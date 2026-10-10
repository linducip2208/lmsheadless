import { queryFirst } from './db.js';
import type { D1Like } from './db.js';
import { orgRole } from './middleware/common.js';
import type { AuthUser } from './types.js';

export async function orgSetting(db: D1Like, orgId: string, key: string): Promise<string> {
  const org = await queryFirst<{ settings: string | null }>(
    db,
    'SELECT settings FROM organizations WHERE id = ?',
    orgId
  );
  try {
    const parsed = JSON.parse(org?.settings ?? '{}') as Record<string, string>;
    return parsed[key] ?? '';
  } catch {
    return '';
  }
}

export async function courseOrg(db: D1Like, courseId: string): Promise<string | null> {
  const row = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM courses WHERE id = ? AND deleted_at IS NULL',
    courseId
  );
  return row?.organization_id ?? null;
}

export async function quizOrg(db: D1Like, quizId: string): Promise<string | null> {
  const r = await queryFirst<{ organization_id: string }>(
    db,
    'SELECT organization_id FROM quizzes WHERE id = ?',
    quizId
  );
  return r?.organization_id ?? null;
}

export function canTeach(user: AuthUser, orgId: string): boolean {
  const r = orgRole(user, orgId);
  return r === 'super_admin' || r === 'organization_admin' || r === 'teacher' || r === 'staff';
}

export function isPrivileged(user: AuthUser, orgId: string): boolean {
  const r = orgRole(user, orgId);
  return r === 'super_admin' || r === 'organization_admin';
}

// Notification preference gate: producers must consult this before writing to
// the notification center (fail-open to the documented defaults on bad rows).
export async function wantsNotification(
  db: D1Like,
  userId: string,
  category: string
): Promise<boolean> {
  try {
    const row = await queryFirst<{ prefs: string }>(
      db,
      'SELECT prefs FROM notification_preferences WHERE user_id = ?',
      userId
    );
    if (!row) return true;
    const prefs = JSON.parse(row.prefs) as Record<string, boolean>;
    return prefs[category] !== false;
  } catch {
    return true;
  }
}

// Entitlement: paid courses require a live entitlement row; free courses are open.
export async function hasEntitlement(
  db: D1Like,
  userId: string,
  courseId: string,
  coursePrice: number
): Promise<boolean> {
  if (coursePrice <= 0) return true;
  const row = await queryFirst<{ expires_at: string | null }>(
    db,
    'SELECT expires_at FROM entitlements WHERE user_id = ? AND kind = ? AND reference_id = ?',
    userId,
    'course',
    courseId
  );
  if (!row) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

export function slugify(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return s || fallback;
}

// CSV cell escaping incl. formula-injection protection for exports.
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return lines.join('\r\n');
}

// Minimal CSV parser (quoted fields, CRLF). Rejects =+-@ leading cells on import (flagged as errors).
export function parseCsv(text: string): { header: string[]; rows: string[][]; errors: string[] } {
  const errors: string[] = [];
  const rows: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQuotes = false;
  const push = () => {
    row.push(cur);
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      push();
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  push();
  if (row.length > 1 || row[0] !== '') rows.push(row);
  if (!rows.length) return { header: [], rows: [], errors: ['Empty file'] };
  const header = rows[0].map((h) => h.trim());
  return { header, rows: rows.slice(1), errors };
}
