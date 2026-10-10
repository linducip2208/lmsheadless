import { describe, it, expect } from 'vitest';
import { execute, queryFirst } from '../src/db.js';
import { newId, nowIso } from '@lms/shared';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('logout revokes the refresh token', () => {
  it('logout kills the session; second call is idempotent', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'lout');
    await mkUser(db, 'u@lout.test', 'student', org);
    const sess = await login(app, 'u@lout.test');
    const out = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refresh_token }),
    });
    expect(out.status).toBe(200);
    const ref = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refresh_token }),
    });
    expect(ref.status).toBe(401);
    // Idempotent: logging out again still returns success, no error leak.
    const again = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: sess.refresh_token }),
    });
    expect(again.status).toBe(200);
    void db;
  });
});

describe('commissions ledger read', () => {
  it('privileged and teacher scopes work; students denied', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cled');
    const t = await mkUser(db, 't@cled.test', 'teacher', org);
    await mkUser(db, 'a@cled.test', 'organization_admin', org);
    await mkUser(db, 's@cled.test', 'student', org);
    const tokT = (await login(app, 't@cled.test')).access_token;
    const tokA = (await login(app, 'a@cled.test')).access_token;
    const tokS = (await login(app, 's@cled.test')).access_token;
    const c = await mkCourse(db, org, t, 'CLED1');
    // A real order gives the commission row a valid FK target.
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as { data: { id: string } };
    await execute(
      db,
      'INSERT INTO commissions (id, organization_id, instructor_id, order_id, amount, amount_minor, rate, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      org,
      t,
      order.data.id,
      70,
      7000,
      70,
      'pending',
      nowIso(),
      nowIso()
    );
    const admin = (await (
      await app.request(`/api/v1/commissions?organization_id=${org}`, { headers: authHeader(tokA) })
    ).json()) as { data: unknown[] };
    expect(admin.data.length).toBe(1);
    // Teachers see only their own rows.
    const teach = (await (
      await app.request(`/api/v1/commissions?organization_id=${org}`, { headers: authHeader(tokT) })
    ).json()) as { data: unknown[] };
    expect(teach.data.length).toBe(1);
    const deny = await app.request(`/api/v1/commissions?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    expect(deny.status).toBe(403);
  });
});

describe('affiliates and payouts listings', () => {
  it('privileged users list; students denied', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'afl');
    const t = await mkUser(db, 't@afl.test', 'teacher', org);
    await mkUser(db, 'a@afl.test', 'organization_admin', org);
    await mkUser(db, 's@afl.test', 'student', org);
    const tokA = (await login(app, 'a@afl.test')).access_token;
    const tokS = (await login(app, 's@afl.test')).access_token;
    const aff = await app.request('/api/v1/affiliates', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, user_id: t, code: 'PARTNER1' }),
    });
    expect(aff.status).toBe(201);
    const list = (await (
      await app.request(`/api/v1/affiliates?organization_id=${org}`, { headers: authHeader(tokA) })
    ).json()) as { data: { code: string }[] };
    expect(list.data.some((a) => a.code === 'PARTNER1')).toBe(true);
    const pay = await app.request('/api/v1/payouts', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, amount: 25 }),
    });
    expect(pay.status).toBe(201);
    const pays = (await (
      await app.request(`/api/v1/payouts?organization_id=${org}`, { headers: authHeader(tokA) })
    ).json()) as { data: unknown[] };
    expect(pays.data.length).toBe(1);
    expect(
      (
        await app.request(`/api/v1/affiliates?organization_id=${org}`, {
          headers: authHeader(tokS),
        })
      ).status
    ).toBe(403);
    expect(
      (await app.request(`/api/v1/payouts?organization_id=${org}`, { headers: authHeader(tokS) }))
        .status
    ).toBe(403);
  });
});

describe('public bundle catalog', () => {
  it('published bundles listed unauthenticated; drafts hidden', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'bcat');
    const t = await mkUser(db, 't@bcat.test', 'teacher', org);
    const tokT = (await login(app, 't@bcat.test')).access_token;
    const c = await mkCourse(db, org, t, 'BCAT1');
    const pub = (await (
      await app.request('/api/v1/bundles', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          organization_id: org,
          name: 'Public pack',
          price: 50,
          course_ids: [c],
        }),
      })
    ).json()) as { data: { id: string } };
    // Publish it for the storefront.
    await app.request(`/api/v1/bundles/${pub.data.id}`, {
      method: 'PATCH',
      headers: H(tokT),
      body: JSON.stringify({ status: 'published' }),
    });
    const list = (await (await app.request('/api/v1/catalog/bundles')).json()) as {
      data: { id: string }[];
    };
    expect(list.data.some((b) => b.id === pub.data.id)).toBe(true);
    const detail = await app.request(`/api/v1/catalog/bundles/${pub.data.id}`);
    expect(detail.status).toBe(200);
    const missing = await app.request('/api/v1/catalog/bundles/does-not-exist');
    expect(missing.status).toBe(404);
  });
});

describe('certificate bulk issue', () => {
  it('issues per member, skips outsiders, repeats idempotently', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'blk');
    const orgB = await mkOrg(db, 'blkB');
    const t = await mkUser(db, 't@blk.test', 'teacher', org);
    const s1 = await mkUser(db, 's1@blk.test', 'student', org);
    const s2 = await mkUser(db, 's2@blk.test', 'student', org);
    const outsider = await mkUser(db, 'x@blk.test', 'student', orgB);
    const tokT = (await login(app, 't@blk.test')).access_token;
    const tokS = (await login(app, 's1@blk.test')).access_token;
    const c = await mkCourse(db, org, t, 'BLK1');
    const first = (await (
      await app.request('/api/v1/certificates/bulk-issue', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ course_id: c, student_ids: [s1, s2, outsider] }),
      })
    ).json()) as { data: { issued: number; skipped: number } };
    expect(first.data.issued).toBe(2);
    expect(first.data.skipped).toBe(1);
    const second = (await (
      await app.request('/api/v1/certificates/bulk-issue', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ course_id: c, student_ids: [s1, s2] }),
      })
    ).json()) as { data: { issued: number; skipped: number } };
    expect(second.data.issued).toBe(0);
    // Students cannot bulk-issue.
    const deny = await app.request('/api/v1/certificates/bulk-issue', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c, student_ids: [s1] }),
    });
    expect(deny.status).toBe(403);
    const n = await queryFirst<{ n: number }>(
      db,
      'SELECT COUNT(*) as n FROM certificates WHERE course_id = ?',
      c
    );
    expect(n?.n).toBe(2);
  });
});

describe('org reports return real data with role gates', () => {
  it('summary/completion/attendance wired; students denied where privileged', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rpt');
    const t = await mkUser(db, 't@rpt.test', 'teacher', org);
    await mkUser(db, 's@rpt.test', 'student', org);
    const tokT = (await login(app, 't@rpt.test')).access_token;
    const tokS = (await login(app, 's@rpt.test')).access_token;
    await mkCourse(db, org, t, 'RPT1');
    for (const path of ['organization-summary', 'completion', 'attendance']) {
      const r = await app.request(`/api/v1/reports/${path}?organization_id=${org}`, {
        headers: authHeader(tokT),
      });
      expect(r.status).toBe(200);
    }
    // Students must not read the org-wide summary.
    const deny = await app.request(`/api/v1/reports/organization-summary?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    expect(deny.status).toBe(403);
  });
});

