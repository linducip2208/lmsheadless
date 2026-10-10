import { describe, it, expect } from 'vitest';
import { createNodeSqliteDb, queryFirst } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { mkOrg, mkUser } from './helpers.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

describe('migration re-runs (boot safety)', () => {
  it('second boot against a migrated DB succeeds and preserves data', async () => {
    const db = await createNodeSqliteDb(':memory:');
    const first = await runMigrations(db, dir);
    expect(first.length).toBeGreaterThan(16);
    const org = await mkOrg(db, 'rerun');
    const uid = await mkUser(db, 'keep@rerun.test', 'organization_admin', org);
    // Second boot must not throw (017/020 bare ALTERs previously crashed here).
    const second = await runMigrations(db, dir);
    expect(second).toEqual(first);
    const kept = await queryFirst<{ id: string }>(db, 'SELECT id FROM users WHERE id = ?', uid);
    expect(kept?.id).toBe(uid);
    // Money columns exist after re-run.
    const info = await db.prepare('PRAGMA table_info(orders)').all<{ name: string }>();
    expect(info.results.map((c) => c.name)).toContain('total_minor');
  });
});
