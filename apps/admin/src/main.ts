import '@tabler/core/dist/css/tabler.min.css';
import {
  applyTheme,
  themeToggleHtml,
  bindThemeToggles,
  bindSwUpdates,
  onlineIndicatorHtml,
  bindOnlineIndicator,
  flushQueue,
} from '@lms/ui';
import {
  ensureMe,
  login,
  logout,
  getMe,
  call,
  myOrgs,
  currentOrgId,
  setCurrentOrgId,
  applyBranding,
  toast,
  t,
  lang,
} from './lib.js';
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
import { renderCommerce } from './pages/commerce.js';
import { renderCohorts } from './pages/cohorts.js';
import { renderLive } from './pages/live.js';
import { renderScorm } from './pages/scorm.js';
import { renderData } from './pages/data.js';
import { renderSearch, renderNotifications } from './pages/search.js';

const THEME_KEY = 'admin-theme';
applyTheme(THEME_KEY);

function navItems(): { hash: string; label: string; title: string }[] {
  const d = t();
  return [
    { hash: '#/', label: d.dashboard, title: d.dashboard },
    { hash: '#/users', label: d.users, title: d.users },
    { hash: '#/organizations', label: d.organizations, title: d.organizations },
    { hash: '#/roles', label: d.roles, title: d.roles },
    { hash: '#/courses', label: d.courses, title: d.courses },
    { hash: '#/cohorts', label: d.cohorts, title: d.cohorts },
    { hash: '#/quizzes', label: d.quizzes, title: d.quizzes },
    { hash: '#/assignments', label: d.assignments, title: d.assignments },
    { hash: '#/attendance', label: d.attendance, title: d.attendance },
    { hash: '#/live', label: d.live, title: d.live },
    { hash: '#/scorm', label: d.scorm, title: d.scorm },
    { hash: '#/commerce', label: d.commerce, title: d.commerce },
    { hash: '#/data', label: d.dataAi, title: d.dataAi },
    { hash: '#/grades', label: d.grades, title: d.grades },
    { hash: '#/community', label: d.community, title: d.community },
    { hash: '#/certificates', label: d.certificates, title: d.certificates },
    { hash: '#/notifications', label: d.notifications, title: d.notifications },
    { hash: '#/files', label: d.files, title: d.files },
    { hash: '#/reports', label: d.reports, title: d.reports },
    { hash: '#/settings', label: d.settings, title: d.settings },
  ];
}

