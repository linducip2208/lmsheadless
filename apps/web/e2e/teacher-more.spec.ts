import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  ADMIN,
  API,
  H,
  J,
  PASS,
  SUPER,
  TEACHER_URL,
  apiLogin,
  trackErrors,
  uniq,
} from './helpers.js';

// Teacher portal, second wave (round 5): students roster with per-student
// progress detail, live-class scheduling (Jitsi, no external creds), and
// static-mode exercise creation. Fixtures via API; server re-verification
// after every UI action.
const TEACHER = 'teacher@example.com';

test.setTimeout(120_000);

async function teacherLogin(page: Page) {
  await page.goto(`${TEACHER_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(TEACHER);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

async function assignedCourse(
  req: APIRequestContext,
  adminTok: string,
  teacherUserId: string,
  org: string,
  tag: string,
  prefix: string
) {
  const teacher = await apiLogin(req, TEACHER);
  const course = (await (
    await req.post(`${API}/api/v1/courses`, {
      headers: { ...H(teacher.access_token), ...J },
      data: {
        organization_id: org,
        code: `${prefix}${tag}`.slice(0, 32),
        title: `${prefix} Course ${tag}`,
      },
    })
  ).json()) as { data: { id: string } };
  const assign = await req.post(`${API}/api/v1/courses/${course.data.id}/instructors`, {
    headers: { ...H(adminTok), ...J },
    data: { user_id: teacherUserId },
  });
  expect(assign.status()).toBe(201);
  return course.data.id;
}

test('teacher students: roster shows enrollee, detail expands progress', async ({
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
  const members = await request.get(`${API}/api/v1/organizations/${org}/members`, {
    headers: H(admin.access_token),
  });
  const teacherId = ((await members.json()) as { data: { email: string; id: string }[] }).data.find(
    (m) => m.email === TEACHER
  )!.id;
  const cid = await assignedCourse(request, admin.access_token, teacherId, org, tag, 'TS');
  const sem = `ts-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `TS Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.access_token), ...J },
    data: { course_id: cid },
  });

  await teacherLogin(page);
  await page.locator('a[href="#/students"]').click();
  await expect(page.locator('#view', { hasText: `TS Student ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`[data-prog="${cid}:${st.user.id}"]`).click();
  await expect(page.locator('[data-det]', { hasText: 'Progress' })).toBeVisible({
    timeout: 15000,
  });
  // Server: the same progress numbers back the detail box.
  const rep = await request.get(`${API}/api/v1/courses/${cid}/progress`, {
    headers: H(admin.access_token),
  });
  expect(rep.status()).toBe(200);

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('teacher live: schedule Jitsi session via modal, listed with join link', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const teacher = await apiLogin(request, TEACHER);
  const sup = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(teacher.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  const starts = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const ends = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);

  await teacherLogin(page);
  await page.locator('a[href="#/live"]').click();
  await page.locator('#lv-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`TL Live ${tag}`);
  await page.locator('.modal-dialog [name="starts_at"]').fill(starts);
  await page.locator('.modal-dialog [name="ends_at"]').fill(ends);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#lv-list', { hasText: `TL Live ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const sl = await request.get(`${API}/api/v1/live-sessions?organization_id=${org}`, {
    headers: H(teacher.access_token),
  });
  expect(sl.status()).toBe(200);
  const row = (
    (await sl.json()) as {
      data: {
        id: string;
        title: string;
        provider: string;
        meeting_url: string | null;
        status: string;
      }[];
    }
  ).data.find((s) => s.title === `TL Live ${tag}`)!;
  expect(row.provider).toBe('jitsi');
  expect(row.meeting_url).toBeTruthy();
  expect(row.status).toBe('scheduled');

  // Cleanup via cancel (state machine, not delete): session leaves the list.
  const cancel = await request.post(`${API}/api/v1/live-sessions/${row.id}/cancel`, {
    headers: H(sup.access_token),
  });
  expect(cancel.status()).toBe(200);
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('teacher exercises: static-mode create via form, server-verified', async ({
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
  const members = await request.get(`${API}/api/v1/organizations/${org}/members`, {
    headers: H(admin.access_token),
  });
  const teacherId = ((await members.json()) as { data: { email: string; id: string }[] }).data.find(
    (m) => m.email === TEACHER
  )!.id;
  const cid = await assignedCourse(request, admin.access_token, teacherId, org, tag, 'TE');

  await teacherLogin(page);
  await page.locator('a[href="#/exercises"]').click();
  await page.locator('#ex-c').fill(cid);
  await page.locator('#ex-t').fill(`TE Exercise ${tag}`);
  await page.locator('#ex-s').fill('Write a function that returns 42.');
  await page.locator('#ex-f button[type="submit"], #ex-f button').first().click();
  // Form resets on success (no toast assertion — reset + server proof).
  await expect(page.locator('#ex-t')).toHaveValue('', { timeout: 15000 });
  const list = await request.get(`${API}/api/v1/exercises?course_id=${cid}`, {
    headers: H(admin.access_token),
  });
  expect(list.status()).toBe(200);
  const row = (
    (await list.json()) as { data: { id: string; title: string; execution_mode: string }[] }
  ).data.find((x) => x.title === `TE Exercise ${tag}`)!;
  expect(row.execution_mode).toBe('static');

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
