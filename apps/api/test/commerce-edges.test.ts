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

describe('webhook amount matching', () => {
  it('rejects signed-but-underpaid events without fulfilling', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'amt');
    await mkUser(db, 't@amt.test', 'teacher', org);
    await mkUser(db, 'adm@amt.test', 'organization_admin', org);
    await mkUser(db, 's@amt.test', 'student', org);
    const tokT = (await login(app, 't@amt.test')).access_token;
    const tokA = (await login(app, 'adm@amt.test')).access_token;
    const tokS = (await login(app, 's@amt.test')).access_token;
    const c = await paidCourse(app, tokT, org, 'AMT1', 100);
    await app.request(`/api/v1/organizations/${org}`, {
      method: 'PUT',
      headers: H(tokA),
      body: JSON.stringify({ settings: { payment_midtrans_server_key: 'k1' } }),
    });
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as { data: { id: string; total: number } };
    // Correctly signed but claims gross_amount=1 on a 100 order.
    const sig = createHash('sha512').update(`${order.data.id}2001k1`).digest('hex');
    const res = await app.request('/api/v1/payments/webhooks/midtrans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        order_id: order.data.id,
        status_code: '200',
        gross_amount: '1',
        signature_key: sig,
        transaction_status: 'settlement',
        transaction_id: 'underpaid-1',
      }),
    });
    expect(res.status).toBe(402);
    const st = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM orders WHERE id = ?',
      order.data.id
    );
    expect(st?.status).toBe('pending');
    // The rejected event is recorded for forensics but never fulfilled.
    const row = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM payment_webhooks WHERE event_id = ?',
      'underpaid-1'
    );
    expect(row?.status).toBe('rejected');
    const pays = await queryFirst<{ n: number }>(
      db,
      'SELECT COUNT(*) as n FROM payments WHERE order_id = ?',
      order.data.id
    );
    expect(pays?.n).toBe(0);
  });
});

