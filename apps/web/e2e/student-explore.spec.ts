import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { scorm12 } from './scorm-zip.js';

// Student leftover views (round 6, final residue): live list + register,
// programs path detail + enroll, AI tutor ask (mock), SCORM player
// bookmark + mark-done. Fixtures via API; server re-verification each step.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const STUDENT_URL = process.env.STUDENT_URL ?? 'http://localhost:5174';
const PASS = 'Password123!';
const ADMIN = 'admin@example.com';
const SUPER = 'superadmin@example.com';
const TEACHER = 'teacher@example.com';

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

test('student live + programs: register for session, enroll from path', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const teacher = await apiLogin(request, TEACHER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const em = `sx-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `SX Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  // Upcoming live session (no capacity cap) + program with one free course.
  const starts = new Date(Date.now() + 86400000).toISOString();
  const ends = new Date(Date.now() + 2 * 86400000).toISOString();
  const sess = (await (
    await request.post(`${API}/api/v1/live-sessions`, {
      headers: { ...H(teacher.access_token), ...J },
      data: {
        organization_id: org,
        provider: 'jitsi',
        title: `SX Live ${tag}`,
        starts_at: starts,
        ends_at: ends,
      },
    })
  ).json()) as { data: { id: string } };
  const sid = sess.data.id;
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `SX${tag}`.slice(0, 32),
        title: `SX Path ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const prog = (await (
    await request.post(`${API}/api/v1/programs`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, name: `SX Program ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const pid = prog.data.id;
  await request.post(`${API}/api/v1/programs/${pid}/courses`, {
    headers: { ...H(admin.access_token), ...J },
    data: { course_id: cid, position: 0 },
  });

  await studentLogin(page, em);
  await page.goto(`${STUDENT_URL}/#/more`);
  await expect(page.locator('#view')).not.toBeEmpty({ timeout: 15000 });
  // Live: register click → server registration row.
  await page.goto(`${STUDENT_URL}/#/live`);
  await expect(page.locator('#view', { hasText: `SX Live ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const regged = page.waitForResponse((r) => r.url().includes(`/live-sessions/${sid}/register`), {
    timeout: 15000,
  });
  await page.locator(`[data-reg="${sid}"]`).click();
  expect((await regged).ok()).toBeTruthy();
  // Programs: path detail shows the course → enroll → active enrollment.
  await page.goto(`${STUDENT_URL}/#/programs`);
  await expect(page.locator('#view', { hasText: `SX Program ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`[data-prog="${pid}"]`).click();
  await expect(page.locator(`[data-pd="${pid}"]`, { hasText: `SX Path ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const enrolled = page.waitForResponse(
    (r) => r.url().includes('/api/v1/enrollments') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator(`[data-penroll="${cid}"]`).click();
  expect((await enrolled).ok()).toBeTruthy();
  const enr = await request.get(`${API}/api/v1/courses/${cid}/enrollments`, {
    headers: { Authorization: `Bearer ${st.access_token}` },
  });
  expect(((await enr.json()) as { data: { status: string }[] }).data[0]?.status).toBe('active');

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, {
    headers: H((await apiLogin(request, SUPER)).access_token),
  });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student tutor: mock ask renders answer, conversation stored', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const em = `sx-tutor-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `SX Tutor ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  // Students must hold an enrollment before the tutor answers.
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `SXt${tag}`.slice(0, 32),
        title: `SX Tutor ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.access_token), ...J },
    data: { course_id: course.data.id },
  });
  const mock = await request.put(`${API}/api/v1/ai/config`, {
    headers: { ...H(admin.access_token), ...J },
    data: { organization_id: org, provider: 'mock', monthly_limit: 100 },
  });
  expect(mock.status()).toBe(200);

  await studentLogin(page, em);
  await page.goto(`${STUDENT_URL}/#/more`);
  await expect(page.locator('#view')).not.toBeEmpty({ timeout: 15000 });
  await page.goto(`${STUDENT_URL}/#/tutor`);
  await page.locator('#tu-q').fill(`Explain photosynthesis ${tag}`);
  const asked = page.waitForResponse(
    (r) => r.url().includes('/api/v1/ai/ask') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#tu-ask button[type="submit"], #tu-ask button').first().click();
  const askRes = await asked;
  expect(askRes.ok()).toBeTruthy();
  const convId = ((await askRes.json()) as { data: { conversation_id: string } }).data
    .conversation_id;
  // No indexed chunks: honest ungrounded answer with the study-tip label.
  await expect(page.locator('#tu-out', { hasText: 'general knowledge' })).toBeVisible({
    timeout: 15000,
  });
  const msgs = await request.get(`${API}/api/v1/ai/conversations/${convId}/messages`, {
    headers: { Authorization: `Bearer ${st.access_token}` },
  });
  expect(msgs.status()).toBe(200);
  expect(
    ((await msgs.json()) as { data: { role: string; body: string }[] }).data.some(
      (m) => m.role === 'user' && m.body.includes(tag)
    )
  ).toBe(true);

  const off = await request.put(`${API}/api/v1/ai/config`, {
    headers: { ...H(admin.access_token), ...J },
    data: { organization_id: org, provider: 'disabled' },
  });
  expect(off.status()).toBe(200);
  await request.delete(`${API}/api/v1/courses/${course.data.id}`, {
    headers: H(admin.access_token),
  });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, {
    headers: H((await apiLogin(request, SUPER)).access_token),
  });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('student scorm player: attempt starts, bookmark + mark-done commit', async ({
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
  const em = `sx-scorm-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `SX Scorm ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  // Package uploaded through the real multipart API (shared zip builder).
  const zip = scorm12(tag, `SX Package ${tag}`);
  const up = await request.post(`${API}/api/v1/scorm/upload`, {
    headers: H(admin.access_token),
    multipart: {
      file: { name: `sx-${tag}.zip`, mimeType: 'application/zip', buffer: Buffer.from(zip) },
      organization_id: org,
    },
  });
  expect(up.status()).toBe(201);
  const pkgId = ((await up.json()) as { data: { id: string } }).data.id;

  await studentLogin(page, em);
  await page.goto(`${STUDENT_URL}/#/scorm/${pkgId}`);
  await expect(page.locator('#sc-done')).toBeVisible({ timeout: 15000 });
  // Bookmark via modal → commit; then mark done → success box.
  await page.locator('#sc-bm').click();
  await page.locator('.modal-dialog [name="location"]').fill('page-3');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await page.locator('#sc-done').click();
  await expect(page.locator('#sc-out', { hasText: '✓' })).toBeVisible({ timeout: 15000 });
  // Server: the attempt committed completed/passed for this student.
  const me = await apiLogin(request, em);
  const atts = await request.get(`${API}/api/v1/scorm/packages/${pkgId}/attempts`, {
    headers: H(me.access_token),
  });
  expect(atts.status()).toBe(200);
  expect(
    ((await atts.json()) as { data: { completion: string }[] }).data.some(
      (a) => a.completion === 'completed'
    )
  ).toBe(true);

  await request.delete(`${API}/api/v1/users/${me.user.id}`, {
    headers: H((await apiLogin(request, SUPER)).access_token),
  });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
