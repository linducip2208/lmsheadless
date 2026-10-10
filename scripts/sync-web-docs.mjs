// Copies packaged operator guides into the public site's static dir so the
// documentation cards open real, versioned content (no self-looping links,
// no external dependency). Run: node scripts/sync-web-docs.mjs
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'apps/web/public/docs');
mkdirSync(dest, { recursive: true });
const files = ['flutter.md', 'white-label.md', 'pwa.md', 'cloudflare.md', 'security.md'];
for (const f of files) {
  copyFileSync(join(root, 'docs', f), join(dest, f));
  console.log(`synced docs/${f} -> apps/web/public/docs/${f}`);
}
