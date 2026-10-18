import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Student submission actions (round 6): assignment submit through the tasks
// tab form, and static exercise submit. Teacher-side reads prove both.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const STUDENT_URL = process.env.STUDENT_URL ?? 'http://localhost:5174';
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

async function studentLogin(page: Page, email: string) {
  await page.goto(`${STUDENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(email);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

test('student assignment submit via tasks form, teacher sees submission', async ({
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
  const em = `sb-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `SB Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(teacher.access_token), ...J },
      data: {
        organization_id: org,
        code: `SB${tag}`.slice(0, 32),
        title: `SB Course ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const asg = (await (
    await request.post(`${API}/api/v1/assignments`, {
      headers: { ...H(teacher.access_token), ...J },
      data: { course_id: cid, title: `SB Asg ${tag}`, max_score: 100 },
    })
  ).json()) as { data: { id: string } };
  const aid = asg.data.id;
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.access_token), ...J },
    data: { course_id: cid },
  });

  await studentLogin(page, em);
  await page.goto(`${STUDENT_URL}/#/courses/${cid}`);
  await page.locator('button[data-t="task"]').click();
  await expect(page.locator('#view', { hasText: `SB Asg ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const submitted = page.waitForResponse(
    (r) => r.url().includes(`/assignments/${aid}/submissions`) && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator(`form[data-sform="${aid}"] input[name="body"]`).fill('SB answer body');
  await page.locator(`form[data-sform="${aid}"] button`).click();
  expect((await submitted).ok()).toBeTruthy();
  await expect(page.locator('#view', { hasText: 'submitted' })).toBeVisible({ timeout: 15000 });
  // Teacher-side read proves the submission row.
  const subs = await request.get(`${API}/api/v1/assignments/${aid}/submissions`, {
    headers: H(teacher.access_token),
  });
  expect(
    ((await subs.json()) as { data: { student_id: string; body: string }[] }).data.some(
      (x) => x.student_id === st.user.id && x.body === 'SB answer body'
    )
  ).toBe(true);

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student exercise submit via form, teacher sees code', async ({ page, request }) => {
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
  const em = `sx2-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `SX2 Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(teacher.access_token), ...J },
      data: {
        organization_id: org,
        code: `SX2${tag}`.slice(0, 32),
        title: `SX2 Course ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const ex = (await (
    await request.post(`${API}/api/v1/exercises`, {
      headers: { ...H(teacher.access_token), ...J },
      data: { course_id: cid, title: `SX2 Ex ${tag}`, statement: 'Return 2.' },
    })
  ).json()) as { data: { id: string } };
  const eid = ex.data.id;
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.access_token), ...J },
    data: { course_id: cid },
  });

  await studentLogin(page, em);
  await page.goto(`${STUDENT_URL}/#/courses/${cid}`);
  await page.locator('button[data-t="code"]').click();
  await expect(page.locator('#view', { hasText: `SX2 Ex ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const sent = page.waitForResponse(
    (r) => r.url().includes(`/exercises/${eid}/submissions`) && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator(`form[data-ex="${eid}"] textarea[name="code"]`).fill('return 2');
  await page.locator(`form[data-ex="${eid}"] button`).click();
  expect((await sent).ok()).toBeTruthy();
  // Teacher-side submissions list carries the student's code.
  const subs = await request.get(`${API}/api/v1/exercises/${eid}/submissions`, {
    headers: H(teacher.access_token),
  });
  expect(subs.status()).toBe(200);
  expect(
    ((await subs.json()) as { data: { student_id: string; code: string }[] }).data.some(
      (x) => x.student_id === st.user.id && x.code === 'return 2'
    )
  ).toBe(true);

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
