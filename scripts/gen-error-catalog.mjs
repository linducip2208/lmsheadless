// Error-code catalog generator (idea 50): scans fail('CODE' occurrences in
// API routes and writes docs/api-error-catalog.md. Run: node scripts/gen-error-catalog.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'apps/api/src/routes');
const codes = new Map();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
  const src = readFileSync(join(dir, f), 'utf8');
  for (const m of src.matchAll(/fail\(\s*c\s*,\s*(\d{3})\s*,\s*'([A-Z_]+)'/g)) {
    const key = `${m[1]} ${m[2]}`;
    if (!codes.has(key)) codes.set(key, new Set());
    codes.get(key).add(f);
  }
}
const rows = [...codes.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([code, files]) => `| \`${code}\` | ${[...files].sort().join(', ')} |`);
const md =
  `# API error catalog (generated ${new Date().toISOString().slice(0, 10)})\n\n` +
  `Source: \`fail(status, CODE)\` call-sites in \`apps/api/src/routes/*.ts\`.\n` +
  `Envelope: \`{success:false, error:{code,message}}\` (ADR 003). Regenerate: \`node scripts/gen-error-catalog.mjs\`.\n\n` +
  `| Code | Route files |\n|------|-------------|\n` +
  rows.join('\n') +
  '\n';
writeFileSync(join(root, 'docs', 'api-error-catalog.md'), md);
console.log(`ERROR-CATALOG: ${codes.size} codes → docs/api-error-catalog.md`);
