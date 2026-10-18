import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Admin live tab (round 6, final residue): schedule → reschedule → record
// attendance → cancel, plus the .ics export link. Fixtures via API; every
// UI action re-verified server-side.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5173';
const PASS = 'Password123!';
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

test('admin live: schedule, reschedule, record attendance, cancel', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const sem = `lv-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `LV Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const sid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;
  const starts = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const ends = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  const starts2 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);
  const ends2 = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 16);

  await adminLogin(page);
  await page.locator('a[href="#/live"]').click();
  await page.locator('#lv-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`LV Session ${tag}`);
  await page.locator('.modal-dialog select[name="provider"]').selectOption('jitsi');
  await page.locator('.modal-dialog [name="starts_at"]').fill(starts);
  await page.locator('.modal-dialog [name="ends_at"]').fill(ends);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#lv-list', { hasText: `LV Session ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const sl = await request.get(`${API}/api/v1/live-sessions?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(sl.status()).toBe(200);
  const sess = (
    (await sl.json()) as {
      data: { id: string; title: string; status: string; starts_at: string }[];
    }
  ).data.find((s) => s.title === `LV Session ${tag}`)!;
  expect(sess.status).toBe('scheduled');

  // Reschedule through the modal; the server start moves.
  await page.locator(`[data-resched="${sess.id}"]`).click();
  await page.locator('.modal-dialog [name="starts_at"]').fill(starts2);
  await page.locator('.modal-dialog [name="ends_at"]').fill(ends2);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/live-sessions?organization_id=${org}`, {
        headers: H(admin.access_token),
      });
      return ((await r.json()) as { data: { id: string; starts_at: string }[] }).data.find(
        (s) => s.id === sess.id
      )!.starts_at;
    })
    .toBe(starts2);

  // Record attendance: the POST response itself is the server proof.
  await page.locator(`[data-att="${sess.id}"]`).click();
  await page.locator('.modal-dialog [name="user_ids"]').fill(sid);
  const recorded = page.waitForResponse(
    (r) => r.url().includes(`/live-sessions/${sess.id}/attendance`),
    { timeout: 15000 }
  );
  await page.locator('.modal-dialog button[type="submit"]').click();
  const rec = await recorded;
  expect(rec.ok()).toBeTruthy();
  expect(((await rec.json()) as { data: { recorded: number } }).data.recorded).toBe(1);

  // Cancel: badge flips, action buttons disappear, server confirms.
  await page.locator(`[data-cancel="${sess.id}"]`).click();
  await expect(page.locator(`[data-cancel="${sess.id}"]`)).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('#lv-list', { hasText: 'cancelled' }).first()).toBeVisible({
    timeout: 15000,
  });
  const after = await request.get(`${API}/api/v1/live-sessions?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(
    ((await after.json()) as { data: { id: string; status: string }[] }).data.find(
      (s) => s.id === sess.id
    )!.status
  ).toBe('cancelled');

  // The .ics export downloads through the authenticated helper (a bare
  // anchor could never carry the memory token → 401).
  const ics = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('#lv-ics').click();
  const icsFile = await ics;
  expect(icsFile.suggestedFilename()).toBe('live-sessions.ics');
  const icsPath = (await icsFile.path()) ?? '';
  expect(readFileSync(icsPath, 'utf8')).toContain('BEGIN:VCALENDAR');

  // No session delete endpoint ships (cancelled sessions are history);
  // only the student fixture is removed.
  await request.delete(`${API}/api/v1/users/${sid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
