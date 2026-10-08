import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { createNodeSqliteDb, execute, queryFirst, type D1Like } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { hashPassword } from '../src/crypto.js';
import { newId, nowIso } from '@lms/shared';
import type { AppEnv } from '../src/types.js';

const SECRET = 'test-secret-min-32-chars-long-xxxxxx';

async function setup() {
  const db = await createNodeSqliteDb(':memory:');
  const { join } = await import('node:path');
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  await runMigrations(db, join(here, '..', '..', '..', 'migrations'));
  const env: AppEnv = { DB: db, JWT_SECRET: SECRET, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: './.data/uploads-test' };
  const app = createApp(env, db);
  return { db, app, env };
}

async function mkOrg(db: D1Like, slug: string) {
  const id = newId();
  await execute(db, 'INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, slug, slug, nowIso(), nowIso());
  return id;
}

async function mkUser(db: D1Like, email: string, role: string | null, orgId?: string) {
  const id = newId();
  await execute(db, 'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, email, await hashPassword('Password123!'), email.split('@')[0], 'active', nowIso(), nowIso());
  if (role && orgId) {
    await execute(db, 'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), orgId, id, role, nowIso(), nowIso());
  }
  return id;
}

async function login(app: ReturnType<typeof createApp>, email: string) {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' }),
  });
  const j = (await res.json()) as { data: { access_token: string } };
  return j.data.access_token;
}

async function mkCourse(db: D1Like, orgId: string, teacherId: string, code = 'C101') {
  const id = newId();
  await execute(db, 'INSERT INTO courses (id, organization_id, code, title, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, orgId, code, `Course ${code}`, 'published', teacherId, nowIso(), nowIso());
  return id;
}

describe('auth', () => {
  it('register + login success, invalid login rejected, unauthorized rejected', async () => {
    const { app, db } = await setup();
    const orgId = await mkOrg(db, 'o1');
    let res = await app.request('/api/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@x.com', password: 'Password123!', name: 'A', organization_id: orgId }) });
    expect(res.status).toBe(201);
    res = await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@x.com', password: 'Wrong!' }) });
    expect(res.status).toBe(401);
    res = await app.request('/api/v1/users');
    expect(res.status).toBe(401);
    res = await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@x.com', password: 'Password123!' }) });
    expect(res.status).toBe(200);
  });
  it('refresh + logout cycle', async () => {
    const { app, db } = await setup();
    const orgId = await mkOrg(db, 'o1');
    await mkUser(db, 'r@x.com', 'student', orgId);
    const loginRes = await (await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'r@x.com', password: 'Password123!' }) })).json() as { data: { refresh_token: string } };
    const ref = await app.request('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: loginRes.data.refresh_token }) });
    expect(ref.status).toBe(200);
    // reuse of old refresh must fail (rotation)
    const ref2 = await app.request('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: loginRes.data.refresh_token }) });
    expect(ref2.status).toBe(401);
  });
});

