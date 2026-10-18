import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Teacher leftover views (round 6, final residue): cohorts roster with
// progress expand, and AI draft generation against the mock provider
// (no external keys; mock enabled per-test via API, restored after).
const API = process.env.API_BASE ?? 'http://localhost:8787';
const TEACHER_URL = process.env.TEACHER_URL ?? 'http://localhost:5175';
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

async function teacherLogin(page: Page) {
  await page.goto(`${TEACHER_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(TEACHER);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

test('teacher cohorts: roster visible, progress expands per student', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const teacher = await apiLogin(request, TEACHER);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(teacher.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const sem = `tc-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `TC Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const sid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;
  const cohortRes = await request.post(`${API}/api/v1/cohorts`, {
    headers: { ...H(teacher.access_token), ...J },
    data: JSON.stringify({ organization_id: org, name: `TC Cohort ${tag}` }),
  });
  expect(cohortRes.status()).toBe(201);
  const cohort = (await cohortRes.json()) as { data: { id: string } };
  const cid = cohort.data.id;
  const mem = await request.post(`${API}/api/v1/cohorts/${cid}/members`, {
    headers: { ...H(teacher.access_token), ...J },
    data: JSON.stringify({ user_id: sid, role: 'student' }),
  });
  expect(mem.status()).toBe(201);

  await teacherLogin(page);
  await page.locator('a[href="#/cohorts"]').click();
  await expect(page.locator('#co-list', { hasText: `TC Cohort ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`[data-p="${cid}"]`).click();
  await expect(page.locator(`[data-o="${cid}"]`, { hasText: `TC Student ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Server: the same progress payload backs the expanded box.
  const prog = await request.get(`${API}/api/v1/cohorts/${cid}/progress`, {
    headers: H(teacher.access_token),
  });
  expect(prog.status()).toBe(200);
  expect(
    ((await prog.json()) as { data: { students: { name: string }[] } }).data.students.some(
      (s) => s.name === `TC Student ${tag}`
    )
  ).toBe(true);

  await request.delete(`${API}/api/v1/cohorts/${cid}`, { headers: H(admin.access_token) });
  await request.delete(`${API}/api/v1/users/${sid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('teacher AI: mock outline generation renders draft, job listed', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const teacher = await apiLogin(request, TEACHER);
  const admin = await apiLogin(request, ADMIN);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const topic = `E2E topic ${tag}`;
  const mock = await request.put(`${API}/api/v1/ai/config`, {
    headers: { ...H(admin.access_token), ...J },
    data: JSON.stringify({ organization_id: org, provider: 'mock', monthly_limit: 100 }),
  });
  expect(mock.status()).toBe(200);

  await teacherLogin(page);
  await page.locator('a[href="#/ai"]').click();
  await page.locator('#ai-k').selectOption('outline');
  await page.locator('#ai-i').fill(topic);
  await page.locator('#ai-f button[type="submit"], #ai-f button').first().click();
  await expect(page.locator('#ai-o', { hasText: topic })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#ai-o', { hasText: 'review' })).toBeVisible({ timeout: 15000 });
  const jobs = await request.get(`${API}/api/v1/ai/jobs?organization_id=${org}`, {
    headers: H(teacher.access_token),
  });
  expect(jobs.status()).toBe(200);
  expect(
    ((await jobs.json()) as { data: { kind: string; status: string }[] }).data.some(
      (j) => j.kind === 'outline'
    )
  ).toBe(true);

  // Restore provider to disabled (shared org setting, do not leak mock).
  const off = await request.put(`${API}/api/v1/ai/config`, {
    headers: { ...H(admin.access_token), ...J },
    data: JSON.stringify({ organization_id: org, provider: 'disabled' }),
  });
  expect(off.status()).toBe(200);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
