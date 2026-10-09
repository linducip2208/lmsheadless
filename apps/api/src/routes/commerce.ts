import { Hono } from 'hono';
import { bundleSchema, couponSchema, orderSchema } from '@lms/validation';
import { newId, nowIso } from '@lms/shared';
import { execute, queryAll, queryFirst } from '../db.js';
import { created, fail, ok, paginationMeta } from '../respond.js';
import { canAccessOrg, orgRole, requireAuth } from '../middleware/common.js';
import { audit } from '../auditlog.js';
import { courseOrg, canTeach, isPrivileged, orgSetting } from '../access.js';
import type { AppVars, AuthUser } from '../types.js';
import type { D1Like } from '../db.js';
import { t } from '../i18n.js';

const commerce = new Hono<{ Variables: AppVars }>();

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------- Bundles ----------
commerce.post('/bundles', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = bundleSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!canTeach(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  for (const cid of parsed.data.course_ids) {
    if ((await courseOrg(db, cid)) !== parsed.data.organization_id) {
      return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    }
  }
  const nid = newId();
  const now = nowIso();
  await execute(db, 'INSERT INTO bundles (id, organization_id, name, description, price, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    nid, parsed.data.organization_id, parsed.data.name, parsed.data.description ?? null, parsed.data.price, user.id, now, now);
  for (const cid of parsed.data.course_ids) {
    await execute(db, 'INSERT OR IGNORE INTO bundle_courses (bundle_id, course_id) VALUES (?, ?)', nid, cid);
  }
  return created(c, { id: nid });
});

commerce.get('/bundles', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM bundles WHERE organization_id = ? ORDER BY created_at DESC', orgId);
  return ok(c, rows);
});

