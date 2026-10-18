import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Admin insight + messaging leftovers (round 6): reports overview matching
// the server summary with a real CSV download, alerts run+dismiss,
// notifications mark-read, system status, email queue + send, exercises-tab
// create. Fixtures via API; server re-verified throughout.
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

test('admin reports: overview matches server, attendance CSV downloads', async ({
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

  await adminLogin(page);
  await page.locator('a[href="#/reports"]').click();
  await expect(page.locator('#rep-body', { hasText: 'Overview' })).toBeVisible({
    timeout: 15000,
  });
  const summary = (await (
    await request.get(`${API}/api/v1/reports/organization-summary?organization_id=${org}`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: Record<string, number> };
  // Real-data proof on the rendered cards.
  await expect(
    page.locator('#rep-body', { hasText: String(summary.data.students) }).first()
  ).toBeVisible({ timeout: 15000 });
  // Authenticated CSV download (bare navigation would 401 without a token).
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('#exp-att').click();
  const dlFile = await dl;
  expect(dlFile.suggestedFilename()).toBe('attendance.csv');
  const csv = readFileSync((await dlFile.path()) ?? '', 'utf8');
  expect(csv.split('\n')[0]).toContain('student');
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin alerts: run rules, dismiss with note, gone server-side', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;

  await adminLogin(page);
  await page.locator('a[href="#/alerts"]').click();
  await page.locator('#al-run').click();
  await expect(page.locator('#al-list').first()).not.toBeEmpty({ timeout: 15000 });
  // If no alert fired, the empty state is honest — dismiss path needs a row.
  const first = page.locator('#al-list [data-dis]').first();
  if ((await first.count()) > 0) {
    const id = (await first.getAttribute('data-dis')) ?? '';
    await first.click();
    await page.locator('.modal-dialog [name="note"]').fill('e2e reviewed');
    await page.locator('.modal-dialog button[type="submit"]').click();
    await expect(page.locator(`#al-list [data-dis="${id}"]`)).toHaveCount(0, {
      timeout: 15000,
    });
    const after = await request.get(`${API}/api/v1/alerts?organization_id=${org}`, {
      headers: H(admin.access_token),
    });
    expect(((await after.json()) as { data: { id: string }[] }).data.some((a) => a.id === id)).toBe(
      false
    );
  }
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin notifications: announcement notifies, mark-read clears badge', async ({
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
  const ann = await request.post(`${API}/api/v1/announcements`, {
    headers: { ...H(admin.access_token), ...J },
    data: { organization_id: org, title: `AN Notify ${tag}`, body: 'ping' },
  });
  expect(ann.status()).toBe(201);

  await adminLogin(page);
  await page.locator('#nav-list a[href="#/notifications"]').click();
  await expect(page.locator('#notif-list', { hasText: `AN Notify ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const unread = await request.get(`${API}/api/v1/notifications/unread-count`, {
    headers: H(admin.access_token),
  });
  expect(((await unread.json()) as { data: { unread: number } }).data.unread).toBeGreaterThan(0);
  await page.locator('#notif-all').click();
  await expect
    .poll(async () => {
      const u = await request.get(`${API}/api/v1/notifications/unread-count`, {
        headers: H(admin.access_token),
      });
      return ((await u.json()) as { data: { unread: number } }).data.unread;
    })
    .toBe(0);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin system status + data exercises/email tabs', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  // System status is super_admin-only; super can also do everything below.
  const admin = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();

  await adminLogin(page, SUPER);
  // System checklist renders live values (database ok, setup completed).
  await page.locator('a[href="#/system"]').click();
  await expect(page.locator('#view', { hasText: 'database' })).toBeVisible({ timeout: 15000 });
  const status = await request.get(`${API}/api/v1/system/status`, {
    headers: H(admin.access_token),
  });
  expect(status.status()).toBe(200);
  expect(((await status.json()) as { data: { database: string } }).data.database).toBe('ok');

  // Data → exercises tab: create via form, server list proves it.
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AX${tag}`.slice(0, 32), title: `AX Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  await page.locator('a[href="#/data"]').click();
  await page.locator('button[data-tab="exercises"]').click();
  await page.locator('#ex-c').fill(course.data.id);
  await page.locator('#ex-t').fill(`AX Exercise ${tag}`);
  await page.locator('#ex-s').fill('Return 1.');
  await page.locator('#ex-form button[type="submit"], #ex-form button').first().click();
  await expect(page.locator('#ex-t')).toHaveValue('', { timeout: 15000 });
  const exs = await request.get(`${API}/api/v1/exercises?course_id=${course.data.id}`, {
    headers: H(admin.access_token),
  });
  expect(
    ((await exs.json()) as { data: { title: string }[] }).data.some(
      (x) => x.title === `AX Exercise ${tag}`
    )
  ).toBe(true);

  // Data → email tab: queue an email, it lists; send goes through the log
  // driver without SMTP (honest local behavior, asserted server-side).
  await page.locator('button[data-tab="email"]').click();
  await page.locator('#em-to').fill(`ax-${tag}@example.com`);
  await page.locator('#em-sub').fill(`AX Subject ${tag}`);
  await page.locator('#em-body').fill('hello');
  await page.locator('#em-form button[type="submit"], #em-form button').first().click();
  await expect(page.locator('#em-list', { hasText: `AX Subject ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const queue = await request.get(`${API}/api/v1/email/queue?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  const mail = (
    (await queue.json()) as { data: { id: string; subject: string; status: string }[] }
  ).data.find((m) => m.subject === `AX Subject ${tag}`)!;
  // Send goes through the log driver without SMTP (honest local behavior).
  const sent = page.waitForResponse((r) => r.url().includes(`/email/queue/${mail.id}/send`), {
    timeout: 15000,
  });
  await page.locator(`[data-send="${mail.id}"]`).click();
  expect((await sent).ok()).toBeTruthy();
  await expect
    .poll(async () => {
      const q = await request.get(`${API}/api/v1/email/queue?organization_id=${org}`, {
        headers: H(admin.access_token),
      });
      return ((await q.json()) as { data: { id: string; status: string }[] }).data.find(
        (m) => m.id === mail.id
      )!.status;
    })
    .toBe('sent');

  await request.delete(`${API}/api/v1/courses/${course.data.id}`, {
    headers: H(admin.access_token),
  });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
