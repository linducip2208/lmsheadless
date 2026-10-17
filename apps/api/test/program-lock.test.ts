import { describe, it, expect } from 'vitest';
import { nowIso } from '@lms/shared';
import { execute, queryFirst } from '../src/db.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('program lock enforcement on enrollment', () => {
  it('blocks self-enrollment into a locked program course and opens after completion', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'plk');
    const t = await mkUser(db, 't@plk.test', 'teacher', org);
    const s = await mkUser(db, 's@plk.test', 'student', org);
    const tokT = (await login(app, 't@plk.test')).access_token;
    const tokS = (await login(app, 's@plk.test')).access_token;
    const courseA = await mkCourse(db, org, t, 'PLK-A');
    const courseB = await mkCourse(db, org, t, 'PLK-B');

    const program = (await (
      await app.request('/api/v1/programs', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Locked path' }),
      })
    ).json()) as { data: { id: string } };
    // A is placed first (no lock).
    await app.request(`/api/v1/programs/${program.data.id}/courses`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ course_id: courseA, position: 0 }),
    });
    // B is placed after A with a program lock on A.
    const pcs = (await (
      await app.request(`/api/v1/programs/${program.data.id}`, { headers: H(tokT) })
    ).json()) as { data: { courses: { id: string; course_id: string }[] } };
    const pcA = pcs.data.courses.find((c) => c.course_id === courseA)?.id;
    expect(pcA).toBeTruthy();
    await app.request(`/api/v1/programs/${program.data.id}/courses`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({
        course_id: courseB,
        position: 1,
        prerequisite_program_course_id: pcA,
      }),
    });

    // Student enrolls into A (allowed), then attempts B directly → blocked.
    const enrollA = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: courseA }),
    });
    expect(enrollA.status).toBe(201);
    const lock = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: courseB }),
    });
    expect(lock.status).toBe(400);
    const lockBody = (await lock.json()) as { error: { code: string; details?: unknown } };
    expect(lockBody.error.code).toBe('PROGRAM_LOCKED');
    expect(lockBody.error.details).toMatchObject({ requires_course_id: courseA });

    // Program detail annotates the same lock for the UI.
    const detail = (await (
      await app.request(`/api/v1/programs/${program.data.id}`, { headers: H(tokS) })
    ).json()) as { data: { courses: { course_id: string; locked: boolean }[] } };
    expect(detail.data.courses.find((c) => c.course_id === courseB)?.locked).toBe(true);
    expect(detail.data.courses.find((c) => c.course_id === courseA)?.locked).toBe(false);

    // Completing the prerequisite course opens B. The completion pipeline is
    // covered elsewhere; here the enrollment hits the finished state directly
    // (same data the endpoint reads).
    await execute(
      db,
      "UPDATE enrollments SET status = 'completed', updated_at = ? WHERE course_id = ? AND student_id = ?",
      nowIso(),
      courseA,
      s
    );
    const reEnroll = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: courseB }),
    });
    expect(reEnroll.status).toBe(201);
    const enrB = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM enrollments WHERE course_id = ? AND student_id = ?',
      courseB,
      s
    );
    expect(enrB?.status).toBe('active');
  });

  it('a second unplaced course is unaffected by program locks', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'plk2');
    const t = await mkUser(db, 't2@plk.test', 'teacher', org);
    await mkUser(db, 's2@plk.test', 'student', org); // row needed by FK; self-enrolls below
    const tokT = (await login(app, 't2@plk.test')).access_token;
    const tokS = (await login(app, 's2@plk.test')).access_token;
    const courseX = await mkCourse(db, org, t, 'PLK2-X'); // not in any program
    const courseY = await mkCourse(db, org, t, 'PLK2-Y');
    const program = (await (
      await app.request('/api/v1/programs', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Path 2' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/programs/${program.data.id}/courses`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ course_id: courseY, position: 0 }), // no prerequisite
    });

    const enrollX = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: courseX }),
    });
    expect(enrollX.status).toBe(201);
    const enrollY = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: courseY }),
    });
    expect(enrollY.status).toBe(201);
  });
});
