// D1-compatible minimal database abstraction.
// Production: Cloudflare D1 binding. Local/test: node:sqlite adapter below.
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
}

export interface D1RunInfo {
  success: boolean;
  changes: number;
  lastRowId: number | string;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1RunInfo>;
}

export interface D1Like {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
}

export type SqlValue = string | number | null | Uint8Array;

// node:sqlite adapter (local dev + tests). Dynamically imported so the
// Cloudflare Workers bundle (which injects the D1 binding instead) never
// statically depends on node builtins.
interface NodeSqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

interface NodeSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
}

export async function createNodeSqliteDb(path: string): Promise<D1Like> {
  // Loaded without any import statement (bundler-proof): this adapter only
  // ever runs in Node (local dev / tests). Workers inject the D1 binding.
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const builtin = proc?.getBuiltinModule?.('node:sqlite') as
    | { DatabaseSync: new (path: string) => NodeSqliteDb }
    | undefined;
  if (!builtin) throw new Error('node:sqlite is unavailable in this runtime');
  const sqlite = new builtin.DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  return {
    prepare(query: string): D1PreparedStatement {
      const stmt = sqlite.prepare(query);
      let values: unknown[] = [];
      const self: D1PreparedStatement = {
        bind(...v: unknown[]) {
          values = v;
          return self;
        },
        async all<T>() {
          const rows = stmt.all(...(values as [])) as T[];
          return { results: rows };
        },
        async first<T>() {
          const row = stmt.get(...(values as [])) as T | undefined;
          return (row ?? null) as T | null;
        },
        async run() {
          const info = stmt.run(...(values as [])) as { changes: number | bigint; lastInsertRowid: number | bigint };
          return {
            success: true,
            changes: Number(info.changes),
            lastRowId: Number(info.lastInsertRowid),
          };
        },
      };
      return self;
    },
    async exec(query: string) {
      sqlite.exec(query);
      return undefined;
    },
  };
}

export async function queryAll<T = Record<string, unknown>>(db: D1Like, sql: string, ...params: SqlValue[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results;
}

export async function queryFirst<T = Record<string, unknown>>(db: D1Like, sql: string, ...params: SqlValue[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function execute(db: D1Like, sql: string, ...params: SqlValue[]): Promise<D1RunInfo> {
  return db.prepare(sql).bind(...params).run();
}
