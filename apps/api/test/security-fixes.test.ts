import { describe, it, expect } from 'vitest';
import { newId, nowIso } from '@lms/shared';
import { execute } from '../src/db.js';
import { sha256Hex } from '../src/crypto.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('password reset revokes sessions', () => {
  it('refresh tokens die with the reset', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rst');
    const uid = await mkUser(db, 'v@rst.test', 'student', org);
    const sess = await login(app, 'v@rst.test');
    // Plant a reset token (same shape as /password/forgot writes).
    const raw = `raw-reset-token-${newId()}`;
    await execute(
      db,
      'INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      uid,
      await sha256Hex(raw),
      new Date(Date.now() + 3600_000).toISOString(),
      nowIso()
    );
    const res = await app.request('/api/v1/auth/password/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: raw, password: 'BrandNew456!' }),
    });
    expect(res.status).toBe(200);
    // Old refresh token must now be rejected.
    const ref = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refresh_token }),
    });
    expect(ref.status).toBe(401);
    // New password works.
    const back = await login(app, 'v@rst.test', 'BrandNew456!');
    expect(back.access_token).toBeTruthy();
  });
});

describe('certificate list authorization', () => {
  it('students cannot read other students certs; teachers and linked parents can', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'crt');
    const t = await mkUser(db, 't@crt.test', 'teacher', org);
    const s1 = await mkUser(db, 's1@crt.test', 'student', org);
    const s2 = await mkUser(db, 's2@crt.test', 'student', org);
    const p = await mkUser(db, 'p@crt.test', 'parent', org);
    await execute(
      db,
      'INSERT INTO parent_links (id, parent_id, student_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      p,
      s1,
      org,
      nowIso()
    );
    const c = await mkCourse(db, org, t, 'CRT1');
    const tokT = (await login(app, 't@crt.test')).access_token;
    const tokS2 = (await login(app, 's2@crt.test')).access_token;
    const tokP = (await login(app, 'p@crt.test')).access_token;
    const issue = await app.request('/api/v1/certificates/issue', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ course_id: c, student_id: s1 }),
    });
    expect(issue.status).toBe(201);
    // Cross-student without org context: denied (was 200 before the fix).
    const sneak = await app.request(`/api/v1/certificates?student_id=${s1}`, {
      headers: authHeader(tokS2),
    });
    expect(sneak.status).toBe(403);
    // Cross-student WITH org context: still denied.
    const sneakOrg = await app.request(
      `/api/v1/certificates?student_id=${s1}&organization_id=${org}`,
      { headers: authHeader(tokS2) }
    );
    expect(sneakOrg.status).toBe(403);
    // Teacher with org context: allowed.
    const teach = await app.request(
      `/api/v1/certificates?student_id=${s1}&organization_id=${org}`,
      { headers: authHeader(tokT) }
    );
    expect(teach.status).toBe(200);
    // Linked parent: allowed. Unlinked: denied.
    const linked = await app.request(
      `/api/v1/certificates?student_id=${s1}&organization_id=${org}`,
      { headers: authHeader(tokP) }
    );
    expect(linked.status).toBe(200);
    const unlinked = await app.request(
      `/api/v1/certificates?student_id=${s2}&organization_id=${org}`,
      { headers: authHeader(tokP) }
    );
    expect(unlinked.status).toBe(403);
  });
});

describe('user roster guards', () => {
  it('students cannot list users or view other profiles', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ros');
    const s1 = await mkUser(db, 's1@ros.test', 'student', org);
    const s2 = await mkUser(db, 's2@ros.test', 'student', org);
    await mkUser(db, 't@ros.test', 'teacher', org);
    const tokS = (await login(app, 's1@ros.test')).access_token;
    const tokT = (await login(app, 't@ros.test')).access_token;
    expect(
      (await app.request(`/api/v1/users?organization_id=${org}`, { headers: authHeader(tokS) }))
        .status
    ).toBe(403);
    expect((await app.request(`/api/v1/users/${s2}`, { headers: authHeader(tokS) })).status).toBe(
      403
    );
    // Self still visible; teacher workflows intact.
    expect((await app.request(`/api/v1/users/${s1}`, { headers: authHeader(tokS) })).status).toBe(
      200
    );
    expect(
      (await app.request(`/api/v1/users?organization_id=${org}`, { headers: authHeader(tokT) }))
        .status
    ).toBe(200);
    expect((await app.request(`/api/v1/users/${s2}`, { headers: authHeader(tokT) })).status).toBe(
      200
    );
  });
});

describe('attendance record membership', () => {
  it('rejects records for users outside the session org', async () => {
    const { app, db } = await setup();
    const orgA = await mkOrg(db, 'atta');
    const orgB = await mkOrg(db, 'attb');
    await mkUser(db, 't@atta.test', 'teacher', orgA);
    const sA = await mkUser(db, 's@atta.test', 'student', orgA);
    const outsider = await mkUser(db, 'x@attb.test', 'student', orgB);
    const tokT = (await login(app, 't@atta.test')).access_token;
    const sess = (
      (await (
        await app.request('/api/v1/attendance/sessions', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({
            organization_id: orgA,
            title: 'S1',
            session_date: '2026-10-01',
          }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    const bad = await app.request('/api/v1/attendance/records', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({
        session_id: sess,
        records: [
          { student_id: sA, status: 'present' },
          { student_id: outsider, status: 'present' },
        ],
      }),
    });
    expect(bad.status).toBe(400);
    const good = await app.request('/api/v1/attendance/records', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({
        session_id: sess,
        records: [{ student_id: sA, status: 'present' }],
      }),
    });
    expect(good.status).toBe(201);
  });
});

describe('grades cross-student oracle closed', () => {
  it('student probing another student gets 403 even when no grades exist', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'grd');
    await mkUser(db, 't@grd.test', 'teacher', org);
    const s1 = await mkUser(db, 's1@grd.test', 'student', org);
    await mkUser(db, 's2@grd.test', 'student', org);
    const tokS2 = (await login(app, 's2@grd.test')).access_token;
    const tokT = (await login(app, 't@grd.test')).access_token;
    // No grades exist for s1 at all: must still be 403, not 200 [].
    const probe = await app.request(`/api/v1/grades?student_id=${s1}`, {
      headers: authHeader(tokS2),
    });
    expect(probe.status).toBe(403);
    // Teacher can still read.
    const teach = await app.request(`/api/v1/grades?student_id=${s1}`, {
      headers: authHeader(tokT),
    });
    expect(teach.status).toBe(200);
  });
});
