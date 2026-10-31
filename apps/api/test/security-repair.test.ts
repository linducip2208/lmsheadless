import { describe, it, expect } from 'vitest';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';
import { execute } from '../src/db.js';
import { newId, nowIso } from '@lms/shared';

async function mkGrade(db: Parameters<typeof execute>[0], courseId: string, studentId: string) {
  await execute(
    db,
    "INSERT INTO grades (id, course_id, student_id, category, score, max_score, created_at, updated_at) VALUES (?, ?, ?, 'general', 90, 100, ?, ?)",
    newId(),
    courseId,
    studentId,
    nowIso(),
    nowIso()
  );
}

describe('repair: cross-org grade isolation', () => {
  it('teacher in org A cannot read victim grades from org B', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'gA');
    const orgB = await mkOrg(db, 'gB');
    const tA = await mkUser(db, 'ta@x.test', 'teacher', orgA);
    const sV = await mkUser(db, 'v@x.test', 'student', orgA);
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgB,
      sV,
      'student',
      nowIso(),
      nowIso()
    );
    const cA = await mkCourse(db, orgA, tA, 'CA');
    const cB = await mkCourse(db, orgB, tA, 'CB');
    await mkGrade(db, cA, sV);
    await mkGrade(db, cB, sV);
    const tok = (await login(app, 'ta@x.test')).access_token;
    const res = await app.request(`/api/v1/grades?student_id=${sV}`, {
      headers: authHeader(tok),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()).data as { course_id: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].course_id).toBe(cA);
  });

  it('student-progress rows are pinned to the requested org', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'pA');
    const orgB = await mkOrg(db, 'pB');
    const tA = await mkUser(db, 'ta@p.test', 'teacher', orgA);
    const sV = await mkUser(db, 'v@p.test', 'student', orgA);
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgB,
      sV,
      'student',
      nowIso(),
      nowIso()
    );
    const cA = await mkCourse(db, orgA, tA, 'CA');
    const cB = await mkCourse(db, orgB, tA, 'CB');
    for (const c of [cA, cB]) {
      await execute(
        db,
        "INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
        newId(),
        c,
        sV,
        nowIso(),
        nowIso(),
        nowIso()
      );
      await mkGrade(db, c, sV);
    }
    const tok = (await login(app, 'ta@p.test')).access_token;
    const res = await app.request(
      `/api/v1/reports/student-progress?student_id=${sV}&organization_id=${orgA}`,
      { headers: authHeader(tok) }
    );
    expect(res.status).toBe(200);
    const data = (await res.json()).data as {
      enrollments: { course_id: string }[];
      grades: { course_id: string }[];
    };
    expect(data.enrollments.every((e) => e.course_id === cA)).toBe(true);
    expect(data.grades.every((g) => g.course_id === cA)).toBe(true);
  });
});

describe('repair: teaching-material and roster privacy', () => {
  it('student cannot read question bank contents; teacher can', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'bk');
    await mkUser(db, 't@bk.test', 'teacher', org);
    const s = await mkUser(db, 's@bk.test', 'student', org);
    const bank = newId();
    await execute(
      db,
      'INSERT INTO question_banks (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      bank,
      org,
      'Bank',
      nowIso(),
      nowIso()
    );
    void s;
    const tokS = (await login(app, 's@bk.test')).access_token;
    const denied = await app.request(`/api/v1/question-banks/${bank}/questions`, {
      headers: authHeader(tokS),
    });
    expect(denied.status).toBe(403);
    const tokT = (await login(app, 't@bk.test')).access_token;
    const allowed = await app.request(`/api/v1/question-banks/${bank}/questions`, {
      headers: authHeader(tokT),
    });
    expect(allowed.status).toBe(200);
  });

  it('cohort roster hides emails from students and parents', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ch');
    await mkUser(db, 'a@ch.test', 'organization_admin', org);
    const s1 = await mkUser(db, 's1@ch.test', 'student', org);
    const s2 = await mkUser(db, 's2@ch.test', 'student', org);
    const p = await mkUser(db, 'p@ch.test', 'parent', org);
    await execute(
      db,
      'INSERT INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      p,
      s1,
      org,
      nowIso()
    );
    const cohort = newId();
    await execute(
      db,
      'INSERT INTO cohorts (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      cohort,
      org,
      'C1',
      nowIso(),
      nowIso()
    );
    for (const u of [s1, s2]) {
      await execute(
        db,
        'INSERT INTO cohort_members (id, cohort_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
        newId(),
        cohort,
        u,
        'student',
        nowIso()
      );
    }
    const tokS2 = (await login(app, 's2@ch.test')).access_token;
    const outsider = await app.request(`/api/v1/cohorts/${cohort}/members`, {
      headers: authHeader(tokS2),
    });
    // s2 is a member: sees roster but without emails.
    expect(outsider.status).toBe(200);
    const rows = (await outsider.json()).data as Record<string, unknown>[];
    expect(rows.length).toBe(2);
    expect(rows[0]).not.toHaveProperty('email');
    const tokP = (await login(app, 'p@ch.test')).access_token;
    const par = await app.request(`/api/v1/cohorts/${cohort}/members`, {
      headers: authHeader(tokP),
    });
    expect(par.status).toBe(200);
    expect((await par.json()).data as unknown[]).toHaveLength(2);
    const tokA = (await login(app, 'a@ch.test')).access_token;
    const adm = await app.request(`/api/v1/cohorts/${cohort}/members`, {
      headers: authHeader(tokA),
    });
    expect(adm.status).toBe(200);
    expect(((await adm.json()).data as Record<string, unknown>[])[0]).toHaveProperty('email');
  });
});

