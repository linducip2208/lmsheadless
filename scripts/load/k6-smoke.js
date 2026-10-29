// k6 smoke (docs-only load shape, no server change): 10 VUs for 1 minute
// against the login + catalog + openapi endpoints. Run: `k6 run scripts/load/k6-smoke.js`
// Requires a running seeded API (npm run dev) and k6 installed (https://k6.io).
// Thresholds mirror scripts/bench.mjs budgets: p95 login < 400ms, p95 catalog < 250ms.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{ep:login}': ['p(95)<400'],
    'http_req_duration{ep:catalog}': ['p(95)<250'],
    'http_req_duration{ep:openapi}': ['p(95)<120'],
  },
};

const BASE = __ENV.API_BASE_URL || 'http://localhost:8787';

export function setup() {
  const r = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { ep: 'login' } }
  );
  check(r, { login: (x) => x.status === 200 });
  return { token: r.json().data.access_token };
}

export default function (data) {
  const auth = { Authorization: `Bearer ${data.token}` };
  let r = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { ep: 'login' } }
  );
  check(r, { 'login 200': (x) => x.status === 200 });
  r = http.get(`${BASE}/api/v1/catalog/courses`, {
    headers: auth,
    tags: { ep: 'catalog' },
  });
  check(r, { 'catalog 200': (x) => x.status === 200 });
  r = http.get(`${BASE}/api/v1/openapi.json`, { tags: { ep: 'openapi' } });
  check(r, { 'openapi 200': (x) => x.status === 200 });
  sleep(1);
}
