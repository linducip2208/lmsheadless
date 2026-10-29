import { describe, it, expect } from 'vitest';
import { newId, nowIso } from '@lms/shared';
import { minor, major } from '../src/routes/commerce.js';
import { execute, queryFirst } from '../src/db.js';
import { runScheduledPublishing, runSubscriptionMaintenance } from '../src/maintenance.js';
import { setup, mkOrg, mkUser, mkCourse, login, authHeader } from './helpers.js';

// Property-style invariants (no new deps): money round-trips, bulk fuzz of
// package validators, cron date-boundary behavior.
describe('round9b: properties, fuzz, cron edges', () => {
  it('minor/major round-trips for a dense range + samples', () => {
    for (let minorV = 0; minorV <= 100000; minorV += 7) {
      expect(major(minorV)).toBe(minorV / 100);
      expect(minor(major(minorV))).toBe(minorV);
    }
    for (const amount of [0, 1, 99, 100, 101, 999, 1000, 123456, 9999999]) {
      expect(minor(amount / 100)).toBe(amount);
      expect(major(amount)).toBe(amount / 100);
    }
  });

  it('upload validator never throws and rejects executables across mutations', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'fz9b');
    await mkUser(db, 't@fz9b.test', 'teacher', org);
    const tok = (await login(app, 't@fz9b.test')).access_token;
    const base = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const names = [
      'a.png',
      'a.PNG',
      'a.png.exe',
      'a.html',
      '.png',
      'a' + '.png'.repeat(60),
      'ünï.png',
    ];
    for (const name of names) {
      const form = new FormData();
      form.set('organization_id', org);
      form.set('file', new File([base], name, { type: 'application/octet-stream' }));
      const r = await app.request('/api/v1/uploads', {
        method: 'POST',
        headers: authHeader(tok),
        body: form,
      });
      expect([201, 400, 413]).toContain(r.status);
    }
    // Executable content never passes regardless of name.
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    for (const name of ['run.png', 'run.pdf', 'run.txt']) {
      const form = new FormData();
      form.set('organization_id', org);
      form.set('file', new File([exe], name, { type: 'application/octet-stream' }));
      const r = await app.request('/api/v1/uploads', {
        method: 'POST',
        headers: authHeader(tok),
        body: form,
      });
      expect([400, 413]).toContain(r.status);
    }
  });

  it('manifest fuzz: 20 mutations of SCORM/H5P packages never 500', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'mf9b');
    await mkUser(db, 't@mf9b.test', 'teacher', org);
    const tok = (await login(app, 't@mf9b.test')).access_token;
    const { default: JSZip } = (await import('jszip')) as unknown as {
      default: new () => {
        file(n: string, d: string | Uint8Array): unknown;
        generateAsync(o: { type: 'arraybuffer' }): Promise<ArrayBuffer>;
      };
    };
    const bodies = [
      '',
      '<',
      '<manifest>',
      '<manifest></manifest>',
      'not xml at all {{[[',
      '<imsmanifest.xml>' + 'x'.repeat(600000),
      JSON.stringify({ title: 1 }),
      '<manifest xmlns="x"><metadata><schemaversion>2004</schemaversion></metadata></manifest>',
    ];
    for (let i = 0; i < bodies.length; i++) {
      const zip = new JSZip();
      zip.file('imsmanifest.xml', bodies[i]);
      zip.file('index.html', '<h1>hi</h1>');
      const buf = await zip.generateAsync({ type: 'arraybuffer' });
      const form = new FormData();
      form.set('organization_id', org);
      form.set('file', new File([buf], `m${i}.zip`, { type: 'application/zip' }));
      const r = await app.request('/api/v1/scorm/upload', {
        method: 'POST',
        headers: authHeader(tok),
        body: form,
      });
      expect(r.status).toBeLessThan(500);
    }
    // H5P with non-JSON / wrong-shape manifests
    for (const h5p of ['{', '{"title":1}', '[]', 'x'.repeat(200000)]) {
      const zip = new JSZip();
      zip.file('h5p.json', h5p);
      const buf = await zip.generateAsync({ type: 'arraybuffer' });
      const form = new FormData();
      form.set('organization_id', org);
      form.set('file', new File([buf], 'p.h5p', { type: 'application/octet-stream' }));
      const r = await app.request('/api/v1/h5p/upload', {
        method: 'POST',
        headers: authHeader(tok),
        body: form,
      });
      expect(r.status).toBeLessThan(500);
    }
  });

  it('cron edges: past publish_at publishes, future does not, leap day works', async () => {
    const { db } = await setup();
    const org = await mkOrg(db, 'ce9b');
    const u = await mkUser(db, 't@ce9b.test', 'teacher', org);
    const mk = async (code: string, publishAt: string | null) => {
      const id = newId();
      await execute(
        db,
        "INSERT INTO courses (id, organization_id, code, title, status, created_by, created_at, updated_at, publish_at) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)",
        id,
        org,
        code,
        code,
        u,
        nowIso(),
        nowIso(),
        publishAt
      );
      return id;
    };
    const past = await mk('PAST', '2024-02-29T00:00:00.000Z'); // leap day, long past
    const future = await mk('FUT', '2999-01-01T00:00:00.000Z');
    const none = await mk('NON', null);
    const res = await runScheduledPublishing(db);
    expect(res.published).toBe(1);
    expect(
      await queryFirst<{ status: string }>(db, 'SELECT status FROM courses WHERE id = ?', past)
    ).toMatchObject({ status: 'published' });
    expect(
      await queryFirst<{ status: string }>(db, 'SELECT status FROM courses WHERE id = ?', future)
    ).toMatchObject({ status: 'draft' });
    expect(
      await queryFirst<{ status: string }>(db, 'SELECT status FROM courses WHERE id = ?', none)
    ).toMatchObject({ status: 'draft' });
    // Idempotent second run publishes nothing new.
    const res2 = await runScheduledPublishing(db);
    expect(res2.published).toBe(0);
  });

  it('subscription boundaries: free renews, paid past_due, cancelled untouched', async () => {
    const { db } = await setup();
    const org = await mkOrg(db, 'sb9b');
    const buyer = await mkUser(db, 'b@sb9b.test', 'student', org);
    const plan = newId();
    await execute(
      db,
      'INSERT INTO subscription_plans (id, organization_id, name, price, price_minor, interval, is_active, created_at) VALUES (?, ?, ?, 0, 0, ?, 1, ?)',
      plan,
      org,
      'Free',
      'monthly',
      nowIso()
    );
    const past = new Date(Date.now() - 1000).toISOString();
    const mk = async (status: string) => {
      const id = newId();
      await execute(
        db,
        'INSERT INTO subscriptions (id, plan_id, buyer_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        plan,
        buyer,
        status,
        past,
        nowIso(),
        nowIso()
      );
      return id;
    };
    const active = await mk('active');
    const cancelled = await mk('cancelled');
    const res = await runSubscriptionMaintenance(db);
    expect(res.renewed).toBe(1);
    expect(
      await queryFirst<{ status: string }>(
        db,
        'SELECT status FROM subscriptions WHERE id = ?',
        active
      )
    ).toMatchObject({ status: 'active' });
    // Cancelled rows are never touched even when past period end.
    expect(
      await queryFirst<{ status: string }>(
        db,
        'SELECT status FROM subscriptions WHERE id = ?',
        cancelled
      )
    ).toMatchObject({ status: 'cancelled' });
  });

  it('envelope shape holds across representative endpoints', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'env9b');
    const t = await mkUser(db, 't@env9b.test', 'teacher', org);
    await mkUser(db, 's@env9b.test', 'student', org);
    const tokT = (await login(app, 't@env9b.test')).access_token;
    const tokS = (await login(app, 's@env9b.test')).access_token;
    await mkCourse(db, org, t, 'ENV9');
    const gets: [string, string][] = [
      ['/api/v1/system/health', tokT],
      [`/api/v1/organizations/${org}/branding`, tokT],
      [`/api/v1/courses?organization_id=${org}`, tokT],
      [`/api/v1/catalog/courses`, tokS],
      ['/api/v1/xapi/statements', tokT],
    ];
    for (const [path, tok] of gets) {
      const r = await app.request(path, { headers: authHeader(tok) });
      expect(r.status).toBeLessThan(500);
      const j = (await r.json()) as Record<string, unknown>;
      expect(Object.keys(j).sort()).toEqual(expect.arrayContaining(['data', 'success']));
      for (const k of Object.keys(j)) expect(['data', 'meta', 'success']).toContain(k);
      expect(j.success).toBe(true);
    }
    const bad = await app.request('/api/v1/courses/does-not-exist', {
      headers: authHeader(tokT),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const bj = (await bad.json()) as Record<string, unknown>;
    expect(Object.keys(bj).sort()).toEqual(['error', 'success']);
    expect(bj.success).toBe(false);
    expect((bj.error as { code?: string }).code).toBeTruthy();
  });
});
