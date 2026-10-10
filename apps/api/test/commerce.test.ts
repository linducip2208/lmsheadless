import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execute, queryFirst } from '../src/db.js';
import { newId, nowIso } from '@lms/shared';
import { setup, mkOrg, mkUser, login, mkCourse, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

async function paidCourse(
  app: ReturnType<(typeof import('../src/app.js'))['createApp']>,
  tokT: string,
  org: string,
  code: string,
  price: number
) {
  const res = (await (
    await app.request('/api/v1/courses', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ organization_id: org, code, title: `Paid ${code}`, price }),
    })
  ).json()) as { data: { id: string } };
  return res.data.id;
}

describe('commerce core', () => {
  it('bundles, coupons, orders with server-side totals, manual payments, refunds, invoices', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'shop');
    const t = await mkUser(db, 't@shop.com', 'teacher', org);
    await mkUser(db, 'adm@shop.com', 'organization_admin', org);
    await mkUser(db, 's@shop.com', 'student', org);
    const tokT = (await login(app, 't@shop.com')).access_token;
    const tokA = (await login(app, 'adm@shop.com')).access_token;
    const tokS = (await login(app, 's@shop.com')).access_token;
    const c1 = await paidCourse(app, tokT, org, 'SHOP1', 100);
    const c2 = await paidCourse(app, tokT, org, 'SHOP2', 50);
    await execute(
      db,
      'INSERT INTO course_instructors (id, course_id, user_id, created_at) VALUES (?, ?, ?, ?)',
      newId(),
      c1,
      t,
      nowIso()
    );
    // bundle
    const bundle = (await (
      await app.request('/api/v1/bundles', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({
          organization_id: org,
          name: 'Pack',
          price: 120,
          course_ids: [c1, c2],
        }),
      })
    ).json()) as { data: { id: string } };
    // cross-org course in bundle rejected
    const org2 = await mkOrg(db, 'shop2');
    const t2 = await mkUser(db, 't2@shop.com', 'teacher', org2);
    const cx = await mkCourse(db, org2, t2, 'X1');
    const badBundle = await app.request('/api/v1/bundles', {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ organization_id: org, name: 'Bad', price: 10, course_ids: [cx] }),
    });
    expect(badBundle.status).toBe(403);
    // coupons
    await app.request('/api/v1/coupons', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, code: 'DISKON10', kind: 'percent', value: 10 }),
    });
    const dupCoupon = await app.request('/api/v1/coupons', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, code: 'DISKON10', kind: 'fixed', value: 5 }),
    });
    expect(dupCoupon.status).toBe(409);
    const couponsList = await app.request(`/api/v1/coupons?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    expect(couponsList.status).toBe(403); // privileged only
    // order with coupon: 100 - 10% = 90
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          organization_id: org,
          kind: 'course',
          reference_id: c1,
          coupon_code: 'DISKON10',
        }),
      })
    ).json()) as { data: { id: string; total: number; status: string } };
    expect(order.data.total).toBe(90);
    expect(order.data.status).toBe('pending');
    // bad coupon rejected, amounts never trusted
    const badCoupon = await app.request('/api/v1/orders', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({
        organization_id: org,
        kind: 'course',
        reference_id: c1,
        coupon_code: 'NOPE',
      }),
    });
    expect(badCoupon.status).toBe(400);
    // manual claim (buyer) + confirm (admin) → paid + fulfilled
    const claim = await app.request(`/api/v1/orders/${order.data.id}/payments/manual`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ reference: 'TRX-1' }),
    });
    expect(claim.status).toBe(201);
    const confirmDeny = await app.request(`/api/v1/payments/xxx/confirm`, {
      method: 'POST',
      headers: authHeader(tokS),
    });
    expect([403, 404].includes(confirmDeny.status)).toBe(true);
    const payments = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM payments WHERE order_id = ?',
      order.data.id
    );
    const confirm = await app.request(`/api/v1/payments/${payments?.id}/confirm`, {
      method: 'POST',
      headers: authHeader(tokA),
    });
    expect(confirm.status).toBe(200);
    const orderRow = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM orders WHERE id = ?',
      order.data.id
    );
    expect(orderRow?.status).toBe('paid');
    // fulfillment: entitlement + enrollment + commission (70% default of 90 = 63)
    const ent = await queryFirst(
      db,
      'SELECT id FROM entitlements WHERE user_id = (SELECT id FROM users WHERE email = ?) AND reference_id = ?',
      's@shop.com',
      c1
    );
    expect(ent).toBeTruthy();
    const comm = await queryFirst<{ amount: number }>(
      db,
      'SELECT amount FROM commissions WHERE order_id = ?',
      order.data.id
    );
    expect(comm?.amount).toBe(63);
    // invoice exists
    const inv = await app.request(`/api/v1/invoices/order/${order.data.id}`, {
      headers: authHeader(tokS),
    });
    expect(inv.status).toBe(200);
    // double confirm rejected
    const confirm2 = await app.request(`/api/v1/payments/${payments?.id}/confirm`, {
      method: 'POST',
      headers: authHeader(tokA),
    });
    expect(confirm2.status).toBe(400);
    // refund reverses everything
    const student = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM users WHERE email = ?',
      's@shop.com'
    );
    const refund = await app.request(`/api/v1/orders/${order.data.id}/refund`, {
      method: 'POST',
      headers: authHeader(tokA),
    });
    expect(refund.status).toBe(200);
    const entGone = await queryFirst(
      db,
      'SELECT id FROM entitlements WHERE user_id = ? AND reference_id = ?',
      student?.id ?? '',
      c1
    );
    expect(entGone).toBeNull();
    const commRev = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM commissions WHERE order_id = ?',
      order.data.id
    );
    expect(commRev?.status).toBe('reversed');
    const enrDropped = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM enrollments WHERE course_id = ? AND student_id = ?',
      c1,
      student?.id ?? ''
    );
    expect(enrDropped?.status).toBe('dropped');
    // revenue report
    const rev = await app.request(`/api/v1/commerce/revenue?organization_id=${org}`, {
      headers: authHeader(tokA),
    });
    expect(rev.status).toBe(200);
    const revDeny = await app.request(`/api/v1/commerce/revenue?organization_id=${org}`, {
      headers: authHeader(tokS),
    });
    expect(revDeny.status).toBe(403);
    void bundle;
  });

  it('free orders fulfill immediately; gifts and subscriptions work', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'free');
    const t = await mkUser(db, 't@free.com', 'teacher', org);
    await mkUser(db, 'adm@free.com', 'organization_admin', org);
    await mkUser(db, 's@free.com', 'student', org);
    await mkUser(db, 'g@free.com', 'student', org);
    await login(app, 't@free.com');
    const tokA = (await login(app, 'adm@free.com')).access_token;
    const tokS = (await login(app, 's@free.com')).access_token;
    const c = await mkCourse(db, org, t, 'FREE1');
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as { data: { id: string; status: string; total: number } };
    expect(order.data.status).toBe('paid');
    expect(order.data.total).toBe(0);
    // gift paid order
    const gift = (await (
      await app.request(`/api/v1/orders/${order.data.id}/gift`, {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ recipient_email: 'g@free.com' }),
      })
    ).json()) as { data: { code: string } };
    const redeem = await app.request('/api/v1/gifts/redeem', {
      method: 'POST',
      headers: H((await login(app, 'g@free.com')).access_token),
      body: JSON.stringify({ code: gift.data.code }),
    });
    expect(redeem.status).toBe(200);
    const redeem2 = await app.request('/api/v1/gifts/redeem', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ code: gift.data.code }),
    });
    expect(redeem2.status).toBe(404);
    // subscriptions
    const plan = (await (
      await app.request('/api/v1/subscription-plans', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({
          organization_id: org,
          name: 'Monthly',
          price: 29,
          interval: 'monthly',
        }),
      })
    ).json()) as { data: { id: string } };
    const sub = (await (
      await app.request('/api/v1/subscriptions', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ plan_id: plan.data.id }),
      })
    ).json()) as { data: { status: string } };
    expect(sub.data.status).toBe('pending');
    void db;
  });

  it('affiliates attribute with anti-self-referral; payouts are manual', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'aff');
    const t = await mkUser(db, 't@aff.com', 'teacher', org);
    await mkUser(db, 'adm@aff.com', 'organization_admin', org);
    const buyer = await mkUser(db, 'b@aff.com', 'student', org);
    const tokT = (await login(app, 't@aff.com')).access_token;
    const tokA = (await login(app, 'adm@aff.com')).access_token;
    const tokB = (await login(app, 'b@aff.com')).access_token;
    const c = await paidCourse(app, tokT, org, 'AFF1', 200);
    await execute(
      db,
      'INSERT INTO course_instructors (id, course_id, user_id, created_at) VALUES (?, ?, ?, ?)',
      newId(),
      c,
      t,
      nowIso()
    );
    const aff = (await (
      await app.request('/api/v1/affiliates', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({
          organization_id: org,
          user_id: buyer,
          code: 'TEMAN10',
          commission_rate: 15,
        }),
      })
    ).json()) as { data: { id: string } };
    void aff;
    // self-referral blocked at order time
    const self = await app.request('/api/v1/orders', {
      method: 'POST',
      headers: H(tokB),
      body: JSON.stringify({
        organization_id: org,
        kind: 'course',
        reference_id: c,
        affiliate_code: 'TEMAN10',
      }),
    });
    expect(self.status).toBe(400);
    // click tracking + real buyer converts
    await mkUser(db, 'c@aff.com', 'student', org);
    const tokC = (await login(app, 'c@aff.com')).access_token;
    const click = await app.request('/api/v1/referrals', {
      method: 'POST',
      headers: H(tokC),
      body: JSON.stringify({ affiliate_code: 'TEMAN10', organization_id: org }),
    });
    expect(click.status).toBe(201);
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokC),
        body: JSON.stringify({
          organization_id: org,
          kind: 'course',
          reference_id: c,
          affiliate_code: 'TEMAN10',
        }),
      })
    ).json()) as { data: { id: string } };
    const pay = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM payments WHERE order_id = ?',
      order.data.id
    ).catch(() => null);
    void pay;
    // pay via manual flow then check affiliate commission (15% of 200 = 30)
    await app.request(`/api/v1/orders/${order.data.id}/payments/manual`, {
      method: 'POST',
      headers: H(tokC),
      body: JSON.stringify({}),
    });
    const p2 = await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM payments WHERE order_id = ?',
      order.data.id
    );
    await app.request(`/api/v1/payments/${p2?.id}/confirm`, {
      method: 'POST',
      headers: authHeader(tokA),
    });
    const affComm = await queryFirst<{ amount: number }>(
      db,
      'SELECT amount FROM commissions WHERE order_id = ? AND instructor_id = ?',
      order.data.id,
      buyer
    );
    expect(affComm?.amount).toBe(30);
    // payout request + approval
    const payout = (await (
      await app.request('/api/v1/payouts', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, amount: 50 }),
      })
    ).json()) as { data: { id: string } };
    const decide = await app.request(`/api/v1/payouts/${payout.data.id}/decide`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ approve: true }),
    });
    expect(decide.status).toBe(200);
    const decideDeny = await app.request(`/api/v1/payouts/${payout.data.id}/decide`, {
      method: 'POST',
      headers: H(tokB),
      body: JSON.stringify({ approve: true }),
    });
    expect(decideDeny.status).toBe(403);
  });

  it('webhooks verify signatures, process idempotently, reject forgeries', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'wh');
    await mkUser(db, 't@wh.com', 'teacher', org);
    await mkUser(db, 'adm@wh.com', 'organization_admin', org);
    await mkUser(db, 's@wh.com', 'student', org);
    const tokT = (await login(app, 't@wh.com')).access_token;
    const tokA = (await login(app, 'adm@wh.com')).access_token;
    const tokS = (await login(app, 's@wh.com')).access_token;
    const c = await paidCourse(app, tokT, org, 'WH1', 100);
    await app.request(`/api/v1/organizations/${org}`, {
      method: 'PUT',
      headers: H(tokA),
      body: JSON.stringify({ settings: { payment_midtrans_server_key: 's3cr3t' } }),
    });
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as { data: { id: string; total: number } };
    const sig = createHash('sha512')
      .update(`${order.data.id}200${order.data.total}s3cr3t`)
      .digest('hex');
    const payload = {
      order_id: order.data.id,
      status_code: '200',
      gross_amount: String(order.data.total),
      signature_key: sig,
      transaction_status: 'settlement',
      transaction_id: 'trx-1',
    };
    const hook = await app.request('/api/v1/payments/webhooks/midtrans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(hook.status).toBe(200);
    const st = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM orders WHERE id = ?',
      order.data.id
    );
    expect(st?.status).toBe('paid');
    // replay → duplicate, no double fulfillment side effects beyond idempotent writes
    const replay = (await (
      await app.request('/api/v1/payments/webhooks/midtrans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
    ).json()) as { data: { duplicate: boolean } };
    expect(replay.data.duplicate).toBe(true);
    // forgery rejected
    const forged = await app.request('/api/v1/payments/webhooks/midtrans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, transaction_id: 'trx-2', signature_key: '0'.repeat(128) }),
    });
    expect(forged.status).toBe(401);
    // unknown provider never trusted
    const unknown = await app.request('/api/v1/payments/webhooks/evilpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: order.data.id }),
    });
    expect(unknown.status).toBe(401);
  });
});

describe('minor-unit money arithmetic', () => {
  it('computes percent/fixed/tax in integer cents with half-up rounding', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cents');
    await mkUser(db, 'adm@cents.com', 'organization_admin', org);
    await mkUser(db, 's@cents.com', 'student', org);
    const tokA = (await login(app, 'adm@cents.com')).access_token;
    const tokS = (await login(app, 's@cents.com')).access_token;
    // Course priced 9.99 → 999 minor via API.
    const c = (await (
      await app.request('/api/v1/courses', {
        method: 'POST',
        headers: H(tokA),
        body: JSON.stringify({ organization_id: org, code: 'CENTS1', title: 'Cents', price: 9.99 }),
      })
    ).json()) as { data: { id: string } };
    const row = await queryFirst<{ price_minor: number; price: number }>(
      db,
      'SELECT price_minor, price FROM courses WHERE id = ?',
      c.data.id
    );
    expect(row?.price_minor).toBe(999);
    expect(row?.price).toBe(9.99);
    // 15% of 999 = 149.85 → 150 minor (half-up), total 849.
    await app.request('/api/v1/coupons', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, code: 'P15', kind: 'percent', value: 15 }),
    });
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          organization_id: org,
          kind: 'course',
          reference_id: c.data.id,
          coupon_code: 'P15',
        }),
      })
    ).json()) as {
      data: { id: string; total: number; total_minor: number };
    };
    expect(order.data.total_minor).toBe(849);
    expect(order.data.total).toBe(8.49);
    const stored = await queryFirst<{
      subtotal_minor: number;
      discount_minor: number;
      total_minor: number;
    }>(
      db,
      'SELECT subtotal_minor, discount_minor, total_minor FROM orders WHERE id = ?',
      order.data.id
    );
    expect(stored).toEqual({ subtotal_minor: 999, discount_minor: 150, total_minor: 849 });
    // Fixed coupon in minor units, capped at subtotal.
    await app.request('/api/v1/coupons', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({
        organization_id: org,
        code: 'F50',
        kind: 'fixed',
        value: 0,
        value_minor: 5000,
      }),
    });
    const big = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          organization_id: org,
          kind: 'course',
          reference_id: c.data.id,
          coupon_code: 'F50',
        }),
      })
    ).json()) as {
      data: { total_minor: number; status: string };
    };
    expect(big.data.total_minor).toBe(0);
    expect(big.data.status).toBe('paid'); // fully discounted → auto-fulfilled
    // Unvalidated value_minor rejected.
    const bad = await app.request('/api/v1/coupons', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({
        organization_id: org,
        code: 'BAD',
        kind: 'fixed',
        value: 1,
        value_minor: 1.5,
      }),
    });
    expect(bad.status).toBe(400);
  });

  it('legacy REAL rows fall back to rounded minor units', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'legacy');
    const t = await mkUser(db, 't@legacy.com', 'teacher', org);
    await mkUser(db, 's@legacy.com', 'student', org);
    const tokS = (await login(app, 's@legacy.com')).access_token;
    // Simulate a pre-017 row: REAL price set, minor zeroed.
    const c = await mkCourse(db, org, t, 'LEG1');
    await execute(db, 'UPDATE courses SET price = 19.99, price_minor = 0 WHERE id = ?', c);
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as {
      data: { total_minor: number };
    };
    expect(order.data.total_minor).toBe(1999);
  });
});

describe('marketplace auto-join', () => {
  it('buyers outside the organization auto-join as students on order', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'guest');
    const t = await mkUser(db, 't@guest.com', 'teacher', org);
    await mkUser(db, 'guest@guest.com', null);
    const tokT = (await login(app, 't@guest.com')).access_token;
    const tokG = (await login(app, 'guest@guest.com')).access_token;
    const c = await paidCourse(app, tokT, org, 'GUEST1', 50);
    const order = await app.request('/api/v1/orders', {
      method: 'POST',
      headers: H(tokG),
      body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
    });
    expect(order.status).toBe(201);
    const member = await queryFirst<{ role: string }>(
      db,
      'SELECT role FROM organization_members WHERE organization_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)',
      org,
      'guest@guest.com'
    );
    expect(member?.role).toBe('student');
    void t;
    void db;
  });
});

describe('public catalog', () => {
  it('lists only published public courses; instructor profiles hide emails', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cat');
    const t = await mkUser(db, 't@cat.com', 'teacher', org);
    const tokT = (await login(app, 't@cat.com')).access_token;
    const c1 = await paidCourse(app, tokT, org, 'CAT1', 100);
    await execute(
      db,
      "UPDATE courses SET status = 'published', visibility = 'public' WHERE id = ?",
      c1
    );
    await execute(
      db,
      'INSERT INTO course_instructors (id, course_id, user_id, created_at) VALUES (?, ?, ?, ?)',
      newId(),
      c1,
      t,
      nowIso()
    );
    const list = (await (
      await app.request(`/api/v1/catalog/courses?organization_id=${org}`)
    ).json()) as { data: { id: string }[] };
    expect(list.data.some((x) => x.id === c1)).toBe(true);
    const q = (await (await app.request(`/api/v1/catalog/courses?q=NOPEZZZ`)).json()) as {
      data: unknown[];
    };
    expect(q.data.length).toBe(0);
    const prof = (await (await app.request(`/api/v1/catalog/instructors/${t}`)).json()) as {
      data: { instructor: Record<string, unknown>; courses: { id: string }[] };
    };
    expect(prof.data.instructor.email).toBeUndefined();
    expect(prof.data.courses.some((x) => x.id === c1)).toBe(true);
    const missing = await app.request('/api/v1/catalog/instructors/nope');
    expect(missing.status).toBe(404);
    void db;
  });
});
