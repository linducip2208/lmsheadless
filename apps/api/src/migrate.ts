import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeSqliteDb, type D1Like } from './db.js';

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ -> project root migrations/
  return join(here, '..', '..', '..', 'migrations');
}

export async function runMigrations(db: D1Like, dir?: string): Promise<string[]> {
  const d = dir ?? migrationsDir();
  let files: string[] = [];
  try {
    files = readdirSync(d)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }
  for (const f of files) {
    const sql = readFileSync(join(d, f), 'utf8');
    try {
      await db.exec(sql);
    } catch (e) {
      // Boots re-run every migration file (no ledger). Files using
      // CREATE ... IF NOT EXISTS are naturally re-runnable; bare
      // ALTER TABLE ... ADD COLUMN (SQLite/D1 have no IF NOT EXISTS
      // variant) throws once the column exists. That case is benign —
      // anything else is a real failure and must still throw.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/duplicate column name|already exists/i.test(msg)) throw e;
    }
  }
  await applyColumnPatches(db);
  return files;
}

// SQLite/D1 have no ADD COLUMN IF NOT EXISTS: inspect PRAGMA table_info first.
const COLUMN_PATCHES: [string, string, string][] = [
  ['courses', 'slug', 'TEXT'],
  ['courses', 'visibility', "TEXT NOT NULL DEFAULT 'private'"],
  ['courses', 'start_at', 'TEXT'],
  ['courses', 'end_at', 'TEXT'],
  ['courses', 'enrollment_mode', "TEXT NOT NULL DEFAULT 'open'"],
  ['lessons', 'status', "TEXT NOT NULL DEFAULT 'published'"],
  ['quizzes', 'shuffle_questions', 'INTEGER NOT NULL DEFAULT 0'],
  ['assignments', 'allow_resubmit', 'INTEGER NOT NULL DEFAULT 1'],
  ['assignments', 'allowed_types', 'TEXT'],
  ['assignments', 'max_size_bytes', 'INTEGER NOT NULL DEFAULT 26214400'],
  ['quiz_attempts', 'expires_at', 'TEXT'],
  ['quiz_attempts', 'client_key', 'TEXT'],
  ['refresh_tokens', 'replaced_by', 'TEXT'],
  ['certificates', 'revoked_at', 'TEXT'],
  ['certificates', 'expires_at', 'TEXT'],
  ['quizzes', 'answer_release', "TEXT NOT NULL DEFAULT 'after_submit'"],
  ['quizzes', 'negative_marking', 'INTEGER NOT NULL DEFAULT 0'],
  ['quizzes', 'cooldown_minutes', 'INTEGER NOT NULL DEFAULT 0'],
  ['questions', 'difficulty', "TEXT NOT NULL DEFAULT 'medium'"],
  ['questions', 'explanation', 'TEXT'],
  ['questions', 'negative_points', 'REAL NOT NULL DEFAULT 0'],
  ['question_options', 'match_value', 'TEXT'],
  ['courses', 'capacity', 'INTEGER'],
  ['courses', 'access_days', 'INTEGER'],
  ['courses', 'enrollment_start', 'TEXT'],
  ['courses', 'enrollment_end', 'TEXT'],
  ['courses', 'publish_at', 'TEXT'],
  ['courses', 'review_status', "TEXT NOT NULL DEFAULT 'none'"],
  ['lessons', 'audio_url', 'TEXT'],
  ['orders', 'affiliate_id', 'TEXT'],
  ['submissions', 'rubric_breakdown', 'TEXT'],
];

async function applyColumnPatches(db: D1Like): Promise<void> {
  for (const [table, column, type] of COLUMN_PATCHES) {
    try {
      const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      if (!info.results.some((c) => c.name === column)) {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    } catch {
      // Table may not exist yet in exotic setups; base migrations create it.
    }
  }
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('migrate.ts')
) {
  const dbPath = process.env.DATABASE_PATH ?? './.data/lms.db';
  const { mkdirSync } = await import('node:fs');
  mkdirSync('./.data', { recursive: true });
  const db = await createNodeSqliteDb(dbPath);
  const files = await runMigrations(db);
  // eslint-disable-next-line no-console
  console.log(`Migrations applied: ${files.join(', ') || '(none found)'}`);
}
