// In-worker maintenance jobs, driven by the Cloudflare Workers Cron Trigger
// (`scheduled` handler in src/index.ts). Each job mirrors the semantics of its
// audited HTTP endpoint so manual/hosted execution stay interchangeable:
//
//   POST /courses/publish-due   → runScheduledPublishing (per-org)
//   POST /ai/retention/purge    → runAiRetentionPurge   (per-org)
//   POST /ai/usage/reset        → runAiQuotaReset       (per-org)
//   POST /subscriptions/renew-due → runSubscriptionMaintenance (global)
//   POST /xapi/retention/purge  → runXapiRetentionPurge (opt-in per-org)
//
// System-run executions write audit rows with a NULL actor (`sys.cron.*`),
// are idempotent, and never delete anything outside the documented policy:
// AI conversations/messages honor the per-org retention_days window
// (default 30), quotas are only zeroed on the monthly schedule, and courses
// are published only when publish_at arrived and no approval is pending.
import { execute, queryAll, queryFirst, type D1Like } from './db.js';
import { newId, nowIso } from '@lms/shared';
import { snapshotCourse } from './routes/authoring.js';

export const CRON_DAILY = '0 17 * * *'; // 00:00 Asia/Jakarta every day
export const CRON_MONTHLY = '0 17 1 * *'; // 00:00 Asia/Jakarta on the 1st

async function systemAudit(
  db: D1Like,
  action: string,
  organizationId: string | null,
  metadata: Record<string, unknown>,
  t0?: number
): Promise<void> {
  const stamped = t0 === undefined ? metadata : { ...metadata, duration_ms: Date.now() - t0 };
  await execute(
    db,
    'INSERT INTO audit_logs (id, actor_id, organization_id, action, entity, entity_id, metadata, ip, created_at) VALUES (?, NULL, ?, ?, NULL, NULL, ?, NULL, ?)',
    newId(),
    organizationId,
    action,
    JSON.stringify(stamped).slice(0, 2000),
    nowIso()
  );
}

export interface AiRetentionResult {
  messages: number;
  conversations: number;
  orgs: number;
}

// Retention purge across all organizations. Orgs without an ai_configs row
// use the documented default window (30 days), matching the HTTP endpoint.
export async function runAiRetentionPurge(db: D1Like): Promise<AiRetentionResult> {
  const t0 = Date.now();
  const daysByOrg = new Map<string, number>();
  for (const row of await queryAll<{ organization_id: string; retention_days: number | null }>(
    db,
    'SELECT organization_id, retention_days FROM ai_configs'
  )) {
    daysByOrg.set(row.organization_id, Math.max(1, row.retention_days ?? 30));
  }
  let messages = 0;
  let conversations = 0;
  let orgs = 0;
  for (const { organization_id } of await queryAll<{ organization_id: string }>(
    db,
    'SELECT DISTINCT organization_id FROM ai_conversations'
  )) {
    const days = daysByOrg.get(organization_id) ?? 30;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const msgs = await execute(
      db,
      'DELETE FROM ai_messages WHERE created_at < ? AND conversation_id IN (SELECT id FROM ai_conversations WHERE organization_id = ?)',
      cutoff,
      organization_id
    );
    const convs = await execute(
      db,
      'DELETE FROM ai_conversations WHERE organization_id = ? AND updated_at < ? AND id NOT IN (SELECT conversation_id FROM ai_messages)',
      organization_id,
      cutoff
    );
    if (msgs.changes > 0 || convs.changes > 0) {
      orgs += 1;
      messages += msgs.changes;
      conversations += convs.changes;
      await systemAudit(
        db,
        'sys.cron.ai_retention_purge',
        organization_id,
        {
          messages: msgs.changes,
          conversations: convs.changes,
          days,
        },
        t0
      );
    }
  }
  return { messages, conversations, orgs };
}

export interface AiQuotaResetResult {
  orgs: number;
  beforeTotal: number;
}

