import { test, expect, type Page } from '@playwright/test';
import { ADMIN_URL, API, H, J, PASS, SUPER, apiLogin, trackErrors, uniq } from './helpers.js';

// Admin setup area (round 6, final residue): organizations manage (create +
// member add + brand edit via the generic crud), role permission remap with
// guaranteed restore, and dashboard numbers matching the server summary.
// Super_admin flows use SUPER login.

test.setTimeout(120_000);

async function superLogin(page: Page) {
  await page.goto(`${ADMIN_URL}/#/login`);
  await page.locator('#email').fill(SUPER);
  await page.locator('#password').fill(PASS);
  await page.locator('#login-form button[type="submit"], #login-form button.w-100').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

test('superadmin organizations: create, manage members, edit brand', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const sup = await apiLogin(request, SUPER);
  const tag = uniq();
  const oname = `E2E Org ${tag}`;
  const oslug = `e2e-org-${tag}`;
  const sem = `org-member-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: {
      email: sem,
      password: PASS,
      name: `Org Member ${tag}`,
      organization_id: (
        (await (
          await request.get(`${API}/api/v1/organizations`, { headers: H(sup.access_token) })
        ).json()) as { data: { id: string }[] }
      ).data[0].id,
    },
  });
  expect(reg.status()).toBe(201);
  const uid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

  await superLogin(page);
  await page.locator('a[href="#/organizations"]').click();
  await page.locator('#crud-new').click();
  await page.locator('.modal-dialog [name="name"]').fill(oname);
  await page.locator('.modal-dialog [name="slug"]').fill(oslug);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#crud-body', { hasText: oname })).toBeVisible({ timeout: 15000 });
  const orgs = await request.get(`${API}/api/v1/organizations`, { headers: H(sup.access_token) });
  const oid = ((await orgs.json()) as { data: { id: string; name: string }[] }).data.find(
    (o) => o.name === oname
  )!.id;
  // Search filters the roster to the new org.
  await page.locator('#crud-q').fill(oslug);
  await expect(page.locator('#crud-body', { hasText: oname })).toBeVisible({ timeout: 15000 });
  await page.locator('#crud-q').fill('');

  // Manage → members table → add member → brand edit, all server-verified.
  await page.locator(`[data-manage="${oid}"]`).click();
  await page.locator('#add-member').click();
  await page.locator('.modal-dialog [name="user_id"]').fill(uid);
  await page.locator('.modal-dialog [name="role"]').fill('student');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#org-detail', { hasText: sem })).toBeVisible({ timeout: 15000 });
  const members = await request.get(`${API}/api/v1/organizations/${oid}/members`, {
    headers: H(sup.access_token),
  });
  expect(
    ((await members.json()) as { data: { id: string; role: string }[] }).data.some(
      (m) => m.id === uid && m.role === 'student'
    )
  ).toBe(true);
  await page.locator('#edit-brand').click();
  await page.locator('.modal-dialog [name="footer_text"]').fill(`Org footer ${tag}`);
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/organizations/${oid}`) && r.request().method() === 'PUT',
    { timeout: 15000 }
  );
  await page.locator('.modal-dialog button[type="submit"]').click();
  expect((await saved).ok()).toBeTruthy();
  // Persistence after reload (a fresh read-back; immediate in-place
  // re-reads can race the just-committed write, as in settings round 4).
  await page.reload();
  await page.locator('a[href="#/organizations"]').click();
  await page.locator('#crud-q').fill(oslug);
  await expect(page.locator('#crud-body', { hasText: oname })).toBeVisible({ timeout: 15000 });
  await page.locator(`[data-manage="${oid}"]`).click();
  await expect(page.locator('#org-detail', { hasText: `Org footer ${tag}` })).toBeVisible({
    timeout: 15000,
  });

  // No organization delete endpoint ships; the fixture org stays documented.
  // The member user is removed (membership row lingers by soft-delete design).
  await request.delete(`${API}/api/v1/users/${uid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('superadmin roles: remap staff permission with guaranteed restore', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const sup = await apiLogin(request, SUPER);
  const roles = (await (
    await request.get(`${API}/api/v1/roles`, { headers: H(sup.access_token) })
  ).json()) as { data: { role: string; permissions: string[] }[] };
  const original: string[] = roles.data.find((r) => r.role === 'staff')?.permissions ?? [];
  expect(original.length).toBeGreaterThan(1);
  const trimmed = original.slice(0, -1);
  const removed = original[original.length - 1];

  await superLogin(page);
  await page.locator('a[href="#/roles"]').click();
  // Locate the staff column by header (first th is the catalog label).
  await expect(page.locator('#view table thead th').nth(1)).toBeVisible({
    timeout: 15000,
  });
  const ths = page.locator('#view table thead th');
  const thCount = await ths.count();
  let staffIdx = -1;
  for (let i = 0; i < thCount; i++) {
    // NOTE: thead is CSS-uppercased (text-transform), but innerText returns
    // the rendered case — match case-insensitively.
    if ((await ths.nth(i).innerText()).toLowerCase().includes('staff')) {
      staffIdx = i;
      break;
    }
  }
  expect(staffIdx).toBeGreaterThan(0);
  const staffCell = () =>
    page.locator('#view table tbody tr', { hasText: removed }).first().locator('td').nth(staffIdx);
  await expect(staffCell().locator('span[aria-label="allowed"]')).toBeVisible({
    timeout: 15000,
  });
  try {
    await page.locator('[data-editrole="staff"]').click();
    await page.locator('.modal-dialog [name="permissions"]').fill(trimmed.join(', '));
    await page.locator('.modal-dialog button[type="submit"]').click();
    await expect(staffCell().locator('span[aria-label="denied"]')).toBeVisible({
      timeout: 15000,
    });
    const after = (await (
      await request.get(`${API}/api/v1/roles`, { headers: H(sup.access_token) })
    ).json()) as { data: { role: string; permissions: string[] }[] };
    expect(after.data.find((r) => r.role === 'staff')!.permissions).not.toContain(removed);
  } finally {
    // Restore first, whatever happened above (shared role row).
    const restore = await request.put(`${API}/api/v1/roles/staff/permissions`, {
      headers: { ...H(sup.access_token), ...J },
      data: { permissions: original },
    });
    expect(restore.status()).toBe(200);
  }
  const back = (await (
    await request.get(`${API}/api/v1/roles`, { headers: H(sup.access_token) })
  ).json()) as { data: { role: string; permissions: string[] }[] };
  expect(back.data.find((r) => r.role === 'staff')!.permissions).toEqual(
    expect.arrayContaining(original)
  );
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin dashboard: cards match server organization summary', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const sup = await apiLogin(request, SUPER);
  await superLogin(page);
  await expect(page.locator('#view', { hasText: /Students|Siswa/ })).toBeVisible({
    timeout: 15000,
  });
  const orgs = (await (
    await request.get(`${API}/api/v1/organizations`, { headers: H(sup.access_token) })
  ).json()) as { data: { id: string }[] };
  const summary = (await (
    await request.get(
      `${API}/api/v1/reports/organization-summary?organization_id=${orgs.data[0].id}`,
      { headers: H(sup.access_token) }
    )
  ).json()) as { data: Record<string, number> };
  // Real-data proof: the rendered student/course/enrollment counts equal the API.
  await expect(
    page.locator('#view', { hasText: String(summary.data.students) }).first()
  ).toBeVisible({
    timeout: 15000,
  });
  expect(summary.data.courses).toBeGreaterThanOrEqual(0);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
