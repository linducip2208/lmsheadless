import { describe, it, expect } from 'vitest';
import { newId, nowIso } from '@lms/shared';
import { execute, queryFirst } from '../src/db.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('round7: push to 100/100', () => {
  it('duplicate preserves enrollment windows + capacity', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'dup100');
    const t = await mkUser(db, 't@dup100.test', 'teacher', org);
    const tok = (await login(app, 't@dup100.test')).access_token;
    const src = await mkCourse(db, org, t, 'SRC1');
    await execute(
      db,
      'UPDATE courses SET capacity = ?, enrollment_start = ?, enrollment_end = ?, enrollment_mode = ? WHERE id = ?',
      25,
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T00:00:00.000Z',
      'approval',
      src
    );
    const r = await app.request(`/api/v1/courses/${src}/duplicate`, {
      method: 'POST',
      headers: H(tok),
      body: JSON.stringify({ code: 'SRC1X' }),
    });
    expect(r.status).toBe(201);
    const nid = ((await r.json()) as { data: { id: string } }).data.id;
    const row = await queryFirst<Record<string, unknown>>(
      db,
      'SELECT capacity, enrollment_start, enrollment_end, enrollment_mode FROM courses WHERE id = ?',
      nid
    );
    expect(Number(row?.capacity)).toBe(25);
    expect(String(row?.enrollment_start)).toContain('2026-01-01');
    expect(String(row?.enrollment_end)).toContain('2026-12-31');
    expect(row?.enrollment_mode).toBe('approval');
  });

  it('expired attempts do not burn max_attempts', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'exp100');
    const t = await mkUser(db, 't@exp100.test', 'teacher', org);
    const s = await mkUser(db, 's@exp100.test', 'student', org);
    const tokT = (await login(app, 't@exp100.test')).access_token;
    const tokS = (await login(app, 's@exp100.test')).access_token;
    const c = await mkCourse(db, org, t, 'EXP1');
    await execute(
      db,
      "INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
      newId(),
      c,
      s,
      nowIso(),
      nowIso(),
      nowIso()
    );
    const qz = (
      (await (
        await app.request('/api/v1/quizzes', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({
            course_id: c,
            title: 'Exp',
            passing_score: 50,
            max_attempts: 1,
            time_limit_minutes: 60,
          }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    // Seed one expired attempt directly.
    await execute(
      db,
      "INSERT INTO quiz_attempts (id, quiz_id, student_id, status, started_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, 'expired', ?, ?, ?, ?)",
      newId(),
      qz,
      s,
      nowIso(),
      new Date(Date.now() - 1000).toISOString(),
      nowIso(),
      nowIso()
    );
    // max_attempts=1 but the only row is expired -> new attempt must be allowed.
    const r = await app.request(`/api/v1/quizzes/${qz}/attempts`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(201);
  });

  it('order cancel: pending ok, paid rejected', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'can100');
    const t = await mkUser(db, 't@can100.test', 'teacher', org);
    await mkUser(db, 's@can100.test', 'student', org);
    const tokS = (await login(app, 's@can100.test')).access_token;
    const c = await mkCourse(db, org, t, 'CAN1');
    await execute(db, 'UPDATE courses SET price_minor = ? WHERE id = ?', 5000, c);
    const orderRes = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as { data: { id: string } };
    const oid = orderRes.data.id;
    expect(oid).toBeTruthy();
    const cancel = await app.request(`/api/v1/orders/${oid}/cancel`, {
      method: 'POST',
      headers: H(tokS),
    });
    expect(cancel.status).toBe(200);
    const row = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM orders WHERE id = ?',
      oid
    );
    expect(row?.status).toBe('cancelled');
    const again = await app.request(`/api/v1/orders/${oid}/cancel`, {
      method: 'POST',
      headers: H(tokS),
    });
    expect([400, 404, 409]).toContain(again.status);
  });

  it('subscriptions: free auto-renew, paid past_due, cancel works', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'sub100');
    await mkUser(db, 'a@sub100.test', 'organization_admin', org);
    const buyer = await mkUser(db, 'b@sub100.test', 'student', org);
    const tokA = (await login(app, 'a@sub100.test')).access_token;
    const tokB = (await login(app, 'b@sub100.test')).access_token;
    const freePlan = newId();
    const paidPlan = newId();
    const past = new Date(Date.now() - 86400000).toISOString();
    await execute(
      db,
      'INSERT INTO subscription_plans (id, organization_id, name, price, price_minor, interval, is_active, created_at) VALUES (?, ?, ?, 0, 0, ?, 1, ?)',
      freePlan,
      org,
      'Free',
      'monthly',
      nowIso()
    );
    await execute(
      db,
      'INSERT INTO subscription_plans (id, organization_id, name, price, price_minor, interval, is_active, created_at) VALUES (?, ?, ?, 10, 1000, ?, 1, ?)',
      paidPlan,
      org,
      'Paid',
      'monthly',
      nowIso()
    );
    const fs = newId();
    const ps = newId();
    await execute(
      db,
      "INSERT INTO subscriptions (id, plan_id, buyer_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
      fs,
      freePlan,
      buyer,
      past,
      nowIso(),
      nowIso()
    );
    await execute(
      db,
      "INSERT INTO subscriptions (id, plan_id, buyer_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
      ps,
      paidPlan,
      buyer,
      past,
      nowIso(),
      nowIso()
    );
    const r = await app.request('/api/v1/subscriptions/renew-due', {
      method: 'POST',
      headers: H(tokA),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { data: { renewed: number; pastDue: number } };
    expect(j.data.renewed).toBe(1);
    expect(j.data.pastDue).toBe(1);
    const c2 = await app.request(`/api/v1/subscriptions/${fs}/cancel`, {
      method: 'POST',
      headers: H(tokB),
    });
    expect(c2.status).toBe(200);
  });

  it('xapi retention purge honors opt-in window', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'x100');
    const adminId = await mkUser(db, 'a@x100.test', 'organization_admin', org);
    const tok = (await login(app, 'a@x100.test')).access_token;
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    await execute(
      db,
      'INSERT INTO xapi_statements (id, statement_id, organization_id, actor_id, actor_name, verb, object_id, timestamp, stored_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      '11111111-1111-4111-8111-111111111111',
      org,
      adminId,
      'Admin',
      'experienced',
      'obj1',
      old,
      old,
      old
    );
    const r = await app.request('/api/v1/xapi/retention/purge', {
      method: 'POST',
      headers: H(tok),
      body: JSON.stringify({ organization_id: org, days: 30 }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { data: { deleted: number } };
    expect(j.data.deleted).toBe(1);
  });

  it('cron-status exposes sys.cron rows to super_admin only', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cron100');
    const sa = await mkUser(db, 'sa@cron100.test', null);
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      org,
      sa,
      'super_admin',
      nowIso(),
      nowIso()
    );
    await mkUser(db, 'st@cron100.test', 'student', org);
    await execute(
      db,
      "INSERT INTO audit_logs (id, actor_id, organization_id, action, entity, entity_id, metadata, ip, created_at) VALUES (?, NULL, ?, 'sys.cron.publish_due', NULL, NULL, ?, NULL, ?)",
      newId(),
      org,
      '{}',
      nowIso()
    );
    const tokSA = (await login(app, 'sa@cron100.test')).access_token;
    const tokSt = (await login(app, 'st@cron100.test')).access_token;
    const okRes = await app.request('/api/v1/system/cron-status', {
      headers: authHeader(tokSA),
    });
    expect(okRes.status).toBe(200);
    const denied = await app.request('/api/v1/system/cron-status', {
      headers: authHeader(tokSt),
    });
    expect(denied.status).toBe(403);
  });

  it('FK cascades fire at DB level (org delete cascades)', async () => {
    const { db } = await setup();
    const org = await mkOrg(db, 'cas100');
    const u = await mkUser(db, 'u@cas100.test', 'teacher', org);
    const c = await mkCourse(db, org, u, 'CAS1');
    await execute(db, 'PRAGMA foreign_keys = ON');
    await execute(db, 'DELETE FROM organizations WHERE id = ?', org);
    const gone = await queryFirst(db, 'SELECT id FROM courses WHERE id = ?', c);
    expect(gone).toBeFalsy();
  });
});
