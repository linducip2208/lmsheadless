import { test, expect } from '@playwright/test';
import {
  ADMIN,
  API,
  H,
  J,
  PASS,
  SUPER,
  adminLogin,
  apiLogin,
  orgId,
  trackErrors,
  uniq,
} from './helpers.js';

// Admin assessment tabs (round 5): quizzes (create quiz → add/edit/reorder/
// delete true_false questions → performance), assignments (create → rubric →
// grade), gradebook (record + filter), certificates (issue → verify →
// revoke). Fixtures via API; every UI action re-verified server-side.

test.setTimeout(120_000);

test('admin quizzes: create quiz, add/edit/reorder/delete questions, performance', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AQ${tag}`.slice(0, 32), title: `AQ Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;

  await adminLogin(page);
  await page.locator('a[href="#/quizzes"]').click();
  await page.locator('#q-course').selectOption(cid);
  await page.locator('#q-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`AQ Quiz ${tag}`);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#q-list', { hasText: `AQ Quiz ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const qlist = await request.get(`${API}/api/v1/quizzes?course_id=${cid}`, {
    headers: H(admin.access_token),
  });
  expect(qlist.status()).toBe(200);
  const qid = ((await qlist.json()) as { data: { id: string; title: string }[] }).data.find(
    (q) => q.title === `AQ Quiz ${tag}`
  )!.id;

  // Two true_false questions (base modal + correct_answer step).
  const prompts = [`AQ First ${tag}`, `AQ Second ${tag}`];
  for (const p of prompts) {
    await page.locator(`[data-quiz="${qid}"]`).click();
    await page.locator('#q-add').click();
    await page.locator('.modal-dialog select[name="type"]').selectOption('true_false');
    await page.locator('.modal-dialog [name="prompt"]').fill(p);
    await page.locator('.modal-dialog button[type="submit"]').click();
    await page.locator('.modal-dialog [name="correct_answer"]').fill('true');
    await page.locator('.modal-dialog button[type="submit"]').click();
    await expect(page.locator('#q-detail', { hasText: p })).toBeVisible({ timeout: 15000 });
  }
  const qs = (await (
    await request.get(`${API}/api/v1/quizzes/${qid}/questions`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: { id: string; prompt: string; position: number }[] };
  expect(qs.data.length).toBe(2);
  const firstId = qs.data.find((q) => q.prompt === prompts[0])!.id;

  // Edit the first prompt.
  await page.locator(`[data-edit="${firstId}"]`).click();
  await page.locator('.modal-dialog [name="prompt"]').fill(`AQ First Edited ${tag}`);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#q-detail', { hasText: `AQ First Edited ${tag}` })).toBeVisible({
    timeout: 15000,
  });

  // Reorder: move the (edited) first question down; positions swap server-side.
  const before = (await (
    await request.get(`${API}/api/v1/quizzes/${qid}/questions`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: { id: string; position: number }[] };
  const reorder = page.waitForResponse(
    (r) => r.url().includes('/questions/reorder') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator(`[data-down="${firstId}"]`).click();
  expect((await reorder).ok()).toBeTruthy();
  const after = (await (
    await request.get(`${API}/api/v1/quizzes/${qid}/questions`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: { id: string; position: number }[] };
  const pos = (id: string) => after.data.find((q) => q.id === id)!.position;
  const otherId = after.data.find((q) => q.id !== firstId)!.id;
  expect(pos(firstId)).toBeGreaterThan(pos(otherId));
  expect(before.data.find((q) => q.id === firstId)!.position).toBeLessThan(
    before.data.find((q) => q.id === otherId)!.position
  );

  // Delete the moved question with in-app confirm; one remains.
  await page.locator(`[data-del="${firstId}"]`).click();
  await page.locator('[data-ok]').click();
  await expect(page.locator('#q-detail', { hasText: `AQ First Edited ${tag}` })).toHaveCount(0, {
    timeout: 15000,
  });
  const remaining = (await (
    await request.get(`${API}/api/v1/quizzes/${qid}/questions`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: { id: string }[] };
  expect(remaining.data.length).toBe(1);
  expect(remaining.data[0].id).toBe(otherId);

  // Performance report renders for the quiz (zero attempts: honest zeros).
  await page.locator(`[data-perf="${qid}"]`).click();
  await expect(page.locator('#q-detail', { hasText: `AQ Quiz ${tag}` })).toBeVisible({
    timeout: 15000,
  });

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(admin.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin assignments: create, rubric, review submission, grade with rubric', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AA${tag}`.slice(0, 32), title: `AA Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const sem = `aa-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `AA Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const st = ((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data;
  await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.access_token), ...J },
    data: { course_id: cid },
  });

  await adminLogin(page);
  await page.locator('a[href="#/assignments"]').click();
  await page.locator('#a-course').selectOption(cid);
  await page.locator('#a-new').click();
  await page.locator('.modal-dialog [name="title"]').fill(`AA Asg ${tag}`);
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#a-list', { hasText: `AA Asg ${tag}` })).toBeVisible({
    timeout: 15000,
  });
  const alist = await request.get(`${API}/api/v1/assignments?course_id=${cid}`, {
    headers: H(admin.access_token),
  });
  const aid = ((await alist.json()) as { data: { id: string; title: string }[] }).data.find(
    (a) => a.title === `AA Asg ${tag}`
  )!.id;
  const sub = await request.post(`${API}/api/v1/assignments/${aid}/submissions`, {
    headers: { ...H(st.access_token), ...J },
    data: { body: 'AA submission body' },
  });
  expect(sub.status()).toBe(201);

  // Review opens the submissions table (pending badge, grade button).
  await page.locator(`[data-asg="${aid}"]`).click();
  await expect(page.locator('#a-detail', { hasText: 'submitted' })).toBeVisible({
    timeout: 15000,
  });
  await page.locator('#rubric-btn').click();
  await page.locator('.modal-dialog [name="criteria"]').fill('Clarity = 60\nDepth = 40');
  await page.locator('.modal-dialog button[type="submit"]').click();
  const rubric = (await (
    await request.get(`${API}/api/v1/assignments/${aid}/rubric`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: { id: string; label: string; max_points: number }[] };
  expect(rubric.data.length).toBe(2);

  // Grade with rubric scores through the modal (rubric_json appears solo).
  const tsubs = await request.get(`${API}/api/v1/assignments/${aid}/submissions`, {
    headers: H(admin.access_token),
  });
  const subId = ((await tsubs.json()) as { data: { id: string; student_id: string }[] }).data.find(
    (x) => x.student_id === st.user.id
  )!.id;
  await page.locator(`[data-grade="${subId}"]`).click();
  await page.locator('.modal-dialog [name="score"]').fill('80');
  const scores = rubric.data.map((c, i) => ({ criterion_id: c.id, points: i === 0 ? 50 : 30 }));
  await page.locator('.modal-dialog [name="rubric_json"]').fill(JSON.stringify(scores));
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#a-detail span.badge', { hasText: 'graded' })).toBeVisible({
    timeout: 15000,
  });
  const check = await request.get(`${API}/api/v1/assignments/${aid}/submissions`, {
    headers: H(admin.access_token),
  });
  const row = (
    (await check.json()) as { data: { id: string; status: string; score: number }[] }
  ).data.find((x) => x.id === subId)!;
  expect(row.status).toBe('graded');
  expect(row.score).toBe(80);

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${st.user.id}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin gradebook: record grade via modal, filter by student', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AG${tag}`.slice(0, 32), title: `AG Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const sem = `ag-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `AG Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const sid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

  await adminLogin(page);
  await page.locator('a[href="#/grades"]').click();
  await page.locator('#g-course').selectOption(cid);
  await page.locator('#g-new').click();
  await page.locator('.modal-dialog [name="student_id"]').fill(sid);
  await page.locator('.modal-dialog [name="score"]').fill('85');
  await page.locator('.modal-dialog [name="feedback"]').fill('e2e gradebook note');
  await page.locator('.modal-dialog button[type="submit"]').click();
  await expect(page.locator('#g-list', { hasText: '85' })).toBeVisible({ timeout: 15000 });
  // Filter to the student: the row persists server-side with feedback.
  await page.locator('#g-student').fill(sid);
  await page.locator('#g-load').click();
  await expect(page.locator('#g-list', { hasText: 'e2e gradebook note' })).toBeVisible({
    timeout: 15000,
  });
  const glist = await request.get(`${API}/api/v1/grades?course_id=${cid}&student_id=${sid}`, {
    headers: H(admin.access_token),
  });
  expect(glist.status()).toBe(200);
  const rows = ((await glist.json()) as { data: { score: number; feedback: string }[] }).data;
  expect(rows.length).toBe(1);
  expect(rows[0].score).toBe(85);
  expect(rows[0].feedback).toBe('e2e gradebook note');

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${sid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test('admin certificates: issue, verify, revoke with honest states', async ({ page, request }) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const sup = await apiLogin(request, SUPER);
  const org = await orgId(request, admin.access_token);
  const tag = uniq();
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: { organization_id: org, code: `AC${tag}`.slice(0, 32), title: `AC Course ${tag}` },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const sem = `ac-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: sem, password: PASS, name: `AC Student ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const sid = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

  await adminLogin(page);
  await page.locator('a[href="#/certificates"]').click();
  await page.locator('#cert-course').selectOption(cid);
  await page.locator('#cert-student').fill(sid);
  const issued = page.waitForResponse(
    (r) => r.url().includes('/certificates/issue') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#cert-form button[type="submit"], #cert-form button').first().click();
  expect((await issued).ok()).toBeTruthy();
  // Server: the certificate number exists for this student+course.
  const clist = await request.get(
    `${API}/api/v1/certificates?student_id=${sid}&organization_id=${org}`,
    { headers: H(admin.access_token) }
  );
  expect(clist.status()).toBe(200);
  const num = ((await clist.json()) as { data: { certificate_number: string }[] }).data[0]
    .certificate_number;
  await expect(page.locator('#cert-list', { hasText: num.slice(0, 20) })).toBeVisible({
    timeout: 15000,
  });

  // Public verify through the UI form: valid first…
  await page.locator('#verify-num').fill(num);
  await page.locator('#verify-form button').click();
  await expect(page.locator('#verify-out', { hasText: 'Valid' })).toBeVisible({
    timeout: 15000,
  });
  // …then revoke with in-app confirm: row flips to REVOKED, verify fails.
  const certId = ((await clist.json()) as { data: { id: string }[] }).data[0].id;
  await page.locator(`[data-revoke="${certId}"]`).click();
  await page.locator('[data-ok]').click();
  await expect(page.locator('#cert-list', { hasText: 'REVOKED' })).toBeVisible({
    timeout: 15000,
  });
  const v2 = await request.get(`${API}/api/v1/certificates/verify/${num}`);
  expect(v2.status()).toBe(200);
  expect(((await v2.json()) as { data: { valid: boolean; reason: string } }).data.valid).toBe(
    false
  );

  await request.delete(`${API}/api/v1/courses/${cid}`, { headers: H(sup.access_token) });
  await request.delete(`${API}/api/v1/users/${sid}`, { headers: H(sup.access_token) });
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
