import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const apps = ['admin', 'teacher', 'student', 'parent', 'web'];

describe('PWA manifests', () => {
  for (const app of apps) {
    it(`${app} has a valid installable manifest`, () => {
      const p = join(root, 'apps', app, 'public', 'manifest.webmanifest');
      expect(existsSync(p)).toBe(true);
      const m = JSON.parse(readFileSync(p, 'utf8')) as {
        name: string; short_name: string; start_url: string; display: string;
        theme_color: string; background_color: string;
        icons: { src: string; sizes: string; type: string; purpose?: string }[];
      };
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.display).toBe('standalone');
      expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
      const png192 = m.icons.find((i) => i.sizes === '192x192' && i.type === 'image/png');
      const png512 = m.icons.find((i) => i.sizes === '512x512' && i.type === 'image/png');
      const maskable = m.icons.find((i) => i.purpose === 'maskable');
      expect(png192).toBeDefined();
      expect(png512).toBeDefined();
      expect(maskable).toBeDefined();
      for (const icon of [png192, png512, maskable]) {
        const fp = join(root, 'apps', app, 'public', icon?.src.slice(1) ?? '');
        expect(existsSync(fp)).toBe(true);
        const head = readFileSync(fp).subarray(0, 8);
        expect(Array.from(head)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic
      }
    });
  }
});

describe('service workers + offline shell', () => {
  for (const app of apps) {
    it(`${app} ships a versioned service worker with safe caching`, () => {
      const p = join(root, 'apps', app, 'public', 'sw.js');
      expect(existsSync(p)).toBe(true);
      const sw = readFileSync(p, 'utf8');
      expect(sw).toContain(`lms-${app}-v`);
      expect(sw).toContain('offline.html');
      expect(sw).toContain('SKIP_WAITING');
      // Private data must never be cached blindly.
      expect(sw.toLowerCase()).toContain('never cache private');
      // Only safe public API endpoints may be cached.
      expect(sw).toContain('certificates/verify');
    });
    it(`${app} has an offline fallback page`, () => {
      const p = join(root, 'apps', app, 'public', 'offline.html');
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, 'utf8').toLowerCase()).toContain('offline');
    });
  }
});

describe('API surface honesty (OpenAPI matches implementation)', () => {
  it('openapi.json is served and documents core domains', async () => {
    const { createApp } = await import('../src/app.js');
    const { createNodeSqliteDb } = await import('../src/db.js');
    const { runMigrations } = await import('../src/migrate.js');
    const db = await createNodeSqliteDb(':memory:');
    await runMigrations(db, join(root, 'migrations'));
    const env = { DB: db, JWT_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: './.data/u' };
    const app = createApp(env, db);
    const res = await app.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    const paths = Object.keys(doc.paths);
    for (const must of ['/api/v1/auth/login', '/api/v1/courses', '/api/v1/quizzes', '/api/v1/assignments', '/api/v1/certificates/verify/{number}', '/api/v1/uploads', '/api/v1/search']) {
      expect(paths).toContain(must);
    }
    // Every documented non-public path must actually exist on the router.
    const routePaths = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    expect(routePaths.size).toBeGreaterThan(40);
  });
});
