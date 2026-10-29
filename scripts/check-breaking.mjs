// Breaking-change detector: compares route registrations (method+path+auth)
// against a committed snapshot. Removing an endpoint or tightening auth from
// PUBLIC to requireAuth breaks clients and fails CI. Run: node scripts/check-breaking.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapPath = join(root, 'scripts', 'openapi-snapshot.json');

function parseRoutes() {
  const routes = new Map();
  const dir = join(root, 'apps/api/src/routes');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const re = /(\w+)\.(get|post|patch|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
    let m;
    while ((m = re.exec(src))) {
      const path = m[3];
      if (!path.startsWith('/')) continue;
      const tail = src.slice(m.index, m.index + 600);
      const auth = tail.includes('requireAuth()') ? 'auth' : 'public';
      routes.set(`${m[2].toUpperCase()} ${path}`, auth);
    }
  }
  return routes;
}

const current = parseRoutes();
if (!existsSync(snapPath)) {
  const snap = Object.fromEntries([...current.entries()].sort());
  writeFileSync(snapPath, JSON.stringify(snap, null, 2) + '\n');
  console.log(`BREAKING: snapshot created (${current.size} routes) — commit it`);
  process.exit(0);
}

const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
const issues = [];
for (const [route, auth] of Object.entries(snapshot)) {
  if (!current.has(route)) {
    issues.push(`REMOVED endpoint: ${route} (was ${auth})`);
  } else if (auth === 'public' && current.get(route) === 'auth') {
    issues.push(`TIGHTENED auth: ${route} public → requireAuth`);
  }
}
const added = [...current.keys()].filter((r) => !(r in snapshot));
if (issues.length) {
  console.log(`BREAKING: ${issues.length} breaking change(s)\n- ${issues.join('\n- ')}`);
  process.exit(1);
}
if (added.length) {
  const merged = Object.fromEntries([...current.entries()].sort());
  writeFileSync(snapPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`BREAKING: PASS + snapshot refreshed (${added.length} new: ${added.join(', ')})`);
} else {
  console.log(`BREAKING: PASS (${current.size} routes, no removals)`);
}
