// Shared E2E helpers (idea 55/73): one canonical copy of the fixtures every
// spec duplicated. Behavior is identical to the inlined versions (same
// defaults, same assertions); specs keep only their test bodies.
import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const API = process.env.API_BASE ?? 'http://localhost:8787';
export const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:5173';
export const TEACHER_URL = process.env.TEACHER_URL ?? 'http://localhost:5175';
export const STUDENT_URL = process.env.STUDENT_URL ?? 'http://localhost:5174';
export const PARENT_URL = process.env.PARENT_URL ?? 'http://localhost:5176';
export const PASS = 'Password123!';
export const ADMIN = 'admin@example.com';
export const SUPER = 'superadmin@example.com';

export const uniq = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
export const H = (t: string) => ({ Authorization: `Bearer ${t}` });
export const J = { 'content-type': 'application/json' };

export async function trackErrors(page: Page) {
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 500) badResponses.push(`${r.status()} ${r.url()}`);
  });
  return { pageErrors, badResponses };
}

export async function apiLogin(req: APIRequestContext, email: string, password: string = PASS) {
  const r = await req.post(`${API}/api/v1/auth/login`, {
    data: { email, password },
  });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { access_token: string; user: { id: string } } }).data;
}

export async function adminLogin(page: Page, email: string = ADMIN) {
  await page.goto(`${ADMIN_URL}/#/login`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASS);
  await page.locator('#login-form button[type="submit"], #login-form button.w-100').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

export async function studentLogin(page: Page, email: string) {
  await page.goto(`${STUDENT_URL}/#/login`);
  await page.locator('#f #e, #f input[type="email"]').first().fill(email);
  await page.locator('#f #p, #f input[type="password"]').first().fill(PASS);
  await page.locator('#f button[type="submit"], #f button').first().click();
  await page.waitForURL('**#/', { timeout: 15000 });
}

export async function orgId(req: APIRequestContext, tok: string) {
  const orgs = (await (
    await req.get(`${API}/api/v1/organizations`, { headers: H(tok) })
  ).json()) as { data: { id: string }[] };
  return orgs.data[0].id;
}

export async function freshStudent(
  req: APIRequestContext,
  org: string,
  tag: string,
  prefix: string
) {
  const em = `${prefix}-${tag}@example.com`;
  const reg = await req.post(`${API}/api/v1/auth/register`, {
    data: { email: em, password: PASS, name: `${prefix} ${tag}`, organization_id: org },
  });
  expect(reg.status()).toBe(201);
  return {
    em,
    ...((await reg.json()) as { data: { access_token: string; user: { id: string } } }).data,
  };
}
