import {
  call,
  loadingHtml,
  errorHtml,
  toast,
  modalForm,
  confirmDialog,
  currentOrgId,
  t,
  esc,
} from '../lib.js';

export async function renderCommerce(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const d = t();
  if (!orgId) {
    el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
    return;
  }
  const tabs: [string, string][] = [
    ['bundles', d.bundles],
    ['coupons', d.coupons],
    ['orders', d.orders],
    ['commissions', d.commissions],
    ['affiliates', d.affiliates],
    ['payouts', d.payouts],
    ['plans', d.plans],
    ['revenue', d.revenue],
  ];
  el.innerHTML = `<ul class="nav nav-tabs mb-3" role="tablist">
    ${tabs.map(([k, label], i) => `<li class="nav-item" role="presentation"><button class="nav-link${i === 0 ? ' active' : ''}" data-tab="${k}" role="tab">${label}</button></li>`).join('')}
    </ul><div id="c-body"></div>`;
  const body = el.querySelector('#c-body') as HTMLElement;
  const show = (tab: string) => {
    if (tab === 'bundles') void renderBundles(body, orgId);
    else if (tab === 'coupons') void renderCoupons(body, orgId);
    else if (tab === 'orders') void renderOrders(body, orgId);
    else if (tab === 'commissions') void renderCommissions(body, orgId);
    else if (tab === 'affiliates') void renderAffiliates(body, orgId);
    else if (tab === 'payouts') void renderPayouts(body, orgId);
    else if (tab === 'plans') void renderPlans(body, orgId);
    else void renderRevenue(body, orgId);
  };
  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      show((b as HTMLElement).dataset.tab ?? 'bundles');
    })
  );
  await renderBundles(body, orgId);
}

async function renderBundles(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="b-new">${d.new_} ${d.bundles}</button><div id="b-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#b-list') as HTMLElement;
    try {
      const items = (await call<{ id: string; name: string; price: number; status: string }[]>(
        '/api/v1/bundles',
        {},
        { organization_id: orgId }
      )) as {
        id: string;
        name: string;
        price: number;
        status: string;
      }[];
      box.innerHTML = items.length
        ? `<div class="row row-cards">${items
            .map(
              (b) => `<div class="col-md-6"><div class="card"><div class="card-body">
        <h3 class="card-title">${esc(b.name)}</h3><p class="text-muted">${Number(b.price)} · <span class="badge ${b.status === 'published' ? 'bg-green' : 'bg-yellow'}">${esc(b.status)}</span></p>
        <div class="d-flex gap-1"><button class="btn btn-sm btn-outline-primary" data-pub="${b.id}">${d.publish}</button>
        <button class="btn btn-sm btn-outline-secondary" data-view="${b.id}">${d.view}</button></div><div data-c="${b.id}"></div></div></div></div>`
            )
            .join('')}</div>`
        : `<div class="alert alert-info">${d.empty}</div>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#b-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(`${d.new_} ${d.bundles}`, [
      { name: 'name', label: d.name, required: true },
      { name: 'description', label: d.description, type: 'textarea' },
      { name: 'price', label: d.price, type: 'number', value: '0' },
      { name: 'course_ids', label: `${d.courses} IDs`, required: true },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/bundles', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          ...data,
          price: Number(data.price),
          course_ids: data.course_ids
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      toast(d.created, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  el.querySelector('#b-list')?.addEventListener('click', async (e) => {
    const pub = (e.target as HTMLElement).closest('[data-pub]') as HTMLElement | null;
    const view = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
    try {
      if (pub?.dataset.pub) {
        await call(`/api/v1/bundles/${pub.dataset.pub}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'published' }),
        });
        toast(d.publish, 'success');
        await load();
      } else if (view?.dataset.view) {
        const box = el.querySelector(`[data-c="${view.dataset.view}"]`) as HTMLElement;
        const det = (await call(`/api/v1/bundles/${view.dataset.view}`)) as {
          courses: { title: string; price: number }[];
        };
        box.innerHTML = `<ul class="mt-2">${det.courses.map((c) => `<li>${esc(c.title)} (${Number(c.price)})</li>`).join('')}</ul>`;
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await load();
}

