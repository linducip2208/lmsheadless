import { Hono } from 'hono';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { courseOrg, canTeach } from '../access.js';
import { putObject, getObject } from '../storage.js';
import type { AppVars, AuthUser } from '../types.js';
import type { D1Like } from '../db.js';
import { t } from '../i18n.js';

const scorm = new Hono<{ Variables: AppVars }>();

const MAX_FILES = 500;
const MAX_TOTAL = 100 * 1024 * 1024;
const BLOCKED_EXT = new Set(['php', 'exe', 'sh', 'bat', 'cmd', 'ps1', 'dll', 'so']);

function cleanEntryPath(name: string): string | null {
  // Neutralize traversal + absolute paths; keep forward slashes.
  const norm = name.replace(/\\/g, '/').trim();
  if (!norm || norm.endsWith('/')) return null;
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  const joined = parts.join('/');
  if (joined.length > 400) return null;
  const ext = joined.split('.').pop()?.toLowerCase() ?? '';
  if (BLOCKED_EXT.has(ext)) return null;
  return joined;
}

interface ParsedManifest {
  title: string;
  entry: string;
  version: string;
  resourceCount: number;
}

async function parseManifest(xml: string): Promise<ParsedManifest> {
  const { XMLParser } = (await import('fast-xml-parser')) as unknown as {
    XMLParser: new (opts: Record<string, unknown>) => { parse(x: string): unknown };
  };
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: false,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const manifest = (doc.manifest ?? doc['manifest']) as Record<string, unknown> | undefined;
  if (!manifest || typeof manifest !== 'object')
    throw new Error('Not a SCORM manifest (missing <manifest>)');
  const orgs = manifest.organizations as Record<string, unknown> | undefined;
  const defaultOrg = (orgs?.['@_default'] ?? orgs?.['adlcp:default']) as string | undefined;
  const orgList = orgs?.organization;
  const orgArray = (Array.isArray(orgList) ? orgList : orgList ? [orgList] : []) as Record<
    string,
    unknown
  >[];
  const org = orgArray.find((o) => o['@_identifier'] === defaultOrg) ?? orgArray[0];
  if (!org) throw new Error('Manifest has no <organization>');
  const items = org.item;
  const itemArray = (Array.isArray(items) ? items : items ? [items] : []) as Record<
    string,
    unknown
  >[];
  // First item with identifierref (nested items supported one level).
  const findRef = (list: Record<string, unknown>[]): string | null => {
    for (const it of list) {
      if (typeof it['@_identifierref'] === 'string') return it['@_identifierref'] as string;
      const nested = it.item;
      const arr = (Array.isArray(nested) ? nested : nested ? [nested] : []) as Record<
        string,
        unknown
      >[];
      const found = findRef(arr);
      if (found) return found;
    }
    return null;
  };
  const ref = findRef(itemArray);
  if (!ref) throw new Error('Manifest organization has no launchable item');
  const resources = (manifest.resources as Record<string, unknown> | undefined)?.resource;
  const resArray = (Array.isArray(resources) ? resources : resources ? [resources] : []) as Record<
    string,
    unknown
  >[];
  const res = resArray.find((r) => r['@_identifier'] === ref);
  const href = res?.['@_href'] as string | undefined;
  if (!href) throw new Error(`Resource ${ref} has no href`);
  const title =
    (org.title as string | undefined) ??
    ((manifest.metadata as Record<string, unknown> | undefined)?.title as string | undefined) ??
    'SCORM Package';
  const schemaVersion =
    ((manifest.metadata as Record<string, unknown> | undefined)?.schemaversion as
      string | undefined) ?? '1.2';
  return {
    title: String(title).slice(0, 200),
    entry: href,
    version: /2004|4th/i.test(schemaVersion) ? '2004' : '1.2',
    resourceCount: resArray.length,
  };
}

