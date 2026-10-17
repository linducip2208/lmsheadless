import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Real-browser proof for the admin manual-payment confirm button (release2
// shopping gap: the button was API-verified only). Disposable fixtures via the
// live API; server state re-verified after the click; buyer user is deleted
// afterwards so the seeded order/payments cascade away (ON DELETE CASCADE).
const API = process.env.API_BASE ?? 'http://localhost:8787';
const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5173';
const PASS = 'Password123!';
const ADMIN = 'admin@example.com';
const SUPER = 'superadmin@example.com';

test.setTimeout(120_000);

const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const email = (tag: string) => `e2e-${uniq()}-${tag}@example.com`;
const code = (tag: string) => `E2E${uniq()}${tag}`.toUpperCase().slice(0, 30);
const H = (t: string) => ({ Authorization: `Bearer ${t}` });
const J = { 'content-type': 'application/json' };

type Req = APIRequestContext;

async function trackErrors(page: Page) {
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 500) badResponses.push(`${r.status()} ${r.url()}`);
  });
  return { pageErrors, badResponses };
}

async function apiLogin(req: Req, em: string) {
  const r = await req.post(`${API}/api/v1/auth/login`, { data: { email: em, password: PASS } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { access_token: string; user: { id: string } } }).data;
}

async function adminLogin(page: Page, em = ADMIN) {
  await page.goto(`${ADMIN_URL}/#/login`);
  await page.locator('#email').fill(em);
  await page.locator('#password').fill(PASS);
  await page.locator('#login-form button[type="submit"], #login-form button.w-100').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

test('admin: pending manual payment confirmed via real UI click, order paid', async ({ page }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const req = page.request;

  // ---- Fixtures via the live API (admin + buyer) ----
  const admin = await apiLogin(req, ADMIN);
  const orgsRes = await req.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) });
  expect(orgsRes.status()).toBe(200);
  const org = ((await orgsRes.json()) as { data: { id: string }[] }).data[0].id;

  const courseRes = await req.post(`${API}/api/v1/courses`, {
    headers: { ...H(admin.access_token), ...J },
    data: {
      organization_id: org,
      code: code('PCF'),
      title: `E2E confirm ${uniq()}`,
      slug: `e2e-c-${uniq()}`.toLowerCase(),
      price: 25000,
    },
  });
  expect(courseRes.status()).toBe(201);
  const course = ((await courseRes.json()) as { data: { id: string } }).data.id;

  const buyerEmail = email('buyer');
  const reg = await req.post(`${API}/api/v1/auth/register`, {
    data: { email: buyerEmail, password: PASS, name: 'E2E buyer', organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const buyer = ((await reg.json()) as { data: { access_token: string; user: { id: string } } })
    .data;

  const orderRes = await req.post(`${API}/api/v1/orders`, {
    headers: { ...H(buyer.access_token), ...J },
    data: { organization_id: org, kind: 'course', reference_id: course },
  });
  expect(orderRes.status()).toBe(201);
  const order = ((await orderRes.json()) as { data: { id: string; status: string } }).data;
  expect(order.status).toBe('pending');

  const claim = await req.post(`${API}/api/v1/orders/${order.id}/payments/manual`, {
    headers: { ...H(buyer.access_token), ...J },
    data: { reference: `BANK-${uniq()}` },
  });
  expect(claim.status()).toBe(201);

  // The order detail must expose a pending payment to the admin.
  const detailPre = await req.get(`${API}/api/v1/orders/${order.id}`, {
    headers: H(admin.access_token),
  });
  expect(detailPre.status()).toBe(200);
  const payments = (
    (await detailPre.json()) as { data: { payments: { id: string; status: string }[] } }
  ).data.payments;
  const pending = payments.find((p) => p.status === 'pending');
  expect(pending).toBeTruthy();
  const pendingId = pending!.id;

  // ---- Browser: open commerce → Orders tab → click the real Confirm button ----
  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/#/commerce`);
  await page.locator('[data-tab="orders"]').click();
  const confirmBtn = page.locator(`button[data-confirm="${pendingId}"]`);
  await expect(confirmBtn).toBeVisible({ timeout: 15000 });
  await confirmBtn.click();
  // Native dialogs are banned; the app must open its own confirm dialog.
  const okBtn = page.locator('[data-ok]');
  await expect(okBtn).toBeVisible({ timeout: 10000 });
  await okBtn.click();
  await expect(confirmBtn).toHaveCount(0, { timeout: 15000 });

  // ---- Server state re-verified ----
  const detail = await req.get(`${API}/api/v1/orders/${order.id}`, {
    headers: H(admin.access_token),
  });
  expect(detail.status()).toBe(200);
  const after = (
    (await detail.json()) as {
      data: { order: { status: string }; payments: { id: string; status: string }[] };
    }
  ).data;
  expect(after.order.status).toBe('paid');
  expect(after.payments.find((p) => p.id === pendingId)?.status).toBe('paid'); // product contract: confirm → paid
  // Paid order grants the course entitlement (enrollment active).
  const enrs = (
    (await (
      await req.get(`${API}/api/v1/courses/${course}/enrollments`, {
        headers: H(buyer.access_token),
      })
    ).json()) as { data: { status: string }[] }
  ).data;
  expect(enrs).toContainEqual(expect.objectContaining({ status: 'active' }));
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);

  // ---- Cleanup (only our fixtures): deleting the buyer cascades order/payments.
  // User deletion is super_admin-only (enforced product boundary); course
  // deletion is allowed for the org admin.
  const delUser = await req.delete(`${API}/api/v1/users/${buyer.user.id}`, {
    headers: H(admin.access_token),
  });
  const delCourse = await req.delete(`${API}/api/v1/courses/${course}`, {
    headers: H(admin.access_token),
  });
  expect([200, 204, 404, 403]).toContain(delUser.status()); // 403 when RBAC refuses admins
  expect([200, 204, 404]).toContain(delCourse.status());
  if (delUser.status() === 403) {
    const superLogin = await req.post(`${API}/api/v1/auth/login`, {
      data: { email: SUPER, password: PASS },
    });
    expect(superLogin.status()).toBe(200);
    const superTok = ((await superLogin.json()) as { data: { access_token: string } }).data
      .access_token;
    const del2 = await req.delete(`${API}/api/v1/users/${buyer.user.id}`, {
      headers: H(superTok),
    });
    expect([200, 204, 404]).toContain(del2.status());
  }
});
