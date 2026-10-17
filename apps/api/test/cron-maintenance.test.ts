import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst, type D1Like } from '../src/db.js';
import { setup, mkOrg, mkUser, mkCourse } from './helpers.js';

const DAILY = '0 17 * * *'; // must match maintenance.ts CRON_DAILY
const MONTHLY = '0 17 1 * *'; // must match maintenance.ts CRON_MONTHLY

async function setDraftPublishAt(db: D1Like, courseId: string, iso: string) {
  await execute(
    db,
    'UPDATE courses SET status = ?, publish_at = ? WHERE id = ?',
    'draft',
    iso,
    courseId
  );
}

async function conv(db: D1Like, orgId: string, userId: string, ageDays: number | null) {
  const id = newId();
  const ts = ageDays === null ? nowIso() : new Date(Date.now() - ageDays * 86400000).toISOString();
  await execute(
    db,
    'INSERT INTO ai_conversations (id, organization_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    id,
    orgId,
    userId,
    ts,
    ts
  );
  await execute(
    db,
    'INSERT INTO ai_messages (id, conversation_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    id,
    'user',
    'hello',
    ts
  );
  return id;
}

const usedCount = (db: D1Like, org: string) =>
  queryFirst<{ used_count: number }>(
    db,
    'SELECT used_count FROM ai_configs WHERE organization_id = ?',
    org
  ).then((r) => r?.used_count ?? null);

describe('native maintenance scheduler (Worker scheduled handler)', () => {
  it('AI retention purge honors per-org config and the 30-day default, keeps fresh rows, audits', async () => {
    const { db } = await setup();
    const orgA = await mkOrg(db, 'cron-a');
    const orgB = await mkOrg(db, 'cron-b');
    const sA = await mkUser(db, 'sa@cron.test', 'student', orgA);
    const sB = await mkUser(db, 'sb@cron.test', 'student', orgB);
    // Org A: explicit 7-day window.
    await execute(
      db,
      'INSERT INTO ai_configs (organization_id, provider, monthly_limit, used_count, retention_days, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      orgA,
      'mock',
      10,
      0,
      7,
      nowIso()
    );
    await conv(db, orgA, sA, 15); // expired by A's window
    const freshA = await conv(db, orgA, sA, null);
    await conv(db, orgB, sB, 90); // expired by default window (no config)
    const freshB = await conv(db, orgB, sB, 2);

    await worker.scheduled({ cron: DAILY, scheduledTime: Date.now() }, { DB: db });

    const leftoverA = await queryAll<{ id: string }>(
      db,
      'SELECT id FROM ai_conversations WHERE organization_id = ?',
      orgA
    );
    const leftoverB = await queryAll<{ id: string }>(
      db,
      'SELECT id FROM ai_conversations WHERE organization_id = ?',
      orgB
    );
    expect(leftoverA.map((r) => r.id)).toEqual([freshA]);
    expect(leftoverB.map((r) => r.id)).toEqual([freshB]);
    const audits = await queryAll<{ action: string; organization_id: string }>(
      db,
      "SELECT action, organization_id FROM audit_logs WHERE action = 'sys.cron.ai_retention_purge' ORDER BY organization_id"
    );
    expect(audits.map((a) => a.organization_id).sort()).toEqual([orgA, orgB].sort());
  });

  it('publishes due drafts, skips pending approvals and future dates, snapshots with creator, idempotent', async () => {
    const { db } = await setup();
    const org = await mkOrg(db, 'cron-pub');
    const t = await mkUser(db, 't@cron-pub.test', 'teacher', org);
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const due = await mkCourse(db, org, t, 'CDUE');
    const later = await mkCourse(db, org, t, 'CLATER');
    const gated = await mkCourse(db, org, t, 'CGATED');
    await setDraftPublishAt(db, due, past);
    await setDraftPublishAt(db, later, future);
    await setDraftPublishAt(db, gated, past);
    await execute(
      db,
      'INSERT INTO publish_approvals (id, organization_id, course_id, requested_by, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      org,
      gated,
      t,
      nowIso()
    );

    await worker.scheduled({ cron: DAILY, scheduledTime: Date.now() }, { DB: db });

    const status = (id: string) =>
      queryFirst<{ status: string }>(db, 'SELECT status FROM courses WHERE id = ?', id).then(
        (r) => r?.status ?? 'missing'
      );
    expect(await status(due)).toBe('published');
    expect(await status(later)).toBe('draft');
    expect(await status(gated)).toBe('draft'); // approval workflow takes precedence
    const versions = await queryAll<{ created_by: string | null }>(
      db,
      'SELECT created_by FROM course_versions WHERE course_id = ?',
      due
    );
    expect(versions.length).toBe(1);
    expect(versions[0].created_by).toBe(t);

    // Idempotent: a second daily run finds nothing to do — no re-snapshot.
    await worker.scheduled({ cron: DAILY }, { DB: db });
    expect(await status(due)).toBe('published');
    const versions2 = await queryAll<{ id: string }>(
      db,
      'SELECT id FROM course_versions WHERE course_id = ?',
      due
    );
    expect(versions2.length).toBe(1);
  });

  it('resets AI quota only on the monthly schedule; zeroed orgs are not re-audited', async () => {
    const { db } = await setup();
    const org = await mkOrg(db, 'cron-quota');
    await execute(
      db,
      'INSERT INTO ai_configs (organization_id, provider, monthly_limit, used_count, retention_days, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      org,
      'mock',
      10,
      3,
      30,
      nowIso()
    );
    await worker.scheduled({ cron: DAILY, scheduledTime: Date.now() }, { DB: db });
    expect(await usedCount(db, org)).toBe(3); // daily run leaves usage alone
    await worker.scheduled({ cron: MONTHLY, scheduledTime: Date.now() }, { DB: db });
    expect(await usedCount(db, org)).toBe(0);
    await worker.scheduled({ cron: MONTHLY, scheduledTime: Date.now() }, { DB: db });
    expect(await usedCount(db, org)).toBe(0);
    const audits = await queryAll<{ action: string }>(
      db,
      "SELECT action FROM audit_logs WHERE action = 'sys.cron.ai_quota_reset'"
    );
    expect(audits.length).toBe(1); // second monthly run skips (already zero)
  });

  it('respects the CRON_DISABLED kill switch', async () => {
    const { db } = await setup();
    const org = await mkOrg(db, 'cron-off');
    const t = await mkUser(db, 'off@cron.test', 'teacher', org);
    const due = await mkCourse(db, org, t, 'COFF');
    await setDraftPublishAt(db, due, new Date(Date.now() - 86400000).toISOString());
    await worker.scheduled(
      { cron: DAILY, scheduledTime: Date.now() },
      { DB: db, CRON_DISABLED: '1' }
    );
    const status = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM courses WHERE id = ?',
      due
    );
    expect(status?.status).toBe('draft');
    const audits = await queryAll<{ action: string }>(
      db,
      "SELECT action FROM audit_logs WHERE action LIKE 'sys.cron.%'"
    );
    expect(audits).toEqual([]);
  });

  it('throws when the DB binding is missing (cron surfaces failure)', async () => {
    await expect(worker.scheduled({ cron: DAILY }, {})).rejects.toThrow(/DB binding/);
  });
});
