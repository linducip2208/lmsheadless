import { describe, it, expect } from 'vitest';
import { setup, mkOrg, mkUser, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('custom roles', () => {
  it('super_admin remaps permissions and enforcement follows the database', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'roles');
    await mkUser(db, 'sup@roles.com', 'super_admin', org);
    await mkUser(db, 't@roles.com', 'teacher', org);
    const tokSup = (await login(app, 'sup@roles.com')).access_token;
    const tokT = (await login(app, 't@roles.com')).access_token;
    // teacher can read audit logs? No (audit.view not in teacher set).
    expect((await app.request(`/api/v1/audit-logs?organization_id=${org}`, { headers: authHeader(tokT) })).status).toBe(403);
    // invalid role + unknown permission keys rejected
    const badRole = await app.request('/api/v1/roles/super_admin/permissions', { method: 'PUT', headers: H(tokSup), body: JSON.stringify({ permissions: [] }) });
    expect(badRole.status).toBe(400);
    const put = await app.request('/api/v1/roles/teacher/permissions', {
      method: 'PUT', headers: H(tokSup),
      body: JSON.stringify({ permissions: ['courses.view', 'audit.view', 'bogus.key'] }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { data: { permissions: string[] } };
    expect(body.data.permissions).toEqual(['courses.view', 'audit.view']); // unknown key dropped
    // enforcement now follows DB: teacher CAN read audit logs
    expect((await app.request(`/api/v1/audit-logs?organization_id=${org}`, { headers: authHeader(tokT) })).status).toBe(200);
    // non-super-admin cannot remap
    const deny = await app.request('/api/v1/roles/teacher/permissions', { method: 'PUT', headers: H(tokT), body: JSON.stringify({ permissions: [] }) });
    expect(deny.status).toBe(403);
    // me/permissions reflects DB mapping
    const mine = (await (await app.request(`/api/v1/users/me/permissions?organization_id=${org}`, { headers: authHeader(tokT) })).json()) as { data: { permissions: string[] } };
    expect(mine.data.permissions).toContain('audit.view');
    void db;
  });
});

describe('maintenance mode + registration toggle', () => {
  it('blocks writes for non-super-admins with 503, allows reads and super_admin', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'mnt');
    await mkUser(db, 'sup@mnt.com', 'super_admin', org);
    await mkUser(db, 't@mnt.com', 'teacher', org);
    const tokSup = (await login(app, 'sup@mnt.com')).access_token;
    const tokT = (await login(app, 't@mnt.com')).access_token;
    await app.request('/api/v1/settings', { method: 'PUT', headers: H(tokSup), body: JSON.stringify({ maintenance_mode: 'true' }) });
    const blocked = await app.request('/api/v1/courses', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, code: 'MX', title: 'Blocked Course' }) });
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('retry-after')).toBe('300');
    // reads still work
    expect((await app.request('/api/v1/courses', { headers: authHeader(tokT) })).status).toBe(200);
    // super_admin writes pass
    const okWrite = await app.request('/api/v1/courses', { method: 'POST', headers: H(tokSup), body: JSON.stringify({ organization_id: org, code: 'MX', title: 'Admin Course' }) });
    expect(okWrite.status).toBe(201);
    // disable restores writes (cache invalidated on settings save)
    await app.request('/api/v1/settings', { method: 'PUT', headers: H(tokSup), body: JSON.stringify({ maintenance_mode: 'false' }) });
    const restored = await app.request('/api/v1/courses', { method: 'POST', headers: H(tokT), body: JSON.stringify({ organization_id: org, code: 'MX2', title: 'Restored Course' }) });
    expect(restored.status).toBe(201);
    void db;
  });

  it('registration toggle gates public signup', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'reg');
    await mkUser(db, 'sup@reg.com', 'super_admin', org);
    const tokSup = (await login(app, 'sup@reg.com')).access_token;
    await app.request('/api/v1/settings', { method: 'PUT', headers: H(tokSup), body: JSON.stringify({ registration_enabled: 'false' }) });
    const blocked = await app.request('/api/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'n@reg.com', password: 'Password123!', name: 'N' }) });
    expect(blocked.status).toBe(403);
    await app.request('/api/v1/settings', { method: 'PUT', headers: H(tokSup), body: JSON.stringify({ registration_enabled: 'true' }) });
    const allowed = await app.request('/api/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'n@reg.com', password: 'Password123!', name: 'N' }) });
    expect(allowed.status).toBe(201);
    void db;
  });
});

describe('email verification loop + reset throttle', () => {
  it('register creates token, status reflects verification, resend throttled', async () => {
    const { app, db } = await setup();
    const reg = await app.request('/api/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'v@loop.com', password: 'Password123!', name: 'V' }) });
    expect(reg.status).toBe(201);
    const tok = (((await reg.json()) as { data: { access_token: string } }).data.access_token) ?? (await login(app, 'v@loop.com')).access_token;
    const st0 = (await (await app.request('/api/v1/auth/verify-status', { headers: authHeader(tok) })).json()) as { data: { email_verified: boolean } };
    expect(st0.data.email_verified).toBe(false);
    // resend 3x ok (creates rows), 4th throttled — but response shape differs; assert rows capped
    for (let i = 0; i < 3; i++) {
      await app.request('/api/v1/auth/verify-email/request', { method: 'POST', headers: authHeader(tok) });
    }
    const r4 = await app.request('/api/v1/auth/verify-email/request', { method: 'POST', headers: authHeader(tok) });
    expect(r4.status).toBe(429);
    // unauthenticated resend rejected
    expect((await app.request('/api/v1/auth/verify-email/request', { method: 'POST', headers: authHeader('bad') })).status).toBe(401);
    void db;
  });

  it('password reset abuse capped silently (enumeration-safe)', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'rst');
    await mkUser(db, 'r@rst.com', 'student', org);
    for (let i = 0; i < 5; i++) {
      const r = await app.request('/api/v1/auth/password/forgot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'r@rst.com' }) });
      expect(r.status).toBe(200); // always success to the caller
    }
    const { queryFirst } = await import('../src/db.js');
    const n = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) as n FROM password_resets WHERE user_id = (SELECT id FROM users WHERE email = ?)', 'r@rst.com');
    expect(n?.n).toBe(3);
  });
});