async function loadZip(buf: ArrayBuffer): Promise<{
  file: (name: string) => { async: (kind: 'uint8array') => Promise<Uint8Array> } | null;
  fileNames: string[];
}> {
  const JSZip = (await import('jszip')) as unknown as {
    loadAsync: (data: ArrayBuffer) => Promise<{
      files: Record<string, { dir: boolean; async: (kind: 'uint8array') => Promise<Uint8Array> }>;
    }>;
  };
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  return {
    fileNames: names,
    file: (name: string) => zip.files[name] ?? null,
  };
}

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
  xml: 'text/xml',
};

scorm.post('/scorm/upload', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  const orgId =
    typeof form?.get('organization_id') === 'string' ? String(form.get('organization_id')) : '';
  const courseId =
    typeof form?.get('course_id') === 'string' ? String(form.get('course_id')) : null;
  const lessonId =
    typeof form?.get('lesson_id') === 'string' ? String(form.get('lesson_id')) : null;
  if (!(file instanceof File)) return fail(c, 400, 'VALIDATION_ERROR', 'file is required');
  if (!orgId || !canTeach(user, orgId))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (!file.name.toLowerCase().endsWith('.zip'))
    return fail(c, 400, 'INVALID_PACKAGE', 'SCORM package must be a .zip file');
  if (file.size > MAX_TOTAL) return fail(c, 400, 'INVALID_PACKAGE', 'Package exceeds 100MB');
  if (courseId && (await courseOrg(c.get('db'), courseId)) !== orgId)
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const buf = await file.arrayBuffer();
  let zip: {
    file: (name: string) => { async: (k: 'uint8array') => Promise<Uint8Array> } | null;
    fileNames: string[];
  };
  try {
    zip = await loadZip(buf);
  } catch {
    return fail(c, 400, 'INVALID_PACKAGE', 'Unrecognized ZIP archive');
  }
  if (zip.fileNames.length > MAX_FILES)
    return fail(c, 400, 'INVALID_PACKAGE', `Too many files (max ${MAX_FILES})`);
  const manifestName = zip.fileNames.find((n) => n.toLowerCase().endsWith('imsmanifest.xml'));
  if (!manifestName) return fail(c, 400, 'INVALID_PACKAGE', 'imsmanifest.xml not found in package');
  const manifestXml = Buffer.from(
    (await zip.file(manifestName)?.async('uint8array')) ?? new Uint8Array()
  )
    .toString('utf8')
    .slice(0, 500000);
  let manifest: ParsedManifest;
  try {
    manifest = await parseManifest(manifestXml);
  } catch (e) {
    return fail(
      c,
      400,
      'INVALID_PACKAGE',
      e instanceof Error ? e.message : 'Manifest parse failed'
    );
  }
  if (manifest.version !== '1.2') {
    return fail(
      c,
      400,
      'UNSUPPORTED_VERSION',
      `Only SCORM 1.2 is supported (package declares ${manifest.version}). See docs/scorm.md`
    );
  }
  const base = manifestName.includes('/')
    ? manifestName.slice(0, manifestName.lastIndexOf('/') + 1)
    : '';
  const pkgId = newId();
  const now = nowIso();
  let stored = 0;
  for (const name of zip.fileNames) {
    const rel = name.startsWith(base) ? name.slice(base.length) : name;
    const safe = cleanEntryPath(rel);
    if (!safe) continue;
    const data = await zip.file(name)?.async('uint8array');
    if (!data) continue;
    if (stored + data.byteLength > MAX_TOTAL)
      return fail(c, 400, 'INVALID_PACKAGE', 'Unpacked size exceeds 100MB');
    stored += data.byteLength;
    const key = `scorm/${pkgId}/${safe}`;
    const ext = safe.split('.').pop()?.toLowerCase() ?? '';
    await putObject(
      c.get('env'),
      key,
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      MIME_BY_EXT[ext] ?? 'application/octet-stream'
    );
  }
  const entrySafe = cleanEntryPath(manifest.entry);
  if (!entrySafe) return fail(c, 400, 'INVALID_PACKAGE', 'Manifest entry path is unsafe');
  const db: D1Like = c.get('db');
  await execute(
    db,
    'INSERT INTO scorm_packages (id, organization_id, course_id, lesson_id, title, version, entry_url, file_key, manifest_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    pkgId,
    orgId,
    courseId,
    lessonId,
    manifest.title,
    '1.2',
    entrySafe,
    `scorm/${pkgId}/${file.name}`,
    JSON.stringify({ resources: manifest.resourceCount, files: stored }),
    user.id,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO files (id, organization_id, owner_id, object_key, file_name, mime_type, size_bytes, purpose, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    orgId,
    user.id,
    `scorm/${pkgId}/${file.name}`,
    file.name.slice(0, 255),
    'application/zip',
    file.size,
    'scorm',
    now
  );
  await audit(c, 'scorm.uploaded', {
    entity: 'scorm_package',
    entityId: pkgId,
    organizationId: orgId,
    metadata: { title: manifest.title },
  });
  return created(c, { id: pkgId, title: manifest.title, entry: entrySafe });
});

