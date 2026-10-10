import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';

// Full role journeys against the live API (no portal UI dependency).
// API on :8787 (API_BASE env or direct), disposable fixtures with unique
// timestamps in emails/codes/slugs so reruns never collide.
const API = process.env.API_BASE ?? 'http://localhost:8787';
const PASS = 'Password123!';
const ADMIN = 'admin@example.com';
const TEACHER = 'teacher@example.com';
const PARENT = 'parent@example.com';

// Tests are independent (disposable fixtures); default file-level ordering applies.

const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const email = (tag: string) => `e2e-${uniq()}-${tag}@example.com`;
const code = (tag: string) => `E2E${uniq()}`.toUpperCase().slice(0, 32) + tag;
const H = (token: string) => ({ Authorization: `Bearer ${token}` });
const J = { 'content-type': 'application/json' };

type Req = APIRequestContext;

async function login(req: Req, em: string, pw: string) {
  const res = await req.post(`${API}/api/v1/auth/login`, { data: { email: em, password: pw } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    data: { access_token: string; user: { id: string; email: string } };
  };
  expect(body.data.access_token).toBeTruthy();
  return body.data;
}

async function orgId(req: Req, token: string) {
  const res = await req.get(`${API}/api/v1/organizations`, { headers: H(token) });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: { id: string }[] };
  expect(body.data.length).toBeGreaterThan(0);
  return body.data[0].id;
}

async function registerStudent(req: Req, org: string, tag: string) {
  const em = email(tag);
  const res = await req.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `E2E ${tag}`, organization_id: org },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { data: { access_token: string; user: { id: string } } };
  return { email: em, token: body.data.access_token, id: body.data.user.id };
}

async function makeCourse(
  req: Req,
  token: string,
  org: string,
  tag: string,
  price = 0
): Promise<string> {
  const res = await req.post(`${API}/api/v1/courses`, {
    headers: { ...H(token), ...J },
    data: {
      organization_id: org,
      code: code(tag),
      title: `E2E Course ${uniq()} ${tag}`,
      slug: `e2e-c-${uniq()}`.toLowerCase(),
      price,
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

async function addSectionLesson(req: Req, token: string, courseId: string, tag: string) {
  const s = await req.post(`${API}/api/v1/courses/${courseId}/sections`, {
    headers: { ...H(token), ...J },
    data: { title: `Section ${tag}` },
  });
  expect(s.status()).toBe(201);
  const sectionId = ((await s.json()) as { data: { id: string } }).data.id;
  const l = await req.post(`${API}/api/v1/courses/sections/${sectionId}/lessons`, {
    headers: { ...H(token), ...J },
    data: { title: `Lesson ${tag}`, content_type: 'text', body: 'e2e body' },
  });
  expect(l.status()).toBe(201);
  const lessonId = ((await l.json()) as { data: { id: string } }).data.id;
  // DB-visible effect: re-GET lessons list contains the new lesson.
  const list = await req.get(`${API}/api/v1/courses/sections/${sectionId}/lessons`, {
    headers: H(token),
  });
  expect(list.status()).toBe(200);
  expect(((await list.json()) as { data: { id: string }[] }).data.map((x) => x.id)).toContain(
    lessonId
  );
  return { sectionId, lessonId };
}

test('1. register→login→me, wrong password 401, unauthenticated users 401', async ({ page }) => {
  const req = page.request;
  const admin = await login(req, ADMIN, PASS);
  const org = await orgId(req, admin.access_token);
  const em = email('auth');
  const reg = await req.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: 'E2E Auth', organization_id: org },
  });
  expect(reg.status()).toBe(201);
  const logged = await login(req, em, PASS);
  const me = await req.get(`${API}/api/v1/auth/me`, { headers: H(logged.access_token) });
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { data: { user: { email: string } } }).data.user.email).toBe(em);
  const bad = await req.post(`${API}/api/v1/auth/login`, {
    data: { email: em, password: 'WrongPass999!' },
  });
  expect(bad.status()).toBe(401);
  const anon = await req.get(`${API}/api/v1/users`);
  expect(anon.status()).toBe(401);
});

