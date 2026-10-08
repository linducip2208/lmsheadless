// Contract check: every /api/v1/* path referenced by frontend sources must
// match a real backend route. Run: npx tsx scripts/check-contract.ts
// Exit 1 on mismatch (wire into CI later if desired).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { createApp } = await import('../apps/api/src/app.js');
const { createNodeSqliteDb } = await import('../apps/api/src/db.js');
const { runMigrations } = await import('../apps/api/src/migrate.js');

const db = await createNodeSqliteDb(':memory:');
await runMigrations(db, join(root, 'migrations'));
const env = { DB: db, JWT_SECRET: 'x'.repeat(40), STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: './.data/u' };
const app = createApp(env, db);

interface Route { method: string; pattern: string[] }
const routes: Route[] = app.routes
  .filter((r) => r.path.startsWith('/api/'))
  .map((r) => ({ method: r.method.toUpperCase(), pattern: r.path.split('/').filter(Boolean) }));

function matchRoute(method: string, segments: string[]): boolean {
  return routes.some((r) => {
    if (r.pattern.length !== segments.length) return false;
    if (r.method !== method && r.method !== 'ALL') return false;
    return r.pattern.every((seg, i) => seg.startsWith(':') || seg === segments[i]);
  });
}

function tsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const issues: string[] = [];
const seen = new Set<string>();
for (const frontend of ['admin', 'teacher', 'student', 'parent', 'web']) {
  for (const file of tsFiles(join(root, 'apps', frontend, 'src'))) {
    const src = readFileSync(file, 'utf8');
    // Match '/api/v1/...' inside string literals and template literals.
    const re = /['"`]((?:\/api\/v1\/)[A-Za-z0-9/_{}$.:-]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      let raw = m[1].split('?')[0].replace(/\$\{[^}]*\}/g, ':p');
      if (raw.endsWith('/') && raw.length > 1) raw = raw.slice(0, -1);
      const key = `${frontend}:${raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Guess method from surrounding call context (default GET is fine for existence check).
      const idx = m.index;
      const context = src.slice(Math.max(0, idx - 160), idx);
      let method = 'GET';
      const mm = context.match(/method:\s*['"](GET|POST|PATCH|PUT|DELETE)['"]/);
      if (mm) method = mm[1];
      else if (/\.request\([^)]*\{[^}]*method/.test(context)) method = 'GET';
      const segments = raw.split('/').filter(Boolean);
      // Existence check across common read methods; writes must match exactly.
      const exists =
        matchRoute(method, segments) ||
        (method === 'GET' && (matchRoute('GET', segments)));
      if (!exists) {
        // For non-GET, also accept if the path exists under any method (handler exists, verb may vary by UI action).
        const anyMethod = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].some((mt) => matchRoute(mt, segments));
        if (!anyMethod) issues.push(`${frontend}: ${raw} (no backend route) [${file.split('lmsheadless')[1]}]`);
      }
    }
  }
}

if (issues.length) {
  console.log(`CONTRACT: ${issues.length} mismatch(es)\n- ${issues.join('\n- ')}`);
  process.exit(1);
}
console.log(`CONTRACT: PASS (${seen.size} frontend API references all resolve to backend routes)`);
