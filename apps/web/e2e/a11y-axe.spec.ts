// Axe accessibility pass (idea 67): extends the pwa-a11y smoke with a real
// rule engine on key unauthenticated pages. No known-issue exclusions:
// failures here are bugs, not noise.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { adminLogin } from './helpers.js';

test.setTimeout(120_000);

const pages = [
  ['web home', 'http://localhost:5177/#/'],
  ['web catalog', 'http://localhost:5177/#/catalog'],
  ['admin login', 'http://localhost:5173/#/login'],
  ['teacher login', 'http://localhost:5175/#/login'],
  ['student login', 'http://localhost:5174/#/login'],
  ['parent login', 'http://localhost:5176/#/login'],
] as const;

for (const [name, url] of pages) {
  test(`axe: ${name} has no serious violations`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await assertNoSerious(page, name);
  });
}

test('axe: admin commerce (status badges) has no serious violations', async ({ page }) => {
  await adminLogin(page);
  await page.locator('a[href="#/commerce"]').click();
  await page.locator('button[data-tab="orders"]').click();
  await expect(page.locator('#o-list')).toBeVisible({ timeout: 15000 });
  await assertNoSerious(page, 'admin commerce');
});

async function assertNoSerious(page: import('@playwright/test').Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact ?? '')
  );
  if (process.env.AXE_VERBOSE && serious.length) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync('test-results/axe-dump', { recursive: true });
    writeFileSync(
      `test-results/axe-dump/${name.replace(/[^a-z0-9]+/gi, '-')}.json`,
      JSON.stringify(
        serious.map((v) => ({
          id: v.id,
          help: v.help,
          nodes: v.nodes.map((n) => ({ target: n.target, html: (n.html as string).slice(0, 300) })),
        })),
        null,
        2
      )
    );
  }
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
    `axe violations on ${name}`
  ).toEqual([]);
}
