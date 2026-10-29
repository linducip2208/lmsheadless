import { test, expect, type Page } from '@playwright/test';
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

// Teacher portal workflows beyond section-building (round 4): question bank
// build + delete, manual grading via the grading queue click path, and an
// attendance session created, taken (records saved) and deleted through the
// real UI. Fixtures via API; every UI action re-verified server-side.
const TEACHER = 'teacher@example.com';

test.setTimeout(120_000);

async function teacherLogin(page: Page, email = TEACHER) {
  await page.goto(`${TEACHER_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(email);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

test('teacher banks: create bank, add MC question via modal, delete bank', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const teacher = await apiLogin(request, TEACHER);
  const orgs = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(teacher.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data;
  const org = orgs[0].id;
  const tag = uniq();
  const bankName = `TW Bank ${tag}`;
  const prompt = `TW Prompt ${tag} — pick A`;

  await teacherLogin(page);
  await page.locator('a[href="#/banks"]').click();
  await page.locator('#b-new').click();
  await page.locator('.modal-dialog [name="name"]').fill(bankName);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#b-list', { hasText: bankName })).toBeVisible({ timeout: 15000 });
  // Server: bank exists in the org list.
  const blist = await request.get(`${API}/api/v1/question-banks?organization_id=${org}`, {
    headers: H(teacher.access_token),
  });
  expect(blist.status()).toBe(200);
  const bid = ((await blist.json()) as { data: { id: string; name: string }[] }).data.find(
    (b) => b.name === bankName
  )!.id;

  // Add a single-choice question through the modal; '*' marks the right line.
  await page.locator(`[data-badd="${bid}"]`).click();
  await page.locator('.modal-dialog select[name="type"]').selectOption('single_choice');
  await page.locator('.modal-dialog [name="prompt"]').fill(prompt);
  await page.locator('.modal-dialog [name="correct_answer"]').fill('A');
  await page.locator('.modal-dialog [name="options"]').fill('*A\nB');
  await page.locator('.modal-dialog button[type="submit"]').click();
  // Open the questions list and scroll the server-provided prompt into view.
  await page.locator(`[data-bq="${bid}"]`).click();
  await expect(page.locator(`[data-bd="${bid}"]`, { hasText: `TW Prompt ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const qlist = await request.get(`${API}/api/v1/question-banks/${bid}/questions`, {
    headers: H(teacher.access_token),
  });
  expect(qlist.status()).toBe(200);
  expect(
    ((await qlist.json()) as { data: { prompt: string }[] }).data.some((q) =>
      q.prompt.startsWith(`TW Prompt ${tag}`)
    )
  ).toBe(true);

  // In-app confirm delete → bank card disappears, list no longer shows it.
  await page.locator(`[data-bdel="${bid}"]`).click();
  await page.locator('[data-ok]').click();
  await expect(page.locator('#b-list', { hasText: bankName })).toHaveCount(0, { timeout: 15000 });
  const after = await request.get(`${API}/api/v1/question-banks?organization_id=${org}`, {
    headers: H(teacher.access_token),
  });
  expect(((await after.json()) as { data: { id: string }[] }).data.some((b) => b.id === bid)).toBe(
    false
  );
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('teacher grading: queue row → grade modal → submission graded 90', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const teacher = await apiLogin(request, TEACHER);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data[0].id;
  const tag = uniq();
  // Fixtures: course + assignment (teacher), student enrolled, submission.
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(teacher.access_token), ...J },
      data: { organization_id: org, code: `TW${tag}`.slice(0, 32), title: `TW Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const asg = (await (
    await request.post(`${API}/api/v1/assignments`, {
      headers: { ...H(teacher.access_token), ...J },
      data: { course_id: cid, title: `TW Asg ${tag}`, max_score: 100 },
    })
  ).json()) as { data: { id: string } };
  const aid = asg.data.id;
  const sem = `tw-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `TW Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const stok = ((await reg.json()) as { data: { access_token: string; user: { id: string } } })
    .data;
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(stok.access_token), ...J },
    data: { course_id: cid },
  });
  const sub = await request.post(`${API}/api/v1/assignments/${aid}/submissions`, {
    headers: { ...H(stok.access_token), ...J },
    data: { body: 'TW submission body' },
  });
  expect(sub.status()).toBe(201);
  // Resolve the submission id the way the UI does: teacher's submissions list.
  const tsubs = await request.get(`${API}/api/v1/assignments/${aid}/submissions`, {
    headers: H(teacher.access_token),
  });
  expect(tsubs.status()).toBe(200);
  const subId = ((await tsubs.json()) as { data: { id: string; student_id: string }[] }).data.find(
    (x) => x.student_id === stok.user.id
  )!.id;
  expect(subId).toBeTruthy();

  // UI: the grading queue shows our pending submission; click grade, fill
  // score + feedback, submit.
  await teacherLogin(page);
  await page.locator('a[href="#/grading"]').click();
  await expect(page.locator('#view', { hasText: `TW Asg ${tag}` }).first()).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`button[data-grade="${subId}"]`).click();
  await page.locator('.modal-dialog [name="score"]').fill('90');
  await page.locator('.modal-dialog [name="feedback"]').fill('e2e feedback');
  await page.locator('.modal-dialog button[type="submit"]').click();
  // The queue only lists ungraded submissions (`status != 'graded'`), so the
  // graded row disappears after re-render — toast alone is not proof.
  await expect(page.locator(`button[data-grade="${subId}"]`)).toHaveCount(0, {
    timeout: 15000,
  });
  // Server: the submission is graded with the score given through the modal.
  const subs = await request.get(`${API}/api/v1/assignments/${aid}/submissions`, {
    headers: H(teacher.access_token),
  });
  expect(subs.status()).toBe(200);
  const row = (
    (await subs.json()) as { data: { id: string; status: string; score: number }[] }
  ).data.find((x) => x.id === subId)!;
  expect(row.status).toBe('graded');
  expect(row.score).toBe(90);

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${stok.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('teacher attendance: create session, take + save records, delete session', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const teacher = await apiLogin(request, TEACHER);
  const sup = await apiLogin(request, SUPER);
  const orgs = (
    (await (
      await request.get(`${API}/api/v1/organizations`, { headers: H(teacher.access_token) })
    ).json()) as { data: { id: string }[] }
  ).data;
  const org = orgs[0].id;
  const tag = uniq();
  const cname = `TW Attend ${tag}`;
  // Fixtures: teacher-created course must ALSO be instructor-assigned —
  // /instructor/courses (the attendance dropdown source) is assignment-scoped.
  const cadmin = await apiLogin(request, ADMIN);
  const members = await request.get(`${API}/api/v1/organizations/${org}/members`, {
    headers: H(cadmin.access_token),
  });
  const seedTeacherId = (
    (await members.json()) as { data: { email: string; id: string }[] }
  ).data.find((m) => m.email === TEACHER)!.id;
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(teacher.access_token), ...J },
      data: { organization_id: org, code: `TWa${tag}`.slice(0, 32), title: cname },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const assign = await request.post(`${API}/api/v1/courses/${cid}/instructors`, {
    headers: { ...H(cadmin.access_token), ...J },
    data: { user_id: seedTeacherId },
  });
  expect(assign.status()).toBe(201);
  const sem = `tw-att-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `TW Attendee ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.access_token), ...J },
    data: { course_id: cid },
  });

  // UI: pick our course, name the session, create it.
  await teacherLogin(page);
  await page.locator('a[href="#/attendance"]').click();
  await page.locator('#at-course').selectOption(cid);
  await page.locator('#at-title').fill(`TW Sess ${tag}`);
  await page.locator('#at-create').click();
  await expect(page.locator('#at-list', { hasText: `TW Sess ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  // Server proof: the session row exists for the org.
  const sl = await request.get(`${API}/api/v1/attendance/sessions?organization_id=${org}`, {
    headers: H(teacher.access_token),
  });
  expect(sl.status()).toBe(200);
  const sess = (await sl.json()) as {
    data: { id: string; title: string; course_id: string | null }[];
  };
  const sid = sess.data.find((s) => s.title === `TW Sess ${tag}`)!.id;
  expect(sid).toBeTruthy();

  // Take attendance: the enrolled student renders a status select; save it.
  await page.locator(`[data-take="${sid}"]`).click();
  await expect(page.locator(`[data-rec="${sid}"]`, { hasText: `TW Attendee ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  await page.locator(`[data-rec="${sid}"] select[data-s="${st.user.id}"]`).selectOption('present');
  const rec = page.waitForResponse(
    (r) => r.url().includes('/attendance/records') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#at-save').click();
  expect((await rec).ok()).toBeTruthy();
  // Server aggregated report: our fresh attendee shows 1 record, 100%.
  const rep = await request.get(`${API}/api/v1/reports/attendance?organization_id=${org}`, {
    headers: H(teacher.access_token),
  });
  expect(rep.status()).toBe(200);
  const agg = (await rep.json()) as {
    data: { students: { name: string; recorded: number; attendance_pct: number }[] };
  };
  const mine = agg.data.students.find((x) => x.name === `TW Attendee ${tag}`);
  expect(mine?.recorded).toBe(1);
  expect(mine?.attendance_pct).toBe(100);

  // Delete the session through the new UI affordance (in-app confirm).
  await page.locator(`[data-sdel="${sid}"]`).click();
  await page.locator('[data-ok]').click();
  await expect(page.locator('#at-list', { hasText: `TW Sess ${tag}` })).toHaveCount(0, {
    timeout: 15000,
  });
  const slAfter = await request.get(`${API}/api/v1/attendance/sessions?organization_id=${org}`, {
    headers: H(teacher.access_token),
  });
  expect(
    ((await slAfter.json()) as { data: { id: string }[] }).data.some((s) => s.id === sid)
  ).toBe(false);

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