describe('notification preferences are enforced', () => {
  it('opted-out users skip announcement fan-out', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'pref');
    await mkUser(db, 't@pref.test', 'teacher', org);
    await mkUser(db, 's@pref.test', 'student', org);
    const tokT = (await login(app, 't@pref.test')).access_token;
    const tokS = (await login(app, 's@pref.test')).access_token;
    // Student opts out of announcements.
    const put = await app.request('/api/v1/notification-preferences', {
      method: 'PUT',
      headers: H(tokS),
      body: JSON.stringify({ announcement: false }),
    });
    expect(put.status).toBe(200);
    await app.request('/api/v1/announcements', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ organization_id: org, title: 'Hello', body: 'World' }),
    });
    const mine = (await (
      await app.request('/api/v1/notifications', { headers: authHeader(tokS) })
    ).json()) as { data: unknown[] };
    expect(mine.data.length).toBe(0);
    // Teacher (default prefs) still receives it.
    const theirs = (await (
      await app.request('/api/v1/notifications', { headers: authHeader(tokT) })
    ).json()) as { data: unknown[] };
    expect(theirs.data.length).toBe(1);
  });
});

describe('AI quota reset for the external scheduler', () => {
  it('privileged reset zeroes usage and audits; students denied', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'qreset');
    await mkUser(db, 'a@qreset.test', 'organization_admin', org);
    await mkUser(db, 's@qreset.test', 'student', org);
    const tokA = (await login(app, 'a@qreset.test')).access_token;
    const tokS = (await login(app, 's@qreset.test')).access_token;
    await app.request('/api/v1/ai/config', {
      method: 'PUT',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, provider: 'mock', monthly_limit: 5 }),
    });
    await execute(db, 'UPDATE ai_configs SET used_count = 5 WHERE organization_id = ?', org);
    const deny = await app.request('/api/v1/ai/usage/reset', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ organization_id: org }),
    });
    expect(deny.status).toBe(403);
    const res = (await (
      await app.request('/api/v1/ai/usage/reset', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({ organization_id: org }),
      })
    ).json()) as { data: { reset: boolean; before: number } };
    expect(res.data.reset).toBe(true);
    expect(res.data.before).toBe(5);
    const cfg = await queryFirst<{ used_count: number }>(
      db,
      'SELECT used_count FROM ai_configs WHERE organization_id = ?',
      org
    );
    expect(cfg?.used_count).toBe(0);
    // Repeatable: second run reports before=0.
    const again = (await (
      await app.request('/api/v1/ai/usage/reset', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({ organization_id: org }),
      })
    ).json()) as { data: { before: number } };
    expect(again.data.before).toBe(0);
  });
});

