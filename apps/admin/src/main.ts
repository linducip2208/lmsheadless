import '@tabler/core/dist/css/tabler.min.css';
import { applyTheme, themeToggleHtml, bindThemeToggles, bindSwUpdates, onlineIndicatorHtml, bindOnlineIndicator, flushQueue } from '@lms/ui';
import { ensureMe, login, logout, getMe, call, myOrgs, currentOrgId, setCurrentOrgId, applyBranding, toast } from './lib.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderUsers } from './pages/users.js';
import { renderOrgs } from './pages/orgs.js';
import { renderRoles } from './pages/roles.js';
import { renderCourses } from './pages/courses.js';
import { renderQuizzes } from './pages/quizzes.js';
import { renderAssignments } from './pages/assignments.js';
import { renderAttendance } from './pages/attendance.js';
import { renderGrades } from './pages/grades.js';
import { renderSocial } from './pages/social.js';
import { renderCerts, renderFilesPage } from './pages/certs.js';
import { renderReports } from './pages/reports.js';
import { renderSettings } from './pages/settings.js';

const THEME_KEY = 'admin-theme';
applyTheme(THEME_KEY);

const NAV: { hash: string; label: string; title: string }[] = [
  { hash: '#/', label: 'Dashboard', title: 'Dashboard' },
  { hash: '#/users', label: 'Users', title: 'Users' },
  { hash: '#/organizations', label: 'Organizations', title: 'Organizations' },
  { hash: '#/roles', label: 'Roles', title: 'Roles & permissions' },
  { hash: '#/courses', label: 'Courses', title: 'Courses' },
  { hash: '#/quizzes', label: 'Quizzes', title: 'Quizzes' },
  { hash: '#/assignments', label: 'Assignments', title: 'Assignments' },
  { hash: '#/attendance', label: 'Attendance', title: 'Attendance' },
  { hash: '#/grades', label: 'Grades', title: 'Grades' },
  { hash: '#/community', label: 'Community', title: 'Announcements & discussions' },
  { hash: '#/certificates', label: 'Certificates', title: 'Certificates' },
  { hash: '#/files', label: 'Files', title: 'Files' },
  { hash: '#/reports', label: 'Reports', title: 'Reports' },
  { hash: '#/settings', label: 'Settings', title: 'Settings' },
];