describe('cohort gift redemption grants access', () => {
  it('redeem grants cohort + membership + courses', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'gft');
    await mkUser(db, 't@gft.test', 'teacher', org);
    await mkUser(db, 'adm@gft.test', 'organization_admin', org);
    await mkUser(db, 's@gft.test', 'student', org);
    await mkUser(db, 'r@gft.test', 'student', org);
    const tokT = (await login(app, 't@gft.test')).access_token;
    const tokA = (await login(app, 'adm@gft.test')).access_token;
    const tokS = (await login(app, 's@gft.test')).access_token;
    const tokR = (await login(app, 'r@gft.test')).access_token;
    const buyer = (await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM users WHERE email = ?',
      's@gft.test'
    ))!.id;
    const recip = (await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM users WHERE email = ?',
      'r@gft.test'
    ))!.id;
    const c = await paidCourse(app, tokT, org, 'GF1', 10);
    const cohort = (await (
      await app.request('/api/v1/cohorts', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Gift cohort' }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/cohorts/${cohort.data.id}/courses`, {
      method: 'POST',
      headers: H(tokT),
      body: JSON.stringify({ course_id: c }),
    });
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          organization_id: org,
          kind: 'cohort',
          reference_id: cohort.data.id,
        }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/orders/${order.data.id}/payments/manual`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ reference: 'GFT-1' }),
    });
    const pay = (await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM payments WHERE order_id = ?',
      order.data.id
    ))!.id;
    void buyer;
    await app.request(`/api/v1/payments/${pay}/confirm`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ approve: true }),
    });
    const gift = (await (
      await app.request(`/api/v1/orders/${order.data.id}/gift`, {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ recipient_email: 'r@gft.test' }),
      })
    ).json()) as { data: { code: string } };
    const redeem = await app.request('/api/v1/gifts/redeem', {
      method: 'POST',
      headers: H(tokR),
      body: JSON.stringify({ code: gift.data.code }),
    });
    expect(redeem.status).toBe(200);
    const member = await queryFirst(
      db,
      'SELECT id FROM cohort_members WHERE cohort_id = ? AND user_id = ?',
      cohort.data.id,
      recip
    );
    expect(member).toBeTruthy();
    const enr = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM enrollments WHERE course_id = ? AND student_id = ?',
      c,
      recip
    );
    expect(enr?.status).toBe('active');
  });
});

describe('sequential double transitions stay rejected', () => {
  it('second refund and second payout decision fail without state change', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'dbl');
    const t = await mkUser(db, 't@dbl.test', 'teacher', org);
    await mkUser(db, 'adm@dbl.test', 'organization_admin', org);
    await mkUser(db, 's@dbl.test', 'student', org);
    const tokT = (await login(app, 't@dbl.test')).access_token;
    const tokA = (await login(app, 'adm@dbl.test')).access_token;
    const tokS = (await login(app, 's@dbl.test')).access_token;
    const c = await paidCourse(app, tokT, org, 'DBL1', 50);
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as { data: { id: string } };
    await app.request(`/api/v1/orders/${order.data.id}/payments/manual`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ reference: 'DBL-1' }),
    });
    const pay = (await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM payments WHERE order_id = ?',
      order.data.id
    ))!.id;
    await app.request(`/api/v1/payments/${pay}/confirm`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ approve: true }),
    });
    const r1 = await app.request(`/api/v1/orders/${order.data.id}/refund`, {
      method: 'POST',
      headers: H(tokA),
    });
    expect(r1.status).toBe(200);
    const r2 = await app.request(`/api/v1/orders/${order.data.id}/refund`, {
      method: 'POST',
      headers: H(tokA),
    });
    expect([400, 409]).toContain(r2.status);
    const st = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM orders WHERE id = ?',
      order.data.id
    );
    expect(st?.status).toBe('refunded');
    // Payout double-decide.
    const mk = await app.request('/api/v1/payouts', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, amount: 10 }),
    });
    expect(mk.status).toBe(201);
    const pid = (await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM payouts WHERE organization_id = ?',
      org
    ))!.id;
    const d1 = await app.request(`/api/v1/payouts/${pid}/decide`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ approve: true }),
    });
    expect(d1.status).toBe(200);
    const d2 = await app.request(`/api/v1/payouts/${pid}/decide`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ approve: false }),
    });
    expect([400, 409]).toContain(d2.status);
    const pst = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM payouts WHERE id = ?',
      pid
    );
    expect(pst?.status).toBe('paid');
    void t;
  });
});

describe('money input guards', () => {
  it('rejects negative subscription prices and affiliate rates; sanitizes garbage org rates', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'grd2');
    await mkUser(db, 't@grd2.test', 'teacher', org);
    await mkUser(db, 'adm@grd2.test', 'organization_admin', org);
    await mkUser(db, 's@grd2.test', 'student', org);
    const tokA = (await login(app, 'adm@grd2.test')).access_token;
    const tokS = (await login(app, 's@grd2.test')).access_token;
    const negPlan = await app.request('/api/v1/subscription-plans', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ organization_id: org, name: 'Bad', price: -5 }),
    });
    expect(negPlan.status).toBe(400);
    const badAff = await app.request('/api/v1/affiliates', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({
        organization_id: org,
        user_id: 'x',
        code: 'BAD1',
        commission_rate: 150,
      }),
    });
    expect(badAff.status).toBe(400);
    // Garbage org rates cannot poison an order (NaN guard).
    await app.request(`/api/v1/organizations/${org}`, {
      method: 'PUT',
      headers: H(tokA),
      body: JSON.stringify({ settings: { tax_rate: 'not-a-number', commission_rate: '999x' } }),
    });
    const t = await mkUser(db, 't2@grd2.test', 'teacher', org);
    const c = await mkCourse(db, org, t, 'GRD1');
    await execute(db, 'UPDATE courses SET price = 100, price_minor = 10000 WHERE id = ?', c);
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({ organization_id: org, kind: 'course', reference_id: c }),
      })
    ).json()) as { data: { total_minor: number; total: number } };
    expect(order.data.total_minor).toBe(10000);
    expect(order.data.total).toBe(100);
    void newId;
    void nowIso;
  });

  it('currency codes are stored as-is; math stays currency-agnostic', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cur');
    await mkUser(db, 't@cur.test', 'teacher', org);
    await mkUser(db, 's@cur.test', 'student', org);
    const tokT = (await login(app, 't@cur.test')).access_token;
    const tokS = (await login(app, 's@cur.test')).access_token;
    const c = await paidCourse(app, tokT, org, 'CUR1', 25);
    const order = (await (
      await app.request('/api/v1/orders', {
        method: 'POST',
        headers: H(tokS),
        body: JSON.stringify({
          organization_id: org,
          kind: 'course',
          reference_id: c,
          currency: 'USD',
        }),
      })
    ).json()) as { data: { id: string; total_minor: number } };
    expect(order.data.total_minor).toBe(2500);
    const row = await queryFirst<{ currency: string }>(
      db,
      'SELECT currency FROM orders WHERE id = ?',
      order.data.id
    );
    expect(row?.currency).toBe('USD');
  });

  it('fractional prices quantize half-up to minor units', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'fr');
    await mkUser(db, 't@fr.test', 'teacher', org);
    const tokT = (await login(app, 't@fr.test')).access_token;
    const c = await paidCourse(app, tokT, org, 'FR1', 10.005);
    const row = await queryFirst<{ price_minor: number }>(
      db,
      'SELECT price_minor FROM courses WHERE id = ?',
      c
    );
    expect(row?.price_minor).toBe(1001);
  });
});
