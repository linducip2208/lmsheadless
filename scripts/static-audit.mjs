// Static audits: (1) every hash link (#/...) in frontends resolves to a router
// branch; (2) API responses go through the envelope helpers (ok/created/fail).
// Run: node scripts/static-audit.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const issues = [];

function tsFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

// ---- 1. hash links vs router branches ----
for (const app of ['admin', 'teacher', 'student', 'parent', 'web']) {
  const mains = tsFiles(join(root, 'apps', app, 'src'));
  const src = mains.map((f) => readFileSync(f, 'utf8')).join('\n');
  const hrefs = new Set(
    [...src.matchAll(/href="#(\/[^"]*)"/g)].map((m) => m[1].split('?')[0].replace(/\/$/, '') || '/')
  );
  // Dynamic hrefs with ${} are detail pages; check their static prefix.
  const dynPrefixes = new Set(
    [...src.matchAll(/href="#(\/[^"$]*)\$/g)].map((m) => '/' + m[1].split('/').filter(Boolean)[0])
  );
  const branches = new Set(
    [
      ...src.matchAll(/route === '([^']+)'/g),
      ...src.matchAll(/route\.startsWith\('([^']+)'\)/g),
      ...src.matchAll(/path === '([^']+)'/g),
      ...src.matchAll(/path\.startsWith\('([^']+)'\)/g),
      ...[...src.matchAll(/\[([^\]]+)\]\.includes\((?:route|path)\)/g)].flatMap((m) =>
        [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      ),
    ].map((m) => (typeof m === 'string' ? m : m[1]).replace(/\/$/, '') || '/')
  );
  const handled = (h) => {
    if (branches.has(h)) return true;
    // Prefix handlers (startsWith) cover deeper paths.
    for (const b of branches) {
      if (h.startsWith(b) && (h === b || h[b.length] === '/')) return true;
    }
    return h === '/' || h === '';
  };
  for (const h of hrefs) {
    if (!handled(h)) issues.push(`${app}: hash link ${h} has no router branch`);
  }
  for (const prefix of dynPrefixes) {
    if (!handled(prefix)) issues.push(`${app}: dynamic link prefix ${prefix} has no router branch`);
  }
}

// ---- 2. envelope discipline ----
for (const f of tsFiles(join(root, 'apps', 'api', 'src', 'routes'))) {
  const src = readFileSync(f, 'utf8');
  const raws = [...src.matchAll(/return c\.(json|body|text|html)\(/g)];
  for (const m of raws) {
    const line = src.slice(0, m.index).split('\n').length;
    // Allowed: file/CSV/ICS downloads + certificate downloads + health-ish bodies.
    const ctx = src.slice(Math.max(0, m.index - 400), m.index + 40);
    const allowed =
      /Content-Disposition|text\/csv|text\/calendar|attachment|download/i.test(ctx) ||
      /c\.body\(obj\.body/.test(src.slice(m.index, m.index + 60));
    if (!allowed)
      issues.push(`api/${f.split('routes')[1]}:${line}: raw c.${m[1]}() outside envelope helpers`);
  }
}

if (issues.length) {
  console.log(`STATIC-AUDIT: ${issues.length} issue(s)\n- ${issues.join('\n- ')}`);
  process.exit(1);
}
console.log('STATIC-AUDIT: PASS (hash links resolve; API uses envelope/downloads only)');
