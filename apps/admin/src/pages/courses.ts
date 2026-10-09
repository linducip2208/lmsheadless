import {
  call,
  crud,
  loadingHtml,
  errorHtml,
  toast,
  modalForm,
  confirmDialog,
  currentOrgId,
  t,
} from '../lib.js';

export async function renderCourses(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  const d = t();
  el.innerHTML = `<div id="approvals" class="mb-3"></div><div id="course-list"></div><div id="builder" class="mt-3"></div>`;
  await renderApprovals(el.querySelector('#approvals') as HTMLElement, orgId);
  const list = el.querySelector('#course-list') as HTMLElement;
  const builder = el.querySelector('#builder') as HTMLElement;
  await crud(list, {
    endpoint: '/api/v1/courses',
    query: orgId ? { organization_id: orgId, per_page: '50' } : { per_page: '50' },
    cols: [
      { key: 'code', label: d.code },
      { key: 'title', label: d.title },
      {
        key: 'status',
        label: d.status,
        render: (v) =>
          `<span class="badge ${v === 'published' ? 'bg-green' : v === 'archived' ? 'bg-red' : 'bg-yellow'}">${String(v)}</span>`,
      },
      { key: 'visibility', label: d.visibility },
      {
        key: '__b',
        label: '',
        render: (
          _v,
          row
        ) => `<span class="d-flex gap-1"><button class="btn btn-sm btn-primary" data-build="${String(row.id)}">${d.builder}</button>
        <button class="btn btn-sm btn-outline-green" data-pub="${String(row.id)}" ${row.status === 'published' ? 'disabled' : ''}>${d.publish}</button></span>`,
      },
    ],
    createTitle: `${d.create} ${d.courses}`,
    createFields: [
      {
        name: 'organization_id',
        label: `${d.organizations} ID`,
        value: orgId ?? '',
        required: true,
      },
      { name: 'code', label: d.code, required: true },
      { name: 'title', label: d.title, required: true },
      { name: 'description', label: d.description, type: 'textarea' },
      {
        name: 'visibility',
        label: d.visibility,
        options: [
          { value: 'private', label: 'Private' },
          { value: 'unlisted', label: 'Unlisted' },
          { value: 'public', label: 'Public' },
        ],
      },
      {
        name: 'enrollment_mode',
        label: d.enrollments,
        options: [
          { value: 'open', label: 'Open' },
          { value: 'approval', label: 'Approval' },
          { value: 'closed', label: 'Closed' },
        ],
      },
    ],
    editFields: (row) => [
      { name: 'title', label: d.title, value: String(row.title ?? '') },
      {
        name: 'description',
        label: d.description,
        type: 'textarea',
        value: String(row.description ?? ''),
      },
      {
        name: 'status',
        label: d.status,
        options: ['draft', 'published', 'archived'].map((s) => ({ value: s, label: s })),
        value: String(row.status ?? 'draft'),
      },
      {
        name: 'visibility',
        label: d.visibility,
        options: ['private', 'unlisted', 'public'].map((s) => ({ value: s, label: s })),
        value: String(row.visibility ?? 'private'),
      },
      { name: 'price', label: d.price, type: 'number', value: String(row.price ?? 0) },
    ],
    deletable: () => true,
    onChanged: () => {
      builder.innerHTML = '';
    },
  });
  list.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('[data-build]') as HTMLElement | null;
    const p = (e.target as HTMLElement).closest('[data-pub]') as HTMLElement | null;
    if (b?.dataset.build) {
      builder.scrollIntoView({ behavior: 'smooth' });
      await renderBuilder(builder, b.dataset.build);
    } else if (p?.dataset.pub) {
      try {
        await call(`/api/v1/courses/${p.dataset.pub}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'published' }),
        });
        toast(d.publish, 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : d.failed, 'danger');
      }
    }
  });
}

async function renderApprovals(el: HTMLElement, orgId: string | null): Promise<void> {
  const d = t();
  if (!orgId) return;
  try {
    const items = (await call<
      { id: string; course_id: string; course_title: string; requested_by_name: string }[]
    >(`/api/v1/publish-approvals?organization_id=${orgId}`)) as {
      id: string;
      course_id: string;
      course_title: string;
      requested_by_name: string;
    }[];
    if (!items.length) return;
    el.innerHTML = `<div class="card border-yellow mb-3"><div class="card-header"><h3 class="card-title">${d.requestApproval} (${items.length})</h3></div>
      <div class="list-group list-group-flush">${items
        .map(
          (a) => `<div class="list-group-item d-flex gap-2 align-items-center flex-wrap">
      <span><strong>${a.course_title}</strong> <span class="text-muted">· ${a.requested_by_name}</span></span>
      <span class="ms-auto d-flex gap-1"><button class="btn btn-sm btn-primary" data-approve="${a.id}">${d.approve}</button>
      <button class="btn btn-sm btn-outline-danger" data-reject="${a.id}">${d.reject}</button></span></div>`
        )
        .join('')}</div></div>`;
    el.querySelectorAll('[data-approve]').forEach((b) =>
      b.addEventListener('click', async () => {
        await call(`/api/v1/publish-approvals/${(b as HTMLElement).dataset.approve}/approve`, {
          method: 'POST',
          body: '{}',
        });
        toast(d.saved, 'success');
        await renderApprovals(el, orgId);
      })
    );
    el.querySelectorAll('[data-reject]').forEach((b) =>
      b.addEventListener('click', async () => {
        await call(`/api/v1/publish-approvals/${(b as HTMLElement).dataset.reject}/reject`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        toast(d.saved, 'success');
        await renderApprovals(el, orgId);
      })
    );
  } catch {
    el.innerHTML = ''; // not privileged or unavailable: no approvals UI
  }
}

async function renderBuilder(el: HTMLElement, courseId: string): Promise<void> {
  const d = t();
  el.innerHTML = `<div class="card"><div class="card-body">${loadingHtml()}</div></div>`;
  try {
    const [course, sections] = await Promise.all([
      call<Record<string, unknown>>(`/api/v1/courses/${courseId}`),
      call<{ id: string; title: string; position: number }[]>(
        `/api/v1/courses/${courseId}/sections`
      ),
    ]);
    const sorted = [...sections].sort((a, b) => a.position - b.position);
    el.innerHTML = `<div class="card"><div class="card-header">
      <div><h3 class="card-title">${d.builder}: ${String(course.title)}</h3></div>
      <button class="btn btn-primary ms-auto" id="add-section">${d.create} ${d.sections}</button></div>
      <div class="card-body" id="sections">
      ${sorted.length ? '' : `<p class="text-muted">${d.empty}</p>`}
      ${sorted
        .map(
          (s, i) => `<div class="card mb-2" data-section="${s.id}">
        <div class="card-header py-2"><strong>${i + 1}. ${s.title}</strong>
        <span class="ms-auto d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary" data-sec-up="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move section up">↑</button>
          <button class="btn btn-sm btn-outline-secondary" data-sec-down="${s.id}" ${i === sorted.length - 1 ? 'disabled' : ''} aria-label="Move section down">↓</button>
          <button class="btn btn-sm btn-outline-primary" data-sec-rename="${s.id}">${d.edit}</button>
          <button class="btn btn-sm btn-outline-green" data-lesson-add="${s.id}">+ ${d.lessons}</button>
          <button class="btn btn-sm btn-outline-danger" data-sec-del="${s.id}">${d.delete}</button>
        </span></div>
        <div class="list-group list-group-flush" data-lessons="${s.id}"><div class="list-group-item text-muted">${d.loading}</div></div>
      </div>`
        )
        .join('')}
      </div>
      <div class="card-footer d-flex gap-1 flex-wrap">
        <button class="btn btn-sm btn-outline-primary" id="adv-tags">${d.tags}</button>
        <button class="btn btn-sm btn-outline-primary" id="adv-prereq">${d.prerequisites}</button>
        <button class="btn btn-sm btn-outline-primary" id="adv-drip">${d.drip}</button>
        <button class="btn btn-sm btn-outline-primary" id="adv-wait">${d.waitlist}</button>
        <button class="btn btn-sm btn-outline-primary" id="adv-dup">${d.duplicate}</button>
        <button class="btn btn-sm btn-outline-primary" id="adv-vers">${d.versions}</button>
        <button class="btn btn-sm btn-outline-primary" id="adv-approve">${d.requestApproval}</button>
      </div><div id="adv-out" class="card-body"></div></div>`;
    for (const s of sorted) await loadLessons(el, s.id);
    const advOutEl = () => el.querySelector('#adv-out') as HTMLElement;
    const advOut = (html: string) => {
      advOutEl().innerHTML = html;
    };
    (el.querySelector('#adv-tags') as HTMLButtonElement).addEventListener('click', async () => {
      const orgId = String(course.organization_id ?? currentOrgId() ?? '');
      const tags = (await call<{ id: string; name: string }[]>(
        '/api/v1/course-tags',
        {},
        orgId ? { organization_id: orgId } : {}
      ).catch(() => [])) as { id: string; name: string }[];
      const data = await modalForm(d.tags, [
        { name: 'new_tag', label: `${d.create} (${d.name})` },
        {
          name: 'tag_ids',
          label: `IDs (${tags.map((x) => `${x.name}=${x.id.slice(0, 8)}`).join(', ') || '—'})`,
        },
      ]);
      if (!data) return;
      const ids: string[] = [];
      if (data.new_tag && orgId) {
        const created = (await call('/api/v1/course-tags', {
          method: 'POST',
          body: JSON.stringify({ organization_id: orgId, name: data.new_tag }),
        })) as { id: string };
        ids.push(created.id);
      }
      if (data.tag_ids) {
        for (const x of data.tag_ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)) {
          ids.push(tags.find((tg) => tg.id.startsWith(x) || tg.id === x)?.id ?? x);
        }
      }
      await call(`/api/v1/courses/${courseId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({ tag_ids: ids }),
      });
      toast(d.saved, 'success');
    });
    (el.querySelector('#adv-prereq') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm(d.prerequisites, [
        { name: 'requires_course_id', label: `${d.courses} ID`, required: true },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/courses/${courseId}/prerequisites`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        toast(d.saved, 'success');
      } catch (e) {
        toast(e instanceof Error ? e.message : d.failed, 'danger');
      }
    });
    (el.querySelector('#adv-drip') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm(d.drip, [
        { name: 'lesson_id', label: `${d.lessons} ID`, required: true },
        { name: 'days_after_enrollment', label: d.date, type: 'number' },
        { name: 'unlock_at', label: 'ISO', required: false },
      ]);
      if (!data) return;
      try {
        await call(`/api/v1/courses/${courseId}/drip`, {
          method: 'POST',
          body: JSON.stringify({
            ...data,
            days_after_enrollment: data.days_after_enrollment
              ? Number(data.days_after_enrollment)
              : undefined,
            unlock_at: data.unlock_at || undefined,
          }),
        });
        toast(d.saved, 'success');
      } catch (e) {
        toast(e instanceof Error ? e.message : d.failed, 'danger');
      }
    });
    (el.querySelector('#adv-wait') as HTMLButtonElement).addEventListener('click', async () => {
      try {
        const list = (await call<{ id: string; student_name: string; status: string }[]>(
          `/api/v1/courses/${courseId}/waitlist`
        )) as { id: string; student_name: string; status: string }[];
        advOut(
          list.length
            ? list
                .map(
                  (
                    w
                  ) => `<div class="d-flex gap-2 align-items-center mb-1"><span>${w.student_name} <span class="badge bg-blue">${w.status}</span></span>
          ${w.status === 'waiting' ? `<button class="btn btn-sm btn-outline-green ms-auto" data-promote="${w.id}">${d.approve}</button>` : ''}</div>`
                )
                .join('')
            : `<p class="text-muted">${d.empty}</p>`
        );
        advOutEl()
          .querySelectorAll('[data-promote]')
          .forEach((b) =>
            b.addEventListener('click', async () => {
              await call(
                `/api/v1/courses/${courseId}/waitlist/${(b as HTMLElement).dataset.promote}/promote`,
                { method: 'POST', body: '{}' }
              );
              toast(d.saved, 'success');
            })
          );
      } catch (e) {
        advOut(errorHtml(e));
      }
    });
    (el.querySelector('#adv-dup') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm(d.duplicate, [
        { name: 'code', label: d.code, required: true },
        { name: 'title', label: d.title, required: true },
      ]);
      if (!data) return;
      const r = (await call(`/api/v1/courses/${courseId}/duplicate`, {
        method: 'POST',
        body: JSON.stringify(data),
      })) as { id: string };
      toast(`${d.duplicate} (${r.id.slice(0, 8)})`, 'success');
    });
    (el.querySelector('#adv-vers') as HTMLButtonElement).addEventListener('click', async () => {
      const vers = (await call<{ version: number; created_at: string }[]>(
        `/api/v1/courses/${courseId}/versions`
      ).catch(() => [])) as { version: number; created_at: string }[];
      advOut(
        vers.length
          ? `<ol>${vers.map((v) => `<li>v${v.version} — ${v.created_at?.slice(0, 16).replace('T', ' ') ?? ''}</li>`).join('')}</ol>`
          : `<p class="text-muted">${d.empty}</p>`
      );
    });
    (el.querySelector('#adv-approve') as HTMLButtonElement).addEventListener('click', async () => {
      await call(`/api/v1/courses/${courseId}/request-approval`, { method: 'POST', body: '{}' });
      toast(d.saved, 'success');
    });
    (el.querySelector('#add-section') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm(`${d.create} ${d.sections}`, [
        { name: 'title', label: d.title, required: true },
      ]);
      if (!data) return;
      await call(`/api/v1/courses/${courseId}/sections`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      toast(d.created, 'success');
      await renderBuilder(el, courseId);
    });
    el.addEventListener(
      'click',
      async (e) => {
        const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!btn) return;
        const ds = btn.dataset;
        try {
          if (ds.secRename) {
            const data = await modalForm(d.edit, [
              { name: 'title', label: d.title, required: true },
            ]);
            if (!data) return;
            await call(`/api/v1/courses/sections/${ds.secRename}`, {
              method: 'PATCH',
              body: JSON.stringify(data),
            });
          } else if (ds.secDel) {
            if (!(await confirmDialog(d.confirmDelete, d.confirmDeleteBody, d.delete))) return;
            await call(`/api/v1/courses/sections/${ds.secDel}`, { method: 'DELETE' });
          } else if (ds.secUp || ds.secDown) {
            const ids = sorted.map((x) => x.id);
            const cur = ds.secUp ?? ds.secDown ?? '';
            const idx = ids.indexOf(cur);
            const swap = ds.secUp ? idx - 1 : idx + 1;
            if (idx < 0 || swap < 0 || swap >= ids.length) return;
            [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
            await call(`/api/v1/courses/${courseId}/sections/reorder`, {
              method: 'POST',
              body: JSON.stringify({ ordered_ids: ids }),
            });
          } else if (ds.lessonAdd) {
            const data = await modalForm(`${d.create} ${d.lessons}`, [
              { name: 'title', label: d.title, required: true },
              {
                name: 'content_type',
                label: d.type,
                options: ['text', 'video', 'document', 'image', 'external'].map((x) => ({
                  value: x,
                  label: x,
                })),
              },
              { name: 'body', label: d.body, type: 'textarea' },
              { name: 'video_url', label: 'URL' },
              {
                name: 'status',
                label: d.status,
                options: [
                  { value: 'published', label: 'published' },
                  { value: 'draft', label: 'draft' },
                ],
              },
            ]);
            if (!data) return;
            await call(`/api/v1/courses/sections/${ds.lessonAdd}/lessons`, {
              method: 'POST',
              body: JSON.stringify(data),
            });
          } else if (ds.lessonEdit) {
            const data = await modalForm(d.edit, [
              { name: 'title', label: d.title, required: true },
              { name: 'body', label: d.body, type: 'textarea' },
              {
                name: 'status',
                label: d.status,
                options: [
                  { value: 'published', label: 'published' },
                  { value: 'draft', label: 'draft' },
                ],
              },
            ]);
            if (!data) return;
            await call(`/api/v1/lessons/${ds.lessonEdit}`, {
              method: 'PATCH',
              body: JSON.stringify(data),
            });
          } else if (ds.lessonDel) {
            if (!(await confirmDialog(d.confirmDelete, d.confirmDeleteBody, d.delete))) return;
            await call(`/api/v1/lessons/${ds.lessonDel}`, { method: 'DELETE' });
          } else if (ds.lessonUp || ds.lessonDown) {
            const secId = btn.closest('[data-section]')?.getAttribute('data-section') ?? '';
            const lessons = (
              await call<{ id: string }[]>(`/api/v1/courses/sections/${secId}/lessons`)
            ).map((l) => l.id);
            const cur = ds.lessonUp ?? ds.lessonDown ?? '';
            const idx = lessons.indexOf(cur);
            const swap = ds.lessonUp ? idx - 1 : idx + 1;
            if (idx < 0 || swap < 0 || swap >= lessons.length) return;
            [lessons[idx], lessons[swap]] = [lessons[swap], lessons[idx]];
            await call(`/api/v1/courses/sections/${secId}/lessons/reorder`, {
              method: 'POST',
              body: JSON.stringify({ ordered_ids: lessons }),
            });
          } else return;
          toast(d.saved, 'success');
          await renderBuilder(el, courseId);
        } catch (err) {
          if (err instanceof Error && err.message !== 'Conflict') toast(err.message, 'danger');
        }
      },
      { once: true }
    );
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function loadLessons(root: HTMLElement, sectionId: string): Promise<void> {
  const box = root.querySelector(`[data-lessons="${sectionId}"]`) as HTMLElement;
  const d = t();
  try {
    const list = await call<{ id: string; title: string; content_type: string; status?: string }[]>(
      `/api/v1/courses/sections/${sectionId}/lessons`
    );
    box.innerHTML = list.length
      ? list
          .map(
            (l, i) => `<div class="list-group-item d-flex align-items-center gap-2 flex-wrap">
      <span class="badge bg-blue">${l.content_type}</span>
      ${l.status === 'draft' ? '<span class="badge bg-yellow">draft</span>' : ''}
      <span>${l.title}</span>
      <span class="ms-auto d-flex gap-1">
        <button class="btn btn-sm btn-outline-secondary" data-lesson-up="${l.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button class="btn btn-sm btn-outline-secondary" data-lesson-down="${l.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        <button class="btn btn-sm btn-outline-primary" data-lesson-edit="${l.id}">${d.edit}</button>
        <button class="btn btn-sm btn-outline-danger" data-lesson-del="${l.id}">${d.delete}</button>
      </span></div>`
          )
          .join('')
      : `<div class="list-group-item text-muted">${d.empty}</div>`;
  } catch {
    box.innerHTML = `<div class="list-group-item text-danger">${d.error}</div>`;
  }
}
