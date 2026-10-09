// Scale fixture + report timing: proves reports stay fast at realistic scale.
// Run: npx tsx scripts/scale-check.mts  (in-memory DB, no side effects)
import { createApp } from '../apps/api/src/app.js';
import { createNodeSqliteDb, execute } from '../apps/api/src/db.js';
import { runMigrations } from '../apps/api/src/migrate.js';
import { newId, nowIso } from '@lms/shared';

const db = await createNodeSqliteDb(':memory:');
await runMigrations(db, './migrations');
const env = {
  DB: db,
  JWT_SECRET: 'x'.repeat(40),
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: './.data/u',
};
const app = createApp(env, db);
const now = nowIso();

const org = newId();
await execute(
  db,
  'INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  org,
  'Scale',
  'scale',
  now,
  now
);
const teacher = newId();
await execute(
  db,
  'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  teacher,
  't@scale.test',
  'x',
  'T',
  'active',
  now,
  now
);
await execute(
  db,
  'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  newId(),
  org,
  teacher,
  'teacher',
  now,
  now
);
const { signAccessToken } = await import('../apps/api/src/crypto.js');
const token = await signAccessToken('x'.repeat(40), teacher, 't@scale.test');
const admin = newId();
await execute(
  db,
  'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  admin,
  'a@scale.test',
  'x',
  'A',
  'active',
  now,
  now
);
await execute(
  db,
  'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  newId(),
  org,
  admin,
  'organization_admin',
  now,
  now
);
const adminToken = await signAccessToken('x'.repeat(40), admin, 'a@scale.test');
const H = { authorization: `Bearer ${token}` };
const HA = { authorization: `Bearer ${adminToken}` };

const N_STUDENTS = 1500;
const N_COURSES = 20;
console.log(`seeding ${N_STUDENTS} students x ${N_COURSES} courses...`);
const studentIds: string[] = [];
for (let i = 0; i < N_STUDENTS; i++) {
  const id = newId();
  studentIds.push(id);
  await execute(
    db,
    'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    `s${i}@scale.test`,
    'x',
    `S${i}`,
    'active',
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    org,
    id,
    'student',
    now,
    now
  );
}
const courseIds: string[] = [];
for (let j = 0; j < N_COURSES; j++) {
  const id = newId();
  courseIds.push(id);
  await execute(
    db,
    'INSERT INTO courses (id, organization_id, code, title, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    org,
    `SC${j}`,
    `Scale ${j}`,
    'published',
    teacher,
    now,
    now
  );
  await execute(
    db,
    'INSERT INTO course_sections (id, course_id, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(),
    id,
    'S1',
    0,
    now,
    now
  );
}
for (let i = 0; i < studentIds.length; i++) {
  for (let k = 0; k < 3; k++) {
    const cid = courseIds[(i + k) % courseIds.length];
    await execute(
      db,
      'INSERT INTO enrollments (id, course_id, student_id, status, progress_percent, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      cid,
      studentIds[i],
      k === 0 ? 'completed' : 'active',
      k === 0 ? 100 : 40,
      now,
      now,
      now
    );
  }
  if (i % 300 === 0) {
    await execute(
      db,
      'INSERT INTO grades (id, course_id, student_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      courseIds[0],
      studentIds[i],
      80,
      now,
      now
    );
    await logActivity();
  }
}
async function logActivity() {
  await execute(
    db,
    'INSERT INTO activity_log (id, organization_id, user_id, kind, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    org,
    teacher,
    'lesson.complete',
    now
  );
}

async function timed(name: string, path: string, budgetMs: number, headers = H): Promise<boolean> {
  const t0 = performance.now();
  const r = await app.request(path, { headers });
  const ms = performance.now() - t0;
  const ok = r.status === 200 && ms <= budgetMs;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name} status=${r.status} ${ms.toFixed(0)}ms budget=${budgetMs}ms`
  );
  return ok;
}

let allOk = true;
allOk =
  (await timed('completion', `/api/v1/reports/completion?organization_id=${org}`, 2000)) && allOk;
allOk =
  (await timed('engagement', `/api/v1/reports/engagement?organization_id=${org}&days=30`, 2000)) &&
  allOk;
allOk =
  (await timed('attendance', `/api/v1/reports/attendance?organization_id=${org}`, 2000)) && allOk;
allOk =
  (await timed(
    'teacher-activity',
    `/api/v1/reports/teacher-activity?organization_id=${org}`,
    2000,
    HA
  )) && allOk;
allOk =
  (await timed(
    'org-summary',
    `/api/v1/reports/organization-summary?organization_id=${org}`,
    2000
  )) && allOk;
allOk = (await timed('search', `/api/v1/search?q=S10&organization_id=${org}`, 2000)) && allOk;
if (!allOk) process.exit(1);
console.log('SCALE: all report budgets met at 1500 students / 20 courses / 4500 enrollments');
