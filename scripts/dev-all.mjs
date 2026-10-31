// One-command local boot: API + 5 portals + single-port gateway.
// Run: `npm run dev:all` / `node scripts/dev-all.mjs [--no-gateway] [--dry-run]`.
import { spawn } from 'node:child_process';
import net from 'node:net';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/dev-all.mjs [--no-gateway] [--dry-run]

Boots: API :8787, admin :5173, student :5174, teacher :5175, parent :5176,
web :5177, gateway :8080 (single-port entry, see scripts/gateway.mjs).`);
  process.exit(0);
}

const DRY_RUN = args.has('--dry-run');
const WITH_GATEWAY = !args.has('--no-gateway');

// Ports must mirror scripts/gateway.mjs defaults (plus env overrides).
const WANT_PORTS = new Map([
  ['api', Number(process.env.API_PORT ?? process.env.PORT ?? 8787)],
  ['admin', Number(process.env.ADMIN_PORT ?? 5173)],
  ['student', Number(process.env.STUDENT_PORT ?? 5174)],
  ['teacher', Number(process.env.TEACHER_PORT ?? 5175)],
  ['parent', Number(process.env.PARENT_PORT ?? 5176)],
  ['web', Number(process.env.WEB_PORT ?? 5177)],
]);
if (WITH_GATEWAY) WANT_PORTS.set('gateway', Number(process.env.GATEWAY_PORT ?? 8080));

// NOTE: preflight uses a real bind-test, not a connect-test. On some Windows
// machines a connect() to an unbound 127.0.0.1 port can spuriously succeed
// (middlebox/WFP interception) even though nothing listens — but an actual
// listen() still works fine. So: only a failed bind counts as busy.
// Both 127.0.0.1 and ::1 are probed: Vite/API may sit on either loopback,
// and an IPv4-only check would miss an IPv6-held port (then fail at spawn).
function tryBind(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}
async function portFree(port) {
  return (await tryBind(port, '127.0.0.1')) && (await tryBind(port, '::1'));
}

// Windows cannot spawn .cmd files without a shell (EINVAL), so npm jobs run
// with shell:true there. The gateway is a plain node .exe and spawns directly.
const NPM_SHELL = process.platform === 'win32' ? { shell: true } : {};

const JOBS = [
  ['api', NPM, ['--workspace', 'apps/api', 'run', 'dev'], NPM_SHELL],
  // --strictPort: never drift to another port silently (gateway targets the
  // exact ports above; a collision must fail loudly instead).
  ['admin', NPM, ['--workspace', 'apps/admin', 'run', 'dev', '--', '--strictPort'], NPM_SHELL],
  ['student', NPM, ['--workspace', 'apps/student', 'run', 'dev', '--', '--strictPort'], NPM_SHELL],
  ['teacher', NPM, ['--workspace', 'apps/teacher', 'run', 'dev', '--', '--strictPort'], NPM_SHELL],
  ['parent', NPM, ['--workspace', 'apps/parent', 'run', 'dev', '--', '--strictPort'], NPM_SHELL],
  ['web', NPM, ['--workspace', 'apps/web', 'run', 'dev', '--', '--strictPort'], NPM_SHELL],
];
if (WITH_GATEWAY) JOBS.push(['gateway', process.execPath, ['scripts/gateway.mjs'], {}]);

if (DRY_RUN) {
  for (const [name, cmd, cmdArgs] of JOBS) {
     
    console.log(`[dry-run] ${name}: ${cmd} ${cmdArgs.join(' ')}`);
  }
  process.exit(0);
}

// Fail fast when something already occupies a dev port (e.g. a leftover
// server from another terminal). Without this, Vite silently drifts to the
// next free port and the :8080 gateway would 502.
const busy = [];
for (const [name, port] of WANT_PORTS) {
  if (!(await portFree(port))) busy.push(`${name} :${port}`);
}
if (busy.length) {
  console.error(
    `[dev-all] ports already in use: ${busy.join(', ')}. Stop the other server(s) first, then retry.`
  );
  process.exit(1);
}

const children = [];
function prefix(tag, chunk, stream) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.length) stream.write(`[${tag}] ${line}\n`);
  }
}

for (const [name, cmd, cmdArgs, jobOpts] of JOBS) {
  const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...(jobOpts ?? {}) });
  children.push(child);
  child.stdout.on('data', (d) => prefix(name, d, process.stdout));
  child.stderr.on('data', (d) => prefix(name, d, process.stderr));
  child.on('exit', (code, signal) => {
     
    console.log(`[${name}] exited (code=${code} signal=${signal})`);
  });
}
 
console.log(
  `[dev-all] ${JOBS.length} processes running. Ctrl+C to stop. Hub: http://localhost:8080/`
);

function shutdown(signal) {
  console.log(`\n[dev-all] ${signal} — stopping ${children.length} processes…`);
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already dead */
    }
  }
  setTimeout(() => {
    for (const child of children) {
      try {
        if (child.exitCode === null) child.kill('SIGKILL');
      } catch {
        /* noop */
      }
    }
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
