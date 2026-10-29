import { test, expect } from '@playwright/test';
import {
  ADMIN,
  ADMIN_URL,
  API,
  H,
  J,
  PASS,
  STUDENT_URL,
  SUPER,
  adminLogin,
  apiLogin,
  studentLogin,
  trackErrors,
  uniq,
} from './helpers.js';

// Round-7 lifecycle (browser proof): admin cancels a pending order through
// the in-app confirm, student cancels their own pending order from the shop,
// cron-status renders the last sys.cron runs for super_admin. Fixtures via
// API; server state re-verified after every click.

test.setTimeout(120_000);

test('admin cancels pending order via browser, server re-verified', async ({ page, request }) => {
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
      data: { organization_id: org, code: `RC${tag}`.slice(0, 32), title: `RC Order ${tag}` },
    })
  ).json()) as { data: { id: string } };
  await request.patch(`${API}/api/v1/courses/${course.data.id}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published', visibility: 'public', price_minor: 7500 },
  });
  const stu = `rc7-${tag}@example.com`;
  await request.post(`${API}/api/v1/auth/register`, {
    data: { email: stu, password: PASS, name: `rc ${tag}`, organization_id: org },
  });
  const stok = (await apiLogin(request, stu)).access_token;
  const order = (await (
    await request.post(`${API}/api/v1/orders`, {
      headers: { ...H(stok), ...J },
      data: { organization_id: org, kind: 'course', reference_id: course.data.id },
    })
  ).json()) as { data: { id: string; status: string } };
  expect(order.data.status).toBe('pending');

  await adminLogin(page);
  await page.locator('a[href="#/commerce"]').click();
  await page.locator('button[data-tab="orders"]').click();
  await expect(page.locator(`[data-cancel-order="${order.data.id}"]`)).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`[data-cancel-order="${order.data.id}"]`).click();
  await page.locator('[data-ok]').click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/orders/${order.data.id}`, {
        headers: H(admin.access_token),
      });
      return ((await r.json()) as { data: { order: { status: string } } }).data.order.status;
    })
    .toBe('cancelled');
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student cancels own pending order from the shop', async ({ page, request }) => {
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
      data: { organization_id: org, code: `RS${tag}`.slice(0, 32), title: `RS Order ${tag}` },
    })
  ).json()) as { data: { id: string } };
  await request.patch(`${API}/api/v1/courses/${course.data.id}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published', visibility: 'public', price_minor: 9200 },
  });
  const stu = `rs7-${tag}@example.com`;
  await request.post(`${API}/api/v1/auth/register`, {
    data: { email: stu, password: PASS, name: `rs ${tag}`, organization_id: org },
  });
  const stok = (await apiLogin(request, stu)).access_token;
  const order = (await (
    await request.post(`${API}/api/v1/orders`, {
      headers: { ...H(stok), ...J },
      data: { organization_id: org, kind: 'course', reference_id: course.data.id },
    })
  ).json()) as { data: { id: string } };

  await studentLogin(page, stu);
  await page
    .locator('a[href="#/shop"], button[data-nav="#/shop"]')
    .first()
    .click()
    .catch(() => {});
  await page.goto(`${STUDENT_URL}/#/shop`);
  await expect(page.locator(`[data-cancel-order="${order.data.id}"]`)).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`[data-cancel-order="${order.data.id}"]`).click();
  await page.locator('[data-ok]').click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/orders/${order.data.id}`, {
        headers: H(stok),
      });
      return ((await r.json()) as { data: { order: { status: string } } }).data.order.status;
    })
    .toBe('cancelled');
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('system status page renders cron runs for super_admin', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const sup = await apiLogin(request, SUPER);
  const cron = await request.get(`${API}/api/v1/system/cron-status`, {
    headers: H(sup.access_token),
  });
  expect(cron.status()).toBe(200);

  await page.goto(`${ADMIN_URL}/#/login`);
  await page.locator('#email').fill(SUPER);
  await page.locator('#password').fill(PASS);
  await page.locator('#login-form button[type="submit"], #login-form button.w-100').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  await page.locator('a[href="#/system"]').click();
  await expect(page.locator('#view')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#cron-list')).toBeVisible({ timeout: 15000 });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin commerce tabs: arrow keys move between tabs (roving tablist)', async ({ page }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  await adminLogin(page);
  await page.locator('a[href="#/commerce"]').click();
  const orders = page.locator('button[data-tab="orders"]');
  const coupons = page.locator('button[data-tab="coupons"]');
  await expect(orders).toBeVisible({ timeout: 15000 });
  await coupons.focus();
  await page.keyboard.press('ArrowRight');
  await expect(orders).toHaveClass(/active/);
  await page.keyboard.press('ArrowLeft');
  await expect(coupons).toHaveClass(/active/);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
