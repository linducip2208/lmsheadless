// Performance smoke: measures p50/p95/p99 (+ light concurrency) and writes
// a results table. Run: `node scripts/bench.mjs` — boots a disposable dev
// API automatically unless API_BASE_URL points at a live server.
// Not a load test — a regression tripwire. Budgets are documented expectations.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIVE_BASE = process.env.API_BASE_URL;
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 8);

const BUDGETS = {
  'GET /health': 50,
  'GET /api/v1/openapi.json': 120,
  'POST /api/v1/auth/login': 400,
  'GET /api/v1/courses': 250,
  'GET /api/v1/reports/organization-summary': 400,
  'GET /api/v1/catalog/courses': 250,
};

let child = null;
let BASE = LIVE_BASE ?? 'http://localhost:8787';

async function waitForHealth(base, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function ensureServer() {
  if (LIVE_BASE) {
    if (!(await waitForHealth(LIVE_BASE, 6))) {
      console.log(`BENCH: cannot reach API_BASE_URL=${LIVE_BASE}`);
      process.exit(1);
    }
    return null;
  }
  // Disposable boot: copy the seeded dev DB to a temp file so the bench
  // never mutates real dev data, then run the API on :8787 from it.
  const seed = './apps/api/.data/lms.db';
  if (!existsSync(seed)) {
    console.log(`BENCH: seeded DB missing at ${seed} — run npm run db:seed first`);
    process.exit(1);
  }
  const tmp = join(tmpdir(), `lms-bench-${Date.now()}.db`);
  copyFileSync(seed, tmp);
  child = spawn('node', ['../../node_modules/tsx/dist/cli.mjs', 'src/dev.ts'], {
    cwd: './apps/api',
    env: {
      ...process.env,
      PORT: '8787',
      DATABASE_PATH: tmp,
      JWT_SECRET: 'bench-secret-min-32-chars-long-xxxxxxxx',
      AUTH_RATE_LIMIT_MAX: '5000',
      RATE_LIMIT_MAX: '5000',
    },
    stdio: 'ignore',
  });
  if (!(await waitForHealth(BASE))) {
    try {
      child.kill();
    } catch {
      /* already dead */
    }
    console.log('BENCH: dev API failed to boot');
    process.exit(1);
  }
  return tmp;
}

async function login() {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
  });
  const j = await r.json();
  return j.data.access_token;
}

function pct(samples, p) {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function measure(name, fn, n = 25) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  // Light concurrency probe: CONCURRENCY parallel hits of the same endpoint.
  const ct0 = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => fn()));
  const concMs = performance.now() - ct0;
  const p50 = pct(samples, 50);
  const p95 = pct(samples, 95);
  const p99 = pct(samples, 99);
  const budget = BUDGETS[name] ?? 500;
  const ok = p95 <= budget;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms conc${CONCURRENCY}=${concMs.toFixed(0)}ms budget=${budget}ms`
  );
  return ok;
}

let tmpDb = null;
try {
  tmpDb = await ensureServer();
  const token = await login();
  const auth = { authorization: `Bearer ${token}` };
  const orgs = await (await fetch(`${BASE}/api/v1/organizations`, { headers: auth })).json();
  const orgId = orgs.data[0].id;

  let allOk = true;
  allOk = (await measure('GET /health', () => fetch(`${BASE}/health`))) && allOk;
  allOk =
    (await measure('GET /api/v1/openapi.json', () => fetch(`${BASE}/api/v1/openapi.json`))) &&
    allOk;
  allOk =
    (await measure('POST /api/v1/auth/login', () =>
      fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
      })
    )) && allOk;
  allOk =
    (await measure('GET /api/v1/courses', () =>
      fetch(`${BASE}/api/v1/courses?organization_id=${orgId}`, { headers: auth })
    )) && allOk;
  allOk =
    (await measure('GET /api/v1/reports/organization-summary', () =>
      fetch(`${BASE}/api/v1/reports/organization-summary?organization_id=${orgId}`, {
        headers: auth,
      })
    )) && allOk;
  allOk =
    (await measure('GET /api/v1/catalog/courses', () => fetch(`${BASE}/api/v1/catalog/courses`))) &&
    allOk;
  if (!allOk) process.exitCode = 1;
  else console.log('BENCH: all budgets met (p95 gate; p99/concurrency reported)');
} finally {
  if (child) {
    try {
      child.kill();
    } catch {
      /* already dead */
    }
  }
  if (tmpDb) {
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(tmpDb);
    } catch {
      /* best effort */
    }
  }
}
