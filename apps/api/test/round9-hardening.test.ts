import { describe, it, expect } from 'vitest';
import { newId, nowIso } from '@lms/shared';
import { execute, queryFirst, queryAll } from '../src/db.js';
import { sniffKind, validateUploadBytes, zipRatioExceeded } from '../src/storage.js';
import {
  purgeAuditLogs,
  purgeNotifications,
  purgeEmailQueue,
  purgeIdempotencyKeys,
  runStorageRetention,
} from '../src/maintenance.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('round9: storage hardening (no new features)', () => {
  it('sniffKind detects png/jpg/gif/webp/pdf/zip by magic bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).buffer;
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer;
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]).buffer;
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer;
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer;
    const txt = new TextEncoder().encode('hello world, no magic here!!').buffer as ArrayBuffer;
    expect(sniffKind(png)).toBe('png');
    expect(sniffKind(jpg)).toBe('jpg');
    expect(sniffKind(gif)).toBe('gif');
    expect(sniffKind(webp)).toBe('webp');
    expect(sniffKind(pdf)).toBe('pdf');
    expect(sniffKind(zip)).toBe('zip');
    expect(sniffKind(txt)).toBe(null);
  });

  it('validateUploadBytes rejects content/extension mismatch, passes unknown', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(validateUploadBytes(png, 'photo.png')).toBe(null);
    expect(validateUploadBytes(png, 'photo.pdf')).toContain('does not match');
    const txt = new TextEncoder().encode('plain text, unverifiable').buffer as ArrayBuffer;
    expect(validateUploadBytes(txt, 'notes.txt')).toBe(null);
  });

  it('zipRatioExceeded flags pathological ratios only', () => {
    expect(zipRatioExceeded(1000, 50_000)).toBe(false); // 50x legitimate text
    expect(zipRatioExceeded(1000, 100_000)).toBe(false); // exactly 100x
    expect(zipRatioExceeded(1000, 100_001)).toBe(true);
    expect(zipRatioExceeded(0, 10)).toBe(true);
  });

  it('upload endpoint rejects spoofed content (png bytes as .pdf)', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'spoof9');
    await mkUser(db, 't@spoof9.test', 'teacher', org);
    const tok = (await login(app, 't@spoof9.test')).access_token;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.set('organization_id', org);
    form.set('file', new File([png], 'evil.pdf', { type: 'application/pdf' }));
    const r = await app.request('/api/v1/uploads', {
      method: 'POST',
      headers: authHeader(tok),
      body: form,
    });
    expect(r.status).toBe(400);
    const j = (await r.json()) as { success: boolean; error: { code: string } };
    expect(j.error.code).toBe('INVALID_FILE');
  });

  it('retention purges honor scope: audit/notifications(read-only)/email(terminal)/idempotency(7d)', async () => {
    const { db } = await setup();
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const now = nowIso();
    // audit: old row purged, fresh row kept
    await execute(db, "INSERT INTO settings (key, value, updated_at) VALUES ('k','v',?)", now);
    await execute(
      db,
      "INSERT INTO audit_logs (id, organization_id, action, created_at) VALUES (?, NULL, 't.old', ?)",
      newId(),
      old
    );
    const freshId = newId();
    await execute(
      db,
      "INSERT INTO audit_logs (id, organization_id, action, created_at) VALUES (?, NULL, 't.fresh', ?)",
      freshId,
      now
    );
    expect((await purgeAuditLogs(db, 30)).deleted).toBe(1);
    expect(await queryFirst(db, 'SELECT id FROM audit_logs WHERE id = ?', freshId)).toBeTruthy();
    // notifications: only read rows purged
    const u = newId();
    await execute(
      db,
      'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      u,
      'n@n.test',
      'x',
      'n',
      'active',
      now,
      now
    );
    await execute(
      db,
      'INSERT INTO notifications (id, user_id, title, body, is_read, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      newId(),
      u,
      't',
      'b',
      old
    );
    await execute(
      db,
      'INSERT INTO notifications (id, user_id, title, body, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      newId(),
      u,
      't',
      'b',
      old
    );
    expect((await purgeNotifications(db, 30)).deleted).toBe(1);
    // email: terminal rows purged, queued kept
    await execute(
      db,
      "INSERT INTO email_queue (id, to_email, subject, body_html, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'sent', ?, ?)",
      newId(),
      'a@a.test',
      's',
      'b',
      old,
      old
    );
    await execute(
      db,
      "INSERT INTO email_queue (id, to_email, subject, body_html, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
      newId(),
      'a@a.test',
      's',
      'b',
      old,
      old
    );
    expect((await purgeEmailQueue(db, 30)).deleted).toBe(1);
    // idempotency: fixed 7-day window
    await execute(
      db,
      'INSERT INTO idempotency_keys (key, user_id, endpoint, status_code, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      u,
      '/x',
      200,
      '{}',
      old
    );
    await execute(
      db,
      'INSERT INTO idempotency_keys (key, user_id, endpoint, status_code, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      u,
      '/x',
      200,
      '{}',
      now
    );
    expect((await purgeIdempotencyKeys(db)).deleted).toBe(1);
  });

  it('runStorageRetention respects opt-in settings (default off)', async () => {
    const { db } = await setup();
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    await execute(
      db,
      "INSERT INTO audit_logs (id, organization_id, action, created_at) VALUES (?, NULL, 't.old', ?)",
      newId(),
      old
    );
    // No settings: nothing purged (idempotency fixed window has no old rows here).
    const none = await runStorageRetention(db);
    expect(none.audit).toBe(0);
    const rows = await queryAll(db, 'SELECT id FROM audit_logs');
    expect(rows.length).toBe(1);
    // Opt in: purge runs.
    await execute(
      db,
      "INSERT INTO settings (key, value, updated_at) VALUES ('audit_log_retention_days', '30', ?)",
      nowIso()
    );
    const some = await runStorageRetention(db);
    expect(some.audit).toBe(1);
  });

  it('system retention endpoint enforces scope/days and RBAC', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'ret9');
    const saId = await mkUser(db, 'sa@ret9.test', null);
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      org,
      saId,
      'super_admin',
      nowIso(),
      nowIso()
    );
    await mkUser(db, 's@ret9.test', 'student', org);
    const tokA = (await login(app, 'sa@ret9.test')).access_token;
    // student (non-super_admin) denied
    const tokS = (await login(app, 's@ret9.test')).access_token;
    const denied = await app.request('/api/v1/system/retention/purge', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ scope: 'audit', days: 30 }),
    });
    expect(denied.status).toBe(403);
    // bad scope/days rejected
    const bad = await app.request('/api/v1/system/retention/purge', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ scope: 'everything', days: 30 }),
    });
    expect(bad.status).toBe(400);
    const badDays = await app.request('/api/v1/system/retention/purge', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ scope: 'audit', days: 0 }),
    });
    expect(badDays.status).toBe(400);
    // happy path purges nothing on a fresh DB but returns the shape
    const okRes = await app.request('/api/v1/system/retention/purge', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ scope: 'idempotency' }),
    });
    expect(okRes.status).toBe(200);
    const j = (await okRes.json()) as { data: { idempotency: number } };
    expect(typeof j.data.idempotency).toBe('number');
  });

  it('audit rows carry the request id', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rid9');
    const t = await mkUser(db, 't@rid9.test', 'teacher', org);
    const tok = (await login(app, 't@rid9.test')).access_token;
    const c = await mkCourse(db, org, t, 'RID9');
    const dup = await app.request(`/api/v1/courses/${c}/duplicate`, {
      method: 'POST',
      headers: H(tok),
      body: JSON.stringify({}),
    });
    expect(dup.status).toBe(201);
    const row = await queryFirst<{ request_id: string | null }>(
      db,
      "SELECT request_id FROM audit_logs WHERE action = 'course.duplicated' ORDER BY rowid DESC LIMIT 1"
    );
    expect(row?.request_id).toBeTruthy();
    expect(typeof row?.request_id).toBe('string');
  });
});
