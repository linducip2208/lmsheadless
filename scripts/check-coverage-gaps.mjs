// Uncalled-endpoint gate: fails CI when a backend endpoint has zero
// invocations in API tests AND E2E, unless allowlisted. The allowlist holds
// only the documented matcher blind spots (invoked via interpolated loops).
// Run: node scripts/check-coverage-gaps.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW = new Set(['GET /api/v1/reports/completion', 'GET /api/v1/reports/attendance']);

function callSites(dir, fnames, re) {
  const out = [];
  for (const f of fnames) {
    const src = readFileSync(join(dir, f), 'utf8');
    let m;
    while ((m = re.exec(src))) out.push(m[1].split('?')[0].split('${')[0]);
  }
  return out;
}

const testsDir = join(root, 'apps/api/test');
const e2eDir = join(root, 'apps/web/e2e');
const testFiles = readdirSync(testsDir).filter((f) => f.endsWith('.ts'));
const e2eFiles = readdirSync(e2eDir).filter((f) => f.endsWith('.ts'));
const sites = [
  ...callSites(testsDir, testFiles, /app\.request\(\s*[`'"]([^`'"]+)[`'"]/g),
  ...callSites(
    e2eDir,
    e2eFiles,
    /(?:req|request|fetch)\.(?:get|post|patch|put|delete)\(\s*[`'"]\$\{[^}]*\}([^`'"]+)[`'"]/g
  ),
  // E2E specs also call via template `${API}/api/...`
  ...callSites(e2eDir, e2eFiles, /[`'"]\$\{API\}([^`'"]+)[`'"]/g),
];

const dir = join(root, 'apps/api/src/routes');
// Resolve router-relative paths via app.ts mount map (mirrors gen-inventory.mjs).
const appSrc = readFileSync(join(root, 'apps/api/src/app.ts'), 'utf8');
const importOf = {};
for (const m of appSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)\.js'/g)) {
  importOf[m[1]] = m[2];
}
const mountOf = {};
for (const m of appSrc.matchAll(/app\.route\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\s*\)/g)) {
  const file = importOf[m[2]];
  if (file) mountOf[file] = m[1];
}
const gaps = [];
let total = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  const re = /(\w+)\.(get|post|patch|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m;
  while ((m = re.exec(src))) {
    const rel = m[3];
    if (!rel.startsWith('/')) continue;
    const mount = mountOf[f.replace('.ts', '')] ?? '/api/v1';
    const full = rel.startsWith('/api/') ? rel : `${mount === '/' ? '' : mount}${rel}`;
    total++;
    const cut = full.indexOf('/:');
    const probe = (cut === -1 ? full : full.slice(0, cut)).replace(/\/$/, '') || '/';
    const hit = sites.some(
      (u) => u === probe || u.startsWith(`${probe}/`) || u.startsWith(`${probe}?`)
    );
    const id = `${m[2].toUpperCase()} ${full}`;
    if (!hit && !ALLOW.has(id)) gaps.push(`${id} (${f})`);
  }
}

if (gaps.length) {
  console.log(`COVERAGE-GAPS: ${gaps.length} uncalled endpoint(s)\n- ${gaps.join('\n- ')}`);
  process.exit(1);
}
console.log(`COVERAGE-GAPS: PASS (${total} /api endpoints, all invoked or allowlisted)`);
