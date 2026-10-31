// Single-port local gateway: exposes the API + all 5 portals on ONE port
// (default :8080) without touching DNS/hosts files or Vite `base` paths.
//
// Trick: the whole 127.0.0.0/8 block is loopback, so each portal gets its own
// loopback IP on the SAME port. No absolute-asset-path conflicts because every
// app is still served at `/` of its own origin. `/api/*` + `/health` always go
// to the API, so frontend `fetch('/api/...')` stays same-origin (no CORS).
//
// Backends are proxied with IPv4-first, IPv6-fallback dialing: on some
// machines Vite binds IPv6 localhost (::1) only, so 127.0.0.1 would refuse.
// Retries only happen before a response starts (connection-level errors),
// never after a backend answered, so POSTs are never double-executed.
//
//   http://localhost:8080        hub (this page) — also ::1 and 127.0.0.1
//   http://127.0.0.2:8080        admin   (proxies 127.0.0.1:5173)
//   http://127.0.0.3:8080        student (proxies 127.0.0.1:5174)
//   http://127.0.0.4:8080        teacher (proxies 127.0.0.1:5175)
//   http://127.0.0.5:8080        parent  (proxies 127.0.0.1:5176)
//   http://127.0.0.6:8080        web     (proxies 127.0.0.1:5177)
//   http://<any-of-above>/api/.. API     (proxies 127.0.0.1:8787)
//
// Bonus: each 127.0.0.x is a separate browser origin (own cookie jar), so you
// can stay logged in as admin + teacher + student at the same time.
//
// On macOS/Linux, `<name>.localhost:8080` (admin.localhost, …) also routes by
// subdomain. On Windows that needs hosts entries, so prefer the 127.0.0.x URLs.
//
// Run: `node scripts/gateway.mjs` (backends must run, e.g. `npm run dev:all`).
// Env: GATEWAY_PORT, API_PORT (or PORT), ADMIN/STUDENT/TEACHER/PARENT/WEB_PORT.
import http from 'node:http';

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const API_PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

const PORTALS = {
  admin: Number(process.env.ADMIN_PORT ?? 5173),
  student: Number(process.env.STUDENT_PORT ?? 5174),
  teacher: Number(process.env.TEACHER_PORT ?? 5175),
  parent: Number(process.env.PARENT_PORT ?? 5176),
  web: Number(process.env.WEB_PORT ?? 5177),
};

// Loopback IP -> portal. 127.0.0.1 / ::1 (and bare `localhost`) serve the hub.
const IP_MAP = {
  '127.0.0.2': 'admin',
  '127.0.0.3': 'student',
  '127.0.0.4': 'teacher',
  '127.0.0.5': 'parent',
  '127.0.0.6': 'web',
};

const HUB_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function stripPort(host) {
  const h = String(host ?? '')
    .split(',')[0]
    .trim();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']')); // [::1]:8080
  const i = h.lastIndexOf(':');
  return i === -1 ? h : h.slice(0, i);
}

// Returns { kind: 'api' } | { kind: 'portal', name } | { kind: 'hub' }.
function resolveTarget(req) {
  const url = req.url ?? '/';
  if (
    url === '/health' ||
    url.startsWith('/health?') ||
    url === '/api' ||
    url.startsWith('/api/') ||
    url.startsWith('/api?')
  ) {
    return { kind: 'api' };
  }
  const host = stripPort(req.headers.host).toLowerCase();
  const sub = host.endsWith('.localhost') ? host.slice(0, -'.localhost'.length) : null;
  if (sub && PORTALS[sub]) return { kind: 'portal', name: sub };
  if (host === 'localhost' || HUB_IPS.has(host)) return { kind: 'hub' };
  const local = req.socket?.localAddress ?? '';
  const mapped = IP_MAP[local];
  if (mapped) return { kind: 'portal', name: mapped };
  return { kind: 'hub' };
}

