import { Hono } from 'hono';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { courseOrg, canTeach, orgStorageExceeded, userStorageExceeded } from '../access.js';
import { putObject, getObject, sniffKind, zipRatioExceeded } from '../storage.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const h5p = new Hono<{ Variables: AppVars }>();

const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_FILES = 500;

interface H5PManifest {
  title: string;
  mainLibrary: string;
}

async function loadZip(buf: ArrayBuffer): Promise<{
  file: (name: string) => { async: (k: 'uint8array') => Promise<Uint8Array> } | null;
  fileNames: string[];
}> {
  const JSZip = (await import('jszip')) as unknown as {
    loadAsync?: (data: ArrayBuffer) => Promise<{
      files: Record<string, { dir: boolean; async: (kind: 'uint8array') => Promise<Uint8Array> }>;
    }>;
    default?: {
      loadAsync: (data: ArrayBuffer) => Promise<{
        files: Record<string, { dir: boolean; async: (kind: 'uint8array') => Promise<Uint8Array> }>;
      }>;
    };
  };
  const loadAsync = JSZip.loadAsync ?? JSZip.default?.loadAsync;
  if (!loadAsync) throw new Error('zip engine unavailable');
  const zip = await loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  return { fileNames: names, file: (name: string) => zip.files[name] ?? null };
}

function cleanEntryPath(p: string): string | null {
  if (!p || p.includes('..') || p.startsWith('/') || p.length > 400) return null;
  const lower = p.toLowerCase();
  if (lower.endsWith('.php') || lower.endsWith('.exe') || lower.endsWith('.sh')) return null;
  return p.replace(/^\/+/, '');
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

// Minimal native H5P runtime: accepts a .h5p (zip with h5p.json), validates
// the manifest, stores extracted content sandboxed, and tracks attempts.
// Full H5P editor/authoring stays out of scope; playback + scoring is native.
h5p.post('/h5p/upload', requireAuth(), async (c) => {
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
  if (!file.name.toLowerCase().endsWith('.h5p'))
    return fail(c, 400, 'INVALID_PACKAGE', 'H5P package must be a .h5p file');
  if (file.size > MAX_TOTAL) return fail(c, 400, 'INVALID_PACKAGE', 'Package exceeds 100MB');
  if (await orgStorageExceeded(c.get('db'), orgId, file.size))
    return fail(c, 413, 'QUOTA_EXCEEDED', 'Organization storage quota exceeded');
  if (await userStorageExceeded(c.get('db'), orgId, user.id, file.size))
    return fail(c, 413, 'QUOTA_EXCEEDED', 'Per-user storage quota exceeded');
  if (courseId && (await courseOrg(c.get('db'), courseId)) !== orgId)
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const buf = await file.arrayBuffer();
  if (sniffKind(buf) !== 'zip')
    return fail(c, 400, 'INVALID_PACKAGE', 'File content is not a ZIP archive');
  let zip: {
    file: (n: string) => { async: (k: 'uint8array') => Promise<Uint8Array> } | null;
    fileNames: string[];
  };
  try {
    zip = await loadZip(buf);
  } catch {
    return fail(c, 400, 'INVALID_PACKAGE', 'Unrecognized archive');
  }
  if (zip.fileNames.length > MAX_FILES)
    return fail(c, 400, 'INVALID_PACKAGE', `Too many files (max ${MAX_FILES})`);
  const manifestFile = zip.fileNames.find(
    (n) => n.toLowerCase() === 'h5p.json' || n.toLowerCase().endsWith('/h5p.json')
  );
  if (!manifestFile) return fail(c, 400, 'INVALID_PACKAGE', 'h5p.json not found in package');
  let manifest: H5PManifest;
  try {
    const raw = Buffer.from((await zip.file(manifestFile)?.async('uint8array')) ?? new Uint8Array())
      .toString('utf8')
      .slice(0, 100000);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.title !== 'string' || typeof parsed.mainLibrary !== 'string')
      throw new Error('bad manifest');
    manifest = {
      title: parsed.title.slice(0, 200),
      mainLibrary: String(parsed.mainLibrary).slice(0, 120),
    };
  } catch {
    return fail(c, 400, 'INVALID_PACKAGE', 'Invalid h5p.json manifest');
  }
  const pkgId = newId();
  const now = nowIso();
  let stored = 0;
  for (const name of zip.fileNames) {
    const safe = cleanEntryPath(name);
    if (!safe) continue;
    const data = await zip.file(name)?.async('uint8array');
    if (!data) continue;
    if (stored + data.byteLength > MAX_TOTAL)
      return fail(c, 400, 'INVALID_PACKAGE', 'Unpacked size exceeds 100MB');
    if (zipRatioExceeded(file.size, stored + data.byteLength))
      return fail(
        c,
        400,
        'INVALID_PACKAGE',
        'Archive compression ratio exceeded (possible zip bomb)'
      );
    stored += data.byteLength;
    const key = `h5p/${pkgId}/${safe}`;
    const ext = safe.split('.').pop()?.toLowerCase() ?? '';
    await putObject(
      c.get('env'),
      key,
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      MIME_BY_EXT[ext] ?? 'application/octet-stream'
    );
  }
  const zipKey = `h5p/${pkgId}/${file.name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'package.h5p'}`;
  await putObject(c.get('env'), zipKey, buf, 'application/octet-stream');
  const db = c.get('db');
  await execute(
    db,
    'INSERT INTO h5p_packages (id, organization_id, course_id, lesson_id, title, main_library, entry_url, file_key, manifest_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    pkgId,
    orgId,
    courseId,
    lessonId,
    manifest.title,
    manifest.mainLibrary,
    'content/index.html',
    zipKey,
    JSON.stringify({ mainLibrary: manifest.mainLibrary, files: stored }),
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
    zipKey,
    file.name.slice(0, 255),
    'application/octet-stream',
    file.size,
    'h5p',
    now
  );
  await audit(c, 'h5p.uploaded', {
    entity: 'h5p_package',
    entityId: pkgId,
    organizationId: orgId,
    metadata: { title: manifest.title, mainLibrary: manifest.mainLibrary },
  });
  return created(c, { id: pkgId, title: manifest.title, main_library: manifest.mainLibrary });
});

