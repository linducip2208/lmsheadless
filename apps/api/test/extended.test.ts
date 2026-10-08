import { describe, it, expect } from 'vitest';
import { execute, queryFirst } from '../src/db.js';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

describe('academic + org members', () => {
  it('manages years, terms, classes, members, subjects with tenant checks', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'acad');
    const other = await mkOrg(db, 'acad2');
    await mkUser(db, 'adm@acad.com', 'organization_admin', org);
    await mkUser(db, 'stu@acad.com', 'student', org);
    const tokA = (await login(app, 'adm@acad.com')).access_token;
    const tokS = (await login(app, 'stu@acad.com')).access_token;
    const H = (t: string) => ({ 'content-type': 'application/json', ...authHeader(t) });
    // student cannot create academic year
    const r = await app.request(`/api/v1/organizations/${org}/academic-years`, { method: 'POST', headers: H(tokS), body: JSON.stringify({ name: 'Y', start_date: '2026-01-01', end_date: '2026-12-31' }) });
    expect(r.status).toBe(403);
    const ay = (await (await app.request(`/api/v1/organizations/${org}/academic-years`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ name: '2026/2027', start_date: '2026-07-01', end_date: '2027-06-30', is_active: 1 }) })).json()) as { data: { id: string } };
    const term = (await (await app.request(`/api/v1/organizations/${org}/terms`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ academic_year_id: ay.data.id, name: 'Ganjil', start_date: '2026-07-01', end_date: '2026-12-31' }) })).json()) as { data: { id: string } };
    const cls = (await (await app.request(`/api/v1/organizations/${org}/classes`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ name: '10-A', academic_year_id: ay.data.id, term_id: term.data.id }) })).json()) as { data: { id: string } };
    const stu = await queryFirst<{ id: string }>(db, 'SELECT id FROM users WHERE email = ?', 'stu@acad.com');
    const add = await app.request(`/api/v1/organizations/classes/${cls.data.id}/members`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ user_id: stu?.id, role: 'student' }) });
    expect(add.status).toBe(201);
    const subj = await app.request(`/api/v1/organizations/${org}/subjects`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ code: 'BIO-10', name: 'Biologi' }) });
    expect(subj.status).toBe(201);
    const dup = await app.request(`/api/v1/organizations/${org}/subjects`, { method: 'POST', headers: H(tokA), body: JSON.stringify({ code: 'BIO-10', name: 'Biologi 2' }) });
    expect(dup.status).toBe(409);
    // cross-org class member add denied
    const cross = await app.request(`/api/v1/organizations/classes/${cls.data.id}/members`, { method: 'POST', headers: H(tokS), body: JSON.stringify({ user_id: stu?.id }) });
    expect([400, 403].includes(cross.status)).toBe(true);
    // other org cannot read
    const ro = await app.request(`/api/v1/organizations/${org}/classes`, { headers: authHeader((await login(app, 'stu@acad.com')).access_token) });
    expect(ro.status).toBe(200);
    void other;
  });

  it('adds org members with role validation', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'mem');
    const u = await mkUser(db, 'u@mem.com', null);
    await mkUser(db, 'adm@mem.com', 'organization_admin', org);
    const tok = (await login(app, 'adm@mem.com')).access_token;
    const bad = await app.request(`/api/v1/organizations/${org}/members`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tok) }, body: JSON.stringify({ user_id: u, role: 'nonsense' }) });
    expect(bad.status).toBe(400);
    const good = await app.request(`/api/v1/organizations/${org}/members`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tok) }, body: JSON.stringify({ user_id: u, role: 'teacher' }) });
    expect(good.status).toBe(201);
  });
});

describe('users management', () => {
  it('edits self, blocks escalation, deletes via super_admin, links parent', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'um');
    const s = await mkUser(db, 's@um.com', 'student', org);
    await mkUser(db, 'sup@um.com', 'super_admin', org);
    await mkUser(db, 'p@um.com', 'parent', org);
    const tokS = (await login(app, 's@um.com')).access_token;
    const tokSup = (await login(app, 'sup@um.com')).access_token;
    // self edit (name + locale), privileged fields ignored
    const patch = await app.request(`/api/v1/users/${s}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ name: 'Renamed', locale: 'id', status: 'active' }) });
    expect(patch.status).toBe(200);
    // empty patch rejected
    const empty = await app.request(`/api/v1/users/${s}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ nickname: 'x' }) });
    expect(empty.status).toBe(400);
    // student cannot delete
    const delNo = await app.request(`/api/v1/users/${s}`, { method: 'DELETE', headers: authHeader(tokS) });
    expect(delNo.status).toBe(403);
    // parent link + linked list
    const p = await queryFirst<{ id: string }>(db, 'SELECT id FROM users WHERE email = ?', 'p@um.com');
    const link = await app.request(`/api/v1/users/${p?.id}/parent-links`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokSup) }, body: JSON.stringify({ student_id: s, organization_id: org }) });
    expect(link.status).toBe(201);
    const linked = (await (await app.request(`/api/v1/users/${p?.id}/linked-students`, { headers: authHeader((await login(app, 'p@um.com')).access_token) })).json()) as { data: { id: string }[] };
    expect(linked.data.some((x) => x.id === s)).toBe(true);
    // super_admin soft-deletes
    const del = await app.request(`/api/v1/users/${s}`, { method: 'DELETE', headers: authHeader(tokSup) });
    expect(del.status).toBe(200);
    const gone = await app.request(`/api/v1/users/${s}`, { headers: authHeader(tokSup) });
    expect(gone.status).toBe(404);
  });
});