scorm.get('/scorm/packages', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const courseId = url.searchParams.get('course_id');
  const orgId = url.searchParams.get('organization_id');
  const db = c.get('db');
  if (courseId) {
    const oid = await courseOrg(db, courseId);
    if (!oid || !canAccessOrg(user, oid))
      return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    const rows = await queryAll(
      db,
      'SELECT id, title, version, entry_url, package_version, created_at FROM scorm_packages WHERE course_id = ? ORDER BY package_version DESC',
      courseId
    );
    return ok(c, rows);
  }
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(
    db,
    'SELECT id, title, version, entry_url, package_version, course_id, created_at FROM scorm_packages WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100',
    orgId
  );
  return ok(c, rows);
});

// Serve extracted package content. Tenant-checked; safe MIME; sandboxed by the
// frontend iframe (sandbox="allow-scripts", opaque origin).
scorm.get('/scorm/content/:pkgId/*', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const pkg = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM scorm_packages WHERE id = ?',
    c.req.param('pkgId')
  );
  if (!pkg || !canAccessOrg(user, pkg.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rest = c.req.path.replace(`/api/v1/scorm/content/${c.req.param('pkgId')}/`, '');
  const safe = cleanEntryPath(rest);
  if (!safe) return fail(c, 400, 'VALIDATION_ERROR', 'Unsafe path');
  const obj = await getObject(c.get('env'), `scorm/${c.req.param('pkgId')}/${safe}`);
  if (!obj) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const ext = safe.split('.').pop()?.toLowerCase() ?? '';
  c.header('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', 'sandbox allow-scripts;');
  return c.body(obj.body as ArrayBuffer, 200);
});

scorm.post('/scorm/attempts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const body = (await c.req.json().catch(() => null)) as { package_id?: string } | null;
  if (!body?.package_id)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const pkg = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM scorm_packages WHERE id = ?',
    body.package_id
  );
  if (!pkg || !canAccessOrg(user, pkg.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const existing = await queryFirst<{
    id: string;
    completion: string;
    location: string | null;
    suspend_data: string | null;
  }>(
    db,
    "SELECT id, completion, location, suspend_data FROM scorm_attempts WHERE package_id = ? AND student_id = ? AND completion NOT IN ('completed') ORDER BY updated_at DESC LIMIT 1",
    body.package_id,
    user.id
  );
  if (existing)
    return ok(c, {
      id: existing.id,
      resumed: true,
      location: existing.location,
      suspend_data: existing.suspend_data,
    });
  const nid = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO scorm_attempts (id, package_id, student_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    nid,
    body.package_id,
    user.id,
    now,
    now
  );
  return created(c, { id: nid, resumed: false });
});

