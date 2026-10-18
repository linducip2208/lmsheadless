import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Commerce + search leftovers (round 6): payouts approve/reject through the
// in-app confirms, revenue cards matching the server, global search
// rendering real results. Fixtures via API; server re-verified.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5173';
const PASS = 'Password123!';
const ADMIN = 'admin@example.com';

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

test('admin payouts: approve one, reject one, conditional transitions hold', async ({
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
  const mk = async (amount: number) =>
    (
      (await (
        await request.post(`${API}/api/v1/payouts`, {
          headers: { ...H(admin.access_token), ...J },
          data: { organization_id: org, amount, method: 'manual' },
        })
      ).json()) as { data: { id: string } }
    ).data.id;
  const p1 = await mk(50000);
  const p2 = await mk(25000);

  await adminLogin(page);
  await page.locator('a[href="#/commerce"]').click();
  await page.locator('button[data-tab="payouts"]').click();
  await expect(page.locator('#p-list', { hasText: '50000' })).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`[data-approve="${p1}"]`).click();
  await page.locator('[data-ok]').click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/payouts?organization_id=${org}`, {
        headers: H(admin.access_token),
      });
      return ((await r.json()) as { data: { id: string; status: string }[] }).data.find(
        (x) => x.id === p1
      )!.status;
    })
    .toBe('paid');
  await page.locator(`[data-reject="${p2}"]`).click();
  await page.locator('[data-ok]').click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/payouts?organization_id=${org}`, {
        headers: H(admin.access_token),
      });
      return ((await r.json()) as { data: { id: string; status: string }[] }).data.find(
        (x) => x.id === p2
      )!.status;
    })
    .toBe('rejected');
  // Second decision on a decided payout is rejected (conditional transition).
  const again = await request.post(`${API}/api/v1/payouts/${p1}/decide`, {
    headers: { ...H(admin.access_token), ...J },
    data: { approve: false },
  });
  expect(again.status()).toBe(400);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin revenue + search: cards match server, query finds fixtures', async ({
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
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `RS${tag}`.slice(0, 32), title: `RS Searchable ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;

  await adminLogin(page);
  await page.locator('a[href="#/commerce"]').click();
  await page.locator('button[data-tab="revenue"]').click();
  const rev = await request.get(`${API}/api/v1/commerce/revenue?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(rev.status()).toBe(200);
  const byStatus = ((await rev.json()) as { data: { by_status: { status: string; n: number }[] } })
    .data.by_status;
  // Static cards always render; dynamic status cards mirror the server rows.
  await expect(page.locator('#c-body', { hasText: 'commissions' })).toBeVisible({
    timeout: 15000,
  });
  for (const s of byStatus.slice(0, 3)) {
    await expect(page.locator('#c-body', { hasText: s.status }).first()).toBeVisible({
      timeout: 15000,
    });
  }
  // Global search finds the fixture course by title fragment.
  await page.locator('#g-q').fill(`Searchable ${tag}`);
  await page.locator('#g-q').press('Enter');
  await expect(page.locator('#view', { hasText: `RS Searchable ${tag}` })).toBeVisible({
    timeout: 15000,
  });

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
