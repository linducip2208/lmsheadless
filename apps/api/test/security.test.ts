import { describe, it, expect } from 'vitest';
import { execute } from '../src/db.js';
import { newId, nowIso } from '@lms/shared';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

// OWASP-style matrix: cross-role, cross-user, cross-org, mass assignment,
// injection, traversal, replay.
describe('authorization matrix', () => {
  it('enforces role boundaries across orgs', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'mxa');
    const orgB = await mkOrg(db, 'mxb');
    const tA = await mkUser(db, 'ta@mx.com', 'teacher', orgA);
    const tB = await mkUser(db, 'tb@mx.com', 'teacher', orgB);
    const sA = await mkUser(db, 'sa@mx.com', 'student', orgA);
    await mkUser(db, 'staff@mx.com', 'staff', orgA);
    await mkUser(db, 'par@mx.com', 'parent', orgA);
    const cA = await mkCourse(db, orgA, tA, 'MXA1');
    const cB = await mkCourse(db, orgB, tB, 'MXB1');
    const T = {
      tA: (await login(app, 'ta@mx.com')).access_token,
      tB: (await login(app, 'tb@mx.com')).access_token,
      sA: (await login(app, 'sa@mx.com')).access_token,
      staff: (await login(app, 'staff@mx.com')).access_token,
      par: (await login(app, 'par@mx.com')).access_token,
    };
    // Teacher B cannot touch org A course (tenant escape)
    let r = await app.request(`/api/v1/courses/${cA}`, { headers: authHeader(T.tB) });
    expect(r.status).toBe(403);
    // Teacher B cannot list org A enrollments
    r = await app.request(`/api/v1/courses/${cA}/enrollments`, { headers: authHeader(T.tB) });
    expect(r.status).toBe(403);
    // Student cannot delete course
    r = await app.request(`/api/v1/courses/${cA}`, { method: 'DELETE', headers: authHeader(T.sA) });
    expect(r.status).toBe(403);
    // Teacher cannot delete course (admin-only)
    r = await app.request(`/api/v1/courses/${cA}`, { method: 'DELETE', headers: authHeader(T.tA) });
    expect(r.status).toBe(403);
    // Parent cannot create course
    r = await app.request('/api/v1/courses', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(T.par) }, body: JSON.stringify({ organization_id: orgA, code: 'PX', title: 'Parent course' }) });
    expect(r.status).toBe(403);
    // Staff cannot update organization branding (settings.manage)
    r = await app.request(`/api/v1/organizations/${orgA}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...authHeader(T.staff) }, body: JSON.stringify({ name: 'Staff renamed' }) });
    expect(r.status).toBe(403);
    // Teacher B cannot grade org A submission (cross-org grading)
    const aRes = (await (await app.request('/api/v1/assignments', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(T.tA) }, body: JSON.stringify({ course_id: cA, title: 'GA', max_score: 100 }) })).json()) as { data: { id: string } };
    await app.request(`/api/v1/assignments/${aRes.data.id}/submissions`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(T.sA) }, body: JSON.stringify({ body: 'work' }) });
    const sub = await db.prepare('SELECT id FROM submissions WHERE assignment_id = ?').bind(aRes.data.id).first<{ id: string }>();
    r = await app.request(`/api/v1/submissions/${sub?.id}/grade`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader(T.tB) }, body: JSON.stringify({ score: 10 }) });
    expect(r.status).toBe(403);
    void cB; void sA;
  });

  it('student A cannot read student B data; parent sees only linked child', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'mx2');
    const t = await mkUser(db, 't@mx2.com', 'teacher', org);
    const s1 = await mkUser(db, 's1@mx2.com', 'student', org);
    const s2 = await mkUser(db, 's2@mx2.com', 'student', org);
    const p = await mkUser(db, 'p@mx2.com', 'parent', org);
    await execute(db, 'INSERT INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)', newId(), p, s1, org, nowIso());
    const c = await mkCourse(db, org, t, 'MX2');
    await execute(db, 'INSERT INTO grades (id, course_id, student_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), c, s2, 95, nowIso(), nowIso());
    const tok1 = (await login(app, 's1@mx2.com')).access_token;
    const tokP = (await login(app, 'p@mx2.com')).access_token;
    // Student A reading student B grades
    let r = await app.request(`/api/v1/grades?course_id=${c}&student_id=${s2}`, { headers: authHeader(tok1) });
    expect(r.status).toBe(403);
    // Parent reading unlinked student
    r = await app.request(`/api/v1/grades?course_id=${c}&student_id=${s2}`, { headers: authHeader(tokP) });
    expect(r.status).toBe(403);
    // Parent reading linked student progress
    r = await app.request(`/api/v1/courses/${c}/progress?student_id=${s1}`, { headers: authHeader(tokP) });
    expect(r.status).toBe(200);
    // Parent reading unlinked student progress
    r = await app.request(`/api/v1/courses/${c}/progress?student_id=${s2}`, { headers: authHeader(tokP) });
    expect(r.status).toBe(403);
  });
});

describe('mass assignment + injection + traversal', () => {
  it('ignores privileged fields on profile update', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'mass');
    const s = await mkUser(db, 's@mass.com', 'student', org);
    const tok = (await login(app, 's@mass.com')).access_token;
    const r = await app.request(`/api/v1/users/${s}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', ...authHeader(tok) },
      body: JSON.stringify({ name: 'New Name', role: 'super_admin', status: 'active', password_hash: 'x', isSuperAdmin: true }),
    });
    expect(r.status).toBe(200);
    const me = (await (await app.request('/api/v1/auth/me', { headers: authHeader(tok) })).json()) as { data: { user: { memberships: { role: string }[] } } };
    expect(me.data.user.memberships[0].role).toBe('student');
  });

  it('search input cannot inject SQL; envelope stays consistent', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'inj');
    const t = await mkUser(db, 't@inj.com', 'teacher', org);
    await mkCourse(db, org, t, 'INJ1');
    const tok = (await login(app, 't@inj.com')).access_token;
    const r = await app.request(`/api/v1/search?q=${encodeURIComponent("' OR '1'='1' -- ")}&organization_id=${org}`, { headers: authHeader(tok) });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { success: boolean; data: { courses: unknown[] } };
    expect(j.success).toBe(true);
    expect(j.data.courses.length).toBe(0);
  });

  it('upload keys are server-generated; traversal filename is neutralized', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'trav');
    await mkUser(db, 'u@trav.com', 'student', org);
    const tok = (await login(app, 'u@trav.com')).access_token;
    const form = new FormData();
    form.append('file', new File(['x'], '../../etc/passwd.txt', { type: 'text/plain' }));
    const up = await app.request('/api/v1/uploads', { method: 'POST', headers: authHeader(tok), body: form });
    // .txt is allowed; key must be generated (no traversal in key)
    expect([201, 400]).toContain(up.status);
    if (up.status === 201) {
      const j = (await up.json()) as { data: { key: string } };
      expect(j.data.key).not.toContain('..');
      expect(j.data.key).not.toContain('/etc/');
    }
    void org;
  });
});