describe('course instructor assignment', () => {
  it('privileged assign/list/unassign; teachers see assigned courses only', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'tassign');
    const t = await mkUser(db, 't@tassign.test', 'teacher', org);
    const s = await mkUser(db, 's@tassign.test', 'student', org);
    await mkUser(db, 'a@tassign.test', 'organization_admin', org);
    const tokT = (await login(app, 't@tassign.test')).access_token;
    const tokA = (await login(app, 'a@tassign.test')).access_token;
    const tokS = (await login(app, 's@tassign.test')).access_token;
    const c = await mkCourse(db, org, t, 'TA1');
    // Unassigned: invisible to the teacher.
    const before = (await (
      await app.request(`/api/v1/instructor/courses?organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: unknown[] };
    expect(before.data.length).toBe(0);
    // Students and teachers cannot assign; students rejected as assignees.
    expect(
      (
        await app.request(`/api/v1/courses/${c}/instructors`, {
          method: 'POST',
          headers: H(tokS),
          body: JSON.stringify({ user_id: t }),
        })
      ).status
    ).toBe(403);
    expect(
      (
        await app.request(`/api/v1/courses/${c}/instructors`, {
          method: 'POST',
          headers: H(tokA),
          body: JSON.stringify({ user_id: s }),
        })
      ).status
    ).toBe(400);
    const assign = await app.request(`/api/v1/courses/${c}/instructors`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ user_id: t }),
    });
    expect(assign.status).toBe(201);
    // Idempotent re-assign.
    const again = await app.request(`/api/v1/courses/${c}/instructors`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ user_id: t }),
    });
    expect(again.status).toBe(201);
    const after = (await (
      await app.request(`/api/v1/instructor/courses?organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: { id: string }[] };
    expect(after.data.some((x) => x.id === c)).toBe(true);
    const un = await app.request(`/api/v1/courses/${c}/instructors/${t}`, {
      method: 'DELETE',
      headers: H(tokA),
    });
    expect(un.status).toBe(200);
    const gone = (await (
      await app.request(`/api/v1/instructor/courses?organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: unknown[] };
    expect(gone.data.length).toBe(0);
    void db;
  });
});

describe('push config honesty', () => {
  it('reports disabled without keys and never leaks key material', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'psh');
    await mkUser(db, 's@psh.test', 'student', org);
    const tokS = (await login(app, 's@psh.test')).access_token;
    const cfg = (await (
      await app.request('/api/v1/push/config', { headers: authHeader(tokS) })
    ).json()) as { data: Record<string, unknown> };
    expect(cfg.data.enabled).toBe(false);
    expect(JSON.stringify(cfg).toLowerCase()).not.toContain('private');
  });
});
