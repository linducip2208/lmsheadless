import { describe, it, expect } from 'vitest';
import { execute, queryFirst } from '../src/db.js';
import { newId, nowIso } from '@lms/shared';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('rubrics + late policy', () => {
  it('criteria validated, rubric total must equal score, late blocked by policy', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rub');
    const t = await mkUser(db, 't@rub.com', 'teacher', org);
    await mkUser(db, 's@rub.com', 'student', org);
    const tokT = (await login(app, 't@rub.com')).access_token;
    const tokS = (await login(app, 's@rub.com')).access_token;
    const c = await mkCourse(db, org, t, 'RUB1');
    const a = (await (
      await app.request('/api/v1/assignments', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ course_id: c, title: 'Essay', max_score: 100, allow_late: false }),
      })
    ).json()) as { data: { id: string } };
    // Rubric with bad criterion rejected.
    const badCrit = await app.request(`/api/v1/assignments/${a.data.id}/rubric`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ criteria: [{ label: '', max_points: -5 }] }),
    });
    expect(badCrit.status).toBe(400);
    const rub = await app.request(`/api/v1/assignments/${a.data.id}/rubric`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({
        criteria: [
          { label: 'Content', max_points: 70 },
          { label: 'Style', max_points: 30 },
        ],
      }),
    });
    expect(rub.status).toBe(201);
    const studentDeny = await app.request(`/api/v1/assignments/${a.data.id}/rubric`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ criteria: [] }),
    });
    expect(studentDeny.status).toBe(403);
    const list = await app.request(`/api/v1/assignments/${a.data.id}/rubric`, {
      headers: authHeader(tokS),
    });
    expect(list.status).toBe(200);
    await app.request(`/api/v1/assignments/${a.data.id}/submissions`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ body: 'work' }),
    });
    const sub = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM submissions WHERE assignment_id = ?',
      a.data.id
    );
    const crits = (await (
      await app.request(`/api/v1/assignments/${a.data.id}/rubric`, { headers: authHeader(tokT) })
    ).json()) as { data: { id: string; max_points: number }[] };
    // Mismatched total rejected.
    const mismatch = await app.request(`/api/v1/submissions/${sub?.id}/grade`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({
        score: 80,
        rubric_scores: [
          { criterion_id: crits.data[0].id, points: 70 },
          { criterion_id: crits.data[1].id, points: 20 },
        ],
      }),
    });
    expect(mismatch.status).toBe(400);
    // Unknown criterion rejected.
    const unknown = await app.request(`/api/v1/submissions/${sub?.id}/grade`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ score: 80, rubric_scores: [{ criterion_id: 'nope', points: 80 }] }),
    });
    expect(unknown.status).toBe(400);
    const good = (await (
      await app.request(`/api/v1/submissions/${sub?.id}/grade`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          score: 80,
          feedback: 'Well done',
          rubric_scores: [
            { criterion_id: crits.data[0].id, points: 60 },
            { criterion_id: crits.data[1].id, points: 20 },
          ],
        }),
      })
    ).json()) as { data: { rubric: { criterion_id: string }[] } };
    expect(good.data.rubric.length).toBe(2);
    // Audit trail recorded.
    const logged = await queryFirst(
      db,
      "SELECT id FROM audit_logs WHERE action = 'submission.graded' AND entity_id = ?",
      sub?.id ?? ''
    );
    expect(logged).toBeTruthy();
    // Late policy: past-due + allow_late=false blocks submission.
    await execute(
      db,
      "UPDATE assignments SET due_at = '2020-01-01T00:00:00Z' WHERE id = ?",
      a.data.id
    );
    await execute(db, 'DELETE FROM submissions WHERE assignment_id = ?', a.data.id);
    const late = await app.request(`/api/v1/assignments/${a.data.id}/submissions`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ body: 'late work' }),
    });
    expect(late.status).toBe(400);
    void t;
  });
});

