import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Teacher profile (round 6 micro-gap): password change through the UI using
// a disposable fixture teacher (seed credentials are never touched).
// New password proven via API login; old password proven dead.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const TEACHER_URL = process.env.TEACHER_URL ?? 'http://localhost:5175';
const PASS = 'Password123!';
const NEWPASS = 'NewPass456!';
const ADMIN = 'admin@example.com';
const SUPER = 'superadmin@example.com';

test.setTimeout(120_000);

const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const H = (t: string) => ({ Authorization: `Bearer ${t}` });

async function trackErrors(page: Page) {
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 500) badResponses.push(`${r.status()} ${r.url()}`);
  });
  return { pageErrors, badResponses };
}

async function apiLogin(req: APIRequestContext, email: string, password = PASS) {
  const r = await req.post(`${API}/api/v1/auth/login`, { data: { email, password } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { access_token: string; user: { id: string } } }).data;
}

test('teacher profile: password change via UI, new works, old dead', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const em = `tp-teacher-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: {
      email: em,
      password: PASS,
      name: `TP Teacher ${tag}`,
      organization_id: org,
      role: 'teacher',
    },
  });
  expect(reg.status()).toBe(201);
  const uid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

  await page.goto(`${TEACHER_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(em);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  await page.locator('a[href="#/profile"]').click();
  await expect(page.locator('#view', { hasText: em })).toBeVisible({ timeout: 15000 });
  await page.locator('#npw').fill(NEWPASS);
  await page.locator('#cpw').fill(PASS);
  const changed = page.waitForResponse(
    (r) => r.url().includes('/auth/password/change') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#pw button[type="submit"], #pw button').first().click();
  expect((await changed).ok()).toBeTruthy();
  // Server: new password logs in, old password is dead.
  await apiLogin(request, em, NEWPASS);
  const dead = await request.post(`${API}/api/v1/auth/login`, {
    data: { email: em, password: PASS },
  });
  expect(dead.status()).toBe(401);

  await request.delete(`${API}/api/v1/users/${uid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
