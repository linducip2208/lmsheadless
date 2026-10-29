// Visual regression harness (idea 66): pixel screenshots of every portal
// shell. Opt-in via VISUAL=1 — excluded from CI sharding by default because
// font rendering differs across OSes. Locally: VISUAL=1 npx playwright test
// e2e/visual.spec.ts --update-snapshots (first run), then commit baselines.
import { test, expect } from '@playwright/test';

test.skip(!process.env.VISUAL, 'visual baselines only with VISUAL=1');
test.setTimeout(120_000);

const shots: [string, string][] = [
  ['web-home', 'http://localhost:5177/#/'],
  ['admin-login', 'http://localhost:5173/#/login'],
  ['teacher-login', 'http://localhost:5175/#/login'],
  ['student-login', 'http://localhost:5174/#/login'],
  ['parent-login', 'http://localhost:5176/#/login'],
];

for (const [name, url] of shots) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot(`${name}.png`, {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });
}

test('visual: web home RTL (ar locale)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('web-locale', 'ar'));
  await page.goto('http://localhost:5177/#/', { waitUntil: 'networkidle' });
  await expect(page.locator('html[dir="rtl"]')).toBeAttached();
  await expect(page).toHaveScreenshot('web-home-ar.png', {
    maxDiffPixelRatio: 0.05,
    animations: 'disabled',
  });
});