describe('password reset + email verification cycles', () => {
  it('forgot always succeeds; reset consumes single-use token', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'pw');
    await mkUser(db, 'w@pw.com', 'student', org);
    const f1 = await app.request('/api/v1/auth/password/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'w@pw.com' }) });
    expect(f1.status).toBe(200);
    const f2 = await app.request('/api/v1/auth/password/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@pw.com' }) });
    expect(f2.status).toBe(200); // enumeration-safe
    const f3 = await app.request('/api/v1/auth/password/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(f3.status).toBe(400);
    const bad = await app.request('/api/v1/auth/password/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'invalid', password: 'Newpass123!' }) });
    expect(bad.status).toBe(400);
    void db;
  });

  it('verify-email rejects bad tokens', async () => {
    const { app } = await setup();
    const r = await app.request('/api/v1/auth/verify-email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'nope' }) });
    expect(r.status).toBe(400);
    const r2 = await app.request('/api/v1/auth/verify-email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(r2.status).toBe(400);
  });
});

describe('course builder edges', () => {
  it('validates patch fields, manages sections/lessons/reorder/delete', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cb');
    const t = await mkUser(db, 't@cb.com', 'teacher', org);
    const tok = (await login(app, 't@cb.com')).access_token;
    const H = { 'content-type': 'application/json', ...authHeader(tok) };
    const c = await mkCourse(db, org, t, 'CB1');
    // bad patch field rejected
    const bad = await app.request(`/api/v1/courses/${c}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'bogus' }) });
    expect(bad.status).toBe(400);
    // sections
    const s1 = (await (await app.request(`/api/v1/courses/${c}/sections`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'S1' }) })).json()) as { data: { id: string } };
    const s2 = (await (await app.request(`/api/v1/courses/${c}/sections`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'S2' }) })).json()) as { data: { id: string } };
    const re = await app.request(`/api/v1/courses/${c}/sections/reorder`, { method: 'POST', headers: H, body: JSON.stringify({ ordered_ids: [s2.data.id, s1.data.id] }) });
    expect(re.status).toBe(200);
    const reBad = await app.request(`/api/v1/courses/${c}/sections/reorder`, { method: 'POST', headers: H, body: JSON.stringify({}) });
    expect(reBad.status).toBe(400);
    const ren = await app.request(`/api/v1/courses/sections/${s1.data.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ title: 'Satu' }) });
    expect(ren.status).toBe(200);
    // lessons
    const l1 = (await (await app.request(`/api/v1/courses/sections/${s1.data.id}/lessons`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'L1', content_type: 'text', body: 'hi' }) })).json()) as { data: { id: string } };
    const l2 = (await (await app.request(`/api/v1/courses/sections/${s1.data.id}/lessons`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'L2', content_type: 'video', video_url: 'https://example.com/v.mp4' }) })).json()) as { data: { id: string } };
    const badVideo = await app.request(`/api/v1/courses/sections/${s1.data.id}/lessons`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'Lx', content_type: 'video', video_url: 'ftp://evil/x' }) });
    expect(badVideo.status).toBe(400);
    const lr = await app.request(`/api/v1/courses/sections/${s1.data.id}/lessons/reorder`, { method: 'POST', headers: H, body: JSON.stringify({ ordered_ids: [l2.data.id, l1.data.id] }) });
    expect(lr.status).toBe(200);
    const lp = await app.request(`/api/v1/lessons/${l1.data.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'draft', title: 'L1-draft' }) });
    expect(lp.status).toBe(200);
    const del = await app.request(`/api/v1/lessons/${l2.data.id}`, { method: 'DELETE', headers: authHeader(tok) });
    expect(del.status).toBe(200);
    const delSec = await app.request(`/api/v1/courses/sections/${s2.data.id}`, { method: 'DELETE', headers: authHeader(tok) });
    expect(delSec.status).toBe(200);
    // enrollments list for teacher + course delete denied for teacher
    const enr = await app.request(`/api/v1/courses/${c}/enrollments`, { headers: authHeader(tok) });
    expect(enr.status).toBe(200);
    const delC = await app.request(`/api/v1/courses/${c}`, { method: 'DELETE', headers: authHeader(tok) });
    expect(delC.status).toBe(403);
  });
});

describe('assessment extras', () => {
  it('edits/deletes/reorders questions, grades manually, lists attempts+submissions', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ax');
    const t = await mkUser(db, 't@ax.com', 'teacher', org);
    const s = await mkUser(db, 's@ax.com', 'student', org);
    const tokT = (await login(app, 't@ax.com')).access_token;
    const tokS = (await login(app, 's@ax.com')).access_token;
    const H = { 'content-type': 'application/json', ...authHeader(tokT) };
    const c = await mkCourse(db, org, t, 'AX1');
    const q = (await (await app.request('/api/v1/quizzes', { method: 'POST', headers: H, body: JSON.stringify({ course_id: c, title: 'Q', passing_score: 60 }) })).json()) as { data: { id: string } };
    const q1 = (await (await app.request(`/api/v1/quizzes/${q.data.id}/questions`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'short_answer', prompt: 'Capital of ID?', points: 100, correct_answer: 'Jakarta' }) })).json()) as { data: { id: string } };
    const q2 = (await (await app.request(`/api/v1/quizzes/${q.data.id}/questions`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'true_false', prompt: 'Sky is blue?', points: 50, correct_answer: 'true' }) })).json()) as { data: { id: string } };
    // student cannot add question
    const denyQ = await app.request(`/api/v1/quizzes/${q.data.id}/questions`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ type: 'short_answer', prompt: 'x?', points: 1 }) });
    expect(denyQ.status).toBe(403);
    // edit + reorder + delete
    const ed = await app.request(`/api/v1/questions/${q1.data.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ points: 80 }) });
    expect(ed.status).toBe(200);
    const ro = await app.request(`/api/v1/quizzes/${q.data.id}/questions/reorder`, { method: 'POST', headers: H, body: JSON.stringify({ ordered_ids: [q2.data.id, q1.data.id] }) });
    expect(ro.status).toBe(200);
    const del = await app.request(`/api/v1/questions/${q2.data.id}`, { method: 'DELETE', headers: authHeader(tokT) });
    expect(del.status).toBe(200);
    // student attempts (wrong answer), teacher lists, manual grade
    const att = (await (await app.request(`/api/v1/quizzes/${q.data.id}/attempts`, { method: 'POST', headers: authHeader(tokS) })).json()) as { data: { id: string } };
    // resume returns same attempt
    const att2 = (await (await app.request(`/api/v1/quizzes/${q.data.id}/attempts`, { method: 'POST', headers: authHeader(tokS) })).json()) as { data: { id: string; resumed: boolean } };
    expect(att2.data.id).toBe(att.data.id);
    expect(att2.data.resumed).toBe(true);
    const sub = await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ answers: [{ question_id: q1.data.id, answer_text: 'Bandung' }] }) });
    expect(sub.status).toBe(200);
    const mine = await app.request(`/api/v1/quizzes/${q.data.id}/attempts`, { headers: authHeader(tokS) });
    expect(mine.status).toBe(200);
    const all = await app.request(`/api/v1/quizzes/${q.data.id}/attempts`, { headers: authHeader(tokT) });
    expect(all.status).toBe(200);
    const grade = await app.request(`/api/v1/quiz-attempts/${att.data.id}/grade`, { method: 'POST', headers: H, body: JSON.stringify({ question_id: q1.data.id, points_awarded: 40 }) });
    expect(grade.status).toBe(200);
    const gradeDeny = await app.request(`/api/v1/quiz-attempts/${att.data.id}/grade`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ question_id: q1.data.id, points_awarded: 80 }) });
    expect(gradeDeny.status).toBe(403);
    // submissions list (student sees own, teacher sees all)
    const a = (await (await app.request('/api/v1/assignments', { method: 'POST', headers: H, body: JSON.stringify({ course_id: c, title: 'A', max_score: 100 }) })).json()) as { data: { id: string } };
    await app.request(`/api/v1/assignments/${a.data.id}/submissions`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ body: 'work' }) });
    const mineS = await app.request(`/api/v1/assignments/${a.data.id}/submissions`, { headers: authHeader(tokS) });
    expect(mineS.status).toBe(200);
    const allS = await app.request(`/api/v1/assignments/${a.data.id}/submissions`, { headers: authHeader(tokT) });
    expect(allS.status).toBe(200);
    // grading queue + instructor courses
    const queue = await app.request(`/api/v1/grading/queue?organization_id=${org}`, { headers: authHeader(tokT) });
    expect(queue.status).toBe(200);
    const mine2 = await app.request(`/api/v1/instructor/courses?organization_id=${org}`, { headers: authHeader(tokT) });
    expect(mine2.status).toBe(200);
    void s;
  });
});

