import { readdirSync, readFileSync, existsSync } from 'node:fs';

// Static audit: checks migrations order, indexes/FKs, secrets, CDN refs, response envelope.
const issues: string[] = [];
const MIG = '../../migrations';
const files = existsSync(MIG) ? readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort() : [];
if (files.length < 6) issues.push(`Expected >=6 migration files, found ${files.length}`);
const requiredTables = ['users', 'organizations', 'courses', 'lessons', 'quizzes', 'assignments', 'certificates'];
const all = files.map((f) => readFileSync(`${MIG}/${f}`, 'utf8')).join('\n');
for (const t of requiredTables) {
  if (!all.includes(`CREATE TABLE IF NOT EXISTS ${t}`)) issues.push(`Missing table: ${t}`);
}
if (!all.includes('FOREIGN KEY') && !all.includes('REFERENCES')) issues.push('No foreign keys found');
if (!all.includes('CREATE INDEX')) issues.push('No indexes found');
if (!all.includes('organization_id')) issues.push('No tenant isolation column found');
// Secrets scan
const srcScan = ['src/app.ts', 'src/crypto.ts', 'src/index.ts'];
for (const f of srcScan) {
  if (existsSync(f)) {
    const s = readFileSync(f, 'utf8');
    if (/sk-live|AKIA|secret\s*=\s*['"][^'"]{4,}/i.test(s) && !s.includes('dev-only')) issues.push(`Possible hardcoded secret in ${f}`);
  }
}
// CDN scan for frontends
for (const f of ['../admin/index.html', '../student/index.html']) {
  if (existsSync(f)) {
    const s = readFileSync(f, 'utf8');
    if (/cdn\.|unpkg|jsdelivr/i.test(s)) issues.push(`CDN reference in ${f} (must be local/bundled)`);
  }
}
// Envelope check
if (existsSync('src/respond.ts')) {
  const s = readFileSync('src/respond.ts', 'utf8');
  if (!s.includes('success')) issues.push('Response envelope missing success flag');
}

if (issues.length) {
  // eslint-disable-next-line no-console
  console.log(`AUDIT: ${issues.length} issue(s)\n- ${issues.join('\n- ')}`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('AUDIT: PASS (migrations, FK/indexes, tenant columns, secrets, CDN, envelope)');
}
