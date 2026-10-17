import { describe, it, expect } from 'vitest';
import { newId, nowIso } from '@lms/shared';
import { execute } from '../src/db.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

async function createQuiz(app: App, tok: string, courseId: string, title: string) {
  const r = (await (
    await app.request('/api/v1/quizzes', {
      method: 'POST',
      headers: H(tok),
      body: JSON.stringify({ course_id: courseId, title, passing_score: 50, max_attempts: 10 }),
    })
  ).json()) as { data: { id: string } };
  return r.data.id;
}

describe('release2: pool isolation, file ACL, login throttle, setup lock, quota, confirm', () => {
  it('pooled draws are per-attempt: isolated rows, template survives', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'pi');
    const t = await mkUser(db, 't@pi.test', 'teacher', org);
    await mkUser(db, 's1@pi.test', 'student', org);
    await mkUser(db, 's2@pi.test', 'student', org);
    const tokT = (await login(app, 't@pi.test')).access_token;
    const tok1 = (await login(app, 's1@pi.test')).access_token;
    const tok2 = (await login(app, 's2@pi.test')).access_token;
    const c = await mkCourse(db, org, t, 'PI1');
    const bank = (await (
      await app.request('/api/v1/question-banks', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Pool bank' }),
      })
    ).json()) as { data: { id: string } };
    for (const [prompt, right] of [
      ['2+2?', '4'],
      ['3+3?', '6'],
    ] as const) {
      const r = await app.request(`/api/v1/question-banks/${bank.data.id}/questions`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          type: 'single_choice',
          prompt,
          points: 100,
          options: [
            { label: right, is_correct: true },
            { label: 'wrong', is_correct: false },
          ],
        }),
      });
      expect(r.status).toBe(201);
    }
    const qz = await createQuiz(app, tokT, c, 'Pooled');
    expect(
      (
        await app.request(`/api/v1/quizzes/${qz}/pools`, {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({ bank_id: bank.data.id, pick_count: 1 }),
        })
      ).status
    ).toBe(201);

    const att1 = (await (
      await app.request(`/api/v1/quizzes/${qz}/attempts`, {
        method: 'POST',
        headers: authHeader(tok1),
      })
    ).json()) as { data: { id: string } };
    const att2 = (await (
      await app.request(`/api/v1/quizzes/${qz}/attempts`, {
        method: 'POST',
        headers: authHeader(tok2),
      })
    ).json()) as { data: { id: string } };
    // Attempt-scoped rows are distinct per attempt; nothing shared.
    const copies = await db
      .prepare('SELECT id, attempt_id FROM questions WHERE quiz_id = ? AND attempt_id IS NOT NULL')
      .bind(qz)
      .all<{ id: string; attempt_id: string }>();
    expect(copies.results.length).toBe(2);
    const byAtt = new Map(copies.results.map((r) => [r.attempt_id, r.id]));
    expect(byAtt.get(att1.data.id)).toBeTruthy();
    expect(byAtt.get(att2.data.id)).toBeTruthy();
    expect(byAtt.get(att1.data.id)).not.toBe(byAtt.get(att2.data.id));
    const shared = await db
      .prepare('SELECT COUNT(*) as n FROM questions WHERE quiz_id = ? AND attempt_id IS NULL')
      .bind(qz)
      .first<{ n: number }>();
    expect(shared?.n).toBe(0);
    // Pool template survives both attempts.
    const pool = await db
      .prepare('SELECT id FROM quiz_pools WHERE quiz_id = ?')
      .bind(qz)
      .first<{ id: string }>();
    expect(pool?.id).toBeTruthy();
    // Cross-attempt reads are forbidden; attempt reads merge shared + own copy.
    const cross = await app.request(`/api/v1/quizzes/${qz}/questions?attempt_id=${att2.data.id}`, {
      headers: authHeader(tok1),
    });
    expect(cross.status).toBe(403);
    const own = (await (
      await app.request(`/api/v1/quizzes/${qz}/questions?attempt_id=${att1.data.id}`, {
        headers: authHeader(tok1),
      })
    ).json()) as { data: { id: string }[] };
    expect(own.data.length).toBe(1);
    expect(own.data[0].id).toBe(byAtt.get(att1.data.id));
    // Teacher sees the attempt draw too (grading/review path).
    const tw = await app.request(`/api/v1/quizzes/${qz}/questions?attempt_id=${att1.data.id}`, {
      headers: authHeader(tokT),
    });
    expect(tw.status).toBe(200);
    // Both students answer their own drawn copy correctly → 100 each.
    for (const [tok, attId] of [
      [tok1, att1.data.id],
      [tok2, att2.data.id],
    ] as const) {
      const qid = byAtt.get(attId) ?? '';
      const right = await db
        .prepare('SELECT id FROM question_options WHERE question_id = ? AND is_correct = 1')
        .bind(qid)
        .first<{ id: string }>();
      const sub = (await (
        await app.request(`/api/v1/quiz-attempts/${attId}/submit`, {
          method: 'POST',
          headers: H(tok),
          body: JSON.stringify({ answers: [{ question_id: qid, option_id: right?.id }] }),
        })
      ).json()) as { data: { score: number; total: number } };
      expect(sub.data.score).toBe(100);
      expect(sub.data.total).toBe(100);
    }
  });

  it('org file listing/download is enrollment-role scoped, owners keep access', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'fa');
    const orgB = await mkOrg(db, 'faB');
    await mkUser(db, 't@fa.test', 'teacher', org);
    await mkUser(db, 's@fa.test', 'student', org);
    await mkUser(db, 'x@fa.test', 'teacher', orgB);
    const tokT = (await login(app, 't@fa.test')).access_token;
    const tokS = (await login(app, 's@fa.test')).access_token;
    const tokX = (await login(app, 'x@fa.test')).access_token;
    const upload = async (tok: string, name: string, oid: string) => {
      const f = new FormData();
      f.append('file', new File(['hello'], name, { type: 'text/plain' }));
      f.append('organization_id', oid);
      return app.request('/api/v1/uploads', {
        method: 'POST',
        headers: authHeader(tok),
        body: f,
      });
    };
    const upT = (await (await upload(tokT, 'teacher-note.txt', org)).json()) as {
      data: { id: string };
    };
    // Student org listing excludes the teacher's file.
    const list = (await (
      await app.request(`/api/v1/files?organization_id=${org}`, { headers: authHeader(tokS) })
    ).json()) as { data: { id: string }[] };
    expect(list.data.some((r) => r.id === upT.data.id)).toBe(false);
    // Student cannot download the teacher's file; other-org teacher neither.
    expect(
      (await app.request(`/api/v1/files/${upT.data.id}/download`, { headers: authHeader(tokS) }))
        .status
    ).toBe(403);
    expect(
      (await app.request(`/api/v1/files/${upT.data.id}/download`, { headers: authHeader(tokX) }))
        .status
    ).toBe(403);
    // Owner paths keep working both ways.
    expect(
      (await app.request(`/api/v1/files/${upT.data.id}/download`, { headers: authHeader(tokT) }))
        .status
    ).toBe(200);
    const upS = (await (await upload(tokS, 'mine.txt', org)).json()) as { data: { id: string } };
    const list2 = (await (
      await app.request(`/api/v1/files?organization_id=${org}`, { headers: authHeader(tokS) })
    ).json()) as { data: { id: string }[] };
    expect(list2.data.some((r) => r.id === upS.data.id)).toBe(true);
    expect(
      (await app.request(`/api/v1/files/${upS.data.id}/download`, { headers: authHeader(tokS) }))
        .status
    ).toBe(200);
    // Teacher keeps the full org listing.
    const listT = (await (
      await app.request(`/api/v1/files?organization_id=${org}`, { headers: authHeader(tokT) })
    ).json()) as { data: { id: string }[] };
    expect(listT.data.some((r) => r.id === upT.data.id)).toBe(true);
    expect(listT.data.some((r) => r.id === upS.data.id)).toBe(true);
  });

  it('login locks an account after 5 failures and resets on success', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'lt');
    await mkUser(db, 'v@lt.test', 'student', org);
    const bad = (pw: string) =>
      app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'v@lt.test', password: pw }),
      });
    for (let i = 0; i < 4; i++) expect((await bad('Wrongpass1!')).status).toBe(401);
    expect((await bad('Wrongpass1!')).status).toBe(423);
    // Correct password is also refused while locked.
    expect(
      (
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'v@lt.test', password: 'Password123!' }),
        })
      ).status
    ).toBe(423);
    // Unknown emails never lock (no oracle, no row to burn).
    for (let i = 0; i < 6; i++) {
      expect(
        (
          await app.request('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'ghost@lt.test', password: 'Wrongpass1!' }),
          })
        ).status
      ).toBe(401);
    }
    // Expired lock admits the rightful owner and the success resets counters.
    await execute(
      db,
      'UPDATE users SET locked_until = ? WHERE email = ?',
      new Date(Date.now() - 1000).toISOString(),
      'v@lt.test'
    );
    expect(
      (
        await app.request('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'v@lt.test', password: 'Password123!' }),
        })
      ).status
    ).toBe(200);
    const row = await db
      .prepare('SELECT failed_login_count, locked_until FROM users WHERE email = ?')
      .bind('v@lt.test')
      .first<{ failed_login_count: number; locked_until: string | null }>();
    expect(row?.failed_login_count).toBe(0);
    expect(row?.locked_until).toBeNull();
    // Four more failures after a success are plain 401s (counter restarted).
    for (let i = 0; i < 4; i++) expect((await bad('Wrongpass1!')).status).toBe(401);
  });

  it('setup is single-winner with stale-claim recovery and password bounds', async () => {
    const { app, db } = await setup();
    const payload = (email: string, password = 'Password123!') => ({
      app_name: 'Lock Academy',
      org_name: 'Lock Academy',
      admin_email: email,
      admin_password: password,
      admin_name: 'Owner',
    });
    const first = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload('owner@lock.test')),
    });
    expect(first.status).toBe(201);
    const second = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload('second@lock.test')),
    });
    expect(second.status).toBe(403);
    const orgs = await db.prepare('SELECT COUNT(*) as n FROM organizations').first<{ n: number }>();
    expect(orgs?.n).toBe(1);
    // Oversized setup passwords are rejected like every other password path.
    const huge = await app.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload('huge@lock.test', 'x'.repeat(200))),
    });
    expect(huge.status).toBe(400);

    // Fresh in-progress claim blocks; stale claims are stealable exactly once.
    const { app: app2, db: db2 } = await setup();
    await execute(
      db2,
      "INSERT INTO settings (key, value, updated_at) VALUES ('setup_completed', 'in_progress', ?)",
      nowIso()
    );
    const busy = await app2.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload('a@lock.test')),
    });
    expect(busy.status).toBe(409);
    await execute(
      db2,
      "UPDATE settings SET updated_at = ? WHERE key = 'setup_completed'",
      new Date(Date.now() - 10 * 60000).toISOString()
    );
    const stolen = await app2.request('/api/v1/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload('b@lock.test')),
    });
    expect(stolen.status).toBe(201);
    const orgs2 = await db2
      .prepare('SELECT COUNT(*) as n FROM organizations')
      .first<{ n: number }>();
    expect(orgs2?.n).toBe(1);
  });

  it('org storage quota blocks over-quota uploads, unset means unlimited', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'sq');
    const t = await mkUser(db, 't@sq.test', 'teacher', org);
    const tokT = (await login(app, 't@sq.test')).access_token;
    void t;
    await execute(
      db,
      'UPDATE organizations SET settings = ? WHERE id = ?',
      JSON.stringify({ storage_quota_bytes: '10' }),
      org
    );
    const up = (name: string, body: string) => {
      const f = new FormData();
      f.append('file', new File([body], name, { type: 'text/plain' }));
      f.append('organization_id', org);
      return app.request('/api/v1/uploads', {
        method: 'POST',
        headers: authHeader(tokT),
        body: f,
      });
    };
    expect((await up('a.txt', '12345')).status).toBe(201);
    expect((await up('b.txt', '12345')).status).toBe(201);
    const over = await up('c.txt', '12345');
    expect(over.status).toBe(413);
    // Invalid quota values fail open (never block legitimate uploads).
    await execute(db, 'UPDATE organizations SET settings = ? WHERE id = ?', '{"a":1}', org);
    expect((await up('d.txt', '12345')).status).toBe(201);
    await execute(
      db,
      'UPDATE organizations SET settings = ? WHERE id = ?',
      JSON.stringify({ storage_quota_bytes: 'not-a-number' }),
      org
    );
    expect((await up('e.txt', '12345')).status).toBe(201);
  });

  it('orders expose pending_payment_id for the admin confirm flow', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'pc');
    const t = await mkUser(db, 't@pc.test', 'teacher', org);
    await mkUser(db, 'a@pc.test', 'organization_admin', org);
    const buyer = await mkUser(db, 'b@pc.test', 'student', org);
    const tokA = (await login(app, 'a@pc.test')).access_token;
    const course = await mkCourse(db, org, t, 'PC1');
    const now = nowIso();
    const oid = newId();
    const pid = newId();
    await execute(
      db,
      "INSERT INTO orders (id, organization_id, buyer_id, kind, reference_id, total, status, created_at, updated_at) VALUES (?, ?, ?, 'course', ?, 100, 'pending', ?, ?)",
      oid,
      org,
      buyer,
      course,
      now,
      now
    );
    await execute(
      db,
      "INSERT INTO payments (id, order_id, provider, amount, status, created_at, updated_at) VALUES (?, ?, 'manual', 100, 'pending', ?, ?)",
      pid,
      oid,
      now,
      now
    );
    const list = (await (
      await app.request(`/api/v1/orders?organization_id=${org}`, { headers: authHeader(tokA) })
    ).json()) as { data: { id: string; pending_payment_id: string | null }[] };
    expect(list.data.find((o) => o.id === oid)?.pending_payment_id).toBe(pid);
    const confirm = await app.request(`/api/v1/payments/${pid}/confirm`, {
      method: 'POST',
      headers: authHeader(tokA),
    });
    expect(confirm.status).toBe(200);
    const relist = (await (
      await app.request(`/api/v1/orders?organization_id=${org}`, { headers: authHeader(tokA) })
    ).json()) as { data: { id: string; pending_payment_id: string | null }[] };
    expect(relist.data.find((o) => o.id === oid)?.pending_payment_id).toBeNull();
  });
});