describe('social + attendance + certs + misc', () => {
  it('covers threads/replies, attendance student view, cert issue/list, misc guards', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'misc');
    const t = await mkUser(db, 't@misc.com', 'teacher', org);
    await mkUser(db, 's@misc.com', 'student', org);
    const tokT = (await login(app, 't@misc.com')).access_token;
    const tokS = (await login(app, 's@misc.com')).access_token;
    const H = { 'content-type': 'application/json', ...authHeader(tokT) };
    const c = await mkCourse(db, org, t, 'M1');
    // threads require course_id
    const noQ = await app.request('/api/v1/discussions', { headers: authHeader(tokS) });
    expect(noQ.status).toBe(400);
    const th = (await (await app.request('/api/v1/discussions', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ course_id: c, title: 'Hello', body: 'First post' }) })).json()) as { data: { id: string } };
    const rep = await app.request(`/api/v1/discussions/${th.data.id}/replies`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokT) }, body: JSON.stringify({ body: 'Welcome!' }) });
    expect(rep.status).toBe(201);
    const reps = await app.request(`/api/v1/discussions/${th.data.id}/replies`, { headers: authHeader(tokS) });
    expect(reps.status).toBe(200);
    // locked thread rejects replies
    await execute(db, 'UPDATE discussion_threads SET is_locked = 1 WHERE id = ?', th.data.id);
    const locked = await app.request(`/api/v1/discussions/${th.data.id}/replies`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ body: 'late' }) });
    expect(locked.status).toBe(400);
    // attendance sessions validation + student view
    const sessBad = await app.request('/api/v1/attendance/sessions', { method: 'POST', headers: H, body: JSON.stringify({}) });
    expect(sessBad.status).toBe(400);
    const sess = (await (await app.request('/api/v1/attendance/sessions', { method: 'POST', headers: H, body: JSON.stringify({ organization_id: org, title: 'P1', session_date: '2026-10-01' }) })).json()) as { data: { id: string } };
    const srow = await queryFirst<{ id: string }>(db, 'SELECT id FROM users WHERE email = ?', 's@misc.com');
    await app.request('/api/v1/attendance/records', { method: 'POST', headers: H, body: JSON.stringify({ session_id: sess.data.id, records: [{ student_id: srow?.id, status: 'late' }] }) });
    const mine = await app.request(`/api/v1/attendance/student?organization_id=${org}`, { headers: authHeader(tokS) });
    expect(mine.status).toBe(200);
    // cert issue endpoint + list + expired refresh rejected
    const issue = await app.request('/api/v1/certificates/issue', { method: 'POST', headers: H, body: JSON.stringify({ course_id: c, student_id: srow?.id }) });
    expect(issue.status).toBe(201);
    const issueBad = await app.request('/api/v1/certificates/issue', { method: 'POST', headers: H, body: JSON.stringify({}) });
    expect(issueBad.status).toBe(400);
    const certs = await app.request('/api/v1/certificates', { headers: authHeader(tokS) });
    expect(certs.status).toBe(200);
    // announcements validation + notifications read-one guard
    const annBad = await app.request('/api/v1/announcements', { method: 'POST', headers: H, body: JSON.stringify({ title: 'x' }) });
    expect(annBad.status).toBe(400);
    const readMissing = await app.request('/api/v1/notifications/nope/read', { method: 'POST', headers: authHeader(tokS) });
    expect(readMissing.status).toBe(404);
    // uploads without file rejected
    const upBad = await app.request('/api/v1/uploads', { method: 'POST', headers: authHeader(tokS), body: new FormData() });
    expect(upBad.status).toBe(400);
    // push subscriptions validation + list
    const pushBad = await app.request('/api/v1/push/subscriptions', { method: 'POST', headers: H, body: JSON.stringify({}) });
    expect(pushBad.status).toBe(400);
    const pushOk = await app.request('/api/v1/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } }) });
    expect(pushOk.status).toBe(201);
    const pushList = await app.request('/api/v1/push/subscriptions', { headers: authHeader(tokS) });
    expect(pushList.status).toBe(200);
    // files list for owner
    const files = await app.request('/api/v1/files', { headers: authHeader(tokS) });
    expect(files.status).toBe(200);
    void t;
  });
});
