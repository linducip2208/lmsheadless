import { describe, it, expect } from 'vitest';
import { execute, queryFirst } from '../src/db.js';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

describe('setup lock + settings', () => {
  it('first-run setup works once, then locks; settings manageable', async () => {
    const { app } = await setup();
    const status = (await (await app.request('/api/v1/setup/status')).json()) as { data: { setup_completed: boolean } };
    expect(status.data.setup_completed).toBe(false);
    const res = await app.request('/api/v1/setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_name: 'Test LMS', org_name: 'Test Org', admin_email: 'root@t.com', admin_password: 'Password123!', admin_name: 'Root' }),
    });
    expect(res.status).toBe(201);
    const again = await app.request('/api/v1/setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org_name: 'Evil', admin_email: 'e@t.com', admin_password: 'Password123!', admin_name: 'E' }),
    });
    expect(again.status).toBe(403);
    const tok = (await login(app, 'root@t.com')).access_token;
    const settings = await app.request('/api/v1/settings', { headers: authHeader(tok) });
    expect(settings.status).toBe(200);
    const put = await app.request('/api/v1/settings', { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader(tok) }, body: JSON.stringify({ app_name: 'Renamed', setup_completed: 'false', evil: 'x' }) });
    expect(put.status).toBe(200);
  });
});

describe('sessions + password change', () => {
  it('lists sessions, changes password, revokes all', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'sess');
    await mkUser(db, 'u@sess.com', 'student', org);
    const tok = (await login(app, 'u@sess.com')).access_token;
    const list = await app.request('/api/v1/auth/sessions', { headers: authHeader(tok) });
    expect(list.status).toBe(200);
    const ch = await app.request('/api/v1/auth/password/change', {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tok) },
      body: JSON.stringify({ current_password: 'Password123!', new_password: 'Newpass123!' }),
    });
    expect(ch.status).toBe(200);
    // old password no longer works, new one does
    const bad = await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'u@sess.com', password: 'Password123!' }) });
    expect(bad.status).toBe(401);
    const good = await login(app, 'u@sess.com', 'Newpass123!');
    expect(good.access_token.length).toBeGreaterThan(10);
    const revoke = await app.request('/api/v1/auth/sessions/revoke-all', { method: 'POST', headers: authHeader(good.access_token) });
    expect(revoke.status).toBe(200);
  });
});

describe('cookie refresh flow', () => {
  it('login?cookie=1 sets httpOnly cookie; refresh works from cookie', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cook');
    await mkUser(db, 'c@cook.com', 'student', org);
    const res = await app.request('/api/v1/auth/login?cookie=1', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'c@cook.com', password: 'Password123!' }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('lms_refresh=');
    expect(setCookie).toContain('HttpOnly');
    const cookie = setCookie.split(';')[0];
    const ref = await app.request('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({}) });
    expect(ref.status).toBe(200);
  });
});

describe('rbac catalog + branding', () => {
  it('permissions/roles visible; branding public; student cannot rebrand', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'brand');
    await mkUser(db, 'adm@brand.com', 'organization_admin', org);
    await mkUser(db, 'stu@brand.com', 'student', org);
    const tokA = (await login(app, 'adm@brand.com')).access_token;
    const tokS = (await login(app, 'stu@brand.com')).access_token;
    const perms = await app.request('/api/v1/permissions', { headers: authHeader(tokA) });
    expect(perms.status).toBe(200);
    const roles = await app.request('/api/v1/roles', { headers: authHeader(tokA) });
    expect(roles.status).toBe(200);
    const mine = (await (await app.request(`/api/v1/users/me/permissions?organization_id=${org}`, { headers: authHeader(tokS) })).json()) as { data: { role: string; permissions: string[] } };
    expect(mine.data.role).toBe('student');
    expect(mine.data.permissions).toContain('courses.view');
    expect(mine.data.permissions).not.toContain('settings.manage');
    // public branding (no auth)
    const brand = await app.request(`/api/v1/organizations/${org}/branding`);
    expect(brand.status).toBe(200);
    // student cannot update org
    const bad = await app.request(`/api/v1/organizations/${org}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ name: 'Hacked' }) });
    expect(bad.status).toBe(403);
    const good = await app.request(`/api/v1/organizations/${org}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader(tokA) }, body: JSON.stringify({ settings: { app_name: 'White Label Academy', primary_color: '#123456' } }) });
    expect(good.status).toBe(200);
    const brand2 = (await (await app.request(`/api/v1/organizations/${org}/branding`)).json()) as { data: Record<string, string> };
    expect(brand2.data.app_name).toBe('White Label Academy');
  });
});

