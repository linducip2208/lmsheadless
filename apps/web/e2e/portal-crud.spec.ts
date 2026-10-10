import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Real-browser CRUD against the actual portals (admin :5173, student :5174,
// teacher :5175, parent :5176) + live API (:8787). Disposable fixtures with
// unique suffixes; server-side verification after every UI action; cleanup
// deletes only records created by these tests (via superadmin API).
const API = process.env.API_BASE ?? 'http://localhost:8787';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5173';
const STUDENT_URL = process.env.STUDENT_URL ?? 'http://localhost:5174';
const TEACHER_URL = process.env.TEACHER_URL ?? 'http://localhost:5175';
const PARENT_URL = process.env.PARENT_URL ?? 'http://localhost:5176';
const PASS = 'Password123!';
const ADMIN = 'admin@example.com';
const SUPER = 'superadmin@example.com';

// Real-browser CRUD flows are long (multiple logins, fixtures, reloads);
// the repo default 60s timeout flakes them under parallel-file load.
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

test('admin: login, create user via UI, persists after reload, delete removes', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const em = `pc-admin-${uniq()}@example.com`;
  // Delete buttons render for super_admin only (server enforces the same).
  await adminLogin(page, SUPER);
  await page.locator('a[href="#/users"]').click();
  await page.locator('#crud-new').click();
  await page.locator('.modal-dialog [name="email"]').fill(em);
  await page.locator('.modal-dialog [name="password"]').fill(PASS);
  await page.locator('.modal-dialog [name="name"]').fill('Portal CRUD');
  await page.locator('.modal-dialog button[type="submit"]').click();
  // Row appears in the roster…
  await page.locator('#crud-q').fill(em);
  await expect(page.locator('#view', { hasText: em }).first()).toBeVisible({ timeout: 15000 });
  // …and persists server-side (verified via API, not just DOM).
  const sup = await apiLogin(request, SUPER);
  const list = await request.get(`${API}/api/v1/users?q=${encodeURIComponent(em)}`, {
    headers: H(sup.access_token),
  });
  expect(list.status()).toBe(200);
  const rows = ((await list.json()) as { data: { id: string; email: string }[] }).data;
  expect(rows.some((u) => u.email === em)).toBe(true);
  const uid = rows.find((u) => u.email === em)!.id;
  // Reload keeps the record (persistence, not DOM state).
  await page.reload();
  await page.locator('#crud-q').fill(em);
  await expect(page.locator('#view', { hasText: em }).first()).toBeVisible({ timeout: 15000 });
  // Delete via UI with confirmation; row disappears and stays gone via API.
  await page.locator('[data-del]').first().click();
  await page.locator('[data-ok]').click();
  await expect(page.locator('#view', { hasText: em })).toHaveCount(0, { timeout: 15000 });
  const gone = await request.get(`${API}/api/v1/users/${uid}`, { headers: H(sup.access_token) });
  expect([404, 403]).toContain(gone.status());
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('teacher: login, add section+lesson via UI, persists after reload', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const sup = await apiLogin(request, SUPER);
  const admin = await apiLogin(request, ADMIN);
  const orgs = (await (
    await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
  ).json()) as { data: { id: string }[] };
  const org = orgs.data[0].id;
  const tag = uniq();
  // Deterministic fixture via API as the teacher (teacher UI has no
  // course-create control; teacher-created courses are visible to them).
  const ttok = (
    await request.post(`${API}/api/v1/auth/login`, {
      data: { email: 'teacher@example.com', password: PASS },
    })
  ).json();
  const teacherToken = ((await ttok) as { data: { access_token: string } }).data.access_token;
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(teacherToken), ...J },
      data: { organization_id: org, code: `PC${tag}`.slice(0, 32), title: `PC Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  // Assign the teacher (instructor/courses is assignment-scoped).
  const members = (await (
    await request.get(`${API}/api/v1/users?q=teacher@example.com`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: { id: string; email: string }[] };
  const teacherId = members.data.find((u) => u.email === 'teacher@example.com')!.id;
  const assign = await request.post(`${API}/api/v1/courses/${cid}/instructors`, {
    headers: { ...H(admin.access_token), ...J },
    data: { user_id: teacherId },
  });
  expect(assign.status()).toBe(201);
  await page.goto(`${TEACHER_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill('teacher@example.com');
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  // Deep link straight to the course builder.
  await page.goto(`${TEACHER_URL}/#/courses/${cid}`);
  await page.locator('#sec-add').click();
  await page.locator('.modal-dialog [name="title"]').fill(`PC Section ${tag}`);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#secs', { hasText: `PC Section ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Reload: section persisted server-side.
  await page.reload();
  await expect(page.locator('#secs', { hasText: `PC Section ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const secs = (await (
    await request.get(`${API}/api/v1/courses/${cid}/sections`, { headers: H(admin.access_token) })
  ).json()) as { data: { id: string; title: string }[] };
  expect(secs.data.some((s) => s.title === `PC Section ${tag}`)).toBe(true);
  // Cleanup only our fixture (API as superadmin).
  for (const s of secs.data.filter((x) => x.title === `PC Section ${tag}`)) {
    await request.delete(`${API}/api/v1/courses/sections/${s.id}`, {
      headers: H(sup.access_token),
    });
  }
  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student: login, free enroll + complete lesson via UI, progress persists', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const orgs = (await (
    await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
  ).json()) as { data: { id: string }[] };
  const org = orgs.data[0].id;
  const tag = uniq();
  // Fresh student + free course with one lesson (API fixtures).
  const em = `pc-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: 'PC Student', organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `PCS${tag}`.slice(0, 32),
        title: `PC Learn ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const sec = (await (
    await request.post(`${API}/api/v1/courses/${cid}/sections`, {
      headers: { ...H(admin.access_token), ...J },
      data: { title: 'S1' },
    })
  ).json()) as { data: { id: string } };
  const les = (await (
    await request.post(`${API}/api/v1/courses/sections/${sec.data.id}/lessons`, {
      headers: { ...H(admin.access_token), ...J },
      data: { title: 'L1', content_type: 'text', body: 'belajar' },
    })
  ).json()) as { data: { id: string } };
  await request.patch(`${API}/api/v1/courses/${cid}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published', visibility: 'public' },
  });
  // UI login + enroll from the shop.
  await page.goto(`${STUDENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(em);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  await page.goto(`${STUDENT_URL}/#/shop`);
  await page.locator(`[data-enroll="${cid}"]`).click();
  // Wait for the enrollment to commit server-side before opening the course
  // (avoids a 403 race between the enroll POST and courseDetail fetch).
  const stok = (await apiLogin(request, em)).access_token;
  let enrolled = false;
  for (let i = 0; i < 20 && !enrolled; i++) {
    const rep = (await (
      await request.get(`${API}/api/v1/reports/student-progress`, { headers: H(stok) })
    ).json()) as { data: { enrollments: { course_id: string }[] } };
    enrolled = rep.data.enrollments.some((e) => e.course_id === cid);
    if (!enrolled) await page.waitForTimeout(500);
  }
  expect(enrolled).toBe(true);
  // Home shows the enrollment after reload (server state, not toast).
  await page.goto(`${STUDENT_URL}/#/`);
  await expect(page.locator('#view', { hasText: `PC Learn ${tag}` }).first()).toBeVisible({
    timeout: 15000,
  });
  // Complete the lesson through the Learn tab. The completion POST must
  // finish before reload, otherwise reload aborts it and progress is lost.
  await page.goto(`${STUDENT_URL}/#/courses/${cid}`);
  await page.locator('[data-t="learn"], button:has-text("Learn")').first().click();
  const done = page.waitForResponse(
    (r) => r.url().includes('/complete') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('[data-done]').first().click();
  const completed = await done;
  expect(completed.ok()).toBe(true);
  await page.reload();
  const me = await apiLogin(request, em);
  const prog = (await (
    await request.get(`${API}/api/v1/courses/${cid}/progress`, { headers: H(me.access_token) })
  ).json()) as { data: { progress?: { percent: number } } };
  expect(prog.data.progress?.percent).toBe(100);
  void les;
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('parent: linked child visible with detail, empty state honest', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  await page.goto(`${PARENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill('parent@example.com');
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  // Seeded link: parent sees the linked child and can open detail.
  await expect(page.locator('#view', { hasText: 'Budi Siswa' }).first()).toBeVisible({
    timeout: 15000,
  });
  await page.locator('[data-child]').first().click();
  await expect(page.locator('#detail')).not.toBeEmpty({ timeout: 15000 });
  // Fresh parent with no links gets the honest empty state, not an error.
  const admin = await apiLogin(request, ADMIN);
  const orgs = (await (
    await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
  ).json()) as { data: { id: string }[] };
  const em = `pc-parent-${uniq()}@example.com`;
  await request.post(`${API}/api/v1/auth/register`, {
    data: {
      email: em,
      password: PASS,
      name: 'PC Parent',
      organization_id: orgs.data[0].id,
      role: 'parent',
    },
  });
  await page.goto(`${PARENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(em);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  await expect(page.locator('#view', { hasText: 'No linked students' })).toBeVisible({
    timeout: 15000,
  });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
