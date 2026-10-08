import { call, crud, loadingHtml, errorHtml, toast, modalForm, confirmDialog, currentOrgId } from '../lib.js';

export async function renderCourses(el: HTMLElement): Promise<void> {
  const orgId = currentOrgId();
  el.innerHTML = `<div id="course-list"></div><div id="builder" class="mt-3"></div>`;
  const list = el.querySelector('#course-list') as HTMLElement;
  const builder = el.querySelector('#builder') as HTMLElement;
  await crud(list, {
    endpoint: '/api/v1/courses',
    query: orgId ? { organization_id: orgId, per_page: '50' } : { per_page: '50' },
    cols: [
      { key: 'code', label: 'Code' },
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status', render: (v) => `<span class="badge ${v === 'published' ? 'bg-green' : v === 'archived' ? 'bg-red' : 'bg-yellow'}">${String(v)}</span>` },
      { key: 'visibility', label: 'Visibility' },
      {
        key: '__b', label: '', render: (_v, row) => `<span class="d-flex gap-1"><button class="btn btn-sm btn-primary" data-build="${String(row.id)}">Builder</button>
        <button class="btn btn-sm btn-outline-green" data-pub="${String(row.id)}" ${row.status === 'published' ? 'disabled' : ''}>Publish</button></span>`,
      },
    ],
    createTitle: 'Create course',
    createFields: [
      { name: 'organization_id', label: 'Organization ID', value: orgId ?? '', required: true },
      { name: 'code', label: 'Code', required: true },
      { name: 'title', label: 'Title', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'visibility', label: 'Visibility', options: [{ value: 'private', label: 'Private' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'public', label: 'Public' }] },
      { name: 'enrollment_mode', label: 'Enrollment', options: [{ value: 'open', label: 'Open' }, { value: 'approval', label: 'Approval' }, { value: 'closed', label: 'Closed' }] },
    ],
    editFields: (row) => [
      { name: 'title', label: 'Title', value: String(row.title ?? '') },
      { name: 'description', label: 'Description', type: 'textarea', value: String(row.description ?? '') },
      { name: 'status', label: 'Status', options: ['draft', 'published', 'archived'].map((s) => ({ value: s, label: s })), value: String(row.status ?? 'draft') },
      { name: 'visibility', label: 'Visibility', options: ['private', 'unlisted', 'public'].map((s) => ({ value: s, label: s })), value: String(row.visibility ?? 'private') },
      { name: 'price', label: 'Price', type: 'number', value: String(row.price ?? 0) },
    ],
    deletable: () => true,
    onChanged: () => { builder.innerHTML = ''; },
  });
  list.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('[data-build]') as HTMLElement | null;
    const p = (e.target as HTMLElement).closest('[data-pub]') as HTMLElement | null;
    if (b?.dataset.build) {
      builder.scrollIntoView({ behavior: 'smooth' });
      await renderBuilder(builder, b.dataset.build);
    } else if (p?.dataset.pub) {
      try {
        await call(`/api/v1/courses/${p.dataset.pub}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) });
        toast('Course published', 'success');
      } catch (err) { toast(err instanceof Error ? err.message : 'Failed', 'danger'); }
    }
  });
}

async function renderBuilder(el: HTMLElement, courseId: string): Promise<void> {
  el.innerHTML = `<div class="card"><div class="card-body">${loadingHtml()}</div></div>`;
  try {
    const [course, sections] = await Promise.all([
      call<Record<string, unknown>>(`/api/v1/courses/${courseId}`),
      call<{ id: string; title: string; position: number }[]>(`/api/v1/courses/${courseId}/sections`),
    ]);
    const sorted = [...sections].sort((a, b) => a.position - b.position);
    el.innerHTML = `<div class="card"><div class="card-header">
      <div><h3 class="card-title">Course builder: ${String(course.title)}</h3>
      <div class="card-subtitle">Sections, lessons, ordering — all persisted via API</div></div>
      <button class="btn btn-primary ms-auto" id="add-section">Add section</button></div>
      <div class="card-body" id="sections">
      ${sorted.length ? '' : '<p class="text-muted">No sections yet. Add the first section to start building.</p>'}
      ${sorted.map((s, i) => `<div class="card mb-2" data-section="${s.id}">
        <div class="card-header py-2"><strong>${i + 1}. ${s.title}</strong>
        <span class="ms-auto d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary" data-sec-up="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move section up">↑</button>
          <button class="btn btn-sm btn-outline-secondary" data-sec-down="${s.id}" ${i === sorted.length - 1 ? 'disabled' : ''} aria-label="Move section down">↓</button>
          <button class="btn btn-sm btn-outline-primary" data-sec-rename="${s.id}">Rename</button>
          <button class="btn btn-sm btn-outline-green" data-lesson-add="${s.id}">+ Lesson</button>
          <button class="btn btn-sm btn-outline-danger" data-sec-del="${s.id}">Delete</button>
        </span></div>
        <div class="list-group list-group-flush" data-lessons="${s.id}"><div class="list-group-item text-muted">Loading lessons…</div></div>
      </div>`).join('')}
      </div></div>`;
    for (const s of sorted) await loadLessons(el, s.id);
    (el.querySelector('#add-section') as HTMLButtonElement).addEventListener('click', async () => {
      const data = await modalForm('Add section', [{ name: 'title', label: 'Title', required: true }]);
      if (!data) return;
      await call(`/api/v1/courses/${courseId}/sections`, { method: 'POST', body: JSON.stringify(data) });
      toast('Section added', 'success');
      await renderBuilder(el, courseId);
    });
    el.addEventListener('click', async (e) => {
      const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!t) return;
      const ds = t.dataset;
      try {
        if (ds.secRename) {
          const data = await modalForm('Rename section', [{ name: 'title', label: 'Title', required: true }]);
          if (!data) return;
          await call(`/api/v1/courses/sections/${ds.secRename}`, { method: 'PATCH', body: JSON.stringify(data) });
        } else if (ds.secDel) {
          if (!(await confirmDialog('Delete section?', 'All lessons inside will be deleted too.'))) return;
          await call(`/api/v1/courses/sections/${ds.secDel}`, { method: 'DELETE' });
        } else if (ds.secUp || ds.secDown) {
          const ids = sorted.map((x) => x.id);
          const cur = ds.secUp ?? ds.secDown ?? '';
          const idx = ids.indexOf(cur);
          const swap = ds.secUp ? idx - 1 : idx + 1;
          if (idx < 0 || swap < 0 || swap >= ids.length) return;
          [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
          await call(`/api/v1/courses/${courseId}/sections/reorder`, { method: 'POST', body: JSON.stringify({ ordered_ids: ids }) });
        } else if (ds.lessonAdd) {
          const data = await modalForm('Add lesson', [
            { name: 'title', label: 'Title', required: true },
            { name: 'content_type', label: 'Type', options: ['text', 'video', 'document', 'image', 'external'].map((x) => ({ value: x, label: x })) },
            { name: 'body', label: 'Body / text content', type: 'textarea' },
            { name: 'video_url', label: 'Video URL (https://…)' },
            { name: 'status', label: 'Status', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }] },
          ]);
          if (!data) return;
          await call(`/api/v1/courses/sections/${ds.lessonAdd}/lessons`, { method: 'POST', body: JSON.stringify(data) });
        } else if (ds.lessonEdit) {
          const data = await modalForm('Edit lesson', [
            { name: 'title', label: 'Title', required: true },
            { name: 'body', label: 'Body', type: 'textarea' },
            { name: 'video_url', label: 'Video URL' },
            { name: 'status', label: 'Status', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }] },
          ]);
          if (!data) return;
          await call(`/api/v1/lessons/${ds.lessonEdit}`, { method: 'PATCH', body: JSON.stringify(data) });
        } else if (ds.lessonDel) {
          if (!(await confirmDialog('Delete lesson?', 'Progress records for this lesson remain but it will disappear from the course.'))) return;
          await call(`/api/v1/lessons/${ds.lessonDel}`, { method: 'DELETE' });
        } else if (ds.lessonUp || ds.lessonDown) {
          const secId = t.closest('[data-section]')?.getAttribute('data-section') ?? '';
          const lessons = (await call<{ id: string }[]>(`/api/v1/courses/sections/${secId}/lessons`)).map((l) => l.id);
          const cur = ds.lessonUp ?? ds.lessonDown ?? '';
          const idx = lessons.indexOf(cur);
          const swap = ds.lessonUp ? idx - 1 : idx + 1;
          if (idx < 0 || swap < 0 || swap >= lessons.length) return;
          [lessons[idx], lessons[swap]] = [lessons[swap], lessons[idx]];
          await call(`/api/v1/courses/sections/${secId}/lessons/reorder`, { method: 'POST', body: JSON.stringify({ ordered_ids: lessons }) });
        } else return;
        toast('Saved', 'success');
        await renderBuilder(el, courseId);
      } catch (err) {
        if (err instanceof Error && err.message !== 'Conflict') toast(err.message, 'danger');
      }
    }, { once: true });
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}

async function loadLessons(root: HTMLElement, sectionId: string): Promise<void> {
  const box = root.querySelector(`[data-lessons="${sectionId}"]`) as HTMLElement;
  try {
    const list = (await call<{ id: string; title: string; content_type: string; status?: string }[]>(`/api/v1/courses/sections/${sectionId}/lessons`));
    box.innerHTML = list.length ? list.map((l, i) => `<div class="list-group-item d-flex align-items-center gap-2 flex-wrap">
      <span class="badge bg-blue">${l.content_type}</span>
      ${l.status === 'draft' ? '<span class="badge bg-yellow">draft</span>' : ''}
      <span>${l.title}</span>
      <span class="ms-auto d-flex gap-1">
        <button class="btn btn-sm btn-outline-secondary" data-lesson-up="${l.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button class="btn btn-sm btn-outline-secondary" data-lesson-down="${l.id}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        <button class="btn btn-sm btn-outline-primary" data-lesson-edit="${l.id}">Edit</button>
        <button class="btn btn-sm btn-outline-danger" data-lesson-del="${l.id}">Delete</button>
      </span></div>`).join('') : '<div class="list-group-item text-muted">No lessons in this section.</div>';
  } catch {
    box.innerHTML = '<div class="list-group-item text-danger">Failed to load lessons.</div>';
  }
}
