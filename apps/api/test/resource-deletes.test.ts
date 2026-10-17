import { describe, expect, it } from 'vitest';
import { queryFirst } from '../src/db.js';
import { authHeader, login, mkCourse, mkOrg, mkUser, setup } from './helpers.js';

// Resource lifecycle teardown endpoints (round 4): DELETE cohort, program,
// question-bank, attendance-session, discussion-thread. Each asserts the
// RBAC gate, the FK cascade, and 404 on a second delete.
const HJ = (tok: string) => ({ 'content-type': 'application/json', ...authHeader(tok) });

describe('resource deletes (cohorts/programs/banks/sessions/threads)', () => {
  it('cohort: admin deletes with FK cascade; teacher/student/cross-org denied', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'del-a');
    const orgB = await mkOrg(db, 'del-b');
    const t = await mkUser(db, 't@da.com', 'teacher', orgA);
    const s = await mkUser(db, 's@da.com', 'student', orgA);
    await mkUser(db, 'a@da.com', 'organization_admin', orgA);
    await mkUser(db, 'o@db.com', 'organization_admin', orgB);
    const tokT = (await login(app, 't@da.com')).access_token;
    const tokS = (await login(app, 's@da.com')).access_token;
    const tokA = (await login(app, 'a@da.com')).access_token;
    const tokO = (await login(app, 'o@db.com')).access_token;
    const c1 = await mkCourse(db, orgA, t, 'DA1');
    const cohort = (await (
      await app.request('/api/v1/cohorts', {
        method: 'POST',
        headers: HJ(tokT),
        body: JSON.stringify({ organization_id: orgA, name: 'DA' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/cohorts/${cohort.data.id}/members`, {
      method: 'POST',
      headers: HJ(tokT),
      body: JSON.stringify({ user_id: s, role: 'student' }),
    });
    await app.request(`/api/v1/cohorts/${cohort.data.id}/courses`, {
      method: 'POST',
      headers: HJ(tokT),
      body: JSON.stringify({ course_id: c1 }),
    });

    // Tenant gate first: cross-org admin, plain student, and teacher all 403
    // while the row still exists.
    expect(
      (
        await app.request(`/api/v1/cohorts/${cohort.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokO),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/cohorts/${cohort.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokT),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/cohorts/${cohort.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokS),
        })
      ).status
    ).toBe(403);

    // Org admin deletes → members and course links cascade, audit written.
    const del = await app.request(`/api/v1/cohorts/${cohort.data.id}`, {
      method: 'DELETE',
      headers: authHeader(tokA),
    });
    expect(del.status).toBe(200);
    expect(await queryFirst(db, 'SELECT id FROM cohorts WHERE id = ?', cohort.data.id)).toBeNull();
    expect(
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM cohort_members WHERE cohort_id = ?',
        cohort.data.id
      )
    ).toEqual({ n: 0 });
    expect(
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM cohort_courses WHERE cohort_id = ?',
        cohort.data.id
      )
    ).toEqual({ n: 0 });
    const aud = await queryFirst<{ action: string }>(
      db,
      'SELECT action FROM audit_logs WHERE entity_id = ? AND action = ?',
      cohort.data.id,
      'cohort.delete'
    );
    expect(aud?.action).toBe('cohort.delete');
    // Second delete: honest 404.
    const again = await app.request(`/api/v1/cohorts/${cohort.data.id}`, {
      method: 'DELETE',
      headers: authHeader(tokA),
    });
    expect(again.status).toBe(404);
  });

  it('program: admin deletes, program_courses cascade; teacher denied', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'del-p');
    const t = await mkUser(db, 't@dp.com', 'teacher', org);
    await mkUser(db, 'a@dp.com', 'organization_admin', org);
    const tokT = (await login(app, 't@dp.com')).access_token;
    const tokA = (await login(app, 'a@dp.com')).access_token;
    const c1 = await mkCourse(db, org, t, 'DP1');
    const prog = (await (
      await app.request('/api/v1/programs', {
        method: 'POST',
        headers: HJ(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Del Path' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/programs/${prog.data.id}/courses`, {
      method: 'POST',
      headers: HJ(tokT),
      body: JSON.stringify({ course_id: c1, position: 0 }),
    });
    expect(
      (
        await app.request(`/api/v1/programs/${prog.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokT),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/programs/${prog.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokA),
        })
      ).status
    ).toBe(200);
    expect(
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM program_courses WHERE program_id = ?',
        prog.data.id
      )
    ).toEqual({ n: 0 });
    expect(
      (await app.request(`/api/v1/programs/${prog.data.id}`, { headers: authHeader(tokA) })).status
    ).toBe(403);
  });

  it('bank: teacher deletes own org bank, bank questions/options cascade', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'del-b');
    await mkUser(db, 't@dbk.com', 'teacher', org);
    const tokT = (await login(app, 't@dbk.com')).access_token;
    const bank = (await (
      await app.request('/api/v1/question-banks', {
        method: 'POST',
        headers: HJ(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Del Bank' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/question-banks/${bank.data.id}/questions`, {
      method: 'POST',
      headers: HJ(tokT),
      body: JSON.stringify({
        type: 'single_choice',
        prompt: 'Pick one',
        points: 5,
        correct_answer: 'A',
        options: [
          { label: 'A', is_correct: true },
          { label: 'B', is_correct: false },
        ],
      }),
    });
    const del = await app.request(`/api/v1/question-banks/${bank.data.id}`, {
      method: 'DELETE',
      headers: authHeader(tokT),
    });
    expect(del.status).toBe(200);
    expect(
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM bank_questions WHERE bank_id = ?',
        bank.data.id
      )
    ).toEqual({ n: 0 });
    expect(
      (
        await app.request(`/api/v1/question-banks/${bank.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokT),
        })
      ).status
    ).toBe(404);
  });

  it('attendance session: teacher deletes, records cascade; student denied', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'del-s');
    await mkUser(db, 't@ds.com', 'teacher', org);
    const s = await mkUser(db, 's@ds.com', 'student', org);
    const tokT = (await login(app, 't@ds.com')).access_token;
    const tokS = (await login(app, 's@ds.com')).access_token;
    const sess = (await (
      await app.request('/api/v1/attendance/sessions', {
        method: 'POST',
        headers: HJ(tokT),
        body: JSON.stringify({
          organization_id: org,
          title: 'Del Sess',
          session_date: '2026-10-18',
        }),
      })
    ).json()) as { data: { id: string } };
    await app.request('/api/v1/attendance/records', {
      method: 'POST',
      headers: HJ(tokT),
      body: JSON.stringify({
        session_id: sess.data.id,
        records: [{ student_id: s, status: 'present' }],
      }),
    });
    expect(
      (
        await app.request(`/api/v1/attendance/sessions/${sess.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokS),
        })
      ).status
    ).toBe(403);
    const del = await app.request(`/api/v1/attendance/sessions/${sess.data.id}`, {
      method: 'DELETE',
      headers: authHeader(tokT),
    });
    expect(del.status).toBe(200);
    expect(
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM attendance_records WHERE session_id = ?',
        sess.data.id
      )
    ).toEqual({ n: 0 });
    expect(
      (
        await app.request(`/api/v1/attendance/sessions/${sess.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokT),
        })
      ).status
    ).toBe(404);
  });

  it('thread: teaching actors moderate-delete with replies cascade; student author denied', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'del-t');
    const t = await mkUser(db, 't@dt.com', 'teacher', org);
    await mkUser(db, 's@dt.com', 'student', org);
    await mkUser(db, 'x@dt.com', 'teacher', await mkOrg(db, 'del-t2'));
    const tokT = (await login(app, 't@dt.com')).access_token;
    const tokS = (await login(app, 's@dt.com')).access_token;
    const tokX = (await login(app, 'x@dt.com')).access_token;
    const c = await mkCourse(db, org, t, 'DT1');
    const th = (await (
      await app.request('/api/v1/discussions', {
        method: 'POST',
        headers: authHeader(tokS),
        body: JSON.stringify({ course_id: c, title: 'Del thread', body: 'question' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/discussions/${th.data.id}/replies`, {
      method: 'POST',
      headers: authHeader(tokT),
      body: JSON.stringify({ body: 'answer' }),
    });
    // Author student and cross-org teacher cannot delete it.
    expect(
      (
        await app.request(`/api/v1/discussions/${th.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokS),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/discussions/${th.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokX),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/discussions/${th.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokT),
        })
      ).status
    ).toBe(200);
    expect(
      await queryFirst<{ n: number }>(
        db,
        'SELECT COUNT(*) as n FROM discussion_replies WHERE thread_id = ?',
        th.data.id
      )
    ).toEqual({ n: 0 });
    expect(
      (
        await app.request(`/api/v1/discussions/${th.data.id}`, {
          method: 'DELETE',
          headers: authHeader(tokT),
        })
      ).status
    ).toBe(404);
  });
});
