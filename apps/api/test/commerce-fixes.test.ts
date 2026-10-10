import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execute, queryFirst, queryAll } from '../src/db.js';
import { newId, nowIso } from '@lms/shared';
import { setup, mkOrg, mkUser, login, authHeader } from './helpers.js';

function H(tok: string) {
  return { 'content-type': 'application/json', ...authHeader(tok) };
}

describe('minor-unit gates survive REAL/minor drift', () => {
  it('paid gates stay closed when REAL drifts to 0 but minor is set', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'drift');
    await mkUser(db, 't@drift.test', 'teacher', org);
    await mkUser(db, 's@drift.test', 'student', org);
    const tokT = (await login(app, 't@drift.test')).access_token;
    const tokS = (await login(app, 's@drift.test')).access_token;
    const c = (
      (await (
        await app.request('/api/v1/courses', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({ organization_id: org, code: 'DR1', title: 'Drift', price: 100 }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    // Simulate legacy drift: REAL zeroed, minor intact.
    await execute(db, 'UPDATE courses SET price = 0 WHERE id = ?', c);
    const enr = await app.request('/api/v1/enrollments', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ course_id: c }),
    });
    expect(enr.status).toBe(402);
  });

  it('PATCH keeps price columns in sync with minor winning', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'sync');
    await mkUser(db, 't@sync.test', 'teacher', org);
    const tokT = (await login(app, 't@sync.test')).access_token;
    const c = (
      (await (
        await app.request('/api/v1/courses', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({ organization_id: org, code: 'SY1', title: 'Sync', price: 10 }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    // Conflicting pair: minor wins.
    await app.request(`/api/v1/courses/${c}`, {
      method: 'PATCH',
      headers: H(tokT),
      body: JSON.stringify({ price: 50, price_minor: 9999 }),
    });
    let row = await queryFirst<{ price: number; price_minor: number }>(
      db,
      'SELECT price, price_minor FROM courses WHERE id = ?',
      c
    );
    expect(row?.price_minor).toBe(9999);
    expect(row?.price).toBeCloseTo(99.99, 5);
    // Minor-only patch derives the major.
    await app.request(`/api/v1/courses/${c}`, {
      method: 'PATCH',
      headers: H(tokT),
      body: JSON.stringify({ price_minor: 5000 }),
    });
    row = await queryFirst<{ price: number; price_minor: number }>(
      db,
      'SELECT price, price_minor FROM courses WHERE id = ?',
      c
    );
    expect(row?.price_minor).toBe(5000);
    expect(row?.price).toBe(50);
  });

  it('duplication carries the minor-unit price', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'dup');
    await mkUser(db, 't@dup.test', 'teacher', org);
    const tokT = (await login(app, 't@dup.test')).access_token;
    const c = (
      (await (
        await app.request('/api/v1/courses', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({
            organization_id: org,
            code: 'DP1',
            title: 'Dup',
            price: 25,
            price_minor: 2500,
          }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    const copy = (await (
      await app.request(`/api/v1/courses/${c}/duplicate`, {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ code: 'DP1-COPY' }),
      })
    ).json()) as { data: { id: string } };
    const row = await queryFirst<{ price_minor: number }>(
      db,
      'SELECT price_minor FROM courses WHERE id = ?',
      copy.data.id
    );
    expect(row?.price_minor).toBe(2500);
  });
});

describe('coupon exhaustion is atomic', () => {
  it('second order on a max_uses=1 coupon fails and is voided', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'cap');
    await mkUser(db, 't@cap.test', 'teacher', org);
    await mkUser(db, 'adm@cap.test', 'organization_admin', org);
    await mkUser(db, 's@cap.test', 'student', org);
    const tokT = (await login(app, 't@cap.test')).access_token;
    const tokA = (await login(app, 'adm@cap.test')).access_token;
    const tokS = (await login(app, 's@cap.test')).access_token;
    const c = (
      (await (
        await app.request('/api/v1/courses', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({ organization_id: org, code: 'CP1', title: 'Cap', price: 100 }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    await app.request('/api/v1/coupons', {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({
        organization_id: org,
        code: 'ONCE',
        kind: 'fixed',
        value: 10,
        max_uses: 1,
      }),
    });
    const first = await app.request('/api/v1/orders', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({
        organization_id: org,
        kind: 'course',
        reference_id: c,
        coupon_code: 'ONCE',
      }),
    });
    expect(first.status).toBe(201);
    const second = await app.request('/api/v1/orders', {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({
        organization_id: org,
        kind: 'course',
        reference_id: c,
        coupon_code: 'ONCE',
      }),
    });
    expect(second.status).toBe(400);
  });
});

describe('commissions are idempotent per order', () => {
  it('a second distinct webhook event does not mint new commissions', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'idem');
    const t = await mkUser(db, 't@idem.test', 'teacher', org);
    await mkUser(db, 'adm@idem.test', 'organization_admin', org);
    await mkUser(db, 's@idem.test', 'student', org);
    const tokT = (await login(app, 't@idem.test')).access_token;
    const tokA = (await login(app, 'adm@idem.test')).access_token;
    const tokS = (await login(app, 's@idem.test')).access_token;
    const c = (
      (await (
        await app.request('/api/v1/courses', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({ organization_id: org, code: 'IM1', title: 'Idem', price: 100 }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    await execute(
      db,
      'INSERT INTO course_instructors (id, course_id, user_id, created_at) VALUES (?, ?, ?, ?)',
      newId(),
      c,
      t,
      nowIso()
    );
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
    const hook = (trx: string) =>
      app.request('/api/v1/payments/webhooks/midtrans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          order_id: order.data.id,
          status_code: '200',
          gross_amount: String(order.data.total),
          signature_key: createHash('sha512')
            .update(`${order.data.id}200${order.data.total}s3cr3t`)
            .digest('hex'),
          transaction_status: 'settlement',
          transaction_id: trx,
        }),
      });
    expect((await hook('trx-1')).status).toBe(200);
    const n1 =
      (
        await queryFirst<{ n: number }>(
          db,
          'SELECT COUNT(*) as n FROM commissions WHERE order_id = ?',
          order.data.id
        )
      )?.n ?? 0;
    expect(n1).toBeGreaterThan(0);
    expect((await hook('trx-2')).status).toBe(200);
    const n2 =
      (
        await queryFirst<{ n: number }>(
          db,
          'SELECT COUNT(*) as n FROM commissions WHERE order_id = ?',
          order.data.id
        )
      )?.n ?? 0;
    expect(n2).toBe(n1);
  });
});

describe('cohort order refunds revoke everything', () => {
  it('refund removes cohort entitlement, membership, and granted courses', async () => {
    const { app, db } = await setup();
    const org = await mkOrg(db, 'coh');
    const t = await mkUser(db, 't@coh.test', 'teacher', org);
    await mkUser(db, 'adm@coh.test', 'organization_admin', org);
    await mkUser(db, 's@coh.test', 'student', org);
    const tokT = (await login(app, 't@coh.test')).access_token;
    const tokA = (await login(app, 'adm@coh.test')).access_token;
    const tokS = (await login(app, 's@coh.test')).access_token;
    const buyer = (await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM users WHERE email = ?',
      's@coh.test'
    ))!.id;
    const c = (
      (await (
        await app.request('/api/v1/courses', {
          method: 'POST',
          headers: H(tokT),
          body: JSON.stringify({
            organization_id: org,
            code: 'CH1',
            title: 'Cohort course',
            price: 10,
          }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;
    const cohort = (await (
      await app.request('/api/v1/cohorts', {
        method: 'POST',
        headers: H(tokT),
        body: JSON.stringify({ organization_id: org, name: 'Fall', price: 10 }),
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
    ).json()) as { data: { id: string; status: string } };
    // Free? price 10 → pending; pay via manual confirm.
    await app.request(`/api/v1/orders/${order.data.id}/payments/manual`, {
      method: 'POST',
      headers: H(tokS),
      body: JSON.stringify({ reference: 'COH-1' }),
    });
    const pay = (await queryFirst<{ id: string }>(
      db,
      'SELECT id FROM payments WHERE order_id = ?',
      order.data.id
    ))!.id;
    const confirm = await app.request(`/api/v1/payments/${pay}/confirm`, {
      method: 'POST',
      headers: H(tokA),
      body: JSON.stringify({ approve: true }),
    });
    expect(confirm.status).toBe(200);
    const memberBefore = await queryFirst(
      db,
      'SELECT id FROM cohort_members WHERE cohort_id = ? AND user_id = ?',
      cohort.data.id,
      buyer
    );
    expect(memberBefore).toBeTruthy();
    const refund = await app.request(`/api/v1/orders/${order.data.id}/refund`, {
      method: 'POST',
      headers: H(tokA),
    });
    expect(refund.status).toBe(200);
    const memberAfter = await queryFirst(
      db,
      'SELECT id FROM cohort_members WHERE cohort_id = ? AND user_id = ?',
      cohort.data.id,
      buyer
    );
    expect(memberAfter).toBeNull();
    const ent = await queryAll(db, 'SELECT id FROM entitlements WHERE user_id = ?', buyer);
    expect(ent.length).toBe(0);
    const enr = await queryFirst<{ status: string }>(
      db,
      'SELECT status FROM enrollments WHERE course_id = ? AND student_id = ?',
      c,
      buyer
    );
    expect(enr?.status).toBe('dropped');
    void t;
  });
});