// Zeroes `used_count` for every configured org. Orgs already at 0 are
// skipped (no audit noise); re-running is harmless.
export async function runAiQuotaReset(db: D1Like): Promise<AiQuotaResetResult> {
  const t0 = Date.now();
  let orgs = 0;
  let beforeTotal = 0;
  for (const row of await queryAll<{ organization_id: string; used_count: number }>(
    db,
    'SELECT organization_id, used_count FROM ai_configs WHERE used_count > 0'
  )) {
    beforeTotal += row.used_count ?? 0;
    await execute(
      db,
      'UPDATE ai_configs SET used_count = 0 WHERE organization_id = ?',
      row.organization_id
    );
    orgs += 1;
    await systemAudit(
      db,
      'sys.cron.ai_quota_reset',
      row.organization_id,
      {
        before: row.used_count ?? 0,
      },
      t0
    );
  }
  return { orgs, beforeTotal };
}

export interface PublishDueResult {
  published: number;
  skippedApprovals: number;
}

// Global version of POST /courses/publish-due: publishes every draft course
// whose publish_at has arrived — approval-workflow courses are skipped, not
// force-published. Version snapshot actor is the course creator (may be NULL).
export async function runScheduledPublishing(db: D1Like): Promise<PublishDueResult> {
  const t0 = Date.now();
  const now = nowIso();
  const due = await queryAll<{ id: string; organization_id: string; created_by: string | null }>(
    db,
    "SELECT id, organization_id, created_by FROM courses WHERE status = 'draft' AND publish_at IS NOT NULL AND publish_at <= ? AND deleted_at IS NULL",
    now
  );
  let published = 0;
  let skippedApprovals = 0;
  for (const course of due) {
    const pending = await queryFirst(
      db,
      "SELECT id FROM publish_approvals WHERE course_id = ? AND status = 'pending'",
      course.id
    );
    if (pending) {
      // Approval workflow takes precedence; the admin approve endpoint will
      // publish it (the publish_at gate does not bypass review).
      skippedApprovals += 1;
      continue;
    }
    await execute(
      db,
      "UPDATE courses SET status = 'published', updated_at = ? WHERE id = ?",
      now,
      course.id
    );
    await snapshotCourse(db, course.id, course.created_by);
    published += 1;
    await systemAudit(
      db,
      'sys.cron.publish_due',
      course.organization_id,
      {
        published: [course.id],
      },
      t0
    );
  }
  return { published, skippedApprovals };
}

export interface QuizCopyPurgeResult {
  copies: number;
  answers: number;
}

// Storage hygiene for pooled quizzes: attempt-scoped question copies are
// inserted per attempt (migration 024) and accumulate until removed. Deletes
// ONLY copies attached to a finished attempt (status != 'in_progress',
// submitted_at past the window) of the given org, plus their answer rows.
// Template questions (`attempt_id IS NULL`) and active attempts are never
// touched. Callers decide the window: the daily cron uses the opt-in per-org
// setting (`organizations.settings.quiz_copy_retention_days`, no value = no
// purge), the HTTP endpoint accepts an explicit bounded `days`.
export async function purgeQuizCopiesForOrg(
  db: D1Like,
  orgId: string,
  days: number
): Promise<QuizCopyPurgeResult> {
  const cutoff = new Date(Date.now() - Math.max(1, Math.floor(days)) * 86400000).toISOString();
  const answers = await execute(
    db,
    `DELETE FROM quiz_answers WHERE question_id IN (
       SELECT q.id FROM questions q
       WHERE q.attempt_id IS NOT NULL
         AND q.quiz_id IN (SELECT id FROM quizzes WHERE organization_id = ?)
         AND q.attempt_id IN (
           SELECT id FROM quiz_attempts WHERE status != 'in_progress'
             AND submitted_at IS NOT NULL AND submitted_at < ?))`,
    orgId,
    cutoff
  );
  const copies = await execute(
    db,
    `DELETE FROM questions WHERE attempt_id IS NOT NULL
       AND quiz_id IN (SELECT id FROM quizzes WHERE organization_id = ?)
       AND attempt_id IN (
         SELECT id FROM quiz_attempts WHERE status != 'in_progress'
           AND submitted_at IS NOT NULL AND submitted_at < ?)`,
    orgId,
    cutoff
  );
  return { copies: copies.changes, answers: answers.changes };
}

