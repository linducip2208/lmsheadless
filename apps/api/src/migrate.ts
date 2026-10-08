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
    files = readdirSync(d).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
  for (const f of files) {
    const sql = readFileSync(join(d, f), 'utf8');
    await db.exec(sql);
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('migrate.ts')) {
  const dbPath = process.env.DATABASE_PATH ?? './.data/lms.db';
  const { mkdirSync } = await import('node:fs');
  mkdirSync('./.data', { recursive: true });
  const db = await createNodeSqliteDb(dbPath);
  const files = await runMigrations(db);
  // eslint-disable-next-line no-console
  console.log(`Migrations applied: ${files.join(', ') || '(none found)'}`);
}