test('2. admin journey: draft course → section+lesson → publish → public catalog', async ({
  page,
}) => {
  const req = page.request;
  const admin = await login(req, ADMIN, PASS);
  const org = await orgId(req, admin.access_token);
  const courseId = await makeCourse(req, admin.access_token, org, 'ADM');
  const before = await req.get(`${API}/api/v1/courses/${courseId}`, {
    headers: H(admin.access_token),
  });
  expect(before.status()).toBe(200);
  expect(((await before.json()) as { data: { status: string } }).data.status).toBe('draft');
  await addSectionLesson(req, admin.access_token, courseId, 'adm');
  const pub = await req.patch(`${API}/api/v1/courses/${courseId}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { status: 'published', visibility: 'public' },
  });
  expect(pub.status()).toBe(200);
  const after = await req.get(`${API}/api/v1/courses/${courseId}`, {
    headers: H(admin.access_token),
  });
  expect(after.status()).toBe(200);
  const course = (
    (await after.json()) as { data: { status: string; visibility: string; code: string } }
  ).data;
  expect(course.status).toBe('published');
  expect(course.visibility).toBe('public');
  // DB-visible effect on the public storefront (no auth), searched by unique code.
  const cat = await req.get(`${API}/api/v1/catalog/courses?q=${encodeURIComponent(course.code)}`);
  expect(cat.status()).toBe(200);
  const items = ((await cat.json()) as { data: { id: string }[] }).data;
  expect(items.map((x) => x.id)).toContain(courseId);
});

test('3. teacher journey: quiz+assignment → enroll → attempt+submit → grade → see grade', async ({
  page,
}) => {
  const req = page.request;
  const teacher = await login(req, TEACHER, PASS);
  const admin = await login(req, ADMIN, PASS);
  const org = await orgId(req, admin.access_token);
  const courseId = await makeCourse(req, teacher.access_token, org, 'TCH');
  const qz = await req.post(`${API}/api/v1/quizzes`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { course_id: courseId, title: `Quiz ${uniq()}`, passing_score: 70 },
  });
  expect(qz.status()).toBe(201);
  const quizId = ((await qz.json()) as { data: { id: string } }).data.id;
  const qq = await req.post(`${API}/api/v1/quizzes/${quizId}/questions`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { type: 'true_false', prompt: 'E2E: sky is blue?', points: 100, correct_answer: 'true' },
  });
  expect(qq.status()).toBe(201);
  const questionId = ((await qq.json()) as { data: { id: string } }).data.id;
  const qlist = await req.get(`${API}/api/v1/quizzes/${quizId}/questions`, {
    headers: H(teacher.access_token),
  });
  expect(qlist.status()).toBe(200);
  expect(((await qlist.json()) as { data: { id: string }[] }).data.map((x) => x.id)).toContain(
    questionId
  );
  const ag = await req.post(`${API}/api/v1/assignments`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { course_id: courseId, title: `Asg ${uniq()}`, max_score: 100 },
  });
  expect(ag.status()).toBe(201);
  const asgId = ((await ag.json()) as { data: { id: string } }).data.id;

  const st = await registerStudent(req, org, 'tstud');
  const enr = await req.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.token), ...J },
    data: { course_id: courseId },
  });
  expect(enr.status()).toBe(201);
  const enrList = await req.get(`${API}/api/v1/courses/${courseId}/enrollments`, {
    headers: H(st.token),
  });
  expect(enrList.status()).toBe(200);
  expect(((await enrList.json()) as { data: { status: string }[] }).data[0]?.status).toBe('active');

  const att = await req.post(`${API}/api/v1/quizzes/${quizId}/attempts`, { headers: H(st.token) });
  expect([200, 201]).toContain(att.status());
  const attemptId = ((await att.json()) as { data: { id: string } }).data.id;
  const sub = await req.post(`${API}/api/v1/quiz-attempts/${attemptId}/submit`, {
    headers: { ...H(st.token), ...J },
    data: { answers: [{ question_id: questionId, answer_text: 'true' }] },
  });
  expect(sub.status()).toBe(200);
  expect(((await sub.json()) as { data: { score: number } }).data.score).toBe(100);
  const myAtt = await req.get(`${API}/api/v1/quizzes/${quizId}/attempts`, { headers: H(st.token) });
  expect(myAtt.status()).toBe(200);
  const mine = ((await myAtt.json()) as { data: { id: string; status: string; score: number }[] })
    .data;
  expect(mine.find((a) => a.id === attemptId)?.status).toBe('graded');

  const ssub = await req.post(`${API}/api/v1/assignments/${asgId}/submissions`, {
    headers: { ...H(st.token), ...J },
    data: { body: 'E2E answer body' },
  });
  expect(ssub.status()).toBe(201);
  const subs = await req.get(`${API}/api/v1/assignments/${asgId}/submissions`, {
    headers: H(teacher.access_token),
  });
  expect(subs.status()).toBe(200);
  const subRow = ((await subs.json()) as { data: { id: string; student_id: string }[] }).data.find(
    (x) => x.student_id === st.id
  );
  expect(subRow).toBeTruthy();
  const grade = await req.post(`${API}/api/v1/submissions/${subRow!.id}/grade`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { score: 90, feedback: 'good' },
  });
  expect(grade.status()).toBe(200);
  const mySubs = await req.get(`${API}/api/v1/assignments/${asgId}/submissions`, {
    headers: H(st.token),
  });
  expect(mySubs.status()).toBe(200);
  const seen = ((await mySubs.json()) as { data: { status: string; score: number }[] }).data[0];
  expect(seen.status).toBe('graded');
  expect(seen.score).toBe(90);

  const g = await req.post(`${API}/api/v1/grades`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { course_id: courseId, student_id: st.id, score: 88 },
  });
  expect(g.status()).toBe(201);
  const glist = await req.get(`${API}/api/v1/grades?course_id=${courseId}`, {
    headers: H(st.token),
  });
  expect(glist.status()).toBe(200);
  expect(
    ((await glist.json()) as { data: { score: number }[] }).data.map((x) => x.score)
  ).toContain(88);
});

test('4. commerce: paid order → manual claim → confirm → duplicate webhook → refund', async ({
  page,
}) => {
  const req = page.request;
  const admin = await login(req, ADMIN, PASS);
  const org = await orgId(req, admin.access_token);
  const courseId = await makeCourse(req, admin.access_token, org, 'COM', 50000);
  const { lessonId } = await addSectionLesson(req, admin.access_token, courseId, 'com');
  const st = await registerStudent(req, org, 'buyer');

  const ord = await req.post(`${API}/api/v1/orders`, {
    headers: { ...H(st.token), ...J },
    data: { organization_id: org, kind: 'course', reference_id: courseId },
  });
  expect(ord.status()).toBe(201);
  const order = (
    (await ord.json()) as { data: { id: string; status: string; total_minor: number } }
  ).data;
  expect(order.status).toBe('pending');
  const oget = await req.get(`${API}/api/v1/orders/${order.id}`, { headers: H(st.token) });
  expect(oget.status()).toBe(200);
  expect(((await oget.json()) as { data: { order: { status: string } } }).data.order.status).toBe(
    'pending'
  );

  const claim = await req.post(`${API}/api/v1/orders/${order.id}/payments/manual`, {
    headers: { ...H(st.token), ...J },
    data: { reference: `BANK-${uniq()}` },
  });
  expect(claim.status()).toBe(201);
  const odetail = await req.get(`${API}/api/v1/orders/${order.id}`, {
    headers: H(admin.access_token),
  });
  expect(odetail.status()).toBe(200);
  const payments = (
    (await odetail.json()) as { data: { payments: { id: string; status: string }[] } }
  ).data.payments;
  expect(payments.length).toBeGreaterThan(0);
  const confirm = await req.post(`${API}/api/v1/payments/${payments[0].id}/confirm`, {
    headers: H(admin.access_token),
  });
  expect(confirm.status()).toBe(200);

  const paid = await req.get(`${API}/api/v1/orders/${order.id}`, { headers: H(st.token) });
  expect(paid.status()).toBe(200);
  expect(((await paid.json()) as { data: { order: { status: string } } }).data.order.status).toBe(
    'paid'
  );
  const enrs = await req.get(`${API}/api/v1/courses/${courseId}/enrollments`, {
    headers: H(st.token),
  });
  expect(enrs.status()).toBe(200);
  expect(((await enrs.json()) as { data: { status: string }[] }).data[0]?.status).toBe('active');
  // Entitlement exists: the paid-course gate passes on lesson completion.
  const done = await req.post(`${API}/api/v1/lessons/${lessonId}/complete`, {
    headers: H(st.token),
  });
  expect(done.status()).toBe(200);

  // Duplicate webhook: same transaction_id twice → second returns duplicate:true.
  const srvKey = `key-${uniq()}`;
  const setKey = await req.put(`${API}/api/v1/organizations/${org}`, {
    headers: { ...H(admin.access_token), ...J },
    data: { settings: { payment_midtrans_server_key: srvKey } },
  });
  expect(setKey.status()).toBe(200);
  const full = (
    (await (
      await req.get(`${API}/api/v1/orders/${order.id}`, { headers: H(admin.access_token) })
    ).json()) as { data: { order: { total_minor: number; total: number } } }
  ).data.order;
  // gross_amount is major units per the Midtrans-style contract (server
  // matches it against the order total and rejects mismatches with 402).
  const gross = String(full.total);
  const txn = `txn-${uniq()}`;
  const sig = createHash('sha512').update(`${order.id}200${gross}${srvKey}`).digest('hex');
  const payload = {
    order_id: order.id,
    status_code: '200',
    gross_amount: gross,
    signature_key: sig,
    transaction_id: txn,
    transaction_status: 'settlement',
  };
  const wh1 = await req.post(`${API}/api/v1/payments/webhooks/midtrans`, { data: payload });
  expect(wh1.status()).toBe(200);
  const wh2 = await req.post(`${API}/api/v1/payments/webhooks/midtrans`, { data: payload });
  expect(wh2.status()).toBe(200);
  expect(((await wh2.json()) as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
  const still = await req.get(`${API}/api/v1/orders/${order.id}`, { headers: H(st.token) });
  expect(((await still.json()) as { data: { order: { status: string } } }).data.order.status).toBe(
    'paid'
  );

  const refund = await req.post(`${API}/api/v1/orders/${order.id}/refund`, {
    headers: H(admin.access_token),
  });
  expect(refund.status()).toBe(200);
  const ro = await req.get(`${API}/api/v1/orders/${order.id}`, { headers: H(st.token) });
  expect(((await ro.json()) as { data: { order: { status: string } } }).data.order.status).toBe(
    'refunded'
  );
  const dropped = await req.get(`${API}/api/v1/courses/${courseId}/enrollments`, {
    headers: H(st.token),
  });
  expect(dropped.status()).toBe(200);
  expect(((await dropped.json()) as { data: { status: string }[] }).data[0]?.status).toBe(
    'dropped'
  );
});

test('5. negative: cross-student privacy, parent scoping, teacher cannot refund', async ({
  page,
}) => {
  const req = page.request;
  const admin = await login(req, ADMIN, PASS);
  const teacher = await login(req, TEACHER, PASS);
  const parent = await login(req, PARENT, PASS);
  const org = await orgId(req, admin.access_token);
  const courseId = await makeCourse(req, teacher.access_token, org, 'NEG');

  const studA = await registerStudent(req, org, 'studA');
  const studB = await registerStudent(req, org, 'studB');
  const mkGrade = await req.post(`${API}/api/v1/grades`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { course_id: courseId, student_id: studA.id, score: 77 },
  });
  expect(mkGrade.status()).toBe(201);
  const cross = await req.get(`${API}/api/v1/grades?course_id=${courseId}&student_id=${studA.id}`, {
    headers: H(studB.token),
  });
  expect(cross.status()).toBe(403);
  const own = await req.get(`${API}/api/v1/grades?course_id=${courseId}&student_id=${studA.id}`, {
    headers: H(studA.token),
  });
  expect(own.status()).toBe(200);
  expect(((await own.json()) as { data: { score: number }[] }).data.map((x) => x.score)).toContain(
    77
  );

  const issue = await req.post(`${API}/api/v1/certificates/issue`, {
    headers: { ...H(teacher.access_token), ...J },
    data: { course_id: courseId, student_id: studA.id },
  });
  expect([200, 201]).toContain(issue.status());
  const crossCert = await req.get(
    `${API}/api/v1/certificates?student_id=${studA.id}&organization_id=${org}`,
    { headers: H(studB.token) }
  );
  expect(crossCert.status()).toBe(403);
  const ownCert = await req.get(`${API}/api/v1/certificates`, { headers: H(studA.token) });
  expect(ownCert.status()).toBe(200);
  expect(((await ownCert.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);

  // Parent sees only linked children: link via API, then verify list.
  const members = await req.get(`${API}/api/v1/organizations/${org}/members`, {
    headers: H(admin.access_token),
  });
  expect(members.status()).toBe(200);
  const seedStudent = (
    (await members.json()) as { data: { email: string; id: string }[] }
  ).data.find((m) => m.email === 'student@example.com');
  expect(seedStudent).toBeTruthy();
  const link = await req.post(`${API}/api/v1/users/${parent.user.id}/parent-links`, {
    headers: { ...H(admin.access_token), ...J },
    data: { student_id: studA.id, organization_id: org },
  });
  expect(link.status()).toBe(201);
  const linked = await req.get(`${API}/api/v1/users/${parent.user.id}/linked-students`, {
    headers: H(parent.access_token),
  });
  expect(linked.status()).toBe(200);
  const kids = ((await linked.json()) as { data: { id: string }[] }).data.map((x) => x.id);
  expect(kids).toContain(seedStudent!.id);
  expect(kids).toContain(studA.id);
  expect(kids).not.toContain(studB.id);

  // Teacher cannot refund: build a small paid order, attempt refund as teacher.
  const paidCourse = await makeCourse(req, admin.access_token, org, 'NEGP', 10000);
  const buyer = await registerStudent(req, org, 'negbuy');
  const ord = await req.post(`${API}/api/v1/orders`, {
    headers: { ...H(buyer.token), ...J },
    data: { organization_id: org, kind: 'course', reference_id: paidCourse },
  });
  expect(ord.status()).toBe(201);
  const orderId = ((await ord.json()) as { data: { id: string } }).data.id;
  const tRefund = await req.post(`${API}/api/v1/orders/${orderId}/refund`, {
    headers: H(teacher.access_token),
  });
  expect(tRefund.status()).toBe(403);
  const ocheck = await req.get(`${API}/api/v1/orders/${orderId}`, { headers: H(buyer.token) });
  expect(((await ocheck.json()) as { data: { order: { status: string } } }).data.order.status).toBe(
    'pending'
  );
});

test('6. certificate: complete lesson → auto-issue → verify → revoke → revoked', async ({
  page,
}) => {
  const req = page.request;
  const admin = await login(req, ADMIN, PASS);
  const teacher = await login(req, TEACHER, PASS);
  const org = await orgId(req, admin.access_token);
  const courseId = await makeCourse(req, admin.access_token, org, 'CRT');
  const { lessonId } = await addSectionLesson(req, admin.access_token, courseId, 'crt');
  const st = await registerStudent(req, org, 'cert');

  const enr = await req.post(`${API}/api/v1/enrollments`, {
    headers: { ...H(st.token), ...J },
    data: { course_id: courseId },
  });
  expect(enr.status()).toBe(201);
  const complete = await req.post(`${API}/api/v1/lessons/${lessonId}/complete`, {
    headers: H(st.token),
  });
  expect(complete.status()).toBe(200);
  expect(
    ((await complete.json()) as { data: { progress_percent: number } }).data.progress_percent
  ).toBe(100);

  // DB-visible effect: certificate auto-issued, visible on re-GET list.
  const certs = await req.get(
    `${API}/api/v1/certificates?student_id=${st.id}&organization_id=${org}`,
    { headers: H(teacher.access_token) }
  );
  expect(certs.status()).toBe(200);
  const rows = ((await certs.json()) as { data: { id: string; certificate_number: string }[] })
    .data;
  expect(rows.length).toBeGreaterThan(0);
  const num = rows[0].certificate_number;
  const v1 = await req.get(`${API}/api/v1/certificates/verify/${num}`);
  expect(v1.status()).toBe(200);
  expect(((await v1.json()) as { data: { valid: boolean } }).data.valid).toBe(true);
  const revoke = await req.post(`${API}/api/v1/certificates/${rows[0].id}/revoke`, {
    headers: H(teacher.access_token),
  });
  expect(revoke.status()).toBe(200);
  const v2 = await req.get(`${API}/api/v1/certificates/verify/${num}`);
  expect(v2.status()).toBe(200);
  const vbody = ((await v2.json()) as { data: { valid: boolean; reason: string } }).data;
  expect(vbody.valid).toBe(false);
  expect(vbody.reason).toBe('revoked');
});

test('7. password recovery: forgot always succeeds, bad token rejected', async ({ page }) => {
  const req = page.request;
  // Enumeration-safe: unknown address also returns success.
  const f1 = await req.post(`${API}/api/v1/auth/password/forgot`, {
    data: { email: `nobody-${Date.now()}@example.com` },
  });
  expect(f1.status()).toBe(200);
  // Consuming an invalid token fails without leaking validity info.
  const bad = await req.post(`${API}/api/v1/auth/password/reset`, {
    data: { token: '0'.repeat(64), password: 'BrandNew123!' },
  });
  expect(bad.status()).toBe(400);
});

test('8. quiz autosave: draft persists across fetches, clears on submit', async ({ page }) => {
  const req = page.request;
  const admin = await login(req, ADMIN, PASS);
  const org = await orgId(req, admin.access_token);
  const teacher = await login(req, TEACHER, PASS);
  const student = await registerStudent(req, org, 'auto');
  const course = await makeCourse(req, teacher.access_token, org, 'AUTO');
  const quiz = await (
    await req.post(`${API}/api/v1/quizzes`, {
      headers: H(teacher.access_token),
      data: { course_id: course, title: 'Autosave quiz', passing_score: 50 },
    })
  ).json();
  const q = await (
    await req.post(`${API}/api/v1/quizzes/${quiz.data.id}/questions`, {
      headers: H(teacher.access_token),
      data: { type: 'short_answer', prompt: 'Capital?', points: 10, correct_answer: 'X' },
    })
  ).json();
  await req.post(`${API}/api/v1/enrollments`, {
    headers: H(student.token),
    data: { course_id: course },
  });
  const att = await (
    await req.post(`${API}/api/v1/quizzes/${quiz.data.id}/attempts`, {
      headers: H(student.token),
    })
  ).json();
  const aid = att.data.id as string;
  const qid = q.data.id as string;
  const save = await req.put(`${API}/api/v1/quiz-attempts/${aid}/autosave`, {
    headers: H(student.token),
    data: { answers: [{ question_id: qid, payload: 'draft-text' }] },
  });
  expect(save.status()).toBe(200);
  // Simulated reload: draft is still there.
  const draft = await req.get(`${API}/api/v1/quiz-attempts/${aid}/autosave`, {
    headers: H(student.token),
  });
  expect(draft.status()).toBe(200);
  expect(((await draft.json()) as { data: { payload: string }[] }).data[0].payload).toBe(
    'draft-text'
  );
  // Submit succeeds and closes the attempt; drafts are gone.
  const submit = await req.post(`${API}/api/v1/quiz-attempts/${aid}/submit`, {
    headers: H(student.token),
    data: { answers: [{ question_id: qid, answer_text: 'X' }] },
  });
  expect(submit.status()).toBe(200);
  const after = await req.get(`${API}/api/v1/quiz-attempts/${aid}/autosave`, {
    headers: H(student.token),
  });
  expect(after.status()).toBe(400);
});
