import { readdirSync, readFileSync, existsSync } from 'node:fs';

// Static audit: migrations order, indexes/FKs, tenant columns, secrets, CDN,
// envelope, PWA assets, RBAC catalog.
const issues: string[] = [];
const MIG = '../../migrations';
const files = existsSync(MIG)
  ? readdirSync(MIG)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  : [];
if (files.length < 7) issues.push(`Expected >=7 migration files, found ${files.length}`);
const requiredTables = [
  'users',
  'organizations',
  'courses',
  'lessons',
  'quizzes',
  'assignments',
  'certificates',
  'settings',
  'audit_logs',
  'files',
  'idempotency_keys',
];
const all = files.map((f) => readFileSync(`${MIG}/${f}`, 'utf8')).join('\n');
for (const t of requiredTables) {
  if (!all.includes(`CREATE TABLE IF NOT EXISTS ${t}`)) issues.push(`Missing table: ${t}`);
}
if (!all.includes('REFERENCES')) issues.push('No foreign keys found');
if (!all.includes('CREATE INDEX')) issues.push('No indexes found');
if (!all.includes('organization_id')) issues.push('No tenant isolation column found');
// Secrets scan
const srcScan = ['src/app.ts', 'src/crypto.ts', 'src/index.ts', 'src/routes/auth.ts'];
for (const f of srcScan) {
  if (existsSync(f)) {
    const s = readFileSync(f, 'utf8');
    if (/sk-live|AKIA|BEGIN [A-Z ]*PRIVATE KEY/i.test(s))
      issues.push(`Possible hardcoded secret in ${f}`);
  }
}
// CDN scan for frontends (source + built output if present)
for (const f of [
  '../admin/index.html',
  '../student/index.html',
  '../teacher/index.html',
  '../parent/index.html',
  '../web/index.html',
]) {
  if (existsSync(f)) {
    const s = readFileSync(f, 'utf8');
    if (/cdn\.|unpkg|jsdelivr/i.test(s))
      issues.push(`CDN reference in ${f} (must be local/bundled)`);
  }
}
// Envelope check
if (existsSync('src/respond.ts')) {
  const s = readFileSync('src/respond.ts', 'utf8');
  if (!s.includes('success')) issues.push('Response envelope missing success flag');
}
// RBAC catalog check
if (existsSync('src/permissions.ts')) {
  const s = readFileSync('src/permissions.ts', 'utf8');
  for (const must of [
    'courses.publish',
    'quiz.grade',
    'certificates.issue',
    'settings.manage',
    'audit.view',
  ]) {
    if (!s.includes(must)) issues.push(`Permission catalog missing: ${must}`);
  }
} else {
  issues.push('Missing src/permissions.ts');
}
// PWA assets check
for (const app of ['admin', 'teacher', 'student', 'parent', 'web']) {
  for (const asset of [
    'public/manifest.webmanifest',
    'public/sw.js',
    'public/offline.html',
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
  ]) {
    if (!existsSync(`../${app}/${asset}`)) issues.push(`Missing PWA asset: ${app}/${asset}`);
  }
}
// No global auth guard on shared mounts (regression: public routes must stay public)
for (const f of [
  'src/routes/courses.ts',
  'src/routes/assessment.ts',
  'src/routes/orgs.ts',
  'src/routes/users.ts',
]) {
  if (existsSync(f) && readFileSync(f, 'utf8').includes(".use('*', requireAuth())")) {
    issues.push(
      `${f} uses a global requireAuth guard (breaks public routes; use per-route guards)`
    );
  }
}

if (issues.length) {
  // eslint-disable-next-line no-console
  console.log(`AUDIT: ${issues.length} issue(s)\n- ${issues.join('\n- ')}`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log(
    'AUDIT: PASS (migrations, FK/indexes, tenant columns, secrets, CDN, envelope, RBAC, PWA, guards)'
  );
}
