import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  ADMIN,
  API,
  H,
  J,
  PASS,
  SUPER,
  adminLogin,
  apiLogin,
  trackErrors,
  uniq,
} from './helpers.js';

// Admin catalogue + delivery leftovers (round 6): attendance sessions with
// notes, community discussions tab, bundles publish/view, coupons,
// affiliates, subscription plans. Fixtures via API; server re-verified.

test.setTimeout(120_000);

async function orgId(req: APIRequestContext, tok: string) {
  const orgs = (await (
    await req.get(`${API}/api/v1/organizations`, { headers: H(tok) })
  ).json()) as { data: { id: string }[] };
  return orgs.data[0].id;
}

test('admin attendance: org session, record with note, save persists', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const sem = `am-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `AM Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const sid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

  await adminLogin(page);
  await page.locator('a[href="#/attendance"]').click();
  await page.locator('#sess-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`AM Session ${tag}`);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#sess-list', { hasText: `AM Session ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const sl = await request.get(`${API}/api/v1/attendance/sessions?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  const sessId = ((await sl.json()) as { data: { id: string; title: string }[] }).data.find(
    (s) => s.title === `AM Session ${tag}`
  )!.id;
  // Recorder lists org users; mark ours late with a note, save all.
  await page.locator(`[data-sess="${sessId}"]`).click();
  await expect(page.locator('#sess-detail', { hasText: `AM Student ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`#sess-detail select[data-st="${sid}"]`).selectOption('late');
  await page.locator(`#sess-detail input[data-note="${sid}"]`).fill('e2e note');
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/v1/attendance/records') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#att-save').click();
  const res = await saved;
  expect(res.ok()).toBeTruthy();
  expect(((await res.json()) as { data: { recorded: number } }).data.recorded).toBeGreaterThan(0);
  // Server aggregated report carries our late record.
  const rep = await request.get(`${API}/api/v1/reports/attendance?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  const mine = (
    (await rep.json()) as { data: { students: { name: string; recorded: number }[] } }
  ).data.students.find((x) => x.name === `AM Student ${tag}`)!;
  expect(mine.recorded).toBe(1);

  // No session delete on this page either; remove the student fixture.
  await request.delete(`${API}/api/v1/users/${sid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin community discussions: create thread, replies render', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AD${tag}`.slice(0, 32), title: `AD Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;

  await adminLogin(page);
  await page.locator('a[href="#/community"]').click();
  await page.locator('button[data-tab="dis"]').click();
  await page.locator('#d-course').selectOption(cid);
  await page.locator('#d-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`AD Thread ${tag}`);
  await page.locator('.modal-dialog [name="body"]').fill('E2E admin thread');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#d-list', { hasText: `AD Thread ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const threads = await request.get(`${API}/api/v1/discussions?course_id=${cid}`, {
    headers: H(admin.access_token),
  });
  const tid = ((await threads.json()) as { data: { id: string; title: string }[] }).data.find(
    (t) => t.title === `AD Thread ${tag}`
  )!.id;
  const rep = await request.post(`${API}/api/v1/discussions/${tid}/replies`, {
    headers: { ...H(admin.access_token), ...J },
    data: { body: 'E2E admin reply' },
  });
  expect(rep.status()).toBe(201);
  // Reload re-renders replies under the thread (read path proof).
  await page.reload();
  await page.locator('a[href="#/community"]').click();
  await page.locator('button[data-tab="dis"]').click();
  await page.locator('#d-course').selectOption(cid);
  await expect(page.locator('#d-list', { hasText: 'E2E admin reply' })).toBeVisible({
    timeout: 15000,
  });

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin commerce bundles: create, publish, view courses', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AB${tag}`.slice(0, 32), title: `AB Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;

  await adminLogin(page);
  await page.locator('a[href="#/commerce"]').click();
  await page.locator('button[data-tab="bundles"]').click();
  await page.locator('#b-new').click();
  await page.locator('.modal-dialog [name="name"]').fill(`AB Bundle ${tag}`);
  await page.locator('.modal-dialog [name="price"]').fill('75000');
  await page.locator('.modal-dialog [name="course_ids"]').fill(cid);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#b-list', { hasText: `AB Bundle ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const blist = await request.get(`${API}/api/v1/bundles?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  const bid = ((await blist.json()) as { data: { id: string; name: string }[] }).data.find(
    (b) => b.name === `AB Bundle ${tag}`
  )!.id;
  await page.locator(`[data-pub="${bid}"]`).click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/bundles?organization_id=${org}`, {
        headers: H(admin.access_token),
      });
      return ((await r.json()) as { data: { id: string; status: string }[] }).data.find(
        (b) => b.id === bid
      )!.status;
    })
    .toBe('published');
  await page.locator(`[data-view="${bid}"]`).click();
  await expect(page.locator(`[data-c="${bid}"]`, { hasText: `AB Course ${tag}` })).toBeVisible({
    timeout: 15000,
  });

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin commerce coupons + affiliates + plans via modals', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const code = `E2E${tag}`.toUpperCase().slice(0, 20);
  const sem = `af-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `AF Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const sid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

  await adminLogin(page);
  await page.locator('a[href="#/commerce"]').click();
  // Coupons.
  await page.locator('button[data-tab="coupons"]').click();
  await page.locator('#c-new').click();
  await page.locator('.modal-dialog [name="code"]').fill(code);
  await page.locator('.modal-dialog select[name="kind"]').selectOption('percent');
  await page.locator('.modal-dialog [name="value"]').fill('15');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#c-list', { hasText: code })).toBeVisible({ timeout: 15000 });
  const clist = await request.get(`${API}/api/v1/coupons?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(
    ((await clist.json()) as { data: { code: string; value: number }[] }).data.some(
      (c) => c.code === code && c.value === 15
    )
  ).toBe(true);
  // Affiliates.
  await page.locator('button[data-tab="affiliates"]').click();
  await page.locator('#a-new').click();
  await page.locator('.modal-dialog [name="user_id"]').fill(sid);
  await page.locator('.modal-dialog [name="code"]').fill(`AFF${tag}`.toUpperCase().slice(0, 20));
  await page.locator('.modal-dialog [name="commission_rate"]').fill('10');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#a-list', { hasText: `AF Student ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Plans.
  await page.locator('button[data-tab="plans"]').click();
  await page.locator('#p-new').click();
  await page.locator('.modal-dialog [name="name"]').fill(`Plan ${tag}`);
  await page.locator('.modal-dialog [name="price"]').fill('99000');
  await page.locator('.modal-dialog select[name="interval"]').selectOption('monthly');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#p-list', { hasText: `Plan ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const plans = await request.get(`${API}/api/v1/subscription-plans?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(
    ((await plans.json()) as { data: { name: string }[] }).data.some(
      (p) => p.name === `Plan ${tag}`
    )
  ).toBe(true);

  await request.delete(`${API}/api/v1/users/${sid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
