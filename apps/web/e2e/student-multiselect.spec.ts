import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Real-browser proof for the multi-select quiz flow (option_ids exact-set
// scoring + checkbox UI): fixtures via API, submit via real student portal
// clicks, score asserted from the rendered result AND the API re-read.
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

test('student: multi-select quiz via UI checks exact set and scores 100', async ({
  page,
  request,
}) => {
  const { pageErrors, badResponses } = await trackErrors(page);
  const admin = await apiLogin(request, ADMIN);
  const orgs = (await (
    await request.get(`${API}/api/v1/organizations`, { headers: H(admin.access_token) })
  ).json()) as { data: { id: string }[] };
  const org = orgs.data[0].id;
  const tag = uniq();
  const em = `ms-student-${tag}@example.com`;
  const reg = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: 'MS Student', organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const course = (await (
    await request.post(`${API}/api/v1/courses`, {
      headers: { ...H(admin.access_token), ...J },
      data: {
        organization_id: org,
        code: `MS${tag}`.slice(0, 32),
        title: `MS Quiz ${tag}`,
        price: 0,
      },
    })
  ).json()) as { data: { id: string } };
  const cid = course.data.id;
  const quiz = (await (
    await request.post(`${API}/api/v1/quizzes`, {
      headers: { ...H(admin.access_token), ...J },
      data: { course_id: cid, title: 'Multi', passing_score: 50, max_attempts: 5 },
    })
  ).json()) as { data: { id: string } };
  const qid = quiz.data.id;
  const q = await request.post(`${API}/api/v1/quizzes/${qid}/questions`, {
    headers: { ...H(admin.access_token), ...J },
    data: {
      type: 'multiple_choice',
      prompt: 'Pick even numbers',
      points: 100,
      options: [
        { label: 'Two', is_correct: true },
        { label: 'Four', is_correct: true },
        { label: 'Three', is_correct: false },
      ],
    },
  });
  expect(q.status()).toBe(201);
  // Correct option ids (privileged read) drive the real checkbox clicks.
  const full = (await (
    await request.get(`${API}/api/v1/quizzes/${qid}/questions`, {
      headers: H(admin.access_token),
    })
  ).json()) as { data: { options: { id: string; label: string; is_correct: number }[] }[] };
  const correctIds = full.data[0].options.filter((o) => o.is_correct === 1).map((o) => o.id);
  expect(correctIds.length).toBe(2);
  await request.patch(`${API}/api/v1/courses/${cid}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published', visibility: 'public' },
  });
  const stok = (await apiLogin(request, em)).access_token;
  const enr = await request.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(stok), ...J },
    data: { course_id: cid },
  });
  expect(enr.status()).toBe(201);

  // Real UI: login, open course, quiz tab, start attempt, check the exact
  // correct set, submit, read the rendered score.
  await page.goto(`${STUDENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(em);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
  await page.goto(`${STUDENT_URL}/#/courses/${cid}`);
  await page.locator('button[data-t="quiz"]').click();
  await page.locator(`button[data-start="${qid}"]`).click();
  for (const oid of correctIds) {
    await page.locator(`#quiz-form input[type="checkbox"][value="${oid}"]`).check();
  }
  const submitted = page.waitForResponse(
    (r) => r.url().includes('/submit') && r.request().method() === 'POST',
    { timeout: 15000 }
  );
  await page.locator('#quiz-form button.btn-primary').click();
  const res = await submitted;
  expect(res.ok()).toBe(true);
  await expect(page.locator('[data-res]', { hasText: '100' }).first()).toBeVisible({
    timeout: 15000,
  });
  // Server state agrees (not just DOM text).
  const me = await apiLogin(request, em);
  const atts = (await (
    await request.get(`${API}/api/v1/quizzes/${qid}/attempts`, { headers: H(me.access_token) })
  ).json()) as { data: { score: number; status: string }[] };
  expect(atts.data[0].score).toBe(100);
  expect(atts.data[0].status).toBe('graded');
  // Fixture student removed via superadmin; content fixtures follow the
  // roles.spec convention (disposable unique codes, no live impact).
  const sup = await apiLogin(request, SUPER);
  const roster = (await (
    await request.get(`${API}/api/v1/users?q=${encodeURIComponent(em)}`, {
      headers: H(sup.access_token),
    })
  ).json()) as { data: { id: string }[] };
  if (roster.data[0]?.id) {
    await request.delete(`${API}/api/v1/users/${roster.data[0].id}`, {
      headers: H(sup.access_token),
    });
  }
  expect(pageErrors).toEqual([]);
  expect(badResponses).toEqual([]);
});