async function loginPage(root: HTMLElement): Promise<void> {
  const d = t();
  root.innerHTML = `<div class="row justify-content-center"><div class="col-md-4"><div class="card">
    <div class="card-body"><h2 class="card-title mb-1">LMS Admin</h2>
    <p class="text-muted">${d.login} — ${d.organizations}</p>
    <form id="login-form">
    <label class="form-label" for="email">${d.email}</label>
    <input id="email" type="email" class="form-control mb-2" required autocomplete="username">
    <label class="form-label" for="password">${d.password}</label>
    <input id="password" type="password" class="form-control mb-3" required autocomplete="current-password">
    <div id="login-err"></div>
    <button class="btn btn-primary w-100">${d.login}</button></form>
    <div class="mt-2 d-flex justify-content-between align-items-center gap-2">
    <select id="login-lang" class="form-select form-select-sm w-auto" aria-label="Language">
      <option value="en"${lang() === 'en' ? ' selected' : ''}>EN</option>
      <option value="id"${lang() === 'id' ? ' selected' : ''}>ID</option>
    </select>${themeToggleHtml(THEME_KEY)}</div>
    </div></div></div></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  (root.querySelector('#login-lang') as HTMLSelectElement).addEventListener('change', (e) => {
    localStorage.setItem('admin-locale', (e.target as HTMLSelectElement).value);
    void loginPage(root);
  });
  (root.querySelector('#login-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (root.querySelector('#email') as HTMLInputElement).value;
    const password = (root.querySelector('#password') as HTMLInputElement).value;
    try {
      await login(email, password);
      location.hash = '#/';
    } catch (err) {
      (root.querySelector('#login-err') as HTMLElement).innerHTML =
        `<div class="alert alert-danger" role="alert">${err instanceof Error ? err.message : 'Login failed'}</div>`;
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
      const brand = await call<Record<string, string>>(
        `/api/v1/organizations/${currentOrgId()}/branding`
      );
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
        ${navItems()
          .map(
            (n) =>
              `<li class="nav-item"><a class="nav-link" href="${n.hash}" data-nav="${n.hash}"><span class="nav-link-title">${n.label}</span></a></li>`
          )
          .join('')}
      </ul></div></div></aside>
    <div class="page-wrapper">
      <header class="navbar navbar-expand-md d-print-none sticky-top bg-white">
        <div class="container-xl d-flex gap-2 align-items-center flex-wrap">
          <nav aria-label="breadcrumb"><ol class="breadcrumb mb-0" id="crumbs"></ol></nav>
          <div class="ms-auto d-flex gap-2 align-items-center">
            ${onlineIndicatorHtml()}
            <form id="g-search" class="d-none d-md-flex" role="search"><input id="g-q" type="search" class="form-control form-control-sm" placeholder="${t().search}" aria-label="${t().search}"></form>
            <a href="#/notifications" class="btn btn-sm btn-outline-primary position-relative" aria-label="Notifications">🔔<span id="notif-badge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger d-none">0</span></a>
            <select id="org-sel" class="form-select form-select-sm w-auto" aria-label="Organization">
              ${orgs.map((o) => `<option value="${o.id}"${o.id === currentOrgId() ? ' selected' : ''}>${o.name}</option>`).join('')}
            </select>
            <select id="lang-sel" class="form-select form-select-sm w-auto" aria-label="Language">
              <option value="en"${lang() === 'en' ? ' selected' : ''}>EN</option>
              <option value="id"${lang() === 'id' ? ' selected' : ''}>ID</option>
            </select>
            ${themeToggleHtml(THEME_KEY)}
            <span class="text-muted small d-none d-md-inline">${me?.name ?? ''}</span>
            <button id="logout" class="btn btn-sm btn-outline-danger">${t().logout}</button>
          </div></div></header>
      <div class="page-body"><div class="container-xl py-3" id="view"></div></div>
    </div></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  bindOnlineIndicator();
  void flushQueue((a, okAction) =>
    toast(
      okAction ? `Synced pending action (${a.path})` : `Sync failed, will retry (${a.path})`,
      okAction ? 'success' : 'warning'
    )
  );
  (document.getElementById('logout') as HTMLButtonElement).addEventListener(
    'click',
    () => void logout()
  );
  (document.getElementById('org-sel') as HTMLSelectElement).addEventListener('change', (e) => {
    setCurrentOrgId((e.target as HTMLSelectElement).value);
    void router();
  });
  (document.getElementById('lang-sel') as HTMLSelectElement).addEventListener('change', (e) => {
    localStorage.setItem('admin-locale', (e.target as HTMLSelectElement).value);
    location.reload();
  });
  (document.getElementById('g-search') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/search/${encodeURIComponent((document.getElementById('g-q') as HTMLInputElement).value)}`;
  });
  void refreshNotifBadge();
}

async function refreshNotifBadge(): Promise<void> {
  try {
    const r = (await call<{ unread: number }>('/api/v1/notifications/unread-count')) as {
      unread: number;
    };
    const badge = document.getElementById('notif-badge');
    if (badge && r.unread > 0) {
      badge.textContent = String(Math.min(99, r.unread));
      badge.classList.remove('d-none');
    }
  } catch {
    /* notifications unavailable */
  }
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
  const items = navItems();
  const item = items.find((n) => n.hash === `#${route}`) ?? items[0];
  (document.getElementById('crumbs') as HTMLElement).innerHTML =
    `<li class="breadcrumb-item">Home</li><li class="breadcrumb-item active" aria-current="page">${item.title}</li>`;
  document
    .querySelectorAll('[data-nav]')
    .forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.nav === item.hash));
  const view = document.getElementById('view') as HTMLElement;
  try {
    if (route === '/' || route === '') await renderDashboard(view);
    else if (route.startsWith('/users')) await renderUsers(view);
    else if (route.startsWith('/organizations')) await renderOrgs(view);
    else if (route.startsWith('/roles')) await renderRoles(view);
    else if (route.startsWith('/courses')) await renderCourses(view);
    else if (route.startsWith('/cohorts')) await renderCohorts(view);
    else if (route.startsWith('/live')) await renderLive(view);
    else if (route.startsWith('/scorm')) await renderScorm(view);
    else if (route.startsWith('/commerce')) await renderCommerce(view);
    else if (route.startsWith('/data')) await renderData(view);
    else if (route.startsWith('/quizzes')) await renderQuizzes(view);
    else if (route.startsWith('/assignments')) await renderAssignments(view);
    else if (route.startsWith('/attendance')) await renderAttendance(view);
    else if (route.startsWith('/grades')) await renderGrades(view);
    else if (route.startsWith('/community')) await renderSocial(view);
    else if (route.startsWith('/certificates')) await renderCerts(view);
    else if (route.startsWith('/notifications')) await renderNotifications(view);
    else if (route.startsWith('/search/'))
      await renderSearch(view, decodeURIComponent(route.slice('/search/'.length)));
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