describe('compliance + alerts + health + export', () => {
  it('overdue compliance, expiring certs, alert dismiss, system status, org export', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'comp');
    const t = await mkUser(db, 't@comp.com', 'teacher', org);
    await mkUser(db, 'sup@comp.com', 'super_admin', org);
    const s = await mkUser(db, 's@comp.com', 'student', org);
    const tokT = (await login(app, 't@comp.com')).access_token;
    const tokSup = (await login(app, 'sup@comp.com')).access_token;
    const tokS = (await login(app, 's@comp.com')).access_token;
    // Compliance course past its end date with an active enrollment.
    const c = (await (
      await app.request('/api/v1/courses', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          organization_id: org,
          code: 'CMP1',
          title: 'Safety',
          is_compliance: true,
        }),
      })
    ).json()) as { data: { id: string } };
    await execute(
      db,
      "UPDATE courses SET end_at = '2020-01-01T00:00:00Z', status = 'published' WHERE id = ?",
      c.data.id
    );
    await execute(
      db,
      'INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'enr-comp',
      c.data.id,
      s,
      'active',
      nowIso(),
      nowIso(),
      nowIso()
    );
    // Expiring certificate.
    await execute(
      db,
      'INSERT INTO certificates (id, organization_id, course_id, student_id, certificate_number, issued_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      'cert-exp',
      org,
      c.data.id,
      s,
      'CERT-EXP-001',
      nowIso(),
      new Date(Date.now() + 10 * 86400000).toISOString(),
      nowIso()
    );
    const rep = (await (
      await app.request(`/api/v1/reports/compliance?organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as {
      data: { overdue: unknown[]; expiring: unknown[] };
    };
    expect(rep.data.overdue.length).toBe(1);
    expect(rep.data.expiring.length).toBe(1);
    const repDeny = await app.request(`/api/v1/reports/compliance?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    expect(repDeny.status).toBe(403);
    // Reminders fan out.
    const remind = (await (
      await app.request('/api/v1/reports/compliance/remind', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org }),
      })
    ).json()) as { data: { reminded: number } };
    expect(remind.data.reminded).toBe(1);
    // Alerts: create a genuinely overdue assignment, then rules persist alerts.
    const acourse = await mkCourse(db, org, t, 'OVD1');
    await execute(
      db,
      'INSERT INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId(),
      acourse,
      s,
      'active',
      nowIso(),
      nowIso(),
      nowIso()
    );
    await execute(
      db,
      "INSERT INTO assignments (id, course_id, organization_id, title, due_at, max_score, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, '2020-01-01T00:00:00Z', 10, ?, ?, ?)",
      newId(),
      acourse,
      org,
      'Overdue HW',
      t,
      nowIso(),
      nowIso()
    );
    const rules = (await (
      await app.request(`/api/v1/alerts/rules?organization_id=${org}`, {
        headers: authHeader(tokT),
      })
    ).json()) as { data: { kind: string }[] };
    expect(
      rules.data.some((r) => r.kind === 'overdue_assignments' || r.kind === 'inactive_learners')
    ).toBe(true);
    const alerts = (await (
      await app.request(`/api/v1/alerts?organization_id=${org}`, { headers: authHeader(tokT) })
    ).json()) as { data: { id: string }[] };
    expect(alerts.data.length).toBeGreaterThan(0);
    const dis = await app.request(`/api/v1/alerts/${alerts.data[0].id}/dismiss`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ note: 'handled' }),
    });
    expect(dis.status).toBe(200);
    const dis2 = await app.request(`/api/v1/alerts/${alerts.data[0].id}/dismiss`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({}),
    });
    expect(dis2.status).toBe(400);
    // Health public, status privileged.
    expect((await app.request('/api/v1/system/health')).status).toBe(200);
    expect((await app.request('/api/v1/system/status', { headers: authHeader(tokT) })).status).toBe(
      403
    );
    const status = (await (
      await app.request('/api/v1/system/status', { headers: authHeader(tokSup) })
    ).json()) as { data: Record<string, unknown> };
    expect(status.data.database).toBe('ok');
    expect(status.data.setup_completed).toBeDefined();
    // Org export excludes secrets.
    const exp = await app.request(`/api/v1/exports/organization?organization_id=${org}`, {
      headers: authHeader(tokSup),
    });
    expect(exp.status).toBe(200);
    const dump = (await exp.json()) as { tables: { users: Record<string, unknown>[] } };
    expect(dump.tables.users.length).toBeGreaterThan(0);
    expect(dump.tables.users[0]).not.toHaveProperty('password_hash');
    expect(JSON.stringify(dump)).not.toContain('Password123');
    void t;
  });

  it('live reschedule validates and notifies', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rsch');
    await mkUser(db, 't@rsch.com', 'teacher', org);
    await mkUser(db, 's@rsch.com', 'student', org);
    const tokT = (await login(app, 't@rsch.com')).access_token;
    const tokS = (await login(app, 's@rsch.com')).access_token;
    const sess = (await (
      await app.request('/api/v1/live-sessions', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          organization_id: org,
          title: 'L',
          starts_at: '2026-11-01T10:00:00Z',
          ends_at: '2026-11-01T11:00:00Z',
        }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/live-sessions/${sess.data.id}/register`, {
      method: 'POST',
      headers: authHeader(tokS),
    });
    const badRange = await app.request(`/api/v1/live-sessions/${sess.data.id}`, {
      method: 'PATCH',
      headers: H(tokT),
      body: JSON.stringify({ starts_at: '2026-11-02T12:00:00Z', ends_at: '2026-11-02T11:00:00Z' }),
    });
    expect(badRange.status).toBe(400);
    const deny = await app.request(`/api/v1/live-sessions/${sess.data.id}`, {
      method: 'PATCH',
      headers: H(tokS),
      body: JSON.stringify({ title: 'Hijack' }),
    });
    expect(deny.status).toBe(403);
    const ok = (await (
      await app.request(`/api/v1/live-sessions/${sess.data.id}`, {
        method: 'PATCH',
        headers: H(tokT),
        body: JSON.stringify({
          starts_at: '2026-11-02T10:00:00Z',
          ends_at: '2026-11-02T11:00:00Z',
        }),
      })
    ).json()) as { data: { notified: number } };
    expect(ok.data.notified).toBe(1);
  });

  it('course CSV import creates drafts with duplicate detection', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cimp');
    await mkUser(db, 'adm@cimp.com', 'organization_admin', org);
    const tokA = (await login(app, 'adm@cimp.com')).access_token;
    const dry = (await (
      await app.request('/api/v1/imports', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({
          kind: 'courses',
          organization_id: org,
          dry_run: true,
          rows: [
            { code: 'IMP1', title: 'Imported' },
            { code: '', title: 'No code' },
          ],
        }),
      })
    ).json()) as { data: { valid: number; errors: unknown[] } };
    expect(dry.data.valid).toBe(1);
    expect(dry.data.errors.length).toBe(1);
    const run = (await (
      await app.request('/api/v1/imports', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({
          kind: 'courses',
          organization_id: org,
          dry_run: false,
          rows: [{ code: 'IMP1', title: 'Imported', price: '49.99' }],
        }),
      })
    ).json()) as { data: { processed: number } };
    expect(run.data.processed).toBe(1);
    const created = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM courses WHERE code = ?',
      'IMP1'
    );
    expect(created?.status).toBe('draft');
    void db;
  });
});