commerce.get('/bundles/:id', requireAuth(), async (c) => {  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const bundle = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM bundles WHERE id = ?', c.req.param('id'));
  if (!bundle || !canAccessOrg(user, bundle.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const courses = await queryAll(db, 'SELECT co.id, co.title, co.code, co.price FROM bundle_courses bc JOIN courses co ON co.id = bc.course_id WHERE bc.bundle_id = ?', c.req.param('id'));
  return ok(c, { courses });
});

commerce.patch('/bundles/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const bundle = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM bundles WHERE id = ?', c.req.param('id'));
  if (!bundle || !canTeach(user, bundle.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const body = (await c.req.json().catch(() => null)) as { name?: string; price?: number; status?: string; description?: string } | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (typeof body.name === 'string' && body.name.length >= 1 && body.name.length <= 150) { sets.push('name = ?'); params.push(body.name); }
  if (typeof body.price === 'number' && body.price >= 0) { sets.push('price = ?'); params.push(body.price); }
  if (body.status === 'draft' || body.status === 'published' || body.status === 'archived') { sets.push('status = ?'); params.push(body.status); }
  if (typeof body.description === 'string' && body.description.length <= 5000) { sets.push('description = ?'); params.push(body.description); }
  if (!sets.length) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  sets.push('updated_at = ?');
  params.push(nowIso(), c.req.param('id'));
  await execute(db, `UPDATE bundles SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return ok(c, { updated: true });
});

// ---------- Coupons ----------
commerce.post('/coupons', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = couponSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!isPrivileged(user, parsed.data.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const nid = newId();
  try {
    await execute(c.get('db'), 'INSERT INTO coupons (id, organization_id, code, kind, value, max_uses, min_amount, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      nid, parsed.data.organization_id, parsed.data.code.toUpperCase(), parsed.data.kind, parsed.data.value,
      parsed.data.max_uses ?? null, parsed.data.min_amount ?? 0, parsed.data.starts_at ?? null, parsed.data.ends_at ?? null, nowIso());
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  return created(c, { id: nid });
});

commerce.get('/coupons', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !isPrivileged(user, orgId)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT * FROM coupons WHERE organization_id = ? ORDER BY created_at DESC', orgId);
  return ok(c, rows);
});

// ---------- Pricing engine (server-side; client amounts never trusted) ----------
export interface PricedItem { kind: string; reference_id: string; title: string; amount: number }

export async function priceReference(db: D1Like, kind: string, referenceId: string, orgId: string): Promise<PricedItem | null> {
  if (kind === 'course') {
    const row = await queryFirst<{ id: string; title: string; price: number }>(db, 'SELECT id, title, price FROM courses WHERE id = ? AND organization_id = ? AND deleted_at IS NULL', referenceId, orgId);
    return row ? { kind, reference_id: row.id, title: row.title, amount: round2(row.price) } : null;
  }
  if (kind === 'bundle') {
    const row = await queryFirst<{ id: string; name: string; price: number }>(db, 'SELECT id, name, price FROM bundles WHERE id = ? AND organization_id = ?', referenceId, orgId);
    return row ? { kind, reference_id: row.id, title: row.name, amount: round2(row.price) } : null;
  }
  if (kind === 'cohort') {
    const row = await queryFirst<{ id: string; name: string }>(db, 'SELECT id, name FROM cohorts WHERE id = ? AND organization_id = ?', referenceId, orgId);
    // Cohort price: sum of linked course prices unless org sets cohort pricing (kept simple: sum).
    if (!row) return null;
    const courses = await queryAll<{ price: number }>(db, 'SELECT co.price FROM cohort_courses cc JOIN courses co ON co.id = cc.course_id WHERE cc.cohort_id = ?', referenceId);
    return { kind, reference_id: row.id, title: row.name, amount: round2(courses.reduce((s, x) => s + (x.price ?? 0), 0)) };
  }
  return null;
}

async function applyCoupon(db: D1Like, orgId: string, code: string | undefined, subtotal: number): Promise<{ discount: number; couponId: string | null }> {
  if (!code) return { discount: 0, couponId: null };
  const coupon = await queryFirst<{ id: string; kind: string; value: number; max_uses: number | null; used_count: number; min_amount: number; starts_at: string | null; ends_at: string | null; is_active: number }>(
    db, 'SELECT * FROM coupons WHERE organization_id = ? AND code = ?', orgId, code.toUpperCase());
  const now = Date.now();
  if (!coupon || !coupon.is_active) throw new Error('Invalid coupon');
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) throw new Error('Coupon exhausted');
  if (subtotal < coupon.min_amount) throw new Error('Coupon minimum not met');
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) throw new Error('Coupon not started');
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now) throw new Error('Coupon expired');
  const discount = coupon.kind === 'percent' ? round2(Math.min(subtotal, (subtotal * coupon.value) / 100)) : round2(Math.min(subtotal, coupon.value));
  return { discount, couponId: coupon.id };
}

// ---------- Orders ----------
commerce.post('/orders', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')), parsed.error.flatten());
  if (!canAccessOrg(user, parsed.data.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const db = c.get('db');
  const item = await priceReference(db, parsed.data.kind, parsed.data.reference_id, parsed.data.organization_id);
  if (!item) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  // Anti-self-referral + affiliate attribution.
  let affiliateId: string | null = null;
  if (parsed.data.affiliate_code) {
    const aff = await queryFirst<{ id: string; user_id: string; is_active: number }>(db, 'SELECT id, user_id, is_active FROM affiliates WHERE organization_id = ? AND code = ?', parsed.data.organization_id, parsed.data.affiliate_code);
    if (!aff || !aff.is_active) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid affiliate code');
    if (aff.user_id === user.id) return fail(c, 400, 'SELF_REFERRAL', 'Affiliates cannot refer themselves');
    affiliateId = aff.id;
  }
  let discount = 0;
  let couponId: string | null = null;
  try {
    const applied = await applyCoupon(db, parsed.data.organization_id, parsed.data.coupon_code, item.amount);
    discount = applied.discount;
    couponId = applied.couponId;
  } catch (e) {
    return fail(c, 400, 'INVALID_COUPON', e instanceof Error ? e.message : 'Invalid coupon');
  }
  const taxRate = Number((await orgSetting(db, parsed.data.organization_id, 'tax_rate')) || 0);
  const taxable = round2(item.amount - discount);
  const tax = round2((taxable * taxRate) / 100);
  const total = round2(taxable + tax);
  const currency = (parsed.data.currency ?? (await orgSetting(db, parsed.data.organization_id, 'currency')) ?? 'IDR').slice(0, 8);
  const now = nowIso();
  const orderId = newId();
  await execute(db, 'INSERT INTO orders (id, organization_id, buyer_id, kind, reference_id, currency, subtotal, discount, tax, total, coupon_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    orderId, parsed.data.organization_id, user.id, item.kind, item.reference_id, currency, item.amount, discount, tax, total, couponId, total === 0 ? 'paid' : 'pending', now, now);
  await execute(db, 'INSERT INTO order_items (id, order_id, kind, reference_id, title, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), orderId, item.kind, item.reference_id, item.title, item.amount, now);
  if (affiliateId) {
    await execute(db, 'UPDATE orders SET affiliate_id = ? WHERE id = ?', affiliateId, orderId).catch(() => undefined);
    const expiryDays = Number((await orgSetting(db, parsed.data.organization_id, 'affiliate_expiry_days')) || 30);
    await execute(db, 'INSERT INTO referrals (id, affiliate_id, buyer_id, order_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId(), affiliateId, user.id, orderId, 'ordered', new Date(Date.now() + expiryDays * 86400000).toISOString(), now);
  }
  if (couponId) await execute(db, 'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', couponId);
  // Free orders fulfill immediately.
  if (total === 0) {
    await fulfillOrder(db, orderId);
  }
  await audit(c, 'order.created', { entity: 'order', entityId: orderId, organizationId: parsed.data.organization_id, metadata: { total, currency } });
  return created(c, { id: orderId, total, currency, status: total === 0 ? 'paid' : 'pending' });
});

commerce.get('/orders', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const url = new URL(c.req.url);
  const orgId = url.searchParams.get('organization_id');
  const db = c.get('db');
  if (orgId) {
    if (!canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
    const role = orgRole(user, orgId);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') ?? '20') || 20));
    const mineOnly = role === 'student' || role === 'parent';
    const where = mineOnly ? 'organization_id = ? AND buyer_id = ?' : 'organization_id = ?';
    const params = mineOnly ? [orgId, user.id] : [orgId];
    const total = (await queryFirst<{ n: number }>(db, `SELECT COUNT(*) as n FROM orders WHERE ${where}`, ...params))?.n ?? 0;
    const rows = await queryAll(db, `SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage);
    return ok(c, rows, paginationMeta(total, page, perPage));
  }
  const rows = await queryAll(db, 'SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC LIMIT 100', user.id);
  return ok(c, rows);
});

commerce.get('/orders/:id', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const order = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM orders WHERE id = ?', c.req.param('id'));
  if (!order) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const orgId = order.organization_id as string;
  const role = orgRole(user, orgId);
  if (order.buyer_id !== user.id && !user.isSuperAdmin && role !== 'organization_admin' && role !== 'staff') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  const items = await queryAll(db, 'SELECT * FROM order_items WHERE order_id = ?', c.req.param('id'));
  const payments = await queryAll(db, 'SELECT id, provider, amount, status, created_at FROM payments WHERE order_id = ?', c.req.param('id'));
  return ok(c, { order, items, payments });
});

