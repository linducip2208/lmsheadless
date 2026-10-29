import { test, expect } from '@playwright/test';
import { ADMIN, API, H, PASS, SUPER, adminLogin, apiLogin, trackErrors, uniq } from './helpers.js';

// Admin data tab (round 6, final residue): CSV imports dry-run through the
// real file input (exercises the multipart token fix on data.ts), AI
// provider config + draft job through the UI, and invitation creation.
// Fixtures via API; server re-verification after every UI action.

test.setTimeout(120_000);

test('admin data imports: users CSV dry-run via file input, job listed', async ({
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
  const csv = `email,name\nim-one-${tag}@example.com,Import One ${tag}\nim-two-${tag}@example.com,Import Two ${tag}\n`;

  await adminLogin(page);
  await page.locator('a[href="#/data"]').click();
  await page.locator('#im-kind').selectOption('users');
  await page.locator('#im-file').setInputFiles({
    name: `users-${tag}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const posted = page.waitForResponse(
    (r) => r.url().includes('/api/v1/imports') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#im-form button[type="submit"], #im-form button').first().click();
  const res = await posted;
  expect(res.ok()).toBeTruthy();
  const posted2 = (await res.json()) as { data: { job_id: string; valid: number; total: number } };
  expect(posted2.data.valid).toBe(2);
  await expect(page.locator('#im-out', { hasText: '2 / 2' })).toBeVisible({ timeout: 15000 });
  // The dry-run job is listed with its detail expandable (id from the POST).
  const jobId = posted2.data.job_id;
  await expect(page.locator('#im-jobs', { hasText: 'users' })).toBeVisible({ timeout: 15000 });
  const jobs = await request.get(`${API}/api/v1/imports?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(jobs.status()).toBe(200);
  const job = (
    (await jobs.json()) as {
      data: { id: string; kind: string; status: string; total_rows: number }[];
    }
  ).data.find((j) => j.id === jobId)!;
  expect(job.status).toBe('dry_run');
  await page.locator(`[data-job="${job.id}"]`).click();
  // Dry-run of valid rows: empty error detail (honest, not hidden).
  await expect(page.locator(`[data-jr="${job.id}"]`)).not.toBeEmpty({ timeout: 15000 });
  // Dry-run wrote nothing: neither address exists as a user.
  const check = await request.get(
    `${API}/api/v1/users?q=${encodeURIComponent(`im-one-${tag}@example.com`)}`,
    { headers: H(admin.access_token) }
  );
  expect(((await check.json()) as { data: unknown[] }).data.length).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin data AI tab: provider mock via UI, draft job listed', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();

  await adminLogin(page);
  await page.locator('a[href="#/data"]').click();
  await page.locator('button[data-tab="ai"]').click();
  await page.locator('#ai-p').selectOption('mock');
  await page.locator('#ai-l').fill('50');
  const savedCfg = page.waitForResponse(
    (r) => r.url().includes('/api/v1/ai/config') && r.request().method() === 'PUT',
    { timeout: 15000 }
  );
  await page.locator('#ai-cfg button[type="submit"], #ai-cfg button').first().click();
  expect((await savedCfg).ok()).toBeTruthy();
  const cfg = await request.get(`${API}/api/v1/ai/config?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(((await cfg.json()) as { data: { provider: string } }).data.provider).toBe('mock');

  await page.locator('#ai-kind').selectOption('outline');
  await page.locator('#ai-in').fill(`E2E topic ${tag}`);
  const jobed = page.waitForResponse(
    (r) => r.url().includes('/api/v1/ai/jobs') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#ai-job button[type="submit"], #ai-job button').first().click();
  expect((await jobed).ok()).toBeTruthy();
  await expect(page.locator('#ai-out', { hasText: `E2E topic ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const jobs = await request.get(`${API}/api/v1/ai/jobs?organization_id=${org}`, {
    headers: H(admin.access_token),
  });
  expect(jobs.status()).toBe(200);
  const jobId = (
    (await jobs.json()) as { data: { id: string; kind: string; reviewed_at: string | null }[] }
  ).data.find((j) => j.kind === 'outline')!.id;
  // Review-gate: approve through the UI, reviewed_at set server-side.
  await page.locator(`[data-review="${jobId}"]`).click();
  await expect
    .poll(async () => {
      const r = await request.get(`${API}/api/v1/ai/jobs?organization_id=${org}`, {
        headers: H(admin.access_token),
      });
      return ((await r.json()) as { data: { id: string; reviewed_at: string | null }[] }).data.find(
        (j) => j.id === jobId
      )!.reviewed_at;
    })
    .not.toBeNull();

  // Restore provider to disabled (shared org setting, do not leak mock).
  await page.locator('#ai-p').selectOption('disabled');
  await page.locator('#ai-cfg button[type="submit"], #ai-cfg button').first().click();
  await expect
    .poll(async () => {
      const c = await request.get(`${API}/api/v1/ai/config?organization_id=${org}`, {
        headers: H(admin.access_token),
      });
      return ((await c.json()) as { data: { provider: string } }).data.provider;
    })
    .toBe('disabled');
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin data invites: create invitation, invite_url shown + stored', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const tag = uniq();
  const inviteEm = `inv-${tag}@example.com`;

  await adminLogin(page);
  await page.locator('a[href="#/data"]').click();
  await page.locator('button[data-tab="invites"]').click();
  await page.locator('#in-email').fill(inviteEm);
  await page.locator('#in-role').selectOption('student');
  await page.locator('#in-form button[type="submit"], #in-form button').first().click();
  await expect(page.locator('#in-out code')).not.toBeEmpty({ timeout: 15000 });
  // Full loop: the invite_url from the UI carries the raw token — accept it
  // (creates the user + membership) and prove the new account logs in.
  const inviteUrl = (await page.locator('#in-out code').textContent()) ?? '';
  const token = inviteUrl.split('/invite/')[1]?.trim() ?? '';
  expect(token.length).toBeGreaterThan(16);
  const accept = await request.post(`${API}/api/v1/invitations/accept`, {
    data: { token, name: `Invited ${tag}`, password: PASS },
  });
  expect(accept.status()).toBe(201);
  const logged = await request.post(`${API}/api/v1/auth/login`, {
    data: { email: inviteEm, password: PASS },
  });
  expect(logged.status()).toBe(200);
  const uid = ((await logged.json()) as { data: { user: { id: string } } }).data.user.id;

  await request.delete(`${API}/api/v1/users/${uid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
