import { Hono } from 'hono';
import { liveSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { canTeach, wantsNotification } from '../access.js';
import type { AppVars, AuthUser } from '../types.js';
import { t } from '../i18n.js';

const live = new Hono<{ Variables: AppVars }>();

function meetingLink(provider: string, sessionId: string, custom?: string | null): string {
  if (provider === 'custom' && custom) return custom;
  if (provider === 'jitsi') return `https://meet.jit.si/lms-${sessionId.slice(0, 8)}`;
  // meet/zoom require host-created links: never invent them.
  if (custom) return custom;
  return '';
}

live.post('/live-sessions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = liveSchema.safeParse(body);
  if (!parsed.success)
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      t('validation_failed', c.get('lang')),
      parsed.error.flatten()
    );
  if (!canTeach(user, parsed.data.organization_id))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (new Date(parsed.data.ends_at).getTime() <= new Date(parsed.data.starts_at).getTime()) {
    return fail(c, 400, 'VALIDATION_ERROR', 'ends_at must be after starts_at');
  }
  const provider = parsed.data.provider ?? 'jitsi';
  if ((provider === 'meet' || provider === 'zoom') && !parsed.data.meeting_url) {
    return fail(
      c,
      400,
      'VALIDATION_ERROR',
      `${provider} requires a host-created meeting_url (OAuth provisioning is customer-configured)`
    );
  }
  const nid = newId();
  const now = nowIso();
  await execute(
    c.get('db'),
    'INSERT INTO live_sessions (id, organization_id, course_id, cohort_id, title, description, provider, meeting_url, starts_at, ends_at, timezone, capacity, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid,
    parsed.data.organization_id,
    parsed.data.course_id ?? null,
    parsed.data.cohort_id ?? null,
    parsed.data.title,
    parsed.data.description ?? null,
    provider,
    parsed.data.meeting_url ?? meetingLink(provider, nid),
    parsed.data.starts_at,
    parsed.data.ends_at,
    parsed.data.timezone ?? 'Asia/Jakarta',
    parsed.data.capacity ?? null,
    'scheduled',
    user.id,
    now,
    now
  );
  await audit(c, 'live.created', {
    entity: 'live_session',
    entityId: nid,
    organizationId: parsed.data.organization_id,
  });
  return created(c, {
    id: nid,
    meeting_url: parsed.data.meeting_url ?? meetingLink(provider, nid),
  });
});

live.get('/live-sessions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const orgId = url.searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const upcoming = url.searchParams.get('upcoming') === '1';
  const rows = await queryAll(
    c.get('db'),
    `SELECT * FROM live_sessions WHERE organization_id = ? ${upcoming ? "AND starts_at >= ? AND status = 'scheduled'" : ''} ORDER BY starts_at ASC, id ASC LIMIT 200`,
    ...(upcoming ? [orgId, nowIso()] : [orgId])
  );
  // Students only see sessions for courses/cohorts they belong to.
  const role = orgRole(user, orgId);
  if (role === 'student' || role === 'parent') {
    const courseIds = (
      await queryAll<{ course_id: string }>(
        c.get('db'),
        'SELECT course_id FROM enrollments WHERE student_id = ?',
        user.id
      )
    ).map((e) => e.course_id);
    const cohortIds = (
      await queryAll<{ cohort_id: string }>(
        c.get('db'),
        'SELECT cohort_id FROM cohort_members WHERE user_id = ?',
        user.id
      )
    ).map((e) => e.cohort_id);
    return ok(
      c,
      (rows as { course_id: string | null; cohort_id: string | null }[]).filter(
        (s) =>
          (s.course_id && courseIds.includes(s.course_id)) ||
          (s.cohort_id && cohortIds.includes(s.cohort_id)) ||
          (!s.course_id && !s.cohort_id)
      )
    );
  }
  return ok(c, rows);
});

