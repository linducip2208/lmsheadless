// Generates reports/audit/feature-matrix.json + feature-inventory.md from code.
// Mechanism (no guessing):
// - backend endpoints: <router>.(get|post|patch|put|delete)('<path>' in
//   apps/api/src/routes/*.ts; auth = handler source contains requireAuth().
// - frontend routes: '#/...' hash literals in apps/*/src/main.ts + nav items.
// - tables: CREATE TABLE (IF NOT EXISTS)? <name> in migrations/*.sql.
// - test coverage: endpoint path substring searched across apps/api/test/*.ts
//   and apps/web/e2e/*.ts.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoutes = join(root, 'apps/api/src/routes');
const testsDir = join(root, 'apps/api/test');
const e2eDir = join(root, 'apps/web/e2e');
const migDir = join(root, 'migrations');

const testCorpus = readdirSync(testsDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(testsDir, f), 'utf8'))
  .join('\n');
const e2eCorpus = readdirSync(e2eDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(e2eDir, f), 'utf8'))
  .join('\n');

const endpoints = [];
for (const f of readdirSync(apiRoutes).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(apiRoutes, f), 'utf8');
  const re = /(\w+)\.(get|post|patch|put|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(src))) {
    const method = m[2].toUpperCase();
    const path = m[3];
    if (path.startsWith('/')) {
      const tail = src.slice(m.index, m.index + 600);
      const authed = tail.includes('requireAuth()');
      // static-prefix match: cut at the first :param so nested routes
      // (e.g. /courses/sections/:id/lessons) match test call sites
      const cut = path.indexOf('/:');
      const probe = (cut === -1 ? path : path.slice(0, cut)).replace(/\/$/, '') || '/';
      const inUnit = testCorpus.includes(probe);
      const inE2e = e2eCorpus.includes(probe);
      endpoints.push({
        id: `BE-${String(endpoints.length + 1).padStart(3, '0')}`,
        method,
        path,
        module: f.replace('.ts', ''),
        auth: authed ? 'requireAuth' : 'PUBLIC',
        backend_test: inUnit,
        e2e_test: inE2e,
        status:
          inUnit && inE2e
            ? 'IMPLEMENTED_AND_VERIFIED'
            : inUnit
              ? 'IMPLEMENTED_PARTIALLY_VERIFIED'
              : 'IMPLEMENTED_NOT_VERIFIED',
      });
    }
  }
}

const portals = ['admin', 'teacher', 'student', 'parent', 'web'];
const feRoutes = [];
for (const p of portals) {
  const main = join(root, `apps/${p}/src/main.ts`);
  let src = '';
  try {
    src = readFileSync(main, 'utf8');
  } catch {
    continue;
  }
  const seen = new Set();
  const re = /#\/[A-Za-z0-9_/:.-]*/g;
  let m;
  while ((m = re.exec(src))) {
    const h = m[0].replace(/\/$/, '');
    if (h.length > 2 && !seen.has(h)) {
      seen.add(h);
      feRoutes.push({
        id: `FE-${p.slice(0, 2).toUpperCase()}-${String(feRoutes.filter((r) => r.portal === p).length + 1).padStart(2, '0')}`,
        portal: p,
        hash: h,
      });
    }
  }
}

const tables = [];
for (const f of readdirSync(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  const src = readFileSync(join(migDir, f), 'utf8');
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)|CREATE TABLE\s+(\w+)/gi;
  let m;
  while ((m = re.exec(src))) tables.push({ table: (m[1] ?? m[2]).toLowerCase(), migration: f });
}

const summary = {
  generated_at: new Date().toISOString(),
  commit: 'fe6a8ec',
  counts: {
    endpoints: endpoints.length,
    public_endpoints: endpoints.filter((e) => e.auth === 'PUBLIC').length,
    with_backend_test: endpoints.filter((e) => e.backend_test).length,
    with_e2e: endpoints.filter((e) => e.e2e_test).length,
    frontend_hashes: feRoutes.length,
    tables: tables.length,
    migrations: readdirSync(migDir).filter((f) => f.endsWith('.sql')).length,
  },
};

const out = join(root, 'reports/audit');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'feature-matrix.json'),
  JSON.stringify({ summary, endpoints, feRoutes, tables }, null, 2)
);

const byStatus = {};
for (const e of endpoints) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
const md =
  `# Feature inventory (generated ${summary.generated_at}, commit fe6a8ec)\n\n` +
  `Source: parsed route registrations in \`apps/api/src/routes/*.ts\`, hash routes in \`apps/*/src/main.ts\`, \`CREATE TABLE\` in \`migrations/*.sql\`. ` +
  `Coverage flags are mechanical substring matches of the endpoint path in \`apps/api/test/*.ts\` (backend_test) and \`apps/web/e2e/*.ts\` (e2e_test).\n\n` +
  `## Counts\n\n- Endpoints: ${summary.counts.endpoints} (public: ${summary.counts.public_endpoints})\n` +
  `- With backend-test reference: ${summary.counts.with_backend_test}\n- With e2e reference: ${summary.counts.with_e2e}\n` +
  `- Frontend hashes: ${summary.counts.frontend_hashes}\n- Tables: ${summary.counts.tables} across ${summary.counts.migrations} migrations\n\n` +
  `## Status histogram\n\n` +
  Object.entries(byStatus)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') +
  '\n\n' +
  `## Public endpoints (no requireAuth in handler)\n\n` +
  endpoints
    .filter((e) => e.auth === 'PUBLIC')
    .map((e) => `- ${e.method} ${e.path} (${e.module})`)
    .join('\n') +
  '\n\n' +
  `## Endpoints without any test reference\n\n` +
  endpoints
    .filter((e) => !e.backend_test && !e.e2e_test)
    .map((e) => `- ${e.method} ${e.path} (${e.module})`)
    .join('\n') +
  '\n';
writeFileSync(join(out, 'feature-inventory.md'), md);
console.log(
  `endpoints=${endpoints.length} public=${summary.counts.public_endpoints} unit=${summary.counts.with_backend_test} e2e=${summary.counts.with_e2e} fe=${feRoutes.length} tables=${tables.length}`
);
console.log('untested:', endpoints.filter((e) => !e.backend_test && !e.e2e_test).length);