export interface SubscriptionMaintenanceResult {
  renewed: number;
  pastDue: number;
  expired: number;
}

// Subscription lifecycle: free plans auto-renew by extending the period,
// paid plans past their period end move to past_due (provider charges).
// Cancelled/expired rows are never touched. Idempotent by construction.
export async function runSubscriptionMaintenance(
  db: D1Like
): Promise<SubscriptionMaintenanceResult> {
  const t0 = Date.now();
  const now = nowIso();
  const due = await queryAll<{
    id: string;
    plan_id: string;
    buyer_id: string;
    interval: string;
    price_minor: number | null;
  }>(
    db,
    `SELECT s.id, s.plan_id, s.buyer_id, p.interval, COALESCE(p.price_minor, 0) as price_minor
     FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.status = 'active' AND s.current_period_end IS NOT NULL AND s.current_period_end <= ?`,
    now
  );
  let renewed = 0;
  let pastDue = 0;
  for (const row of due) {
    if ((row.price_minor ?? 0) === 0) {
      const days = row.interval === 'yearly' ? 365 : 30;
      const next = new Date(Date.now() + days * 86400000).toISOString();
      const res = await execute(
        db,
        "UPDATE subscriptions SET current_period_end = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        next,
        now,
        row.id
      );
      if (res.changes > 0) {
        renewed += 1;
        const plan = await queryFirst<{ organization_id: string }>(
          db,
          'SELECT organization_id FROM subscription_plans WHERE id = ?',
          row.plan_id
        );
        if (plan)
          await systemAudit(
            db,
            'sys.cron.subscription_renew',
            plan.organization_id,
            {
              subscription: row.id,
              next_period_end: next,
            },
            t0
          );
      }
    } else {
      const res = await execute(
        db,
        "UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE id = ? AND status = 'active'",
        now,
        row.id
      );
      if (res.changes > 0) {
        pastDue += 1;
        const plan = await queryFirst<{ organization_id: string }>(
          db,
          'SELECT organization_id FROM subscription_plans WHERE id = ?',
          row.plan_id
        );
        if (plan)
          await systemAudit(
            db,
            'sys.cron.subscription_past_due',
            plan.organization_id,
            {
              subscription: row.id,
            },
            t0
          );
      }
    }
  }
  return { renewed, pastDue, expired: 0 };
}

export interface XapiPurgeResult {
  orgs: number;
  deleted: number;
}

// Opt-in xAPI retention: orgs set organizations.settings.xapi_retention_days.
// No setting = never purge (same policy shape as quiz-copy retention).
export async function runXapiRetentionPurge(db: D1Like): Promise<XapiPurgeResult> {
  const t0 = Date.now();
  let orgs = 0;
  let deleted = 0;
  for (const org of await queryAll<{ id: string; settings: string | null }>(
    db,
    'SELECT id, settings FROM organizations'
  )) {
    let raw: Record<string, unknown> = {};
    try {
      raw = (JSON.parse(org.settings ?? '{}') ?? {}) as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const days = Number(raw['xapi_retention_days']);
    if (!Number.isFinite(days) || days <= 0) continue;
    const cutoff = new Date(Date.now() - Math.floor(days) * 86400000).toISOString();
    const res = await execute(
      db,
      'DELETE FROM xapi_statements WHERE organization_id = ? AND stored_at < ?',
      org.id,
      cutoff
    );
    if (res.changes > 0) {
      orgs += 1;
      deleted += res.changes;
      await systemAudit(
        db,
        'sys.cron.xapi_retention_purge',
        org.id,
        {
          deleted: res.changes,
          days,
        },
        t0
      );
    }
  }
  return { orgs, deleted };
}

export interface QuizCopyPurgeAllResult extends QuizCopyPurgeResult {
  orgs: number;
}

export interface RetentionResult {
  deleted: number;
}

async function globalSetting(db: D1Like, key: string): Promise<string> {
  const row = await queryFirst<{ value: string }>(
    db,
    'SELECT value FROM settings WHERE key = ?',
    key
  );
  return row?.value ?? '';
}

// Retention sweeps for unbounded tables. All are opt-in via global settings
// (no value = never purge), except idempotency keys which have a fixed 7-day
// window (replays past a week are re-executions, never silent duplicates).
// Audit purges keep nothing back: cron-status observability reads the same
// rows, so orgs choose the window consciously (default off).
export async function purgeAuditLogs(db: D1Like, days: number): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - Math.max(1, Math.floor(days)) * 86400000).toISOString();
  const res = await execute(db, 'DELETE FROM audit_logs WHERE created_at < ?', cutoff);
  return { deleted: res.changes };
}