live.post('/live-sessions/:id/register', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sess = await queryFirst<{
    organization_id: string;
    capacity: number | null;
    status: string;
  }>(
    db,
    'SELECT organization_id, capacity, status FROM live_sessions WHERE id = ?',
    c.req.param('id')
  );
  if (!sess) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, sess.organization_id))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  if (sess.status === 'cancelled')
    return fail(c, 400, 'SESSION_CANCELLED', 'This session was cancelled');
  if (sess.capacity) {
    const count =
      (
        await queryFirst<{ n: number }>(
          db,
          "SELECT COUNT(*) as n FROM live_registrations WHERE session_id = ? AND status = 'registered'",
          c.req.param('id')
        )
      )?.n ?? 0;
    const already = await queryFirst(
      db,
      'SELECT id FROM live_registrations WHERE session_id = ? AND user_id = ?',
      c.req.param('id'),
      user.id
    );
    if (!already && count >= sess.capacity) return fail(c, 400, 'SESSION_FULL', 'Session is full');
  }
  await execute(
    db,
    'INSERT INTO live_registrations (id, session_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id, user_id) DO UPDATE SET status = ?',
    newId(),
    c.req.param('id'),
    user.id,
    nowIso(),
    'registered'
  );
  return created(c, { registered: true });
});

