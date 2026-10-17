import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Family loop (round 5): student grades view renders a teacher-posted grade,
// and the parent link lifecycle (link → child visible with detail → admin
// revoke → honest empty state). The revoke endpoint is new in round 5.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const STUDENT_URL = process.env.STUDENT_URL ?? 'http://localhost:5174';
const PARENT_URL = process.env.PARENT_URL ?? 'http://localhost:5176';
const PASS = 'Password123!';
const ADMIN = 'admin@example.com';
const SUPER = 'superadmin@example.com';
const TEACHER = 'teacher@example.com';

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

test('student grades view renders teacher-posted grade + certificate', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const teacher = await apiLogin(request, TEACHER);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const em = `fm-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `FM Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(teacher.access_token), ...J },
      data: { organization_id: org, code: `FM${tag}`.slice(0, 32), title: `FM Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const g = await request.post(`${API}/api/v1/grades`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { course_id: cid, student_id: st.user.id, category: 'quiz', score: 92, feedback: 'fm' },
  });
  expect(g.status()).toBe(201);
  const issue = await request.post(`${API}/api/v1/certificates/issue`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { course_id: cid, student_id: st.user.id },
  });
  expect([200, 201]).toContain(issue.status());
  const num = ((await issue.json()) as { data: { certificate_number: string } }).data
    .certificate_number;

  await page.goto(`${STUDENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(em);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  await page.goto(`${STUDENT_URL}/#/grades`);
  await expect(page.locator('#view', { hasText: 'quiz' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#view', { hasText: '92' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#view', { hasText: num.slice(0, 20) })).toBeVisible({
    timeout: 15000,
  });

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('parent link lifecycle: linked child visible, revoked link shows empty state', async ({
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
  const kem = `fm-kid-${tag}@example.com`;
  const kreg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: kem, password: PASS, name: `FM Kid ${tag}`, organization_id: org },
  });
  expect(kreg.status()).toBe(201);
  const kid = ((await kreg.json()) as { data: { user: { id: string } } }).data.user.id;
  const pem = `fm-parent-${tag}@example.com`;
  const preg = await request.post(`${API}/api/v1/auth/register`, {
    data: {
      email: pem,
      password: PASS,
      name: `FM Parent ${tag}`,
      organization_id: org,
      role: 'parent',
    },
  });
  expect(preg.status()).toBe(201);
  const parent = ((await preg.json()) as { data: { user: { id: string } } }).data.user.id;
  const link = await request.post(`${API}/api/v1/users/${parent}/parent-links`, {
    headers: { ...H(admin.access_token), ...J },
    data: { student_id: kid, organization_id: org },
  });
  expect(link.status()).toBe(201);

  await page.goto(`${PARENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(pem);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  await expect(page.locator('#view', { hasText: `FM Kid ${tag}` }).first()).toBeVisible({
    timeout: 15000,
  });
  await page.locator('[data-child]').first().click();
  await expect(page.locator('#detail')).not.toBeEmpty({ timeout: 15000 });

  // Admin revokes the link through the new endpoint; parent reloads into the
  // honest empty state (no stale child card).
  const revoke = await request.delete(`${API}/api/v1/users/${parent}/parent-links/${kid}`, {
    headers: H(admin.access_token),
  });
  expect(revoke.status()).toBe(200);
  await page.reload();
  await expect(page.locator('#view', { hasText: 'No linked students' })).toBeVisible({
    timeout: 15000,
  });

  await request.delete(`${API}/api/v1/users/${kid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${parent}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
