import { test, expect } from '@playwright/test';

// Browser E2E: public site + real API integration (dev DB must be migrated + seeded).
test('home renders and switches to Indonesian', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: /headless LMS/i }).first()).toBeVisible();
  await page.selectOption('#lang-sel', 'id');
  await expect(page.getByRole('heading', { name: /untuk sekolah/i }).first()).toBeVisible();
});

test('catalog shows a published public course from the live API', async ({ page, request }) => {
  // Arrange via API: login as admin, publish + publicize a course.
  const login = await request.post('http://localhost:8787/api/v1/auth/login', {
    data: { email: 'admin@example.com', password: 'Password123!' },
  });
  expect(login.ok()).toBeTruthy();
  const { data } = (await login.json()) as { data: { access_token: string } };
  const headers = { Authorization: `Bearer ${data.access_token}` };
  const orgs = (await (
    await request.get('http://localhost:8787/api/v1/organizations', { headers })
  ).json()) as {
    data: { id: string }[];
  };
  const orgId = orgs.data[0].id;
  const created = await request.post('http://localhost:8787/api/v1/courses', {
    headers: { ...headers, 'content-type': 'application/json' },
    data: {
      organization_id: orgId,
      code: `E2E-${Date.now().toString(36)}`,
      title: 'E2E Public Course',
      price: 0,
    },
  });
  expect(created.ok()).toBeTruthy();
  const courseId = ((await created.json()) as { data: { id: string } }).data.id;
  await request.patch(`http://localhost:8787/api/v1/courses/${courseId}`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { status: 'published', visibility: 'public' },
  });
  await page.goto('/#/catalog');
  await expect(page.locator('#cat-list')).toContainText(/E2E Public Course/i, { timeout: 15000 });
});

test('certificate verification reports unknown numbers honestly', async ({ page }) => {
  await page.goto('/#/verify/CERT-NOPE-123');
  await expect(page.getByText(/not found|tidak ditemukan/i)).toBeVisible({ timeout: 15000 });
});

test('API docs endpoint is reachable from the site origin', async ({ request }) => {
  const res = await request.get('http://localhost:8787/api/v1/openapi.json');
  expect(res.ok()).toBeTruthy();
  const doc = (await res.json()) as { paths: Record<string, unknown> };
  expect(Object.keys(doc.paths).length).toBeGreaterThan(40);
});