live.patch('/live-sessions/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sess = await queryFirst<{ organization_id: string; status: string }>(
    db,
    'SELECT organization_id, status FROM live_sessions WHERE id = ?',
    c.req.param('id')
  );
  if (!sess || !canTeach(user, sess.organization_id))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (sess.status === 'cancelled')
    return fail(c, 400, 'VALIDATION_ERROR', 'Cannot reschedule a cancelled session');
  const body = (await c.req.json().catch(() => null)) as {
    title?: string;
    starts_at?: string;
    ends_at?: string;
    meeting_url?: string;
    capacity?: number;
  } | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (typeof body.title === 'string' && body.title.length >= 1 && body.title.length <= 200) {
    sets.push('title = ?');
    params.push(body.title);
  }
  if (typeof body.starts_at === 'string' && body.starts_at) {
    sets.push('starts_at = ?');
    params.push(body.starts_at);
  }
  if (typeof body.ends_at === 'string' && body.ends_at) {
    sets.push('ends_at = ?');
    params.push(body.ends_at);
  }
  if (
    typeof body.meeting_url === 'string' &&
    body.meeting_url.length <= 2000 &&
    (body.meeting_url === '' || /^https?:\/\//i.test(body.meeting_url))
  ) {
    sets.push('meeting_url = ?');
    params.push(body.meeting_url || null);
  }
  if (typeof body.capacity === 'number' && Number.isInteger(body.capacity) && body.capacity >= 1) {
    sets.push('capacity = ?');
    params.push(body.capacity);
  }
  if (!sets.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const row = await queryFirst<{ starts_at: string; ends_at: string }>(
    db,
    'SELECT starts_at, ends_at FROM live_sessions WHERE id = ?',
    c.req.param('id')
  );
  const start = (body.starts_at ?? row?.starts_at ?? '') as string;
  const end = (body.ends_at ?? row?.ends_at ?? '') as string;
  if (new Date(end).getTime() <= new Date(start).getTime())
    return fail(c, 400, 'VALIDATION_ERROR', 'ends_at must be after starts_at');
  sets.push('updated_at = ?');
  params.push(nowIso(), c.req.param('id'));
  await execute(db, `UPDATE live_sessions SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const regs = await queryAll<{ user_id: string }>(
    db,
    'SELECT user_id FROM live_registrations WHERE session_id = ?',
    c.req.param('id')
  );
  let notified = 0;
  for (const reg of regs) {
    if (!(await wantsNotification(db, reg.user_id, 'system'))) continue;
    await execute(
      db,
      'INSERT INTO notifications (id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      reg.user_id,
      'Live session rescheduled',
      `New time: ${start}`.slice(0, 1000),
      nowIso()
    );
    notified++;
  }
  await audit(c, 'live.rescheduled', {
    entity: 'live_session',
    entityId: c.req.param('id'),
    organizationId: sess.organization_id,
  });
  return ok(c, { rescheduled: true, notified });
});

live.post('/live-sessions/:id/cancel', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sess = await queryFirst<{ organization_id: string; created_by: string | null }>(
    db,
    'SELECT organization_id, created_by FROM live_sessions WHERE id = ?',
    c.req.param('id')
  );
  if (!sess || !canTeach(user, sess.organization_id))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  await execute(
    db,
    "UPDATE live_sessions SET status = 'cancelled', updated_at = ? WHERE id = ?",
    nowIso(),
    c.req.param('id')
  );
  // Notify registrants through the notification center.
  const regs = await queryAll<{ user_id: string; title: string }>(
    db,
    'SELECT r.user_id, s.title FROM live_registrations r JOIN live_sessions s ON s.id = r.session_id WHERE r.session_id = ? LIMIT 1000',
    c.req.param('id')
  );
  for (const reg of regs) {
    if (!(await wantsNotification(db, reg.user_id, 'system'))) continue;
    await execute(
      db,
      'INSERT INTO notifications (id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      reg.user_id,
      'Live session cancelled',
      `Cancelled: ${reg.title}`.slice(0, 1000),
      nowIso()
    );
  }
  await audit(c, 'live.cancelled', {
    entity: 'live_session',
    entityId: c.req.param('id'),
    organizationId: sess.organization_id,
  });
  return ok(c, { cancelled: true, notified: regs.length });
});

live.post('/live-sessions/:id/attendance', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const sess = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM live_sessions WHERE id = ?',
    c.req.param('id')
  );
  if (!sess || !canTeach(user, sess.organization_id))
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { user_ids?: string[] } | null;
  if (!body?.user_ids || !Array.isArray(body.user_ids) || body.user_ids.length > 1000) {
    return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  }
  const ids = body.user_ids.filter((x) => typeof x === 'string');
  if (!ids.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  // Validate attendees belong to the org (no silent FK failures, no cross-org writes).
  const placeholders = ids.map(() => '?').join(',');
  const members = await queryAll<{ user_id: string }>(
    db,
    `SELECT user_id FROM organization_members WHERE organization_id = ? AND user_id IN (${placeholders})`,
    sess.organization_id,
    ...ids
  );
  const valid = new Set(members.map((m) => m.user_id));
  const invalid = ids.filter((id) => !valid.has(id));
  if (invalid.length)
    return fail(c, 400, 'VALIDATION_ERROR', 'Unknown attendees for this organization', {
      invalid: invalid.slice(0, 20),
    });
  const now = nowIso();
  for (const uid of ids) {
    await execute(
      db,
      'INSERT INTO live_attendance (id, session_id, user_id, joined_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id, user_id) DO UPDATE SET joined_at = excluded.joined_at',
      newId(),
      c.req.param('id'),
      uid,
      now,
      now
    );
  }
  return created(c, { recorded: ids.length });
});

// Calendar export (ICS) for upcoming org sessions.
live.get('/live-sessions.ics', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId))
    return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll<{
    title: string;
    description: string | null;
    starts_at: string;
    ends_at: string;
    meeting_url: string | null;
  }>(
    c.get('db'),
    "SELECT title, description, starts_at, ends_at, meeting_url FROM live_sessions WHERE organization_id = ? AND status = 'scheduled' ORDER BY starts_at ASC, id ASC LIMIT 200",
    orgId
  );
  const esc = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
      .slice(0, 500);
  const stamp = (iso: string) => {
    try {
      return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    } catch {
      return '';
    }
  };
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LMS Headless//Live//EN',
    ...rows.flatMap((s, i) => [
      'BEGIN:VEVENT',
      `UID:live-${i}-${Date.now()}@lms`,
      `DTSTAMP:${stamp(nowIso())}`,
      `DTSTART:${stamp(s.starts_at)}`,
      `DTEND:${stamp(s.ends_at)}`,
      `SUMMARY:${esc(s.title)}`,
      `DESCRIPTION:${esc((s.description ?? '') + (s.meeting_url ? `\nJoin: ${s.meeting_url}` : ''))}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');
  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="live-sessions.ics"');
  return c.body(ics, 200);
});

export default live;
