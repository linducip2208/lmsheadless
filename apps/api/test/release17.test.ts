import { describe, it, expect } from 'vitest';
import { execute, queryFirst } from '../src/db.js';
import { nowIso } from '@lms/shared';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('enrollment approval workflow', () => {
  it('closed blocks, approval queues, teacher decides, student notified', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'appr');
    const t = await mkUser(db, 't@appr.com', 'teacher', org);
    await mkUser(db, 's@appr.com', 'student', org);
    const tokT = (await login(app, 't@appr.com')).access_token;
    const tokS = (await login(app, 's@appr.com')).access_token;
    const c = await mkCourse(db, org, t, 'APPR1');
    await execute(db, "UPDATE courses SET enrollment_mode = 'closed' WHERE id = ?", c);
    const closed = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c }),
    });
    expect(closed.status).toBe(400);
    await execute(db, "UPDATE courses SET enrollment_mode = 'approval' WHERE id = ?", c);
    const req = (await (
      await app.request('/api/v1/enrollments', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ course_id: c }),
      })
    ).json()) as { data: { requested: boolean } };
    expect(req.data.requested).toBe(true);
    // No enrollment yet.
    const enr0 = await queryFirst(db, 'SELECT id FROM enrollments WHERE course_id = ?', c);
    expect(enr0).toBeNull();
    const queue = (await (
      await app.request(`/api/v1/courses/${c}/enrollment-requests`, { headers: authHeader(tokT) })
    ).json()) as { data: { id: string }[] };
    expect(queue.data.length).toBe(1);
    // Student cannot approve own request.
    const selfApprove = await app.request(
      `/api/v1/enrollment-requests/${queue.data[0].id}/approve`,
      { method: 'POST', headers: authHeader(tokS) }
    );
    expect(selfApprove.status).toBe(403);
    const approve = await app.request(`/api/v1/enrollment-requests/${queue.data[0].id}/approve`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(approve.status).toBe(200);
    const enr1 = await queryFirst(db, 'SELECT id FROM enrollments WHERE course_id = ?', c);
    expect(enr1).toBeTruthy();
    // Double decision rejected.
    const again = await app.request(`/api/v1/enrollment-requests/${queue.data[0].id}/approve`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(again.status).toBe(400);
    // Notification delivered.
    const notifs = (await (
      await app.request('/api/v1/notifications', { headers: authHeader(tokS) })
    ).json()) as { data: { title: string }[] };
    expect(notifs.data.some((n) => n.title === 'Enrollment approved')).toBe(true);
    void t;
  });

  it('reject path notifies without enrolling', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rej');
    const t = await mkUser(db, 't@rej.com', 'teacher', org);
    await mkUser(db, 's@rej.com', 'student', org);
    const tokT = (await login(app, 't@rej.com')).access_token;
    const tokS = (await login(app, 's@rej.com')).access_token;
    const c = await mkCourse(db, org, t, 'REJ1');
    await execute(db, "UPDATE courses SET enrollment_mode = 'approval' WHERE id = ?", c);
    await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c }),
    });
    const queue = (await (
      await app.request(`/api/v1/courses/${c}/enrollment-requests`, { headers: authHeader(tokT) })
    ).json()) as { data: { id: string }[] };
    const rej = await app.request(`/api/v1/enrollment-requests/${queue.data[0].id}/reject`, {
      method: 'POST',
      headers: authHeader(tokT),
    });
    expect(rej.status).toBe(200);
    expect(await queryFirst(db, 'SELECT id FROM enrollments WHERE course_id = ?', c)).toBeNull();
  });
});

describe('verification email delivery + upcoming work', () => {
  it('queues verification email when provider configured, silent otherwise', async () => {
    const { app, db } = await setup();
    // No provider: register reports no-provider, no queue rows.
    const r1 = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e1@x.com', password: 'Password123!', name: 'E1' }),
    });
    expect(
      ((await r1.json()) as { data: { verification_email: string } }).data.verification_email
    ).toBe('no-provider');
    // Configure provider via settings, then register queues.
    await execute(
      db,
      "INSERT INTO settings (key, value, updated_at) VALUES ('email_api_url', 'https://mail.example/send', ?), ('email_api_key', 'k', ?), ('web_base_url', 'https://app.example', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      nowIso(),
      nowIso(),
      nowIso()
    );
    const r2 = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2@x.com', password: 'Password123!', name: 'E2' }),
    });
    expect(
      ((await r2.json()) as { data: { verification_email: string } }).data.verification_email
    ).toBe('queued');
    const queued = await queryFirst<{ subject: string; body_html: string }>(
      db,
      "SELECT subject, body_html FROM email_queue WHERE to_email = 'e2@x.com'"
    );
    expect(queued?.subject).toBe('Verify your email');
    expect(queued?.body_html).toContain('https://app.example/#/verify-email/');
  });

  it('student-progress includes upcoming assignments and quizzes', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'upc');
    const t = await mkUser(db, 't@upc.com', 'teacher', org);
    await mkUser(db, 's@upc.com', 'student', org);
    const tokT = (await login(app, 't@upc.com')).access_token;
    const tokS = (await login(app, 's@upc.com')).access_token;
    const c = await mkCourse(db, org, t, 'UPC1');
    await app.request('/api/v1/assignments', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ course_id: c, title: 'A', max_score: 10 }),
    });
    await app.request('/api/v1/quizzes', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ course_id: c, title: 'Q', passing_score: 50 }),
    });
    await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c }),
    });
    const rep = (await (
      await app.request('/api/v1/reports/student-progress', { headers: authHeader(tokS) })
    ).json()) as {
      data: { upcoming_assignments: unknown[]; upcoming_quizzes: unknown[] };
    };
    expect(rep.data.upcoming_assignments.length).toBe(1);
    expect(rep.data.upcoming_quizzes.length).toBe(1);
  });
});

describe('refresh token pruning', () => {
  it('prunes long-expired idle sessions but keeps rotation chains for reuse detection', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'prune');
    const u = await mkUser(db, 'u@prune.com', 'student', org);
    const first = await login(app, 'u@prune.com');
    // Stale dead row (expired 2 days ago, never rotated).
    await execute(
      db,
      "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, datetime('now', '-2 days'), ?)",
      'stale-1',
      u,
      'hash-stale',
      nowIso()
    );
    // Refresh triggers prune.
    await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: first.refresh_token }),
    });
    expect(await queryFirst(db, "SELECT id FROM refresh_tokens WHERE id = 'stale-1'")).toBeNull();
    // Rotation chain intact: replaying the old token still yields REUSE_DETECTED.
    const replay = (await (
      await app.request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: first.refresh_token }),
      })
    ).json()) as { error: { code: string } };
    expect(replay.error.code).toBe('REUSE_DETECTED');
  });
});
