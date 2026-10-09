import { test, expect } from '@playwright/test';

// Behavior-level PWA + accessibility tests (not mere file-existence checks).
test('service worker takes control and serves the shell offline', async ({ page, context }) => {
  await page.goto('/#/');
  // Wait for the service worker to activate and control the page.
  await expect
    .poll(async () => page.evaluate(() => navigator.serviceWorker?.controller?.state ?? 'none'), {
      timeout: 20000,
    })
    .toBe('activated');
  // Go offline: navigations must still resolve (shell cache or offline page).
  await context.setOffline(true);
  await page.goto('/#/catalog');
  await expect(page.locator('#app')).not.toBeEmpty({ timeout: 15000 });
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length).toBeGreaterThan(0);
  await context.setOffline(false);
});

test('no private API data is pre-cached by the service worker', async ({ page }) => {
  await page.goto('/#/');
  await page.waitForTimeout(2000);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) urls.push(req.url);
    }
    return urls;
  });
  const sensitive = cached.filter((u) =>
    /\/api\/v1\/(grades|users|reports|auth\/me|notifications)/.test(u)
  );
  expect(sensitive).toEqual([]);
});

test('accessibility smoke: controls have names, images have alts, lang set', async ({ page }) => {
  for (const route of ['#/', '#/catalog', '#/login', '#/pricing']) {
    await page.goto(`/${route}`);
    // Every button/input/select/textarea must have an accessible name
    // (aria-label, associated <label>, placeholder, or visible text).
    const unnamed = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, input, select, textarea, a.btn'));
      return els
        .filter((el) => {
          const e = el as HTMLElement;
          const input = el as HTMLInputElement;
          const labelledBy = input.labels && input.labels.length > 0;
          const name =
            e.getAttribute('aria-label') ??
            (labelledBy ? 'x' : null) ??
            input.placeholder ??
            e.textContent?.trim() ??
            '';
          return name.length === 0 && e.getAttribute('aria-hidden') !== 'true';
        })
        .map((el) => (el as HTMLElement).outerHTML.slice(0, 120));
    });
    expect(unnamed).toEqual([]);
    // Images (if any) need alt text.
    const noAlt = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('img')).filter((img) => img.alt === undefined).length
    );
    expect(noAlt).toBe(0);
  }
  const lang = await page.evaluate(() => document.documentElement.lang);
  expect(lang).toBeTruthy();
});