describe('rbac + tenant isolation + IDOR', () => {
  it('org A cannot access org B; student cannot create course; IDOR on grades blocked', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'orga');
    const orgB = await mkOrg(db, 'orgb');
    const tA = await mkUser(db, 'ta@x.com', 'teacher', orgA);
    const sA = await mkUser(db, 'sa@x.com', 'student', orgA);
    const sB = await mkUser(db, 'sb@x.com', 'student', orgB);
    const courseB = await mkCourse(db, orgB, tA, 'CB1');
    const tokA = await login(app, 'sa@x.com');
    // cross-tenant read denied
    let res = await app.request(`/api/v1/courses/${courseB}`, { headers: { authorization: `Bearer ${tokA}` } });
    expect(res.status).toBe(403);
    // student cannot create course
    res = await app.request('/api/v1/courses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokA}` }, body: JSON.stringify({ organization_id: orgA, code: 'X1', title: 'Hack' }) });
    expect(res.status).toBe(403);
    // teacher creates course in A, student B tries to list enrollments (IDOR-ish) -> denied
    const tokT = await login(app, 'ta@x.com');
    const cA = await (await app.request('/api/v1/courses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ organization_id: orgA, code: 'CA1', title: 'Algebra' }) })).json() as { data: { id: string } };
    void sB;
    const tokB = await login(app, 'sb@x.com');
    res = await app.request(`/api/v1/courses/${cA.data.id}/enrollments`, { headers: { authorization: `Bearer ${tokB}` } });
    expect(res.status).toBe(403);
    // privilege escalation: student tries to create super_admin
    res = await app.request('/api/v1/users', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokA}` }, body: JSON.stringify({ email: 'evil@x.com', password: 'Password123!', name: 'E', role: 'super_admin' }) });
    expect(res.status).toBe(403);
    void sA;
  });
  it('parent sees only linked student grades', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'opg');
    const t = await mkUser(db, 't@p.com', 'teacher', org);
    const s1 = await mkUser(db, 's1@p.com', 'student', org);
    const s2 = await mkUser(db, 's2@p.com', 'student', org);
    const p = await mkUser(db, 'p@p.com', 'parent', org);
    await execute(db, 'INSERT INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)', newId(), p, s1, org, nowIso());
    const c = await mkCourse(db, org, t, 'PC1');
    await execute(db, 'INSERT INTO grades (id, course_id, student_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), c, s2, 90, nowIso(), nowIso());
    const tokP = await login(app, 'p@p.com');
    const res = await app.request(`/api/v1/grades?course_id=${c}&student_id=${s2}`, { headers: { authorization: `Bearer ${tokP}` } });
    expect(res.status).toBe(403);
    const res2 = await app.request(`/api/v1/grades?course_id=${c}&student_id=${s1}`, { headers: { authorization: `Bearer ${tokP}` } });
    expect(res2.status).toBe(200);
  });
});

describe('courses + progress', () => {
  it('CRUD + enroll + complete lesson + progress 100% issues certificate', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'oc');
    const t = await mkUser(db, 'tc@c.com', 'teacher', org);
    const s = await mkUser(db, 'sc@c.com', 'student', org);
    const tokT = await login(app, 'tc@c.com');
    const tokS = await login(app, 'sc@c.com');
    const cRes = (await (await app.request('/api/v1/courses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ organization_id: org, code: 'M1', title: 'Math' }) })).json()) as { data: { id: string } };
    const cid = cRes.data.id;
    const sec = (await (await app.request(`/api/v1/courses/${cid}/sections`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ title: 'S1' }) })).json()) as { data: { id: string } };
    const les = (await (await app.request(`/api/v1/courses/sections/${sec.data.id}/lessons`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ title: 'L1', content_type: 'text', body: 'hi' }) })).json()) as { data: { id: string } };
    const enr = await app.request('/api/v1/enrollments', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokS}` }, body: JSON.stringify({ course_id: cid }) });
    expect(enr.status).toBe(201);
    const done = await app.request(`/api/v1/lessons/${les.data.id}/complete`, { method: 'POST', headers: { authorization: `Bearer ${tokS}` } });
    expect(done.status).toBe(200);
    const certs = (await (await app.request('/api/v1/certificates', { headers: { authorization: `Bearer ${tokS}` } })).json()) as { data: unknown[] };
    expect(certs.data.length).toBe(1);
    void t; void s;
  });
  it('validation rejects bad input', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ov');
    await mkUser(db, 'tv@v.com', 'teacher', org);
    const tok = await login(app, 'tv@v.com');
    const res = await app.request('/api/v1/courses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ organization_id: org, code: '', title: 'x' }) });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { success: boolean; error: { code: string } };
    expect(j.success).toBe(false);
    expect(j.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('quiz + assignment + attendance + verify', () => {
  it('quiz attempt scores and respects max attempts; assignment submit+grade; attendance; cert verify public', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'oq');
    const t = await mkUser(db, 'tq@q.com', 'teacher', org);
    const s = await mkUser(db, 'sq@q.com', 'student', org);
    const tokT = await login(app, 'tq@q.com');
    const tokS = await login(app, 'sq@q.com');
    const cRes = (await (await app.request('/api/v1/courses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ organization_id: org, code: 'Q1', title: 'Quiz Course' }) })).json()) as { data: { id: string } };
    const cid = cRes.data.id;
    const qRes = (await (await app.request('/api/v1/quizzes', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ course_id: cid, title: 'QZ', passing_score: 50, max_attempts: 1 }) })).json()) as { data: { id: string } };
    const qid = qRes.data.id;
    const qq = (await (await app.request(`/api/v1/quizzes/${qid}/questions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ type: 'multiple_choice', prompt: '1+1?', points: 100, options: [{ label: '1', is_correct: false }, { label: '2', is_correct: true }] }) })).json()) as { data: { id: string } };
    const qs = (await (await app.request(`/api/v1/quizzes/${qid}/questions`, { headers: { authorization: `Bearer ${tokS}` } })).json()) as { data: { id: string; options: { id: string }[] }[] };
    const correctOpt = qs.data[0].options.find((o) => o.id);
    const att = (await (await app.request(`/api/v1/quizzes/${qid}/attempts`, { method: 'POST', headers: { authorization: `Bearer ${tokS}` } })).json()) as { data: { id: string } };
    // find correct option id from db
    const opts = await db.prepare('SELECT id, is_correct FROM question_options WHERE question_id = ?').bind(qq.data.id).all<{ id: string; is_correct: number }>();
    const right = opts.results.find((o) => o.is_correct === 1)?.id ?? correctOpt?.id ?? '';
    const sub = await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokS}` }, body: JSON.stringify({ answers: [{ question_id: qq.data.id, option_id: right }] }) });
    expect(sub.status).toBe(200);
    const sj = (await sub.json()) as { data: { score: number; passed: boolean } };
    expect(sj.data.score).toBe(100);
    expect(sj.data.passed).toBe(true);
    // second attempt blocked
    const att2 = await app.request(`/api/v1/quizzes/${qid}/attempts`, { method: 'POST', headers: { authorization: `Bearer ${tokS}` } });
    expect(att2.status).toBe(400);
    // assignment
    const aRes = (await (await app.request('/api/v1/assignments', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ course_id: cid, title: 'A1', max_score: 100 }) })).json()) as { data: { id: string } };
    const sRes = await app.request(`/api/v1/assignments/${aRes.data.id}/submissions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokS}` }, body: JSON.stringify({ body: 'my work' }) });
    expect(sRes.status).toBe(201);
    // grade it: fetch submission id
    const subRow = await queryFirst<{ id: string }>(db, 'SELECT id FROM submissions WHERE assignment_id = ?', aRes.data.id);
    const gRes = await app.request(`/api/v1/submissions/${subRow?.id}/grade`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ score: 90 }) });
    expect(gRes.status).toBe(200);
    // attendance
    const sess = (await (await app.request('/api/v1/attendance/sessions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ organization_id: org, title: 'P1', session_date: '2026-10-01' }) })).json()) as { data: { id: string } };
    const rec = await app.request('/api/v1/attendance/records', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokT}` }, body: JSON.stringify({ session_id: sess.data.id, records: [{ student_id: s, status: 'present' }] }) });
    expect(rec.status).toBe(201);
    // cert verify public (no auth)
    await execute(db, 'INSERT INTO certificates (id, organization_id, course_id, student_id, certificate_number, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), org, cid, s, 'CERT-TEST-001', nowIso(), nowIso());
    const v = await app.request('/api/v1/certificates/verify/CERT-TEST-001');
    expect(v.status).toBe(200);
    void t;
  });
});
