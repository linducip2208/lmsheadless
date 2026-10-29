import {
  call,
  loadingHtml,
  errorHtml,
  currentOrgId,
  pageHeader,
  statCard,
  t,
  esc,
} from '../lib.js';

interface CompletionRow {
  course_id: string;
  title: string;
  enrolled: number;
  completed: number;
  completion_rate: number;
  avg_progress: number;
}

export async function renderDashboard(el: HTMLElement): Promise<void> {
  const d = t();
  el.innerHTML = loadingHtml();
  try {
    const orgs = (await call<{ id: string; name: string }[]>('/api/v1/organizations')) as {
      id: string;
      name: string;
    }[];
    const orgId = currentOrgId() ?? orgs[0]?.id;
    if (!orgId) {
      el.innerHTML =
        pageHeader({ title: d.dashboard, desc: 'Ringkasan operasional organisasi Anda.' }) +
        `<div class="alert alert-info">${d.empty}</div>`;
      return;
    }
    const activeOrg = orgs.find((o) => o.id === orgId)?.name ?? '';
    const [summary, completion, teachers, engagement, notif] = await Promise.all([
      call<Record<string, number>>(
        '/api/v1/reports/organization-summary',
        {},
        { organization_id: orgId }
      ),
      call<CompletionRow[]>('/api/v1/reports/completion', {}, { organization_id: orgId }).catch(
        () => [] as CompletionRow[]
      ),
      call<{ name: string; courses: number; submissions_graded: number }[]>(
        '/api/v1/reports/teacher-activity',
        {},
        { organization_id: orgId }
      ).catch(() => []),
      call<{ by_day: { day: string; dau: number; actions: number }[] }>(
        '/api/v1/reports/engagement',
        {},
        { organization_id: orgId, days: '14' }
      ).catch(() => ({ by_day: [] })),
      call<{ unread: number }>('/api/v1/notifications/unread-count').catch(() => ({ unread: 0 })),
    ]);

    const students = Number(summary.students ?? 0);
    const teachersCount = Number(summary.teachers ?? 0);
    const courses = Number(summary.courses ?? 0);
    const enrollments = Number(summary.enrollments ?? 0);
    const avgProgress = Math.round(Number(summary.avg_progress ?? 0));
    const avgQuiz = Math.round(Number(summary.avg_quiz_score ?? 0));
    const lowCompletion = completion.filter((c) => Number(c.completion_rate) < 30).slice(0, 3);
    const recentTeachers = teachers.slice(0, 5);
    const last7 = engagement.by_day.slice(-7);
    const maxDau = Math.max(1, ...last7.map((x) => Number(x.dau)));

    el.innerHTML =
      pageHeader({
        title: d.dashboard,
        desc: activeOrg
          ? `Ringkasan ${activeOrg} — data aktual dari server, diperbarui setiap kunjungan.`
          : 'Ringkasan operasional — data aktual dari server.',
        actions: `<a class="btn btn-outline-primary" href="#/reports">${d.reports}</a><a class="btn btn-primary" href="#/courses">${d.courses}</a>`,
      }) +
      `<div class="row row-cards mb-3">
        ${statCard({ label: d.students, value: students, context: `${teachersCount} pengajar aktif`, icon: '◉' })}
        ${statCard({ label: d.teachers, value: teachersCount, context: `${recentTeachers.length} aktif mengajar`, icon: '◎' })}
        ${statCard({ label: d.courses, value: courses, context: 'Total kursus organisasi', icon: '▤' })}
        ${statCard({ label: d.enrollments, value: enrollments, context: 'Total enrollment organisasi', icon: '◍' })}
        ${statCard({ label: d.avgProgress, value: `${avgProgress}%`, context: 'Rata-rata progres belajar', icon: '◐' })}
        ${statCard({ label: d.avgQuiz, value: `${avgQuiz}`, context: 'Rata-rata skor kuis', icon: '✎' })}
      </div>
      ${
        notif.unread > 0
          ? `<div class="alert alert-warning d-flex justify-content-between align-items-center flex-wrap gap-2" role="alert"><span><strong>${notif.unread} notifikasi</strong> belum dibaca — ada hal yang butuh perhatian.</span><a class="btn btn-sm btn-warning" href="#/notifications">${d.notifications}</a></div>`
          : ''
      }
      <div class="row row-cards">
        <div class="col-md-7"><div class="card h-100"><div class="card-header d-flex align-items-center"><h3 class="card-title">Penyelesaian per kursus</h3><a href="#/courses" class="btn btn-sm btn-outline-primary ms-auto">Kelola</a></div>
        <div class="card-body">${
          completion.length
            ? completion.slice(0, 8).map(
                (c) => `
          <div class="mb-3"><div class="d-flex justify-content-between gap-2"><strong>${esc(c.title)}</strong>
          <span class="text-muted text-nowrap">${Number(c.completed)}/${Number(c.enrolled)} · ${Number(c.completion_rate)}%</span></div>
          <div class="progress" role="progressbar" aria-label="${esc(c.title)} progress" aria-valuenow="${Number(c.avg_progress)}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-bar" style="width:${Math.min(100, Number(c.avg_progress))}%"></div></div></div>`
              )
              .join('')
            : `<p class="text-muted mb-0">${d.empty} Buat kursus pertama dari halaman Courses.</p>`
        }
        </div></div></div>
        <div class="col-md-5"><div class="card mb-3"><div class="card-header"><h3 class="card-title">Aktivitas 7 hari</h3></div>
        <div class="card-body">${
          last7.length
            ? last7.map(
                (x) => `<div class="d-flex align-items-center gap-2 mb-1"><span class="text-muted small" style="width:4.5rem">${esc(String(x.day).slice(5))}</span><div class="progress flex-grow-1"><div class="progress-bar" style="width:${Math.round((Number(x.dau) / maxDau) * 100)}%"></div></div><span class="small text-nowrap">${Number(x.dau)} user</span></div>`
              ).join('')
            : `<p class="text-muted mb-0">Belum ada aktivitas tercatat.</p>`
        }</div></div>
        <div class="card"><div class="card-header"><h3 class="card-title">Aksi cepat</h3></div>
        <div class="card-body d-flex flex-wrap gap-2">
          <a class="btn btn-outline-primary btn-sm" href="#/users">+ Pengguna</a>
          <a class="btn btn-outline-primary btn-sm" href="#/courses">+ Kursus</a>
          <a class="btn btn-outline-primary btn-sm" href="#/cohorts">+ Cohort</a>
          <a class="btn btn-outline-primary btn-sm" href="#/live">+ Live class</a>
          <a class="btn btn-outline-primary btn-sm" href="#/reports">Ekspor CSV</a>
        </div></div></div>
      </div>
      <div class="row row-cards mt-3">
        <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Aktivitas pengajar</h3></div><div class="card-body">
        ${recentTeachers.map((x) => `<div class="d-flex justify-content-between border-bottom py-1"><span>${esc(x.name)}</span><span class="text-muted">${Number(x.courses)} kursus · ${Number(x.submissions_graded)} dinilai</span></div>`).join('') || `<p class="text-muted mb-0">Belum ada data pengajar.</p>`}
        </div></div></div>
        <div class="col-md-6"><div class="card"><div class="card-header"><h3 class="card-title">Perlu perhatian</h3></div><div class="card-body">
        ${lowCompletion.length ? lowCompletion.map((c) => `<div class="alert alert-warning py-2 mb-2"><strong>${esc(c.title)}</strong> — completion ${Number(c.completion_rate)}% dari ${Number(c.enrolled)} enrollment.</div>`).join('') : `<p class="text-muted mb-0">Tidak ada kursus dengan completion rendah. Bagus.</p>`}
        </div></div></div>
      </div>`;
  } catch (e) {
    el.innerHTML = errorHtml(e);
  }
}
