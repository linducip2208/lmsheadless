import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createNodeSqliteDb } from './db.js';
import type { AppEnv } from './types.js';
import { runMigrations } from './migrate.js';
import { existsSync, mkdirSync } from 'node:fs';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DATABASE_PATH ?? './.data/lms.db';
mkdirSync('./.data', { recursive: true });
if (!existsSync(dbPath)) {
  // Create empty file via adapter then migrate.
}
// Fail fast on weak secrets: an explicitly short JWT_SECRET is a
// misconfiguration, and production mode must never run on the dev default.
const explicitSecret = process.env.JWT_SECRET;
const secret = explicitSecret ?? 'dev-only-change-me-min-32-chars-long-secret';
if (explicitSecret && explicitSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
if (process.env.COOKIE_SECURE === '1' && !explicitSecret) {
  throw new Error('COOKIE_SECURE=1 requires an explicit JWT_SECRET (≥32 chars)');
}
const db = await createNodeSqliteDb(dbPath);
const applied = await runMigrations(db);
// eslint-disable-next-line no-console
console.log(`Migrations applied: ${applied.length} files (${dbPath})`);

const env: AppEnv = {
  DB: db,
  JWT_SECRET: secret,
  STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local',
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR ?? './.data/uploads',
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 200),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  AUTH_RATE_LIMIT_MAX: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 60),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
};

const app = createApp(env, db);

// eslint-disable-next-line no-console
console.log(`LMS API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