describe('files', () => {
  it('upload validates, records, downloads with auth; cross-org denied', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'fa');
    const orgB = await mkOrg(db, 'fb');
    await mkUser(db, 'a@f.com', 'teacher', orgA);
    await mkUser(db, 'b@f.com', 'teacher', orgB);
    const tokA = (await login(app, 'a@f.com')).access_token;
    const tokB = (await login(app, 'b@f.com')).access_token;
    // evil extension rejected
    const evil = new FormData();
    evil.append('file', new File(['x'], 'evil.exe', { type: 'application/x-msdownload' }));
    const bad = await app.request('/api/v1/uploads', { method: 'POST', headers: authHeader(tokA), body: evil });
    expect(bad.status).toBe(400);
    // valid upload
    const form = new FormData();
    form.append('prefix', 'general');
    form.append('organization_id', orgA);
    form.append('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const up = (await (await app.request('/api/v1/uploads', { method: 'POST', headers: authHeader(tokA), body: form })).json()) as { data: { id: string } };
    expect(up.data.id).toBeDefined();
    const dl = await app.request(`/api/v1/files/${up.data.id}/download`, { headers: authHeader(tokA) });
    expect(dl.status).toBe(200);
    const cross = await app.request(`/api/v1/files/${up.data.id}/download`, { headers: authHeader(tokB) });
    expect(cross.status).toBe(403);
    const missing = await app.request('/api/v1/files/nope/download', { headers: authHeader(tokA) });
    expect(missing.status).toBe(404);
  });
});

describe('search + notifications', () => {
  it('search is org-scoped; notifications count/read-all/prefs work', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'sn');
    const t = await mkUser(db, 't@sn.com', 'teacher', org);
    await mkUser(db, 's@sn.com', 'student', org);
    await mkCourse(db, org, t, 'Algebra');
    const tokT = (await login(app, 't@sn.com')).access_token;
    const tokS = (await login(app, 's@sn.com')).access_token;
    const found = (await (await app.request(`/api/v1/search?q=Alge&organization_id=${org}`, { headers: authHeader(tokS) })).json()) as { data: { courses: unknown[]; users: unknown[] } };
    expect(found.data.courses.length).toBe(1);
    expect(found.data.users.length).toBe(0); // students cannot search users
    const foundT = (await (await app.request(`/api/v1/search?q=t%40sn&organization_id=${org}`, { headers: authHeader(tokT) })).json()) as { data: { users: unknown[] } };
    expect(foundT.data.users.length).toBeGreaterThan(0);
    // announcement fans out notifications
    await app.request('/api/v1/announcements', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokT) }, body: JSON.stringify({ organization_id: org, title: 'Hi', body: 'Hello all' }) });
    const count = (await (await app.request('/api/v1/notifications/unread-count', { headers: authHeader(tokS) })).json()) as { data: { unread: number } };
    expect(count.data.unread).toBeGreaterThan(0);
    const all = await app.request('/api/v1/notifications/read-all', { method: 'POST', headers: authHeader(tokS) });
    expect(all.status).toBe(200);
    const prefs = await app.request('/api/v1/notification-preferences', { headers: authHeader(tokS) });
    expect(prefs.status).toBe(200);
    const put = await app.request('/api/v1/notification-preferences', { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ quiz: false }) });
    expect(put.status).toBe(200);
  });
});