h5p.get('/h5p/packages', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const courseId = url.searchParams.get('course_id');
  const orgId = url.searchParams.get('organization_id');
  const db = c.get('db');
  if (courseId) {
    const oid = await courseOrg(db, courseId);
    if (!oid || !canAccessOrg(user, oid))
      return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    return ok(
      c,
      await queryAll(
        db,
        'SELECT id, title, main_library, entry_url, created_at FROM h5p_packages WHERE course_id = ? ORDER BY created_at DESC, id DESC LIMIT 200',
        courseId
      )
    );
  }
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  return ok(
    c,
    await queryAll(
      db,
      'SELECT id, title, main_library, entry_url, course_id, created_at FROM h5p_packages WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 200',
      orgId
    )
  );
});

// Sandboxed content fetch: tenant-checked, MIME-allowlisted, never serves
// archives or executables inline.
h5p.get('/h5p/packages/:id/content', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const pkg = await queryFirst<{
    organization_id: string;
    file_key: string;
    entry_url: string;
    title: string;
    main_library: string;
  }>(
    db,
    'SELECT organization_id, file_key, entry_url, title, main_library FROM h5p_packages WHERE id = ?',
    c.req.param('id')
  );
  if (!pkg) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, pkg.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const path = new URL(c.req.url).searchParams.get('path') ?? pkg.entry_url;
  const safe = cleanEntryPath(path);
  if (!safe) return fail(c, 400, 'VALIDATION_ERROR', 'Unsafe path');
  const ext = safe.split('.').pop()?.toLowerCase() ?? '';
  if (!(ext in MIME_BY_EXT)) return fail(c, 400, 'VALIDATION_ERROR', 'Unsupported content type');
  const obj = await getObject(c.get('env'), `h5p/${c.req.param('id')}/${safe}`);
  if (!obj) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  c.header('Content-Type', MIME_BY_EXT[ext]);
  c.header('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'");
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(obj.body as ArrayBuffer);
});

// Attempt tracking: start/resume + xAPI-style score commit.
h5p.post('/h5p/attempts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { package_id?: string } | null;
  if (!body?.package_id)
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const pkg = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM h5p_packages WHERE id = ?',
    body.package_id
  );
  if (!pkg) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, pkg.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const existing = await queryFirst<{ id: string }>(
    db,
    'SELECT id FROM h5p_attempts WHERE package_id = ? AND student_id = ? AND completed = 0',
    body.package_id,
    user.id
  );
  if (existing) return ok(c, { id: existing.id, resumed: true });
  const nid = newId();
  const now = nowIso();
  await execute(
    db,
    'INSERT INTO h5p_attempts (id, package_id, student_id, completed, started_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    nid,
    body.package_id,
    user.id,
    now,
    now,
    now
  );
  return created(c, { id: nid });
});

h5p.post('/h5p/attempts/:id/commit', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as {
    score?: number;
    max_score?: number;
    completed?: boolean;
    state?: unknown;
  } | null;
  const db = c.get('db');
  const att = await queryFirst<{ package_id: string; student_id: string; completed: number }>(
    db,
    'SELECT package_id, student_id, completed FROM h5p_attempts WHERE id = ?',
    c.req.param('id')
  );
  if (!att) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (att.student_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const score = typeof body?.score === 'number' ? Math.max(0, Math.min(1000000, body.score)) : null;
  const maxScore =
    typeof body?.max_score === 'number' ? Math.max(0, Math.min(1000000, body.max_score)) : null;
  const completed = body?.completed === true ? 1 : 0;
  const now = nowIso();
  await execute(
    db,
    'UPDATE h5p_attempts SET score = ?, max_score = ?, completed = ?, completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END, state = ?, updated_at = ? WHERE id = ?',
    score,
    maxScore,
    completed,
    completed,
    now,
    body?.state === undefined ? null : JSON.stringify(body.state).slice(0, 20000),
    now,
    c.req.param('id')
  );
  return ok(c, { committed: true, completed: completed === 1 });
});

export default h5p;
