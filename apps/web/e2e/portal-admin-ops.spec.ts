import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Admin ops tabs (round 5): community announcements (course-scoped modal
// create), files upload via the real file input, global settings edit as
// super_admin, and the audit-log table. Fixtures via API; server
// re-verification after every UI action.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5173';
const PASS = 'Password123!';
const ADMIN = 'admin@example.com';
const SUPER = 'superadmin@example.com';

test.setTimeout(120_000);

const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const H = (t: string) => ({ Authorization: `Bearer ${t}` });
const J = { 'content-type': 'application/json' };

async function trackErrors(page: Page) {
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 500) badResponses.push(`${r.status()} ${r.url()}`);
  });
  return { pageErrors, badResponses };
}

async function apiLogin(req: APIRequestContext, email: string) {
  const r = await req.post(`${API}/api/v1/auth/login`, { data: { email, password: PASS } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { access_token: string; user: { id: string } } }).data;
}

async function adminLogin(page: Page, email = ADMIN) {
  await page.goto(`${ADMIN_URL}/#/login`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASS);
  await page.locator('#login-form button[type="submit"], #login-form button.w-100').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

test('admin community: course-scoped announcement via modal, listed + served', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AN${tag}`.slice(0, 32), title: `AN Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;

  await adminLogin(page);
  await page.locator('a[href="#/community"]').click();
  await page.locator('#ann-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`AN Notice ${tag}`);
  await page.locator('.modal-dialog [name="body"]').fill('E2E announcement body');
  await page.locator('.modal-dialog [name="course_id"]').fill(cid);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#social-body', { hasText: `AN Notice ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Server: the org listing contains the notice (fan-out is prefs-gated).
  const list = await request.get(`${API}/api/v1/announcements?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(list.status()).toBe(200);
  expect(
    ((await list.json()) as { data: { title: string; body: string }[] }).data.some(
      (a) => a.title === `AN Notice ${tag}` && a.body === 'E2E announcement body'
    )
  ).toBe(true);

  // No announcement delete endpoint ships (published notices are history);
  // the course fixture is still removed. The notice row stays documented.
  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin files: upload via file input, listed with download link', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const fname = `e2e-note-${tag}.txt`;

  await adminLogin(page);
  await page.locator('a[href="#/files"]').click();
  await page.locator('#up-file').setInputFiles({
    name: fname,
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e file body'),
  });
  const uploaded = page.waitForResponse(
    (r) => r.url().includes('/api/v1/uploads') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#up-form button[type="submit"], #up-form button').first().click();
  expect((await uploaded).ok()).toBeTruthy();
  await expect(page.locator('#file-list', { hasText: fname })).toBeVisible({ timeout: 15000 });
  // Server: the file record exists with size + download affordance in UI.
  const files = await request.get(`${API}/api/v1/files?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(files.status()).toBe(200);
  const row = (
    (await files.json()) as { data: { id: string; file_name: string; size_bytes: number }[] }
  ).data.find((f) => f.file_name === fname)!;
  expect(row.size_bytes).toBeGreaterThan(0);
  // Authenticated download through the new button: filename + byte proof.
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.locator(`#file-list [data-dl="${row.id}"]`).click();
  const dlFile = await dl;
  expect(dlFile.suggestedFilename()).toBe(fname);
  const dlPath = (await dlFile.path()) ?? '';
  expect(readFileSync(dlPath, 'utf8')).toBe('e2e file body');
  // No file delete endpoint ships; the tiny fixture row stays documented.
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('superadmin settings: global footer edit merges + audit log lists rows', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const sup = await apiLogin(request, SUPER);
  const tag = uniq();
  const footer = `E2E Global ${tag}`;

  await adminLogin(page, SUPER);
  await page.locator('a[href="#/settings"]').click();
  await page.locator('button[data-tab="global"]').click();
  await page.locator('#g-edit').click();
  await page.locator('.modal-dialog [name="footer_text"]').fill(footer);
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/v1/settings') && r.request().method() === 'PUT',
    { timeout: 15000 }
  );
  await page.locator('.modal-dialog button[type="submit"]').click();
  expect((await saved).ok()).toBeTruthy();
  const settings = await request.get(`${API}/api/v1/settings`, {
    headers: H(sup.access_token),
  });
  expect(settings.status()).toBe(200);
  expect(((await settings.json()) as { data: Record<string, string> }).data.footer_text).toBe(
    footer
  );
  // Persistence after reload (same stale-render caution as org branding).
  await page.reload();
  await page.locator('a[href="#/settings"]').click();
  await page.locator('button[data-tab="global"]').click();
  await expect(page.locator('#set-body', { hasText: footer }).first()).toBeVisible({
    timeout: 15000,
  });

  // Audit tab renders real rows (this session's activity guarantees some).
  await page.locator('button[data-tab="audit"]').click();
  await expect(page.locator('#set-body tbody tr').first()).toBeVisible({ timeout: 15000 });

  // Restore the shared global footer through the same UI path.
  await page.locator('button[data-tab="global"]').click();
  await page.locator('#g-edit').click();
  await page.locator('.modal-dialog [name="footer_text"]').fill('');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect
    .poll(async () => {
      const s = await request.get(`${API}/api/v1/settings`, { headers: H(sup.access_token) });
      return ((await s.json()) as { data: Record<string, string> }).data.footer_text ?? '';
    })
    .toBe('');
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

// Minimal stored (uncompressed) ZIP builder: the SCORM importer only needs
// a readable archive with imsmanifest.xml, so the E2E can ship a real
// valid 1.2 package without extra dependencies.
function crc32(data: Uint8Array): number {
  let table: number[] | null = (crc32 as unknown as { t?: number[] }).t ?? null;
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      (table as number[])[n] = c;
    }
    (crc32 as unknown as { t: number[] }).t = table;
  }
  let crc = 0xffffffff;
  for (const b of data) crc = (table as number[])[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new Uint8Array(30 + name.length + f.data.length);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); // store
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    head.set(name, 30);
    head.set(f.data, 30 + name.length);
    chunks.push(head);
    // Central-directory header is 46 fixed bytes (APPNOTE 4.3.12).
    const cen = new Uint8Array(46 + name.length);
    const cd = new DataView(cen.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += head.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    chunks.push(c);
    cdSize += c.length;
  }
  const end = new Uint8Array(22);
  const ed = new DataView(end.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(8, central.length, true);
  ed.setUint16(10, central.length, true);
  ed.setUint32(12, cdSize, true);
  ed.setUint32(16, cdStart, true);
  chunks.push(end);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

test('admin scorm: valid 1.2 package imports; non-zip rejected honestly', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest identifier="M-${tag}" version="1.2"><organizations default="O1"><organization identifier="O1"><title>E2E SCORM ${tag}</title><item identifier="I1" identifierref="R1"><title>Lesson</title></item></organization></organizations><resources><resource identifier="R1" type="webcontent" href="index.html"><file href="index.html"/></resource></resources></manifest>`;
  const enc = new TextEncoder();
  const zip = storedZip([
    { name: 'imsmanifest.xml', data: enc.encode(manifest) },
    { name: 'index.html', data: enc.encode('<html><body>hi</body></html>') },
  ]);

  await adminLogin(page);
  await page.locator('a[href="#/scorm"]').click();
  // Negative first: a .txt is rejected with a clear package error.
  await page.locator('#sc-file').setInputFiles({
    name: `bad-${tag}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('not a package'),
  });
  await page.locator('#sc-form button[type="submit"], #sc-form button').first().click();
  await expect(page.locator('#sc-err', { hasText: '.zip' })).toBeVisible({ timeout: 15000 });
  // Positive: the hand-built 1.2 package imports and lists.
  await page.locator('#sc-file').setInputFiles({
    name: `e2e-${tag}.zip`,
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  });
  const imported = page.waitForResponse(
    (r) => r.url().includes('/api/v1/scorm/upload') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#sc-form button[type="submit"], #sc-form button').first().click();
  expect((await imported).ok()).toBeTruthy();
  await expect(page.locator('#view', { hasText: `E2E SCORM ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const pkgs = await request.get(`${API}/api/v1/scorm/packages?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(pkgs.status()).toBe(200);
  expect(
    ((await pkgs.json()) as { data: { title: string; version: string }[] }).data.some(
      (p) => p.title === `E2E SCORM ${tag}` && p.version === '1.2'
    )
  ).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
