import { createApp } from '../src/app.js';
import { createNodeSqliteDb, execute, type D1Like } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { hashPassword } from '../src/crypto.js';
import { newId, nowIso } from '@lms/shared';
import type { AppEnv } from '../src/types.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invalidateMaintenanceCache } from '../src/middleware/maintenance.js';

export const SECRET = 'test-secret-min-32-chars-long-xxxxxx';

export async function setup() {
  invalidateMaintenanceCache(); // module-level maintenance cache must not leak between tests
  const db = await createNodeSqliteDb(':memory:');
  const here = dirname(fileURLToPath(import.meta.url));
  await runMigrations(db, join(here, '..', '..', '..', 'migrations'));
  const env: AppEnv = {
    DB: db,
    JWT_SECRET: SECRET,
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: './.data/uploads-test',
  };
  const app = createApp(env, db);
  return { db, app, env };
}

export async function mkOrg(db: D1Like, slug: string) {
  const id = newId();
  await execute(
    db,
    'INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    id,
    slug,
    slug,
    nowIso(),
    nowIso()
  );
  return id;
}

export async function mkUser(db: D1Like, email: string, role: string | null, orgId?: string) {
  const id = newId();
  await execute(
    db,
    'INSERT INTO users (id, email, password_hash, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    email,
    await hashPassword('Password123!'),
    email.split('@')[0],
    'active',
    nowIso(),
    nowIso()
  );
  if (role && orgId) {
    await execute(
      db,
      'INSERT INTO organization_members (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId(),
      orgId,
      id,
      role,
      nowIso(),
      nowIso()
    );
  }
  return id;
}

export async function login(
  app: ReturnType<typeof createApp>,
  email: string,
  password = 'Password123!'
) {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = (await res.json()) as { data: { access_token: string; refresh_token: string } };
  return j.data;
}

export async function mkCourse(db: D1Like, orgId: string, teacherId: string, code = 'C101') {
  const id = newId();
  await execute(
    db,
    'INSERT INTO courses (id, organization_id, code, title, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    orgId,
    code,
    `Course ${code}`,
    'published',
    teacherId,
    nowIso(),
    nowIso()
  );
  return id;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