async function loginPage(root: HTMLElement): Promise<void> {
  root.innerHTML = `<div class="row justify-content-center"><div class="col-md-4"><div class="card">
    <div class="card-body"><h2 class="card-title mb-1">LMS Admin</h2>
    <p class="text-muted">Sign in to manage your organization.</p>
    <form id="login-form">
    <label class="form-label" for="email">Email</label>
    <input id="email" type="email" class="form-control mb-2" required autocomplete="username">
    <label class="form-label" for="password">Password</label>
    <input id="password" type="password" class="form-control mb-3" required autocomplete="current-password">
    <div id="login-err"></div>
    <button class="btn btn-primary w-100">Sign in</button></form>
    <div class="mt-2 d-flex justify-content-between align-items-center"><span class="text-muted small">Tokens in memory · refresh in httpOnly cookie</span>${themeToggleHtml(THEME_KEY)}</div>
    </div></div></div></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  (root.querySelector('#login-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (root.querySelector('#email') as HTMLInputElement).value;
    const password = (root.querySelector('#password') as HTMLInputElement).value;
    try {
      await login(email, password);
      location.hash = '#/';
    } catch (err) {
      (root.querySelector('#login-err') as HTMLElement).innerHTML = `<div class="alert alert-danger" role="alert">${err instanceof Error ? err.message : 'Login failed'}</div>`;
    }
  });
}

async function shell(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const me = getMe();
  const orgs = await myOrgs().catch(() => []);
  if (!currentOrgId() && orgs[0]) setCurrentOrgId(orgs[0].id);
  if (currentOrgId()) {
    try {
      const brand = await call<Record<string, string>>(`/api/v1/organizations/${currentOrgId()}/branding`);
      applyBranding(brand);
    } catch {
      /* branding is best-effort */
    }
  }
  app.innerHTML = `<div class="page">
    <aside class="navbar navbar-vertical navbar-expand-lg" id="sidebar">
      <div class="container-fluid"><button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Menu">
        <span class="navbar-toggler-icon"></span></button>
      <h1 class="navbar-brand" id="brand-name">LMS Admin</h1>
      <div class="collapse navbar-collapse" id="sidebar-menu">
      <ul class="navbar-nav pt-lg-3" id="nav-list">
        ${NAV.map((n) => `<li class="nav-item"><a class="nav-link" href="${n.hash}" data-nav="${n.hash}"><span class="nav-link-title">${n.label}</span></a></li>`).join('')}
      </ul></div></div></aside>
    <div class="page-wrapper">
      <header class="navbar navbar-expand-md d-print-none sticky-top bg-white">
        <div class="container-xl d-flex gap-2 align-items-center flex-wrap">
          <nav aria-label="breadcrumb"><ol class="breadcrumb mb-0" id="crumbs"></ol></nav>
          <div class="ms-auto d-flex gap-2 align-items-center">
            ${onlineIndicatorHtml()}
            <select id="org-sel" class="form-select form-select-sm w-auto" aria-label="Organization">
              ${orgs.map((o) => `<option value="${o.id}"${o.id === currentOrgId() ? ' selected' : ''}>${o.name}</option>`).join('')}
            </select>
            ${themeToggleHtml(THEME_KEY)}
            <span class="text-muted small d-none d-md-inline">${me?.name ?? ''}</span>
            <button id="logout" class="btn btn-sm btn-outline-danger">Logout</button>
          </div></div></header>
      <div class="page-body"><div class="container-xl py-3" id="view"></div></div>
    </div></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  bindOnlineIndicator();
  void flushQueue((a, okAction) => toast(okAction ? `Synced pending action (${a.path})` : `Sync failed, will retry (${a.path})`, okAction ? 'success' : 'warning'));
  (document.getElementById('logout') as HTMLButtonElement).addEventListener('click', () => void logout());
  (document.getElementById('org-sel') as HTMLSelectElement).addEventListener('change', (e) => {
    setCurrentOrgId((e.target as HTMLSelectElement).value);
    void router();
  });
}

async function router(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const hash = location.hash || '#/';
  if (hash === '#/login') {
    await loginPage(app);
    return;
  }
  const me = await ensureMe();
  if (!me) {
    location.hash = '#/login';
    return;
  }
  if (!document.getElementById('sidebar')) await shell();
  const route = hash.replace('#', '');
  const item = NAV.find((n) => n.hash === `#${route}`) ?? (route.startsWith('/certificates') ? NAV[10] : NAV[0]);
  (document.getElementById('crumbs') as HTMLElement).innerHTML = `<li class="breadcrumb-item">Home</li><li class="breadcrumb-item active" aria-current="page">${item.title}</li>`;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.nav === item.hash));
  const view = document.getElementById('view') as HTMLElement;
  try {
    if (route === '/' || route === '') await renderDashboard(view);
    else if (route.startsWith('/users')) await renderUsers(view);
    else if (route.startsWith('/organizations')) await renderOrgs(view);
    else if (route.startsWith('/roles')) await renderRoles(view);
    else if (route.startsWith('/courses')) await renderCourses(view);
    else if (route.startsWith('/quizzes')) await renderQuizzes(view);
    else if (route.startsWith('/assignments')) await renderAssignments(view);
    else if (route.startsWith('/attendance')) await renderAttendance(view);
    else if (route.startsWith('/grades')) await renderGrades(view);
    else if (route.startsWith('/community')) await renderSocial(view);
    else if (route.startsWith('/certificates')) await renderCerts(view);
    else if (route.startsWith('/files')) await renderFilesPage(view);
    else if (route.startsWith('/reports')) await renderReports(view);
    else if (route.startsWith('/settings')) await renderSettings(view);
    else await renderDashboard(view);
  } catch (e) {
    view.innerHTML = `<div class="alert alert-danger" role="alert">${e instanceof Error ? e.message : 'Failed to load page.'}</div>`;
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

window.addEventListener('hashchange', () => void router());
void router();
