import { toast, modalForm } from '@lms/ui';
import type { ApiClient } from '@lms/ui';
import { getDict } from './i18n.js';

const t = () => getDict(localStorage.getItem('teacher-locale') ?? 'en');

export async function banksView(el: HTMLElement, client: ApiClient, orgId: string | null): Promise<void> {
  const { call } = client;
  const d = t();
  if (!orgId) { el.innerHTML = `<div class="alert alert-warning">${d.noOrg}</div>`; return; }
  el.innerHTML = `<button class="btn btn-primary mb-2" id="b-new">${d.newBank}</button><div id="b-list"><p>${d.loading}</p></div><div id="b-det" class="mt-3"></div>`;
  const load = async () => {
    const box = el.querySelector('#b-list') as HTMLElement;
    try {
      const items = (await call<{ id: string; name: string }[]>('/api/v1/question-banks', {}, { organization_id: orgId })) as { id: string; name: string }[];
      box.innerHTML = items.length ? items.map((b) => `<div class="card mb-2"><div class="card-body"><h3 class="card-title">${b.name}</h3>
        <div class="d-flex gap-1"><button class="btn btn-sm btn-outline-primary" data-bq="${b.id}">${d.questions}</button>
        <button class="btn btn-sm btn-outline-green" data-badd="${b.id}">${d.newQuestion}</button></div><div data-bd="${b.id}" class="mt-2"></div></div></div>`).join('') : `<p class="text-muted">${d.empty}</p>`;
    } catch (e) { box.innerHTML = `<div class="alert alert-danger">${e instanceof Error ? e.message : 'Error'}</div>`; }
  };
  (el.querySelector('#b-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(d.newBank, [{ name: 'name', label: d.name, required: true }]);
    if (!data) return;
    await call('/api/v1/question-banks', { method: 'POST', body: JSON.stringify({ organization_id: orgId, ...data }) });
    toast(d.created, 'success');
    await load();
  });
  el.querySelector('#b-list')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    try {
      if (btn.dataset.bq) {
        const qs = (await call<{ id: string; type: string; prompt: string }[]>(`/api/v1/question-banks/${btn.dataset.bq}/questions`)) as { id: string; type: string; prompt: string }[];
        (el.querySelector(`[data-bd="${btn.dataset.bq}"]`) as HTMLElement).innerHTML =
          qs.map((q) => `<div class="small mb-1"><span class="badge bg-blue">${q.type}</span> ${q.prompt.slice(0, 120)}</div>`).join('') || `<p class="text-muted">${d.empty}</p>`;
      } else if (btn.dataset.badd) {
        const data = await modalForm(d.newQuestion, [
          { name: 'type', label: d.type, options: ['multiple_choice', 'single_choice', 'true_false', 'short_answer', 'essay', 'matching', 'ordering'].map((x) => ({ value: x, label: x })) },
          { name: 'prompt', label: d.prompt, type: 'textarea', required: true },
          { name: 'points', label: d.points, type: 'number', value: '10' },
          { name: 'correct_answer', label: d.correctAnswer },
          { name: 'options', label: d.optionsHelp, type: 'textarea' },
        ]);
        if (!data) return;
        const payload: Record<string, unknown> = { ...data, points: Number(data.points) };
        if (data.options) {
          payload.options = data.options.split('\n').map((s: string) => s.trim()).filter(Boolean).map((l: string) => {
            const correct = l.startsWith('*');
            const text = correct ? l.slice(1).trim() : l;
            const [label, match] = text.split('=').map((s: string) => s.trim());
            return { label, match_value: match || undefined, is_correct: correct };
          });
        }
        await call(`/api/v1/question-banks/${btn.dataset.badd}/questions`, { method: 'POST', body: JSON.stringify(payload) });
        toast(d.created, 'success');
      }
    } catch (err) { toast(err instanceof Error ? err.message : d.failed, 'danger'); }
  });
  await load();
}

export async function liveView(el: HTMLElement, client: ApiClient, orgId: string | null): Promise<void> {
  const { call } = client;
  const d = t();
  if (!orgId) { el.innerHTML = `<div class="alert alert-warning">${d.noOrg}</div>`; return; }
  el.innerHTML = `<button class="btn btn-primary mb-2" id="lv-new">${d.schedule}</button><div id="lv-list"><p>${d.loading}</p></div>`;
  const load = async () => {
    const box = el.querySelector('#lv-list') as HTMLElement;
    const items = (await call<{ id: string; title: string; starts_at: string; meeting_url: string | null; status: string }[]>('/api/v1/live-sessions', {}, { organization_id: orgId }).catch(() => [])) as {
      id: string; title: string; starts_at: string; meeting_url: string | null; status: string;
    }[];
    box.innerHTML = items.length ? items.map((s) => `<div class="card mb-2"><div class="card-body"><h3 class="card-title">${s.title}</h3>
      <p class="text-muted">${s.starts_at?.slice(0, 16).replace('T', ' ') ?? ''} · ${s.status}</p>
      ${s.meeting_url ? `<a href="${s.meeting_url}" target="_blank" rel="noopener">${d.join}</a>` : ''}</div></div>`).join('') : `<p class="text-muted">${d.empty}</p>`;
  };
  (el.querySelector('#lv-new') as HTMLButtonElement).addEventListener('click', async () => {
    const data = await modalForm(d.schedule, [
      { name: 'title', label: d.title, required: true },
      { name: 'course_id', label: d.courseId },
      { name: 'starts_at', label: d.starts, required: true },
      { name: 'ends_at', label: d.ends, required: true },
    ]);
    if (!data) return;
    try {
      await call('/api/v1/live-sessions', { method: 'POST', body: JSON.stringify({ organization_id: orgId, provider: 'jitsi', ...data, course_id: data.course_id || undefined }) });
      toast(d.created, 'success');
      await load();
    } catch (err) { toast(err instanceof Error ? err.message : d.failed, 'danger'); }
  });
  await load();
}