// ---------- Fulfillment (single writer of entitlements) ----------
export async function fulfillOrder(db: D1Like, orderId: string): Promise<void> {
  const order = await queryFirst<{ organization_id: string; buyer_id: string; kind: string; reference_id: string; status: string; total: number }>(
    db, 'SELECT organization_id, buyer_id, kind, reference_id, status, total FROM orders WHERE id = ?', orderId);
  // Idempotent: missing/refunded/cancelled orders are never fulfilled;
  // paid orders re-run safely (INSERT OR IGNORE throughout).
  if (!order || order.status === 'refunded' || order.status === 'cancelled') return;
  const now = nowIso();
  const grantCourse = async (courseId: string) => {
    const course = await queryFirst<{ access_days: number | null }>(db, 'SELECT access_days FROM courses WHERE id = ?', courseId);
    const expires = course?.access_days ? new Date(Date.now() + course.access_days * 86400000).toISOString() : null;
    await execute(db, 'INSERT OR IGNORE INTO entitlements (id, user_id, kind, reference_id, source, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), order.buyer_id, 'course', courseId, 'order', expires, now);
    await execute(db, 'INSERT OR IGNORE INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), courseId, order.buyer_id, 'active', now, now, now);
  };
  if (order.kind === 'course') await grantCourse(order.reference_id);
  else if (order.kind === 'bundle') {
    const courses = await queryAll<{ course_id: string }>(db, 'SELECT course_id FROM bundle_courses WHERE bundle_id = ?', order.reference_id);
    for (const course of courses) await grantCourse(course.course_id);
  } else if (order.kind === 'cohort') {
    await execute(db, 'INSERT OR IGNORE INTO entitlements (id, user_id, kind, reference_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), order.buyer_id, 'cohort', order.reference_id, 'order', now);
    await execute(db, 'INSERT INTO cohort_members (id, cohort_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cohort_id, user_id) DO NOTHING', newId(), order.reference_id, order.buyer_id, 'student', now);
    const courses = await queryAll<{ course_id: string }>(db, 'SELECT course_id FROM cohort_courses WHERE cohort_id = ?', order.reference_id);
    for (const course of courses) await grantCourse(course.course_id);
  }
  await execute(db, "UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?", now, orderId);
  // Invoice (idempotent per order).
  const existing = await queryFirst(db, 'SELECT id FROM invoices WHERE order_id = ?', orderId);
  if (!existing) {
    const buyer = await queryFirst<{ name: string; email: string }>(db, 'SELECT name, email FROM users WHERE id = ?', order.buyer_id);
    const items = await queryAll<{ title: string; amount: number }>(db, 'SELECT title, amount FROM order_items WHERE order_id = ?', orderId);
    await execute(db, 'INSERT INTO invoices (id, order_id, number, buyer_name, buyer_email, lines, total, issued_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(), orderId, `INV-${new Date().getUTCFullYear()}-${orderId.slice(0, 8).toUpperCase()}`, buyer?.name ?? '', buyer?.email ?? '', JSON.stringify(items), order.total, now, now);
  }
  // Instructor commissions (refund-aware; organization rate setting).
  const rateSetting = await orgSetting(db, order.organization_id, 'commission_rate');
  const rate = rateSetting ? Number(rateSetting) : 70;
  if (rate > 0) {
    if (order.kind === 'course') {
      const instructors = await queryAll<{ user_id: string }>(db, 'SELECT user_id FROM course_instructors WHERE course_id = ?', order.reference_id);
      const share = instructors.length ? rate / instructors.length : 0;
      for (const ins of instructors) {
        await execute(db, 'INSERT INTO commissions (id, organization_id, instructor_id, order_id, amount, rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          newId(), order.organization_id, ins.user_id, orderId, round2((order.total * share) / 100), share, now, now);
      }
    }
    // Affiliate commission.
    const affOrder = await queryFirst<{ affiliate_id: string | null }>(db, 'SELECT affiliate_id FROM orders WHERE id = ?', orderId);
    if (affOrder?.affiliate_id) {
      const aff = await queryFirst<{ user_id: string; commission_rate: number }>(db, 'SELECT user_id, commission_rate FROM affiliates WHERE id = ?', affOrder.affiliate_id);
      if (aff) {
        await execute(db, 'INSERT INTO commissions (id, organization_id, instructor_id, order_id, amount, rate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          newId(), order.organization_id, aff.user_id, orderId, round2((order.total * aff.commission_rate) / 100), aff.commission_rate, now, now);
        await execute(db, "UPDATE referrals SET status = 'converted' WHERE order_id = ?", orderId);
      }
    }
  }
}

// ---------- Manual payments ----------
commerce.post('/orders/:id/payments/manual', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const order = await queryFirst<{ organization_id: string; buyer_id: string; status: string; total: number; currency: string }>(db, 'SELECT organization_id, buyer_id, status, total, currency FROM orders WHERE id = ?', c.req.param('id'));
  if (!order) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (order.buyer_id !== user.id && !isPrivileged(user, order.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (order.status !== 'pending') return fail(c, 400, 'VALIDATION_ERROR', `Order is ${order.status}`);
  const body = (await c.req.json().catch(() => null)) as { reference?: string } | null;
  const now = nowIso();
  await execute(db, 'INSERT INTO payments (id, order_id, provider, provider_ref, amount, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(), c.req.param('id'), 'manual', body?.reference?.slice(0, 200) ?? null, order.total, order.currency, 'pending', now, now);
  await audit(c, 'payment.manual_claimed', { entity: 'order', entityId: c.req.param('id'), organizationId: order.organization_id });
  return created(c, { claimed: true });
});

commerce.post('/payments/:id/confirm', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const payment = await queryFirst<{ order_id: string; status: string }>(db, 'SELECT order_id, status FROM payments WHERE id = ?', c.req.param('id'));
  if (!payment) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const order = await queryFirst<{ organization_id: string }>(db, 'SELECT organization_id FROM orders WHERE id = ?', payment.order_id);
  if (!order || !isPrivileged(user, order.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (payment.status !== 'pending') return fail(c, 400, 'VALIDATION_ERROR', `Payment is ${payment.status}`);
  const now = nowIso();
  await execute(db, "UPDATE payments SET status = 'paid', updated_at = ? WHERE id = ?", now, c.req.param('id'));
  await fulfillOrder(db, payment.order_id);
  await audit(c, 'payment.confirmed', { entity: 'payment', entityId: c.req.param('id'), organizationId: order.organization_id });
  return ok(c, { confirmed: true });
});

// ---------- Provider adapter (signature-verified webhooks) ----------
async function sha512Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Midtrans-style: signature = SHA512(order_id + status_code + gross_amount + serverKey).
export async function verifyProviderSignature(provider: string, payload: Record<string, string>, serverKey: string): Promise<boolean> {
  if (provider === 'midtrans') {
    const { order_id, status_code, gross_amount, signature_key } = payload;
    if (!order_id || !status_code || !gross_amount || !signature_key) return false;
    const expected = await sha512Hex(`${order_id}${status_code}${gross_amount}${serverKey}`);
    if (expected.length !== signature_key.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature_key.charCodeAt(i);
    return diff === 0;
  }
  return false; // unknown providers are never trusted
}

commerce.post('/payments/webhooks/:provider', async (c) => {
  const provider = c.req.param('provider');
  const body = (await c.req.json().catch(() => null)) as Record<string, string> | null;
  if (!body) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid payload');
  const db = c.get('db');
  const eventId = body.transaction_id ?? body.order_id ?? JSON.stringify(body).slice(0, 120);
  // Replay protection: provider+event unique.
  try {
    await execute(db, 'INSERT INTO payment_webhooks (id, provider, event_id, payload, created_at) VALUES (?, ?, ?, ?, ?)', newId(), provider, eventId, JSON.stringify(body).slice(0, 8000), nowIso());
  } catch {
    return ok(c, { received: true, duplicate: true });
  }
  const order = await queryFirst<{ id: string; organization_id: string; total: number }>(db, 'SELECT id, organization_id, total FROM orders WHERE id = ?', body.order_id ?? '');
  if (!order) {
    await execute(db, "UPDATE payment_webhooks SET status = 'ignored' WHERE provider = ? AND event_id = ?", provider, eventId);
    return fail(c, 404, 'ORDER_NOT_FOUND', 'No matching order');
  }
  const serverKey = await orgSetting(db, order.organization_id, `payment_${provider}_server_key`);
  if (!serverKey || !(await verifyProviderSignature(provider, body, serverKey))) {
    await execute(db, "UPDATE payment_webhooks SET status = 'rejected' WHERE provider = ? AND event_id = ?", provider, eventId);
    return fail(c, 401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  }
  const now = nowIso();
  const status = body.transaction_status ?? '';
  const paid = ['capture', 'settlement'].includes(status);
  const failed = ['deny', 'cancel', 'expire', 'failure'].includes(status);
  await execute(db, 'INSERT INTO payments (id, order_id, provider, provider_ref, amount, currency, status, raw_payload, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING',
    newId(), order.id, provider, eventId.slice(0, 200), order.total, 'IDR', paid ? 'paid' : failed ? 'failed' : 'pending', JSON.stringify(body).slice(0, 4000), `${provider}:${eventId}`.slice(0, 200), now, now);
  if (paid) await fulfillOrder(db, order.id);
  else if (failed) await execute(db, "UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'", now, order.id);
  await execute(db, "UPDATE payment_webhooks SET status = 'processed', processed_at = ? WHERE provider = ? AND event_id = ?", now, provider, eventId);
  await audit(c, paid ? 'payment.webhook_paid' : 'payment.webhook_received', { entity: 'order', entityId: order.id, organizationId: order.organization_id });
  return ok(c, { received: true, paid });
});

// ---------- Refunds ----------
commerce.post('/orders/:id/refund', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const order = await queryFirst<{ organization_id: string; status: string; buyer_id: string }>(db, 'SELECT organization_id, status, buyer_id FROM orders WHERE id = ?', c.req.param('id'));
  if (!order) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!isPrivileged(user, order.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (order.status !== 'paid') return fail(c, 400, 'VALIDATION_ERROR', `Only paid orders can be refunded (status: ${order.status})`);
  const now = nowIso();
  await execute(db, "UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?", now, c.req.param('id'));
  await execute(db, "UPDATE commissions SET status = 'reversed', updated_at = ? WHERE order_id = ?", now, c.req.param('id'));
  // Revoke entitlements granted by this order (order-scoped via buyer + course links of items).
  const items = await queryAll<{ kind: string; reference_id: string }>(db, 'SELECT kind, reference_id FROM order_items WHERE order_id = ?', c.req.param('id'));
  for (const item of items) {
    if (item.kind === 'course') {
      await execute(db, 'DELETE FROM entitlements WHERE user_id = ? AND kind = ? AND reference_id = ?', order.buyer_id, 'course', item.reference_id);
      await execute(db, "UPDATE enrollments SET status = 'dropped', updated_at = ? WHERE course_id = ? AND student_id = ?", now, item.reference_id, order.buyer_id);
    } else if (item.kind === 'bundle') {
      const courses = await queryAll<{ course_id: string }>(db, 'SELECT course_id FROM bundle_courses WHERE bundle_id = ?', item.reference_id);
      for (const course of courses) {
        await execute(db, 'DELETE FROM entitlements WHERE user_id = ? AND kind = ? AND reference_id = ?', order.buyer_id, 'course', course.course_id);
        await execute(db, "UPDATE enrollments SET status = 'dropped', updated_at = ? WHERE course_id = ? AND student_id = ?", now, course.course_id, order.buyer_id);
      }
    }
  }
  await audit(c, 'order.refunded', { entity: 'order', entityId: c.req.param('id'), organizationId: order.organization_id });
  return ok(c, { refunded: true });
});

commerce.get('/subscription-plans', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const rows = await queryAll(c.get('db'), 'SELECT id, name, price, interval, trial_days FROM subscription_plans WHERE organization_id = ? AND is_active = 1 ORDER BY price ASC', orgId);
  return ok(c, rows);
});

// ---------- Subscriptions ----------
commerce.post('/subscription-plans', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; name?: string; price?: number; interval?: string; trial_days?: number } | null;
  if (!body?.organization_id || !body?.name || typeof body.price !== 'number') return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (!isPrivileged(user, body.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (body.interval && !['monthly', 'yearly'].includes(body.interval)) return fail(c, 400, 'VALIDATION_ERROR', 'interval must be monthly|yearly');
  const nid = newId();
  await execute(c.get('db'), 'INSERT INTO subscription_plans (id, organization_id, name, price, interval, trial_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nid, body.organization_id, body.name.slice(0, 150), round2(body.price), body.interval ?? 'monthly', body.trial_days ?? 0, nowIso());
  return created(c, { id: nid });
});

commerce.post('/subscriptions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const body = (await c.req.json().catch(() => null)) as { plan_id?: string } | null;  if (!body?.plan_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const plan = await queryFirst<{ organization_id: string; price: number; interval: string; trial_days: number }>(db, 'SELECT organization_id, price, interval, trial_days FROM subscription_plans WHERE id = ? AND is_active = 1', body.plan_id);
  if (!plan) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!canAccessOrg(user, plan.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const now = nowIso();
  const periodEnd = new Date(Date.now() + (plan.interval === 'yearly' ? 365 : 30) * 86400000).toISOString();
  const nid = newId();
  // First period is an order (paid or trial→free); recurring charges are provider-driven.
  await execute(db, 'INSERT INTO subscriptions (id, plan_id, buyer_id, status, current_period_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    nid, body.plan_id, user.id, plan.price === 0 ? 'active' : 'pending', periodEnd, now, now);
  return created(c, { id: nid, status: plan.price === 0 ? 'active' : 'pending', note: 'Recurring charges are collected by the configured payment provider' });
});

// ---------- Commissions & payouts (manual) ----------
commerce.get('/commissions', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  const where = role === 'teacher' ? 'c.organization_id = ? AND c.instructor_id = ?' : 'c.organization_id = ?';
  const params = role === 'teacher' ? [orgId, user.id] : [orgId];
  if (role !== 'teacher' && !isPrivileged(user, orgId) && role !== 'staff') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const rows = await queryAll(c.get('db'), `SELECT c.*, u.name as instructor_name FROM commissions c JOIN users u ON u.id = c.instructor_id WHERE ${where} ORDER BY c.created_at DESC LIMIT 200`, ...params);
  return ok(c, rows);
});

commerce.post('/payouts', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; amount?: number; method?: string } | null;
  if (!body?.organization_id || typeof body.amount !== 'number' || body.amount <= 0) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (!canAccessOrg(user, body.organization_id)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const nid = newId();
  await execute(c.get('db'), "INSERT INTO payouts (id, organization_id, instructor_id, amount, method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    nid, body.organization_id, user.id, round2(body.amount), (body.method ?? 'manual').slice(0, 40), nowIso(), nowIso());
  return created(c, { id: nid, note: 'Payouts are processed manually by the organization' });
});

commerce.post('/payouts/:id/decide', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const payout = await queryFirst<{ organization_id: string; status: string }>(db, 'SELECT organization_id, status FROM payouts WHERE id = ?', c.req.param('id'));
  if (!payout) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (!isPrivileged(user, payout.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (payout.status !== 'pending') return fail(c, 400, 'VALIDATION_ERROR', 'Already decided');
  const body = (await c.req.json().catch(() => null)) as { approve?: boolean; note?: string } | null;
  const status = body?.approve ? 'paid' : 'rejected';
  await execute(db, 'UPDATE payouts SET status = ?, note = ?, decided_by = ?, updated_at = ? WHERE id = ?', status, body?.note?.slice(0, 1000) ?? null, user.id, nowIso(), c.req.param('id'));
  await audit(c, 'payout.decided', { entity: 'payout', entityId: c.req.param('id'), organizationId: payout.organization_id, metadata: { status } });
  return ok(c, { status });
});

// ---------- Affiliates ----------
commerce.post('/affiliates', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { organization_id?: string; user_id?: string; code?: string; commission_rate?: number } | null;
  if (!body?.organization_id || !body?.user_id || !body?.code) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  if (!isPrivileged(user, body.organization_id)) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(body.code)) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid code');
  const nid = newId();
  try {
    await execute(c.get('db'), 'INSERT INTO affiliates (id, organization_id, user_id, code, commission_rate, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      nid, body.organization_id, body.user_id, body.code.toUpperCase(), body.commission_rate ?? 10, nowIso());
  } catch {
    return fail(c, 409, 'CONFLICT', t('conflict', c.get('lang')));
  }
  return created(c, { id: nid });
});

commerce.post('/referrals', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const body = (await c.req.json().catch(() => null)) as { affiliate_code?: string; organization_id?: string } | null;
  if (!body?.affiliate_code || !body?.organization_id) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const db = c.get('db');
  const aff = await queryFirst<{ id: string; user_id: string; is_active: number }>(db, 'SELECT id, user_id, is_active FROM affiliates WHERE organization_id = ? AND code = ?', body.organization_id, body.affiliate_code.toUpperCase());
  if (!aff || !aff.is_active) return fail(c, 400, 'VALIDATION_ERROR', 'Invalid affiliate code');
  if (aff.user_id === user.id) return fail(c, 400, 'SELF_REFERRAL', 'Affiliates cannot refer themselves');
  const expiryDays = Number((await orgSetting(db, body.organization_id, 'affiliate_expiry_days')) || 30);
  await execute(db, 'INSERT INTO referrals (id, affiliate_id, buyer_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    newId(), aff.id, user.id, 'clicked', new Date(Date.now() + expiryDays * 86400000).toISOString(), nowIso());
  return created(c, { tracked: true });
});

// ---------- Gifts ----------
commerce.post('/orders/:id/gift', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const order = await queryFirst<{ buyer_id: string; status: string }>(db, 'SELECT buyer_id, status FROM orders WHERE id = ?', c.req.param('id'));
  if (!order) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  if (order.buyer_id !== user.id) return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  if (order.status !== 'paid') return fail(c, 400, 'VALIDATION_ERROR', 'Only paid orders can be gifted');
  const body = (await c.req.json().catch(() => null)) as { recipient_email?: string } | null;
  if (!body?.recipient_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.recipient_email)) {
    return fail(c, 400, 'VALIDATION_ERROR', 'Valid recipient email required');
  }
  const code = `GIFT-${newId().slice(0, 8).toUpperCase()}`;
  await execute(db, 'INSERT INTO gifts (id, order_id, recipient_email, code, created_at) VALUES (?, ?, ?, ?, ?)', newId(), c.req.param('id'), body.recipient_email.toLowerCase(), code, nowIso());
  return created(c, { code });
});

commerce.post('/gifts/redeem', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const body = (await c.req.json().catch(() => null)) as { code?: string } | null;
  if (!body?.code) return fail(c, 400, 'VALIDATION_ERROR', t('validation_failed', c.get('lang')));
  const gift = await queryFirst<{ id: string; order_id: string; status: string }>(db, 'SELECT id, order_id, status FROM gifts WHERE code = ?', body.code.toUpperCase());
  if (!gift || gift.status !== 'issued') return fail(c, 404, 'NOT_FOUND', 'Invalid or redeemed gift code');
  const order = await queryFirst<{ kind: string; reference_id: string }>(db, 'SELECT kind, reference_id FROM orders WHERE id = ?', gift.order_id);
  if (!order) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const now = nowIso();
  if (order.kind === 'course') {
    await execute(db, 'INSERT OR IGNORE INTO entitlements (id, user_id, kind, reference_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), user.id, 'course', order.reference_id, 'gift', now);
    await execute(db, 'INSERT OR IGNORE INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), order.reference_id, user.id, 'active', now, now, now);
  } else if (order.kind === 'bundle') {
    const courses = await queryAll<{ course_id: string }>(db, 'SELECT course_id FROM bundle_courses WHERE bundle_id = ?', order.reference_id);
    for (const course of courses) {
      await execute(db, 'INSERT OR IGNORE INTO entitlements (id, user_id, kind, reference_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?)', newId(), user.id, 'course', course.course_id, 'gift', now);
      await execute(db, 'INSERT OR IGNORE INTO enrollments (id, course_id, student_id, status, enrolled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), course.course_id, user.id, 'active', now, now, now);
    }
  }
  await execute(db, "UPDATE gifts SET status = 'redeemed', recipient_id = ? WHERE id = ?", user.id, gift.id);
  return ok(c, { redeemed: true });
});

// ---------- Public catalog (marketplace storefront; published + public only) ----------
commerce.get('/catalog/courses', async (c) => {
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  const q = (new URL(c.req.url).searchParams.get('q') ?? '').slice(0, 100);
  const db = c.get('db');
  const where = "status = 'published' AND visibility = 'public' AND deleted_at IS NULL";
  const params: (string | number)[] = [];
  let scope = '';
  if (orgId) { scope = 'AND organization_id = ?'; params.push(orgId); }
  const like = q ? 'AND (title LIKE ? OR code LIKE ?)' : '';
  if (q) params.push(`%${q}%`, `%${q}%`);
  const rows = await queryAll(db, `SELECT id, organization_id, code, title, description, price, thumbnail_url FROM courses WHERE ${where} ${scope} ${like} ORDER BY created_at DESC LIMIT 50`, ...params);
  return ok(c, rows);
});

commerce.get('/catalog/bundles', async (c) => {
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  const db = c.get('db');
  const rows = await queryAll(db, `SELECT * FROM bundles WHERE status = 'published' ${orgId ? 'AND organization_id = ?' : ''} ORDER BY created_at DESC LIMIT 50`, ...(orgId ? [orgId] : []));
  return ok(c, rows);
});

commerce.get('/catalog/bundles/:id', async (c) => {
  const db = c.get('db');
  const bundle = await queryFirst<{ id: string; name: string; description: string | null; price: number }>(db, "SELECT id, name, description, price FROM bundles WHERE id = ? AND status = 'published'", c.req.param('id'));
  if (!bundle) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const courses = await queryAll(db, 'SELECT co.id, co.title, co.code, co.price FROM bundle_courses bc JOIN courses co ON co.id = bc.course_id WHERE bc.bundle_id = ?', c.req.param('id'));
  return ok(c, { bundle, courses });
});

commerce.get('/catalog/instructors/:id', async (c) => {
  const db = c.get('db');
  const user = await queryFirst<{ id: string; name: string }>(db, 'SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL', c.req.param('id'));
  if (!user) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  // Public profile: name + published public courses only. No email, no internals.
  const courses = await queryAll(db, "SELECT id, title, code, price, organization_id FROM courses WHERE id IN (SELECT course_id FROM course_instructors WHERE user_id = ?) AND status = 'published' AND visibility = 'public' AND deleted_at IS NULL LIMIT 50", c.req.param('id'));
  return ok(c, { instructor: user, courses });
});

// ---------- Revenue report ----------
commerce.get('/commerce/revenue', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const orgId = new URL(c.req.url).searchParams.get('organization_id');
  if (!orgId || !canAccessOrg(user, orgId)) return fail(c, 403, 'TENANT_DENIED', t('tenant_denied', c.get('lang')));
  const role = orgRole(user, orgId);
  if (!isPrivileged(user, orgId) && role !== 'staff') return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  const db = c.get('db');
  const byStatus = await queryAll<{ status: string; n: number; total: number }>(db, 'SELECT status, COUNT(*) as n, COALESCE(SUM(total),0) as total FROM orders WHERE organization_id = ? GROUP BY status', orgId);
  const discounts = (await queryFirst<{ v: number | null }>(db, 'SELECT SUM(discount) as v FROM orders WHERE organization_id = ?', orgId))?.v ?? 0;
  const paidCommissions = (await queryFirst<{ v: number | null }>(db, "SELECT SUM(amount) as v FROM commissions WHERE organization_id = ? AND status = 'pending'", orgId))?.v ?? 0;
  return ok(c, { by_status: byStatus, total_discounts: round2(discounts), pending_commissions: round2(paidCommissions) });
});

commerce.get('/invoices/order/:orderId', requireAuth(), async (c) => {
  const user = c.get('user') as AuthUser;
  const db = c.get('db');
  const inv = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE order_id = ?', c.req.param('orderId'));
  if (!inv) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const order = await queryFirst<{ buyer_id: string; organization_id: string }>(db, 'SELECT buyer_id, organization_id FROM orders WHERE id = ?', c.req.param('orderId'));
  if (!order) return fail(c, 404, 'NOT_FOUND', t('not_found', c.get('lang')));
  const role = order ? orgRole(user, order.organization_id) : null;
  if (order.buyer_id !== user.id && !isPrivileged(user, order.organization_id) && role !== 'staff') {
    return fail(c, 403, 'FORBIDDEN', t('forbidden', c.get('lang')));
  }
  return ok(c, inv);
});

export default commerce;