async function renderCoupons(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="c-new">${d.new_} ${d.coupons}</button><div id="c-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#c-list') as HTMLElement;
    try {
      const items = (await call<
        { code: string; kind: string; value: number; used_count: number; max_uses: number | null }[]
      >('/api/v1/coupons', {}, { organization_id: orgId })) as {
        code: string;
        kind: string;
        value: number;
        used_count: number;
        max_uses: number | null;
      }[];
      box.innerHTML = items.length
        ? `<div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">${d.code}</th><th scope="col">${d.status}</th><th scope="col">${d.total}</th><th scope="col">${d.actions}</th></tr></thead><tbody>
        ${items.map((x) => `<tr><td><code>${esc(x.code)}</code></td><td>${esc(x.kind)}</td><td>${Number(x.value)}</td><td>${Number(x.used_count)}${x.max_uses ? `/${Number(x.max_uses)}` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#c-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(`${d.new_} ${d.coupons}`, [
      { name: 'code', label: d.code, required: true },
      {
        name: 'kind',
        label: d.status,
        options: [
          { value: 'percent', label: '%' },
          { value: 'fixed', label: '+' },
        ],
      },
      { name: 'value', label: d.total, type: 'number', required: true },
      { name: 'max_uses', label: d.actions, type: 'number' },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/coupons', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          ...data,
          value: Number(data.value),
          max_uses: data.max_uses ? Number(data.max_uses) : undefined,
        }),
      });
      toast(d.created, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  await load();
}