export async function cohortsView(el: HTMLElement, client: ApiClient, orgId: string | null): Promise<void> {
  const { call } = client;
  const d = t();
  if (!orgId) { el.innerHTML = `<div class="alert alert-warning">${d.noOrg}</div>`; return; }
  el.innerHTML = `<div id="co-list"><p>${d.loading}</p></div>`;
  const box = el.querySelector('#co-list') as HTMLElement;
  const items = (await call<{ id: string; name: string }[]>('/api/v1/cohorts', {}, { organization_id: orgId }).catch(() => [])) as { id: string; name: string }[];
  box.innerHTML = items.length ? items.map((co) => `<div class="card mb-2"><div class="card-body">
    <h3 class="card-title">${co.name}</h3><button class="btn btn-sm btn-outline-primary" data-p="${co.id}">${d.progress}</button>
    <div data-o="${co.id}" class="mt-2"></div></div></div>`).join('') : `<p class="text-muted">${d.empty}</p>`;
  box.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => {
    const id = (b as HTMLElement).dataset.p ?? '';
    const p = (await call<{ students: { name: string; avg_progress: number }[] }>(`/api/v1/cohorts/${id}/progress`)) as { students: { name: string; avg_progress: number }[] };
    (box.querySelector(`[data-o="${id}"]`) as HTMLElement).innerHTML =
      p.students.map((s) => `<div class="d-flex justify-content-between"><span>${s.name}</span><span>${s.avg_progress}%</span></div>`).join('') || `<span class="text-muted">${d.empty}</span>`;
  }));
}

export async function aiView(el: HTMLElement, client: ApiClient, orgId: string | null): Promise<void> {
  const { call } = client;
  const d = t();
  if (!orgId) { el.innerHTML = `<div class="alert alert-warning">${d.noOrg}</div>`; return; }
  el.innerHTML = `<div class="card"><div class="card-body"><p class="text-muted small">${d.aiNote}</p>
    <form id="ai-f" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">${d.kind}</label><select id="ai-k" class="form-select"><option>outline</option><option>lesson_draft</option><option>questions</option><option>summary</option></select></div>
    <div class="flex-fill"><label class="form-label">${d.topic}</label><input id="ai-i" class="form-control" required></div>
    <button class="btn btn-primary">${d.generate}</button></form><div id="ai-o" class="mt-2"></div></div></div>`;
  (el.querySelector('#ai-f') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = el.querySelector('#ai-o') as HTMLElement;
    out.innerHTML = `<p>${d.loading}</p>`;
    try {
      const r = (await call<{ output?: string; note?: string }>('/api/v1/ai/jobs', { method: 'POST', body: JSON.stringify({ organization_id: orgId, kind: (el.querySelector('#ai-k') as HTMLSelectElement).value, input_ref: (el.querySelector('#ai-i') as HTMLInputElement).value }) })) as { output?: string; note?: string };
      out.innerHTML = `<div class="alert alert-warning">${r.note ?? ''}</div><pre class="card card-body">${(r.output ?? '').slice(0, 3000)}</pre>`;
    } catch (err) { out.innerHTML = `<div class="alert alert-danger">${err instanceof Error ? err.message : d.failed}</div>`; }
  });
}

export async function exercisesView(el: HTMLElement, client: ApiClient, orgId: string | null): Promise<void> {
  const { call } = client;
  const d = t();
  if (!orgId) { el.innerHTML = `<div class="alert alert-warning">${d.noOrg}</div>`; return; }
  el.innerHTML = `<div class="card"><div class="card-body"><form id="ex-f" class="d-flex gap-2 flex-wrap align-items-end">
    <div><label class="form-label">${d.courseId}</label><input id="ex-c" class="form-control" required></div>
    <div><label class="form-label">${d.title}</label><input id="ex-t" class="form-control" required></div>
    <div class="flex-fill"><label class="form-label">${d.statement}</label><textarea id="ex-s" class="form-control" required></textarea></div>
    <button class="btn btn-primary">${d.create}</button></form><div id="ex-o" class="mt-2"></div></div></div>`;
  (el.querySelector('#ex-f') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/v1/exercises', { method: 'POST', body: JSON.stringify({ course_id: (el.querySelector('#ex-c') as HTMLInputElement).value, title: (el.querySelector('#ex-t') as HTMLInputElement).value, statement: (el.querySelector('#ex-s') as HTMLTextAreaElement).value }) });
      toast(d.created, 'success');
      (el.querySelector('#ex-f') as HTMLFormElement).reset();
    } catch (err) { (el.querySelector('#ex-o') as HTMLElement).innerHTML = `<div class="alert alert-danger">${err instanceof Error ? err.message : d.failed}</div>`; }
  });
  void orgId;
}
