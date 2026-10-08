import { createApp } from './app.js';
import type { D1Like } from './db.js';
import type { AppEnv } from './types.js';

// Cloudflare Workers entry. `DB`, `STORAGE` (R2), `KV` bindings come from wrangler.toml.
interface WorkerBindings {
  DB?: D1Like;
  STORAGE?: AppEnv['R2'];
  KV?: AppEnv['KV'];
  JWT_SECRET?: string;
  DEFAULT_LANG?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  R2_PUBLIC_BASE_URL?: string;
}

function buildEnv(platformEnv: WorkerBindings, db: D1Like): AppEnv {
  const secret =
    platformEnv.JWT_SECRET ??
    (typeof process !== 'undefined' ? process.env?.JWT_SECRET : undefined) ??
    'dev-only-change-me-min-32-chars-long-secret';
  return {
    DB: db,
    JWT_SECRET: secret,
    STORAGE_DRIVER: 'r2',
    STORAGE_LOCAL_DIR: './.data/uploads',
    R2: platformEnv.STORAGE,
    KV: platformEnv.KV,
    R2_PUBLIC_BASE_URL: platformEnv.R2_PUBLIC_BASE_URL,
    RATE_LIMIT_MAX: Number(platformEnv.RATE_LIMIT_MAX ?? 120),
    RATE_LIMIT_WINDOW_MS: Number(platformEnv.RATE_LIMIT_WINDOW_MS ?? 60_000),
  };
}

export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    const db = env.DB as D1Like | undefined;
    if (!db) {
      return Response.json({ success: false, error: { code: 'NO_DB', message: 'D1 binding missing' } }, { status: 500 });
    }
    const appEnv = buildEnv(env, db);
    const app = createApp(appEnv, db);
    return app.fetch(request, env);
  },
};