const COMPLETION = new Set(['incomplete', 'completed']);
const SUCCESS = new Set(['passed', 'failed', 'unknown']);

scorm.post('/scorm/attempts/:id/commit', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const attempt = await queryFirst<{ package_id: string; student_id: string }>(
    db,
    'SELECT package_id, student_id FROM scorm_attempts WHERE id = ?',
    c.req.param('id')
  );
  if (!attempt) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (attempt.student_id !== user.id)
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as {
    completion?: string;
    success?: string;
    score?: number;
    location?: string;
    total_time?: string;
    suspend_data?: string;
  } | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (body.completion && !COMPLETION.has(body.completion))
    return fail(c, 400, 'VALIDATION_ERROR', 'Invalid completion value');
  if (body.success && !SUCCESS.has(body.success))
    return fail(c, 400, 'VALIDATION_ERROR', 'Invalid success value');
  if (
    body.score !== undefined &&
    (typeof body.score !== 'number' || body.score < 0 || body.score > 100)
  ) {
    return fail(c, 400, 'VALIDATION_ERROR', 'score must be 0-100');
  }
  const now = nowIso();
  const sets: string[] = ['updated_at = ?'];
  const params: (string | number | null)[] = [now];
  if (body.completion) {
    sets.push('completion = ?');
    params.push(body.completion);
  }
  if (body.success) {
    sets.push('success = ?');
    params.push(body.success);
  }
  if (body.score !== undefined) {
    sets.push('score = ?');
    params.push(body.score);
  }
  if (body.location !== undefined) {
    sets.push('location = ?');
    params.push(String(body.location).slice(0, 500));
  }
  if (body.total_time !== undefined) {
    sets.push('total_time = ?');
    params.push(String(body.total_time).slice(0, 32));
  }
  if (body.suspend_data !== undefined) {
    sets.push('suspend_data = ?');
    params.push(String(body.suspend_data).slice(0, 20000));
  }
  params.push(c.req.param('id'));
  await execute(db, `UPDATE scorm_attempts SET ${sets.join(', ')} WHERE id = ?`, ...params);
  // Map completion back to lesson progress when the package is attached to a lesson.
  if (body.completion === 'completed') {
    const pkg = await queryFirst<{
      lesson_id: string | null;
      course_id: string | null;
      organization_id: string;
    }>(
      db,
      'SELECT lesson_id, course_id, organization_id FROM scorm_packages WHERE id = ?',
      attempt.package_id
    );
    if (pkg?.lesson_id && pkg.course_id) {
      await execute(
        db,
        'INSERT INTO lesson_progress (id, lesson_id, student_id, course_id, is_completed, completed_at, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(lesson_id, student_id) DO UPDATE SET is_completed = 1, completed_at = excluded.completed_at, last_activity_at = excluded.last_activity_at',
        newId(),
        pkg.lesson_id,
        user.id,
        pkg.course_id,
        now,
        now,
        now,
        now
      );
    }
  }
  return ok(c, { committed: true });
});

scorm.get('/scorm/packages/:id/attempts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const pkg = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM scorm_packages WHERE id = ?',
    c.req.param('id')
  );
  if (!pkg || !canAccessOrg(user, pkg.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = user.memberships.find((m) => m.organization_id === pkg.organization_id)?.role ?? '';
  if (role === 'student') {
    const mine = await queryAll(
      db,
      'SELECT * FROM scorm_attempts WHERE package_id = ? AND student_id = ? ORDER BY updated_at DESC',
      c.req.param('id'),
      user.id
    );
    return ok(c, mine);
  }
  const rows = await queryAll(
    db,
    'SELECT a.*, u.name as student_name FROM scorm_attempts a JOIN users u ON u.id = a.student_id WHERE a.package_id = ? ORDER BY a.updated_at DESC LIMIT 200',
    c.req.param('id')
  );
  return ok(c, rows);
});

export default scorm;
