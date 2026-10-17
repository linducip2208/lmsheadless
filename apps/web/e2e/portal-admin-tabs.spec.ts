import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Admin tab CRUD beyond users/courses/commerce (round 4): cohorts (create →
// member add → roster → delete), programs (create → course → view → delete)
// and settings → org branding merge. Disposable fixtures; every UI action is
// re-verified server-side; cleanup deletes only test-created rows.
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

async function adminLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/#/login`);
  await page.locator('#email').fill(ADMIN);
  await page.locator('#password').fill(PASS);
  await page.locator('#login-form button[type="submit"], #login-form button.w-100').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

test('admin cohorts tab: create, add member, roster, delete (server-verified)', async ({
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
  const sname = `CR Student ${tag}`;
  const sem = `cr-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: sname, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const sid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

  await adminLogin(page);
  await page.locator('a[href="#/cohorts"]').click();
  await page.locator('#co-new').click();
  await page.locator('.modal-dialog [name="name"]').fill(`CR Cohort ${tag}`);
  await page.locator('.modal-dialog [name="capacity"]').fill('25');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#co-list', { hasText: `CR Cohort ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Server: the cohort row exists with the org + capacity.
  const list = await request.get(`${API}/api/v1/cohorts?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(list.status()).toBe(200);
  const row = (
    (await list.json()) as { data: { id: string; name: string; capacity: number | null }[] }
  ).data.find((c) => c.name === `CR Cohort ${tag}`);
  expect(row?.id).toBeTruthy();
  const cid = row!.id;
  expect(row!.capacity).toBe(25);

  // Member via UI (user_id + default role), roster badge rendered.
  await page.locator(`[data-add="${cid}"]`).click();
  await page.locator('.modal-dialog [name="user_id"]').fill(sid);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await page.locator(`[data-mem="${cid}"]`).click();
  await expect(page.locator(`[data-out="${cid}"]`, { hasText: sname })).toBeVisible({
    timeout: 15000,
  });
  const members = await request.get(`${API}/api/v1/cohorts/${cid}/members`, {
    headers: H(admin.access_token),
  });
  expect(members.status()).toBe(200);
  expect(
    ((await members.json()) as { data: { name: string; role: string }[] }).data.some(
      (m) => m.name === sname && m.role === 'student'
    )
  ).toBe(true);

  // In-app confirm delete → card disappears and the row is gone server-side.
  await page.locator(`[data-cdel="${cid}"]`).click();
  await page.locator('[data-ok]').click();
  await expect(page.locator('#co-list', { hasText: `CR Cohort ${tag}` })).toHaveCount(0, {
    timeout: 15000,
  });
  const after = await request.get(`${API}/api/v1/cohorts?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(((await after.json()) as { data: { id: string }[] }).data.some((c) => c.id === cid)).toBe(
    false
  );

  await request.delete(`${API}/api/v1/users/${sid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin programs tab: create, attach course, view path, delete', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const orgs = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data;
  const org = orgs[0].id;
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `PR${tag}`.slice(0, 32), title: `PR Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;

  await adminLogin(page);
  await page.locator('a[href="#/cohorts"]').click();
  await page.locator('button[data-tab="programs"]').click();
  await page.locator('#pr-new').click();
  await page.locator('.modal-dialog [name="name"]').fill(`PR Path ${tag}`);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#pr-list', { hasText: `PR Path ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Server: program exists; attach the course through the UI modal.
  const plist = await request.get(`${API}/api/v1/programs?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(plist.status()).toBe(200);
  const pid = ((await plist.json()) as { data: { id: string; name: string }[] }).data.find(
    (p) => p.name === `PR Path ${tag}`
  )!.id;
  await page.locator(`[data-add="${pid}"]`).click();
  await page.locator('.modal-dialog [name="course_id"]').fill(cid);
  await page.locator('.modal-dialog button[type="submit"]').click();
  // View renders the ordered course list (name comes from a JOIN server-side).
  await page.locator(`[data-view="${pid}"]`).click();
  await expect(page.locator(`[data-p="${pid}"]`, { hasText: `PR Course ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const detail = await request.get(`${API}/api/v1/programs/${pid}`, {
    headers: H(admin.access_token),
  });
  expect(detail.status()).toBe(200);
  const det = (await detail.json()) as { data: { courses: { course_title: string }[] } };
  expect(det.data.courses.map((c) => c.course_title)).toContain(`PR Course ${tag}`);

  await page.locator(`[data-pdel="${pid}"]`).click();
  await page.locator('[data-ok]').click();
  await expect(page.locator('#pr-list', { hasText: `PR Path ${tag}` })).toHaveCount(0, {
    timeout: 15000,
  });
  const after = await request.get(`${API}/api/v1/programs?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(((await after.json()) as { data: { id: string }[] }).data.some((p) => p.id === pid)).toBe(
    false
  );

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin settings: org branding footer edit merges (does not clobber other keys)', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const orgs = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data;
  const org = orgs[0].id;
  const tag = uniq();
  const footer = `E2E Footer ${tag}`;
  // A distinct settings key must survive the branding-only modal edit (merge).
  const sentinel = `e2e_sentinel_${tag}`.replace(/[^a-z0-9_]/g, '_');
  const pre = await request.put(`${API}/api/v1/organizations/${org}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { settings: { [sentinel]: 'survive', footer_text: '' } },
  });
  expect(pre.status()).toBe(200);

  await adminLogin(page);
  await page.locator('a[href="#/settings"]').click();
  await page.locator('button[data-tab="org"]').click();
  await page.locator('#brand-edit').click();
  await page.locator('.modal-dialog [name="footer_text"]').fill(footer);
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/v1/organizations/') && r.request().method() === 'PUT',
    { timeout: 15000 }
  );
  await page.locator('.modal-dialog button[type="submit"]').click();
  expect((await saved).ok()).toBeTruthy();
  // Public branding subset reflects the new footer (server proof of save).
  const brand = await request.get(`${API}/api/v1/organizations/${org}/branding`);
  expect(brand.status()).toBe(200);
  expect(((await brand.json()) as { data: { footer_text?: string } }).data.footer_text).toBe(
    footer
  );
  // Persistence after reload: a fresh page load renders the saved footer.
  // (The in-place re-render after save can race with a concurrent
  // branding fetch, so reload is the deterministic read-back.)
  await page.reload();
  await page.locator('a[href="#/settings"]').click();
  await page.locator('button[data-tab="org"]').click();
  await expect(page.locator('#set-body', { hasText: footer }).first()).toBeVisible({
    timeout: 15000,
  });
  // The other settings key survived the modal write (merge, not replace).
  const orgFull = await request.get(`${API}/api/v1/organizations/${org}`, {
    headers: H(admin.access_token),
  });
  const stored = JSON.parse(
    ((await orgFull.json()) as { data: { settings: string | null } }).data.settings ?? '{}'
  ) as Record<string, string>;
  expect(stored[sentinel]).toBe('survive');
  expect(stored.footer_text).toBe(footer);

  // Restore: set footer back to empty through the same UI path.
  await page.locator('#brand-edit').click();
  await page.locator('.modal-dialog [name="footer_text"]').fill('');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect
    .poll(async () => {
      const b = await request.get(`${API}/api/v1/organizations/${org}/branding`);
      return ((await b.json()) as { data: { footer_text?: string } }).data.footer_text ?? '';
    })
    .toBe('');
  // Remove the test sentinel key from shared org settings.
  await request.put(`${API}/api/v1/organizations/${org}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { settings: { [sentinel]: '', footer_text: '' } },
  });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
