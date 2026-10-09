// Performance smoke: measures p50/p95 against a running dev API and writes
// a results table. Run: API on :8787 (seeded) then `node scripts/bench.mjs`.
// Not a load test — a regression tripwire. Budgets are documented expectations.
const BASE = process.env.API_BASE_URL ?? 'http://localhost:8787';

const BUDGETS = {
  'GET /health': 50,
  'GET /api/v1/openapi.json': 120,
  'POST /api/v1/auth/login': 400,
  'GET /api/v1/courses': 250,
  'GET /api/v1/reports/organization-summary': 400,
  'GET /api/v1/catalog/courses': 250,
};

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
  const p50 = pct(samples, 50);
  const p95 = pct(samples, 95);
  const budget = BUDGETS[name] ?? 500;
  const ok = p95 <= budget;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms budget=${budget}ms`
  );
  return ok;
}

const token = await login();
const auth = { authorization: `Bearer ${token}` };
const orgs = await (await fetch(`${BASE}/api/v1/organizations`, { headers: auth })).json();
const orgId = orgs.data[0].id;

let allOk = true;
allOk = (await measure('GET /health', () => fetch(`${BASE}/health`))) && allOk;
allOk =
  (await measure('GET /api/v1/openapi.json', () => fetch(`${BASE}/api/v1/openapi.json`))) && allOk;
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
    fetch(`${BASE}/api/v1/reports/organization-summary?organization_id=${orgId}`, { headers: auth })
  )) && allOk;
allOk =
  (await measure('GET /api/v1/catalog/courses', () => fetch(`${BASE}/api/v1/catalog/courses`))) &&
  allOk;
if (!allOk) process.exit(1);
console.log('BENCH: all budgets met (local dev, seeded SQLite)');