describe('repair: parent links are org-scoped', () => {
  it('link in org A does not authorize reads in org B', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'lA');
    const orgB = await mkOrg(db, 'lB');
    const tB = await mkUser(db, 'tb@l.test', 'teacher', orgB);
    const pA = await mkUser(db, 'pa@l.test', 'parent', orgA);
    const sV = await mkUser(db, 'v@l.test', 'student', orgA);
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgB,
      sV,
      'student',
      nowIso(),
      nowIso()
    );
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgB,
      pA,
      'parent',
      nowIso(),
      nowIso()
    );
    await execute(
      db,
      'INSERT INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      pA,
      sV,
      orgA,
      nowIso()
    );
    const cB = await mkCourse(db, orgB, tB, 'CB');
    const tokP = (await login(app, 'pa@l.test')).access_token;
    const res = await app.request(
      `/api/v1/courses/${cB}/progress?student_id=${sV}`,
      { headers: authHeader(tokP) }
    );
    expect(res.status).toBe(403);
  });
});

describe('repair: draft visibility and instructor scoping', () => {
  it('students get 404 on drafts and never list them', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'dr');
    const t = await mkUser(db, 't@dr.test', 'teacher', org);
    await mkUser(db, 's@dr.test', 'student', org);
    const draft = newId();
    await execute(
      db,
      'INSERT INTO courses (id, organization_id, code, title, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      draft,
      org,
      'DRAFT1',
      'Draft course',
      'draft',
      t,
      nowIso(),
      nowIso()
    );
    const tokS = (await login(app, 's@dr.test')).access_token;
    const detail = await app.request(`/api/v1/courses/${draft}`, {
      headers: authHeader(tokS),
    });
    expect(detail.status).toBe(404);
    const list = await app.request(`/api/v1/courses?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    const rows = (await list.json()).data as { id: string }[];
    expect(rows.some((r) => r.id === draft)).toBe(false);
    const tokT = (await login(app, 't@dr.test')).access_token;
    const tDetail = await app.request(`/api/v1/courses/${draft}`, {
      headers: authHeader(tokT),
    });
    expect(tDetail.status).toBe(200);
  });

  it('instructor courses are pinned to the requested org', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'iA');
    const orgB = await mkOrg(db, 'iB');
    const t = await mkUser(db, 't@i.test', 'teacher', orgA);
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgB,
      t,
      'teacher',
      nowIso(),
      nowIso()
    );
    const cA = await mkCourse(db, orgA, t, 'CA');
    const cB = await mkCourse(db, orgB, t, 'CB');
    for (const c of [cA, cB]) {
      await execute(
        db,
        'INSERT INTO course_instructors (id, course_id, user_id, created_at) VALUES (?, ?, ?, ?)',
        newId(),
        c,
        t,
        nowIso()
      );
    }
    const tok = (await login(app, 't@i.test')).access_token;
    const res = await app.request(`/api/v1/instructor/courses?organization_id=${orgA}`, {
      headers: authHeader(tok),
    });
    const rows = (await res.json()).data as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([cA]);
  });
});

describe('repair: xapi requires an org', () => {
  it('rejects statements with no resolvable organization', async () => {
    const { app, db } = await setup();
    await mkOrg(db, 'x1');
    const loner = await mkUser(db, 'loner@x.test', null);
    void loner;
    const tok = (await login(app, 'loner@x.test')).access_token;
    const res = await app.request('/api/v1/xapi/statements', {
      method: 'POST',
      headers: { ...authHeader(tok), 'content-type': 'application/json' },
      body: JSON.stringify({ verb: { id: 'http://example.com/v' }, object: { id: 'http://example.com/o' } }),
    });
    expect(res.status).toBe(400);
  });
});
