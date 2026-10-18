import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Student shop edges (round 6 micro-gaps): paid bundle buy with manual
// claim, subscription-plan buy, and the full gift loop (paid order → gift
// code → redeem grants enrollment). Fixtures via API; server re-verified.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const STUDENT_URL = process.env.STUDENT_URL ?? 'http://localhost:5174';
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

async function studentLogin(page: Page, email: string) {
  await page.goto(`${STUDENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(email);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

async function orgId(req: APIRequestContext, tok: string) {
  return (
    (await (await req.get(`${API}/api/v1/organizations`, { headers: H(tok) })).json()) as {
      data: { id: string }[];
    }
  ).data[0].id;
}

async function freshStudent(req: APIRequestContext, org: string, tag: string, prefix: string) {
  const em = `${prefix}-${tag}@example.com`;
  const reg = await req.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `${prefix} ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  return {
    em,
    ...((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data,
  };
}

test('student shop: paid bundle buy → pending order + claim', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const st = await freshStudent(request, org, tag, 'scb-student');
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `SCB${tag}`.slice(0, 32),
        title: `SCB Course ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  const bundle = (await (
    await request.post(`${API}/api/v1/bundles`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        name: `SCB Bundle ${tag}`,
        price: 120000,
        course_ids: [course.data.id],
      },
    })
  ).json()) as { data: { id: string } };
  const bid = bundle.data.id;
  const pub = await request.patch(`${API}/api/v1/bundles/${bid}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published' },
  });
  expect(pub.status()).toBe(200);

  await studentLogin(page, st.em);
  await page.goto(`${STUDENT_URL}/#/more`);
  await expect(page.locator('#view')).not.toBeEmpty({ timeout: 15000 });
  await page.goto(`${STUDENT_URL}/#/shop`);
  await page.locator(`[data-buy="bundle:${bid}"]`).click();
  await page.locator('.modal-dialog button[type="submit"]').click();
  const claim = page.waitForResponse(
    (r) => r.url().includes('/payments/manual') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await expect(page.locator('[data-ok]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-ok]').click();
  expect((await claim).ok()).toBeTruthy();
  const orders = await request.get(`${API}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${st.access_token}` },
  });
  const row = (
    (await orders.json()) as { data: { id: string; status: string; reference_id: string }[] }
  ).data.find((o) => o.reference_id === bid)!;
  expect(row.status).toBe('pending');

  await request.delete(`${API}/api/v1/courses/${course.data.id}`, {
    headers: H(admin.access_token),
  });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student shop: subscription plan buy creates subscription', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const st = await freshStudent(request, org, tag, 'scp-student');
  const plan = (await (
    await request.post(`${API}/api/v1/subscription-plans`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, name: `SCP Plan ${tag}`, price: 99000, interval: 'monthly' },
    })
  ).json()) as { data: { id: string } };
  const pid = plan.data.id;

  await studentLogin(page, st.em);
  await page.goto(`${STUDENT_URL}/#/more`);
  await expect(page.locator('#view')).not.toBeEmpty({ timeout: 15000 });
  await page.goto(`${STUDENT_URL}/#/shop`);
  await expect(page.locator('#view', { hasText: `SCP Plan ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const subbed = page.waitForResponse(
    (r) => r.url().includes('/api/v1/subscriptions') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator(`[data-plan="${pid}"]`).click();
  const subRes = await subbed;
  expect(subRes.ok()).toBeTruthy();
  // Server: subscription row created pending (paid plan, provider-driven renewal).
  const subBody = (await subRes.json()) as { data: { id: string; status: string } };
  expect(subBody.data.id).toBeTruthy();
  expect(subBody.data.status).toBe('pending');

  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student shop: gift loop paid order → code → redeem enrolls', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const buyer = await freshStudent(request, org, tag, 'scg-buyer');
  const gifted = await freshStudent(request, org, tag, 'scg-gifted');
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `SCG${tag}`.slice(0, 32),
        title: `SCG Course ${tag}`,
        price: 50000,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  await request.patch(`${API}/api/v1/courses/${cid}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published', visibility: 'public' },
  });
  // Buyer: order → manual claim → admin confirm (paid).
  const ord = await request.post(`${API}/api/v1/orders`, {
    headers: { ...H(buyer.access_token), ...J },
    data: { organization_id: org, kind: 'course', reference_id: cid },
  });
  expect(ord.status()).toBe(201);
  const oid = ((await ord.json()) as { data: { id: string } }).data.id;
  const claim = await request.post(`${API}/api/v1/orders/${oid}/payments/manual`, {
    headers: { ...H(buyer.access_token), ...J },
    data: {},
  });
  expect(claim.status()).toBe(201);
  const odetail = await request.get(`${API}/api/v1/orders/${oid}`, {
    headers: H(admin.access_token),
  });
  const payId = ((await odetail.json()) as { data: { payments: { id: string }[] } }).data
    .payments[0].id;
  const confirm = await request.post(`${API}/api/v1/payments/${payId}/confirm`, {
    headers: H(admin.access_token),
  });
  expect(confirm.status()).toBe(200);
  // Buyer gifts the paid order; recipient redeems through the shop UI.
  const gift = await request.post(`${API}/api/v1/orders/${oid}/gift`, {
    headers: { ...H(buyer.access_token), ...J },
    data: { recipient_email: `${`scg-gifted-${tag}`}@example.com` },
  });
  expect(gift.status()).toBe(201);
  const code = ((await gift.json()) as { data: { code: string } }).data.code;

  await studentLogin(page, gifted.em);
  await page.goto(`${STUDENT_URL}/#/shop`);
  await page.locator('#gift-code').fill(code);
  await page.locator('#gift-f button[type="submit"], #gift-f button').first().click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/courses/${cid}/enrollments`, {
        headers: { Authorization: `Bearer ${gifted.access_token}` },
      });
      return ((await r.json()) as { data: { status: string }[] }).data[0]?.status ?? null;
    })
    .toBe('active');

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  await request.delete(`${API}/api/v1/users/${buyer.user.id}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${gifted.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
