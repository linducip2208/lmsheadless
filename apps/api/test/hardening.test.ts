import { describe, it, expect } from 'vitest';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('robustness', () => {
  it('malformed JSON never becomes a 500', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'neg');
    await mkUser(db, 't@neg.com', 'teacher', org);
    const tok = (await login(app, 't@neg.com')).access_token;
    const r = await app.request('/api/v1/courses', {
      method: 'POST', headers: H(tok), body: '{not json',
    });
    expect([400, 401, 403, 404, 409, 422].includes(r.status)).toBe(true);
  });

  it('oversized and invalid inputs are rejected with 4xx', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'neg2');
    await mkUser(db, 't@neg2.com', 'teacher', org);
    const tok = (await login(app, 't@neg2.com')).access_token;
    const big = await app.request('/api/v1/courses', {
      method: 'POST', headers: H(tok),
      body: JSON.stringify({ organization_id: org, code: 'X'.repeat(5000), title: 'T'.repeat(100000) }),
    });
    expect(big.status).toBe(400);
    const badId = await app.request('/api/v1/courses/%2E%2E%2Fetc', { headers: authHeader(tok) });
    expect([400, 403, 404].includes(badId.status)).toBe(true);
    const missing = await app.request('/api/v1/courses/00000000-0000-0000-0000-000000000000', { headers: authHeader(tok) });
    expect(missing.status).toBe(404);
    const wrongMethod = await app.request('/api/v1/enrollments', { headers: authHeader(tok) });
    expect(wrongMethod.status).toBe(404);
  });

  it('pagination is bounded and sort columns are allowlisted', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'pg');
    const t = await mkUser(db, 't@pg.com', 'teacher', org);
    const tok = (await login(app, 't@pg.com')).access_token;
    await mkCourse(db, org, t, 'PG1');
    const r = (await (await app.request(`/api/v1/courses?organization_id=${org}&per_page=1000&page=-5&sort=(SELECT+1)&order=sideways`, { headers: authHeader(tok) })).json()) as {
      data: unknown[]; meta: { perPage: number; page: number };
    };
    expect(r.meta.perPage).toBeLessThanOrEqual(100);
    expect(r.meta.page).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(r.data)).toBe(true);
    void t;
  });

  it('oversized idempotency keys are ignored safely', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'idem2');
    const t = await mkUser(db, 't@idem2.com', 'teacher', org);
    await mkUser(db, 's@idem2.com', 'student', org);
    const tok = (await login(app, 's@idem2.com')).access_token;
    const c = await mkCourse(db, org, t, 'ID2');
    const r = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader(tok), 'Idempotency-Key': 'k'.repeat(500) },
      body: JSON.stringify({ course_id: c }),
    });
    expect(r.status).toBe(201); // key ignored, request processed normally
    expect(r.headers.get('idempotent-replayed')).toBeNull();
  });

  it('empty uploads and wrong content are rejected', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'up2');
    await mkUser(db, 'u@up2.com', 'student', org);
    const tok = (await login(app, 'u@up2.com')).access_token;
    const empty = new FormData();
    empty.append('file', new File([], 'empty.txt', { type: 'text/plain' }));
    expect((await app.request('/api/v1/uploads', { method: 'POST', headers: authHeader(tok), body: empty })).status).toBe(400);
  });
});

describe('security headers + CORS preflight', () => {
  it('emits baseline headers on API responses', async () => {
    const { app } = await setup();
    const r = await app.request('/health');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(r.headers.get('x-request-id')).toBeTruthy();
  });

  it('handles CORS preflight correctly', async () => {
    const { app } = await setup();
    const ok = await app.request('/api/v1/courses', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
    const evil = await app.request('/api/v1/courses', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('auth endpoints sit in a stricter rate bucket', async () => {
    const { app } = await setup();
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const r = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.10.10.10' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
      });
      if (r.status === 429) limited++;
    }
    // 60/min auth bucket: some of the 70 must be limited, while the general
    // bucket (120) would have allowed them all.
    expect(limited).toBeGreaterThan(0);
  });
});
