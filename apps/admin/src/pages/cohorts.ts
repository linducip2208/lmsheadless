import { call, loadingHtml, errorHtml, toast, modalForm, currentOrgId, t, esc } from '../lib.js';

export async function renderCohorts(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const d = t();
  if (!orgId) {
    el.innerHTML = `<div class="alert alert-warning">${d.selectOrg}</div>`;
    return;
  }
  const tabs: [string, string][] = [
    ['cohorts', d.cohorts],
    ['programs', d.programs],
    ['competencies', d.competencies],
  ];
  el.innerHTML = `<ul class="nav nav-tabs mb-3" role="tablist">
    ${tabs.map(([k, label], i) => `<li class="nav-item" role="presentation"><button class="nav-link${i === 0 ? ' active' : ''}" data-tab="${k}" role="tab">${label}</button></li>`).join('')}
    </ul><div id="co-body"></div>`;
  const body = el.querySelector('#co-body') as HTMLElement;
  el.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = (b as HTMLElement).dataset.tab ?? 'cohorts';
      if (tab === 'cohorts') void renderCohortList(body, orgId);
      else if (tab === 'programs') void renderPrograms(body, orgId);
      else void renderCompetencies(body, orgId);
    })
  );
  await renderCohortList(body, orgId);
}

async function renderCohortList(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="co-new">${d.new_} ${d.cohorts}</button><div id="co-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#co-list') as HTMLElement;
    try {
      const items = (await call<
        { id: string; name: string; capacity: number | null; start_date: string | null }[]
      >('/api/v1/cohorts', {}, { organization_id: orgId })) as {
        id: string;
        name: string;
        capacity: number | null;
        start_date: string | null;
      }[];
      box.innerHTML = items.length
        ? items
            .map(
              (co) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${co.name}</h3><p class="text-muted">${d.capacity} ${co.capacity ?? '∞'}</p>
        <div class="d-flex gap-1 flex-wrap"><button class="btn btn-sm btn-outline-primary" data-mem="${co.id}">${d.members}</button>
        <button class="btn btn-sm btn-outline-primary" data-add="${co.id}">${d.create}</button>
        <button class="btn btn-sm btn-outline-primary" data-course="${co.id}">${d.courses}</button>
        <button class="btn btn-sm btn-outline-green" data-prog="${co.id}">${d.view}</button></div>
        <div data-out="${co.id}" class="mt-2"></div></div></div>`
            )
            .join('')
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#co-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(`${d.new_} ${d.cohorts}`, [
      { name: 'name', label: d.name, required: true },
      { name: 'description', label: d.description, type: 'textarea' },
      { name: 'capacity', label: d.capacity, type: 'number' },
    ]);
    if (!data) return;
    await call('/api/v1/cohorts', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: orgId,
        ...data,
        capacity: data.capacity ? Number(data.capacity) : undefined,
        description: data.description || undefined,
      }),
    });
    toast(d.created, 'success');
    await load();
  });
  el.querySelector('#co-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    const ds = btn.dataset;
    const out = (id: string) => el.querySelector(`[data-out="${id}"]`) as HTMLElement;
    try {
      if (ds.mem) {
        const members = (await call<{ name: string; role: string }[]>(
          `/api/v1/cohorts/${ds.mem}/members`
        )) as { name: string; role: string }[];
        out(ds.mem).innerHTML =
          members
            .map((m) => `<span class="badge bg-blue me-1">${esc(m.name)} (${esc(m.role)})</span>`)
            .join('') || `<span class="text-muted">${d.empty}</span>`;
      } else if (ds.add) {
        const data = await modalForm(d.members, [
          { name: 'user_id', label: `${d.users} ID`, required: true },
          { name: 'role', label: d.role, value: 'student' },
        ]);
        if (!data) return;
        await call(`/api/v1/cohorts/${ds.add}/members`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        toast(d.created, 'success');
      } else if (ds.course) {
        const data = await modalForm(d.courses, [
          { name: 'course_id', label: `${d.courses} ID`, required: true },
        ]);
        if (!data) return;
        await call(`/api/v1/cohorts/${ds.course}/courses`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        toast(d.created, 'success');
      } else if (ds.prog) {
        const p = (await call<{ students: { name: string; avg_progress: number }[] }>(
          `/api/v1/cohorts/${ds.prog}/progress`
        )) as { students: { name: string; avg_progress: number }[] };
        out(ds.prog).innerHTML =
          p.students
            .map(
              (s) =>
                `<div class="d-flex justify-content-between"><span>${esc(s.name)}</span><span>${Number(s.avg_progress)}%</span></div>`
            )
            .join('') || `<span class="text-muted">${d.empty}</span>`;
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await load();
}

async function renderPrograms(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="pr-new">${d.new_} ${d.programs}</button><div id="pr-list">${loadingHtml()}</div>`;
  const load = async () => {
    const box = el.querySelector('#pr-list') as HTMLElement;
    try {
      const items = (await call<{ id: string; name: string }[]>(
        '/api/v1/programs',
        {},
        { organization_id: orgId }
      )) as { id: string; name: string }[];
      box.innerHTML = items.length
        ? items
            .map(
              (p) => `<div class="card mb-2"><div class="card-body">
        <h3 class="card-title">${esc(p.name)}</h3>
        <div class="d-flex gap-1"><button class="btn btn-sm btn-outline-primary" data-view="${p.id}">${d.view}</button>
        <button class="btn btn-sm btn-outline-green" data-add="${p.id}">${d.create}</button></div>
        <div data-p="${p.id}" class="mt-2"></div></div></div>`
            )
            .join('')
        : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) {
      box.innerHTML = errorHtml(e);
    }
  };
  (el.querySelector('#pr-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(`${d.new_} ${d.programs}`, [
      { name: 'name', label: d.name, required: true },
      { name: 'description', label: d.description, type: 'textarea' },
    ]);
    if (!data) return;
    await call('/api/v1/programs', {
      method: 'POST',
      body: JSON.stringify({ organization_id: orgId, ...data }),
    });
    toast(d.created, 'success');
    await load();
  });
  el.querySelector('#pr-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    try {
      if (btn.dataset.view) {
        const det = (await call<{ courses: { course_title: string; is_required: number }[] }>(
          `/api/v1/programs/${btn.dataset.view}`
        )) as {
          courses: { course_title: string; is_required: number }[];
        };
        (el.querySelector(`[data-p="${btn.dataset.view}"]`) as HTMLElement).innerHTML =
          `<ol>${det.courses.map((c) => `<li>${esc(c.course_title)}</li>`).join('')}</ol>`;
      } else if (btn.dataset.add) {
        const data = await modalForm(d.courses, [
          { name: 'course_id', label: `${d.courses} ID`, required: true },
          { name: 'position', label: '#', type: 'number', value: '0' },
        ]);
        if (!data) return;
        await call(`/api/v1/programs/${btn.dataset.add}/courses`, {
          method: 'POST',
          body: JSON.stringify({ ...data, position: Number(data.position) }),
        });
        toast(d.created, 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
  await load();
}

async function renderCompetencies(el: HTMLElement, orgId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<button class="btn btn-primary mb-2" id="cp-new">${d.new_} ${d.competencies}</button>
    <div class="card"><div class="card-body d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">${d.competencies} ID</label><input id="cp-id" class="form-control"></div>
    <div><label class="form-label">${d.users} ID</label><input id="cp-stu" class="form-control"></div>
    <div><label class="form-label">${d.status}</label><select id="cp-status" class="form-select"><option>achieved</option><option>pending</option><option>not_achieved</option></select></div>
    <button class="btn btn-outline-primary" id="cp-go">${d.record}</button></div></div>`;
  (el.querySelector('#cp-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(`${d.new_} ${d.competencies}`, [
      { name: 'name', label: d.name, required: true },
    ]);
    if (!data) return;
    await call('/api/v1/competencies', {
      method: 'POST',
      body: JSON.stringify({ organization_id: orgId, ...data }),
    });
    toast(d.created, 'success');
  });
  (el.querySelector('#cp-go') as HTMLButtonElement).addEventListener('click', async () => {
    try {
      await call(
        `/api/v1/competencies/${(el.querySelector('#cp-id') as HTMLInputElement).value}/assess`,
        {
          method: 'POST',
          body: JSON.stringify({
            student_id: (el.querySelector('#cp-stu') as HTMLInputElement).value,
            status: (el.querySelector('#cp-status') as HTMLSelectElement).value,
          }),
        }
      );
      toast(d.saved, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : d.failed, 'danger');
    }
  });
}
