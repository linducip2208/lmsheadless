// R2 + D1 restore drill (local-first, R2-aware). No sqlite3 CLI needed:
// uses Node's built-in node:sqlite through the repo's D1Like adapter shape.
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const candidates = [process.env.STORAGE_LOCAL_DIR ?? './.data/uploads', './apps/api/.data/uploads'];
const dir = candidates.find((d) => existsSync(d)) ?? candidates[0];
const dbCandidates = [
  process.env.DATABASE_PATH,
  './.data/lms.db',
  './apps/api/.data/lms.db',
].filter(Boolean);
const dbPath = dbCandidates.find((d) => existsSync(d));

let failures = 0;
console.log(`[drill] storage dir: ${dir}`);
console.log(`[drill] database: ${dbPath ?? '(none found)'}`);

if (!existsSync(dir)) {
  console.log(
    '[drill] no local storage dir (R2-only deploy?) — file inventory via R2 API post-deploy, see docs/backup-recovery.md'
  );
} else {
  let count = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        count++;
        try {
          const s = statSync(p);
          if (s.size === 0) console.log(`[drill] WARN empty file: ${p}`);
        } catch {
          console.log(`[drill] FAIL unreadable: ${p}`);
          failures++;
        }
      }
    }
  };
  walk(dir);
  console.log(`[drill] local objects inventoried: ${count}`);
}

if (!existsSync(dbPath)) {
  console.log(
    '[drill] no local DB file — D1 remote drill must run post-deploy per docs/backup-recovery.md'
  );
} else {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(dbPath, { readOnly: true });
    const integrity = sqlite.prepare('PRAGMA integrity_check').get();
    const fk = sqlite.prepare('PRAGMA foreign_key_check').all();
    const files = sqlite.prepare('SELECT COUNT(*) as n FROM files').get();
    console.log(
      `[drill] integrity_check: ${integrity?.integrity_check ?? JSON.stringify(integrity)}`
    );
    console.log(`[drill] foreign_key_violations: ${fk.length}`);
    console.log(`[drill] files rows: ${files?.n ?? '?'}`);
    if (String(integrity?.integrity_check ?? '').toLowerCase() !== 'ok') {
      console.log('[drill] FAIL integrity_check != ok');
      failures++;
    }
    if (fk.length > 0) {
      console.log('[drill] FAIL foreign_key violations');
      failures++;
    }
    sqlite.close();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[drill] FAIL cannot open DB (${msg})`);
    failures++;
  }
}

if (failures > 0) {
  console.log(`[drill] FAIL (${failures})`);
  process.exit(1);
}
console.log('[drill] PASS');
