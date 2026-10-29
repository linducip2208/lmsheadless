import { test, expect } from '@playwright/test';
import {
  ADMIN,
  API,
  H,
  J,
  PASS,
  STUDENT_URL,
  SUPER,
  apiLogin,
  studentLogin,
  trackErrors,
  uniq,
} from './helpers.js';

// Student portal workflows beyond free-enroll/lesson-complete (round 4):
// discussion thread + reply through the Talk tab, and a PAID course bought
// from the shop with a manual payment claim through the real buy dialogs.
// Fixtures via API; every UI action re-verified server-side.

test.setTimeout(120_000);

test('student discussion: new thread + reply via Talk tab, server-verified', async ({
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
  const em = `sw-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `SW Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `SW${tag}`.slice(0, 32),
        title: `SW Talk ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.access_token), ...J },
    data: { course_id: cid },
  });

  await studentLogin(page, em);
  await page.goto(`${STUDENT_URL}/#/courses/${cid}`);
  await page.locator('button[data-t="talk"]').click();
  await page.locator('#th-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`SW Thread ${tag}`);
  await page.locator('.modal-dialog [name="body"]').fill('E2E thread body');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#view', { hasText: `SW Thread ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Server: the thread row exists for the course.
  const threads = await request.get(`${API}/api/v1/discussions?course_id=${cid}`, {
    headers: H(st.access_token),
  });
  expect(threads.status()).toBe(200);
  const tid = ((await threads.json()) as { data: { id: string; title: string }[] }).data.find(
    (t) => t.title === `SW Thread ${tag}`
  )!.id;
  // Reply through the inline form; re-render shows the reply alert.
  await page.locator(`form[data-rform="${tid}"] input`).fill('E2E reply body');
  await page.locator(`form[data-rform="${tid}"] button`).first().click();
  await expect(page.locator('#view', { hasText: 'E2E reply body' })).toBeVisible({
    timeout: 15000,
  });
  const reps = await request.get(`${API}/api/v1/discussions/${tid}/replies`, {
    headers: H(st.access_token),
  });
  expect(reps.status()).toBe(200);
  expect(
    ((await reps.json()) as { data: { body: string }[] }).data.some(
      (r) => r.body === 'E2E reply body'
    )
  ).toBe(true);
  // Author still cannot delete via the moderation endpoint (RBAC honest).
  const sDel = await request.delete(`${API}/api/v1/discussions/${tid}`, {
    headers: H(st.access_token),
  });
  expect(sDel.status()).toBe(403);

  // Cleanup: admin moderates the thread away, then course + user fixtures.
  const tDel = await request.delete(`${API}/api/v1/discussions/${tid}`, {
    headers: H(admin.access_token),
  });
  expect(tDel.status()).toBe(200);
  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student shop: buy paid course → pending order → manual payment claim', async ({
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
  const em = `sw-buyer-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `SW Buyer ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const stok = ((await reg.json()) as { data: { access_token: string } }).data.access_token;
  // Published PAID course → the shop renders a buy button (not enroll).
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `SWp${tag}`.slice(0, 32),
        title: `SW Paid ${tag}`,
        price: 50000,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  await request.patch(`${API}/api/v1/courses/${cid}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published', visibility: 'public' },
  });

  await studentLogin(page, em);
  // The shop's buy POST requires organization_id from the portal's stored
  // org; visiting #/more first auto-selects the member's first org.
  await page.goto(`${STUDENT_URL}/#/more`);
  await expect(page.locator('#view')).not.toBeEmpty({ timeout: 15000 });
  await page.goto(`${STUDENT_URL}/#/shop`);
  // Buy opens the coupon modal first (empty coupon is valid), then the
  // in-app pending-payment confirm dialog triggers the manual claim.
  await page.locator(`[data-buy="course:${cid}"]`).click();
  await page.locator('.modal-dialog button[type="submit"]').click();
  const claim = page.waitForResponse(
    (r) => r.url().includes('/payments/manual') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await expect(page.locator('[data-ok]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-ok]').click();
  expect((await claim).ok()).toBeTruthy();
  // Server: order pending + a pending manual payment for it, enrollment NOT
  // granted until an admin confirms (paid gate is honest).
  const orders = await request.get(`${API}/api/v1/orders`, {
    headers: { Authorization: `Bearer ${stok}` },
  });
  expect(orders.status()).toBe(200);
  const row = (
    (await orders.json()) as { data: { id: string; status: string; reference_id: string }[] }
  ).data.find((o) => o.reference_id === cid)!;
  expect(row.status).toBe('pending');
  const odetail = await request.get(`${API}/api/v1/orders/${row.id}`, {
    headers: H(admin.access_token),
  });
  expect(odetail.status()).toBe(200);
  const pay = (
    (await odetail.json()) as { data: { payments: { status: string; method: string }[] } }
  ).data.payments;
  expect(pay.length).toBeGreaterThan(0);
  expect(pay[0].status).toBe('pending');
  const enr = await request.get(`${API}/api/v1/courses/${cid}/enrollments`, {
    headers: { Authorization: `Bearer ${stok}` },
  });
  expect(enr.status()).toBe(200);
  expect(((await enr.json()) as { data: unknown[] }).data.length).toBe(0);

  // Cleanup: deleting the buyer cascades orders + payments (pattern proven in
  // the admin-payment-confirm spec) and the course fixture goes first.
  const me = await request.get(`${API}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${stok}` },
  });
  const uid = ((await me.json()) as { data: { user: { id: string } } }).data.user.id;
  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  const del = await request.delete(`${API}/api/v1/users/${uid}`, {
    headers: H(admin.access_token),
  });
  if (del.status() === 403) {
    const sup = await apiLogin(request, SUPER);
    await request.delete(`${API}/api/v1/users/${uid}`, { headers: H(sup.access_token) });
  }
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