export async function purgeNotifications(db: D1Like, days: number): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - Math.max(1, Math.floor(days)) * 86400000).toISOString();
  // Unread notifications are never purged: retention applies to read rows only.
  const res = await execute(
    db,
    'DELETE FROM notifications WHERE is_read = 1 AND created_at < ?',
    cutoff
  );
  return { deleted: res.changes };
}

export async function purgeEmailQueue(db: D1Like, days: number): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - Math.max(1, Math.floor(days)) * 86400000).toISOString();
  // Terminal rows only (sent/failed); queued/sending rows are never touched.
  const res = await execute(
    db,
    "DELETE FROM email_queue WHERE status IN ('sent', 'failed') AND updated_at < ?",
    cutoff
  );
  return { deleted: res.changes };
}

export async function purgeIdempotencyKeys(db: D1Like): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const res = await execute(db, 'DELETE FROM idempotency_keys WHERE created_at < ?', cutoff);
  return { deleted: res.changes };
}

export interface StorageRetentionAllResult {
  audit: number;
  notifications: number;
  email: number;
  idempotency: number;
}

// Daily-cron entrypoint: purges per the opt-in global settings.
export async function runStorageRetention(db: D1Like): Promise<StorageRetentionAllResult> {
  const t0 = Date.now();
  const out = { audit: 0, notifications: 0, email: 0, idempotency: 0 };
  const policies: [
    string,
    (d: D1Like, days: number) => Promise<RetentionResult>,
    keyof StorageRetentionAllResult,
  ][] = [
    ['audit_log_retention_days', purgeAuditLogs, 'audit'],
    ['notification_retention_days', purgeNotifications, 'notifications'],
    ['email_retention_days', purgeEmailQueue, 'email'],
  ];
  for (const [key, fn, field] of policies) {
    const days = Number(await globalSetting(db, key));
    if (!Number.isFinite(days) || days <= 0) continue;
    const res = await fn(db, days);
    out[field] = res.deleted;
  }
  out.idempotency = (await purgeIdempotencyKeys(db)).deleted;
  if (out.audit + out.notifications + out.email + out.idempotency > 0) {
    await systemAudit(db, 'sys.cron.storage_retention', null, { ...out }, t0);
  }
  return out;
}

// Daily-cron entrypoint: purges per org only when the opt-in policy exists.
export async function runQuizCopyPurge(db: D1Like): Promise<QuizCopyPurgeAllResult> {
  const t0 = Date.now();
  let orgs = 0;
  let copies = 0;
  let answers = 0;
  for (const org of await queryAll<{ id: string; settings: string | null }>(
    db,
    'SELECT id, settings FROM organizations'
  )) {
    let raw: Record<string, unknown> = {};
    try {
      raw = (JSON.parse(org.settings ?? '{}') ?? {}) as Record<string, unknown>;
    } catch {
      raw = {}; // invalid settings JSON → treated as no policy, never a purge
    }
    const days = Number(raw['quiz_copy_retention_days']);
    if (!Number.isFinite(days) || days <= 0) continue; // opt-in only
    const res = await purgeQuizCopiesForOrg(db, org.id, days);
    if (res.copies > 0) {
      orgs += 1;
      copies += res.copies;
      answers += res.answers;
      await systemAudit(
        db,
        'sys.cron.quiz_copy_purge',
        org.id,
        {
          copies: res.copies,
          answers: res.answers,
          days,
        },
        t0
      );
    }
  }
  return { orgs, copies, answers };
}