describe('idempotency + audit + resubmit + expiry + CORS', () => {
  it('duplicate enroll with same key replays without duplicating', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'idem');
    const t = await mkUser(db, 't@idem.com', 'teacher', org);
    await mkUser(db, 's@idem.com', 'student', org);
    const c = await mkCourse(db, org, t, 'IDEM1');
    const tok = (await login(app, 's@idem.com')).access_token;
    const key = 'test-key-1234567890';
    const h = { 'content-type': 'application/json', ...authHeader(tok), 'Idempotency-Key': key };
    const r1 = await app.request('/api/v1/enrollments', { method: 'POST', headers: h, body: JSON.stringify({ course_id: c }) });
    expect(r1.status).toBe(201);
    const r2 = await app.request('/api/v1/enrollments', { method: 'POST', headers: h, body: JSON.stringify({ course_id: c }) });
    expect(r2.status).toBe(201);
    expect(r2.headers.get('idempotent-replayed')).toBe('true');
    const n = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM enrollments WHERE course_id = ? AND student_id = (SELECT id FROM users WHERE email = ?)', c, 's@idem.com');
    expect(n?.n).toBe(1);
  });

  it('publishing a course writes an audit log (admin can read, teacher cannot)', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'aud');
    await mkUser(db, 't@aud.com', 'teacher', org);
    await mkUser(db, 'adm@aud.com', 'organization_admin', org);
    const tok = (await login(app, 't@aud.com')).access_token;
    const tokA = (await login(app, 'adm@aud.com')).access_token;
    const created = (await (await app.request('/api/v1/courses', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tok) }, body: JSON.stringify({ organization_id: org, code: 'A1', title: 'Audit Course' }) })).json()) as { data: { id: string } };
    await app.request(`/api/v1/courses/${created.data.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader(tok) }, body: JSON.stringify({ status: 'published' }) });
    const denied = await app.request(`/api/v1/audit-logs?organization_id=${org}`, { headers: authHeader(tok) });
    expect(denied.status).toBe(403);
    const logs = (await (await app.request(`/api/v1/audit-logs?organization_id=${org}`, { headers: authHeader(tokA) })).json()) as { data: { action: string }[] };
    expect(logs.data.some((l) => l.action === 'course.published')).toBe(true);
    void db;
  });

  it('resubmission blocked when disabled; expired quiz attempt rejected', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rules');
    const t = await mkUser(db, 't@rules.com', 'teacher', org);
    await mkUser(db, 's@rules.com', 'student', org);
    const tokT = (await login(app, 't@rules.com')).access_token;
    const tokS = (await login(app, 's@rules.com')).access_token;
    const c = await mkCourse(db, org, t, 'R1');
    const aRes = (await (await app.request('/api/v1/assignments', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokT) }, body: JSON.stringify({ course_id: c, title: 'Strict', max_score: 100, allow_resubmit: false }) })).json()) as { data: { id: string } };
    const s1 = await app.request(`/api/v1/assignments/${aRes.data.id}/submissions`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ body: 'first' }) });
    expect(s1.status).toBe(201);
    const s2 = await app.request(`/api/v1/assignments/${aRes.data.id}/submissions`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ body: 'second' }) });
    expect(s2.status).toBe(409);
    // quiz with time limit: force expiry in DB, submit must fail
    const qRes = (await (await app.request('/api/v1/quizzes', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokT) }, body: JSON.stringify({ course_id: c, title: 'Timed', passing_score: 50, time_limit_minutes: 1 }) })).json()) as { data: { id: string } };
    await app.request(`/api/v1/quizzes/${qRes.data.id}/questions`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokT) }, body: JSON.stringify({ type: 'short_answer', prompt: '2+2?', points: 10, correct_answer: '4' }) });
    const att = (await (await app.request(`/api/v1/quizzes/${qRes.data.id}/attempts`, { method: 'POST', headers: authHeader(tokS) })).json()) as { data: { id: string } };
    await execute(db, 'UPDATE quiz_attempts SET expires_at = ? WHERE id = ?', new Date(Date.now() - 60000).toISOString(), att.data.id);
    const sub = await app.request(`/api/v1/quiz-attempts/${att.data.id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ answers: [] }) });
    expect(sub.status).toBe(400);
  });

  it('CORS allows localhost dev, blocks unknown origins', async () => {
    const { app } = await setup();
    const okRes = await app.request('/api/v1/openapi.json', { headers: { origin: 'http://localhost:5173' } });
    expect(okRes.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const evil = await app.request('/api/v1/openapi.json', { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rate limiting architecture triggers under flood', async () => {
    const { app } = await setup();
    let limited = 0;
    // Isolated IP so this flood does not poison other tests sharing the
    // in-memory limiter within the same process/window.
    for (let i = 0; i < 135; i++) {
      const r = await app.request('/api/v1/openapi.json', { headers: { 'cf-connecting-ip': '9.9.9.9' } });
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe('reports extended', () => {
  it('completion, quiz performance, attendance, teacher activity return real data', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rep');
    const t = await mkUser(db, 't@rep.com', 'teacher', org);
    await mkUser(db, 's@rep.com', 'student', org);
    await mkUser(db, 'adm@rep.com', 'organization_admin', org);
    const c = await mkCourse(db, org, t, 'REP1');
    const tokS = (await login(app, 's@rep.com')).access_token;
    const tokA = (await login(app, 'adm@rep.com')).access_token;
    await app.request('/api/v1/enrollments', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(tokS) }, body: JSON.stringify({ course_id: c }) });
    for (const path of ['completion', 'attendance', 'teacher-activity']) {
      const r = await app.request(`/api/v1/reports/${path}?organization_id=${org}`, { headers: authHeader(tokA) });
      expect(r.status).toBe(200);
    }
    const qRes = (await (await app.request('/api/v1/quizzes', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader((await login(app, 't@rep.com')).access_token) }, body: JSON.stringify({ course_id: c, title: 'Q', passing_score: 50 }) })).json()) as { data: { id: string } };
    const perf = await app.request(`/api/v1/reports/quiz-performance?quiz_id=${qRes.data.id}`, { headers: authHeader(tokA) });
    expect(perf.status).toBe(200);
    // student cannot see teacher reports
    const denied = await app.request(`/api/v1/reports/teacher-activity?organization_id=${org}`, { headers: authHeader(tokS) });
    expect(denied.status).toBe(403);
  });
});