function backendDown(res, label, port, detail) {
  const body = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="3">
<title>Starting… — ${label}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:4rem auto;padding:0 1rem;line-height:1.6}</style>
</head><body><h1>“${label}” is starting…</h1>
<p>Backend <code>127.0.0.1:${port}</code> is not reachable yet${detail ? ` (${detail})` : ''}.
This page retries every 3 seconds.</p>
<p>Run <code>npm run dev:all</code> to boot the API + all portals + this gateway.</p>
</body></html>`;
  res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}

function proxyHttp(req, res, port, label) {
  readBody(req, 10 * 1024 * 1024).then(
    (body) => sendTo('127.0.0.1', body),
    () => {
      if (!res.headersSent) {
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Request body too large');
      }
    }
  );

  function sendTo(host, body) {
    const headers = { ...req.headers, host: `127.0.0.1:${port}` };
    delete headers.connection;
    delete headers['transfer-encoding'];
    headers['content-length'] = body.length;
    const proxyReq = http.request(
      { hostname: host, port, method: req.method, path: req.url, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    // Connection-level failure only (no response received yet): safe to
    // retry the other loopback family. Never retries after an answer.
    proxyReq.on('error', (err) => {
      if (host === '127.0.0.1') sendTo('::1', body);
      else if (!res.headersSent) backendDown(res, label, port, err.message);
      else res.end();
    });
    proxyReq.end(body);
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (d) => {
      size += d.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function proxyUpgrade(req, socket, head, port) {
  attempt('127.0.0.1');

  function attempt(host) {
    // Unlike plain HTTP, the Upgrade handshake headers MUST be preserved,
    // otherwise the backend never emits its own 'upgrade' event.
    const headers = { ...req.headers, host: `127.0.0.1:${port}`, connection: 'Upgrade' };
    const proxyReq = http.request({
      hostname: host,
      port,
      method: req.method,
      path: req.url,
      headers,
    });
    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`];
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
      }
      lines.push('', '');
      socket.write(lines.join('\r\n'));
      if (proxyHead?.length) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      const close = () => {
        try {
          proxySocket.destroy();
        } catch {
          /* noop */
        }
        try {
          socket.destroy();
        } catch {
          /* noop */
        }
      };
      proxySocket.on('error', close);
      socket.on('error', close);
    });
    proxyReq.on('error', () => {
      if (host === '127.0.0.1') attempt('::1');
      else socket.destroy();
    });
    proxyReq.end(head);
  }
}

function hubPage() {
  const g = GATEWAY_PORT;
  const row = (name, ip, direct) =>
    `<tr><td>${name}</td><td><a href="http://127.0.0.${ip}:${g}/">http://127.0.0.${ip}:${g}/</a></td><td><a href="http://localhost:${direct}/">: ${direct}</a></td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<title>LMS Headless — local single-port hub</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}
code{background:#f3f4f6;padding:.1rem .35rem;border-radius:4px}</style>
</head><body><h1>LMS Headless — local hub (one port: ${g})</h1>
<table><tr><th>Portal</th><th>Single-port URL</th><th>Direct (Vite)</th></tr>
${row('Admin', 2, PORTALS.admin)}${row('Student', 3, PORTALS.student)}${row('Teacher', 4, PORTALS.teacher)}${row('Parent', 5, PORTALS.parent)}${row('Web', 6, PORTALS.web)}
<tr><td>API docs</td><td><a href="http://127.0.0.1:${g}/api/v1/docs">/api/v1/docs</a></td><td><a href="http://localhost:${API_PORT}/api/v1/docs">: ${API_PORT}</a></td></tr>
</table>
<p>Boot everything with <code>npm run dev:all</code>. Each <code>127.0.0.x</code> origin
keeps its own cookies, so admin/teacher/student sessions stay logged in side by side.</p>
</body></html>`;
}

function handle(req, res) {
  const t = resolveTarget(req);
  if (t.kind === 'api') return proxyHttp(req, res, API_PORT, 'API');
  if (t.kind === 'hub') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(hubPage());
  }
  return proxyHttp(req, res, PORTALS[t.name], t.name);
}

function handleUpgrade(req, socket, head) {
  const t = resolveTarget(req);
  if (t.kind === 'api') return proxyUpgrade(req, socket, head, API_PORT);
  if (t.kind === 'hub') return socket.destroy();
  return proxyUpgrade(req, socket, head, PORTALS[t.name]);
}

// Bind each loopback IP separately (never 0.0.0.0: no LAN exposure).
const servers = [];
for (const ip of [
  '127.0.0.1',
  '127.0.0.2',
  '127.0.0.3',
  '127.0.0.4',
  '127.0.0.5',
  '127.0.0.6',
  '::1',
]) {
  const server = http.createServer(handle);
  server.on('upgrade', handleUpgrade);
  server.on('error', (err) => {
     
    console.error(`[gateway] listen ${ip}:${GATEWAY_PORT} failed: ${err.message}`);
    process.exitCode = 1;
  });
  server.listen(GATEWAY_PORT, ip, () => {
     
    console.log(`[gateway] listening on http://${ip}:${GATEWAY_PORT}`);
  });
  servers.push(server);
}
 
console.log(`[gateway] hub -> http://localhost:${GATEWAY_PORT}/ (API :${API_PORT})`);
