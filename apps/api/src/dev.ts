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
const db = await createNodeSqliteDb(dbPath);
await runMigrations(db);

const env: AppEnv = {
  DB: db,
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-change-me-min-32-chars-long-secret',
  STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? 'local',
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR ?? './.data/uploads',
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 200),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  COOKIE_SECURE: process.env.COOKIE_SECURE === '1',
};

const app = createApp(env, db);

// eslint-disable-next-line no-console
console.log(`LMS API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