async function renderOrders(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div id="o-list">${loadingHtml()}</div>`;
  const box = el.querySelector('#o-list') as HTMLElement;
  try {
    const orders = (await call<{ id: string; kind: string; total: number; status: string }[]>(
      '/api/v1/orders',
      {},
      { organization_id: orgId, per_page: '50' }
    )) as {
      id: string;
      kind: string;
      total: number;
      status: string;
    }[];
    box.innerHTML = orders.length
      ? `<div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">ID</th><th scope="col">${d.status}</th><th scope="col">${d.total}</th><th scope="col">${d.status}</th><th scope="col"></th></tr></thead><tbody>
      ${orders
        .map(
          (
            o
          ) => `<tr><td class="text-truncate" style="max-width:140px">${esc(o.id.slice(0, 8))}…</td><td>${esc(o.kind)}</td><td>${Number(o.total)}</td>
      <td><span class="badge ${o.status === 'paid' ? 'bg-green' : o.status === 'refunded' ? 'bg-red' : 'bg-yellow'}">${esc(o.status)}</span></td>
      <td>${o.status === 'paid' ? `<button class="btn btn-sm btn-outline-danger" data-refund="${o.id}">${d.refund}</button>` : ''}</td></tr>`
        )
        .join('')}</tbody></table></div>`
      : `<p class="text-muted">${d.empty}</p>`;
    box.querySelectorAll('[data-refund]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!(await confirmDialog(d.refund, d.confirmDeleteBody, d.refund))) return;
        try {
          await call(`/api/v1/orders/${(b as HTMLElement).dataset.refund}/refund`, {
            method: 'POST',
            body: '{}',
          });
          toast(d.saved, 'success');
          await renderOrders(el, orgId);
        } catch (e) {
          toast(e instanceof Error ? e.message : d.failed, 'danger');
        }
      })
    );
  } catch (e) {
    box.innerHTML = errorHtml(e);
  }
}

async function renderCommissions(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const rows = (await call<
      { instructor_name: string; amount: number; rate: number; status: string }[]
    >('/api/v1/commissions', {}, { organization_id: orgId })) as {
      instructor_name: string;
      amount: number;
      rate: number;
      status: string;
    }[];
    el.innerHTML = rows.length
      ? `<div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">${d.teachers}</th><th scope="col">${d.total}</th><th scope="col">%</th><th scope="col">${d.status}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.instructor_name)}</td><td>${Number(r.amount)}</td><td>${Number(r.rate)}%</td><td><span class="badge ${r.status === 'reversed' ? 'bg-red' : 'bg-yellow'}">${esc(r.status)}</span></td></tr>`).join('')}</tbody></table></div>`
      : `<p class="text-muted">${d.empty}</p>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function renderAffiliates(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="a-new">${d.new_} ${d.affiliates}</button><div id="a-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#a-list') as HTMLElement;
    try {
      const items = (await call<{ code: string; user_name: string; commission_rate: number }[]>(
        '/api/v1/affiliates',
        {},
        { organization_id: orgId }
      )) as { code: string; user_name: string; commission_rate: number }[];
      box.innerHTML = items.length
        ? `<div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">${d.code}</th><th scope="col">${d.users}</th><th scope="col">%</th></tr></thead><tbody>
          ${items.map((a) => `<tr><td>${esc(a.code)}</td><td>${esc(a.user_name)}</td><td>${Number(a.commission_rate)}%</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#a-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(`${d.new_} ${d.affiliates}`, [
      { name: 'user_id', label: `${d.users} ID`, required: true },
      { name: 'code', label: d.code, required: true },
      { name: 'commission_rate', label: '%', type: 'number', value: '10' },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/affiliates', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: orgId,
          ...data,
          commission_rate: Number(data.commission_rate),
        }),
      });
      toast(d.created, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : d.failed, 'danger');
    }
  });
  await load();
}

async function renderPayouts(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div id="p-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#p-list') as HTMLElement;
    try {
      const items = (await call<
        { id: string; instructor_name: string; amount: number; method: string; status: string }[]
      >('/api/v1/payouts', {}, { organization_id: orgId })) as {
        id: string;
        instructor_name: string;
        amount: number;
        method: string;
        status: string;
      }[];
      box.innerHTML = items.length
        ? `<div class="table-responsive"><table class="table card-table"><thead><tr><th scope="col">${d.teachers}</th><th scope="col">${d.total}</th><th scope="col">${d.status}</th><th scope="col"></th></tr></thead><tbody>
          ${items
            .map(
              (p) =>
                `<tr><td>${esc(p.instructor_name)}</td><td>${Number(p.amount)}</td><td><span class="badge">${esc(p.status)}</span></td><td>${
                  p.status === 'pending'
                    ? `<span class="d-flex gap-1"><button class="btn btn-sm btn-primary" data-approve="${p.id}">${d.approve}</button><button class="btn btn-sm btn-outline-danger" data-reject="${p.id}">${d.reject}</button></span>`
                    : ''
                }</td></tr>`
            )
            .join('')}</tbody></table></div>`
        : `<p class="text-muted">${d.empty}</p>`;
      box.querySelectorAll('[data-approve],[data-reject]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const id =
              (b as HTMLElement).dataset.approve ?? (b as HTMLElement).dataset.reject ?? '';
            const approve = (b as HTMLElement).dataset.approve !== undefined;
            if (!(await confirmDialog(approve ? d.approve : d.reject, d.status, d.save))) return;
            await call(`/api/v1/payouts/${id}/decide`, {
              method: 'POST',
              body: JSON.stringify({ approve }),
            });
            toast(d.saved, 'success');
            await load();
          } catch (e) {
            toast(e instanceof Error ? e.message : d.failed, 'danger');
          }
        })
      );
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  await load();
}

async function renderPlans(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="p-new">${d.new_} ${d.plans}</button><div id="p-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#p-list') as HTMLElement;
    try {
      const items = (await call<{ name: string; price: number; interval: string }[]>(
        '/api/v1/subscription-plans',
        {},
        { organization_id: orgId }
      )) as {
        name: string;
        price: number;
        interval: string;
      }[];
      box.innerHTML = items.length
        ? `<ul>${items.map((p) => `<li>${esc(p.name)} — ${Number(p.price)}/${esc(p.interval)}</li>`).join('')}</ul>`
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#p-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(`${d.new_} ${d.plans}`, [
      { name: 'name', label: d.name, required: true },
      { name: 'price', label: d.price, type: 'number', required: true },
      {
        name: 'interval',
        label: d.status,
        options: [
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly' },
        ],
      },
    ]);
    if (!data) return;
    await call('/api/v1/subscription-plans', {
      method: 'POST',
      body: JSON.stringify({ organization_id: orgId, ...data, price: Number(data.price) }),
    });
    toast(d.created, 'success');
    await load();
  });
  await load();
}

async function renderRevenue(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const r = (await call<Record<string, unknown>>(
      '/api/v1/commerce/revenue',
      {},
      { organization_id: orgId }
    )) as {
      by_status: { status: string; n: number; total: number }[];
      total_discounts: number;
      pending_commissions: number;
    };
    el.innerHTML = `<div class="row row-cards">
      ${r.by_status.map((s) => `<div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${esc(s.status)}</div><div class="h1">${Number(s.n)} × ${Number(s.total)}</div></div></div></div>`).join('')}
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${d.revenue}</div><div class="h1">${Number(r.total_discounts)}</div></div></div></div>
      <div class="col-sm-4"><div class="card"><div class="card-body"><div class="subheader">${d.commissions}</div><div class="h1">${Number(r.pending_commissions)}</div></div></div></div></div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}
