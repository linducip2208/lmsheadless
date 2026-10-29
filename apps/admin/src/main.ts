import '@tabler/core/dist/css/tabler.min.css';
import '@lms/ui/contrast.css';
import './theme.css';
import {
  applyTheme,
  themeToggleHtml,
  bindThemeToggles,
  bindSwUpdates,
  onlineIndicatorHtml,
  bindOnlineIndicator,
  flushQueue,
} from '@lms/ui';
import { applyLocaleDir } from './i18n.js';
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
  esc,
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
import { renderSystem, renderAlerts } from './pages/system.js';

const THEME_KEY = 'admin-theme';
applyTheme(THEME_KEY);

interface NavItem {
  hash: string;
  label: string;
  title: string;
}
interface NavGroup {
  section: string | null;
  items: NavItem[];
}

// Sidebar follows the operator business flow: overview → setup & people →
// learning content → delivery & results → commerce → monitoring →
// configuration. Every hash from the flat menu is preserved; only the
// visual grouping changed.
function navGroups(): NavGroup[] {
  const d = t();
  const it = (hash: string, label: string): NavItem => ({ hash, label, title: label });
  return [
    { section: null, items: [it('#/', d.dashboard)] },
    {
      section: d.navSetup,
      items: [
        it('#/organizations', d.organizations),
        it('#/users', d.users),
        it('#/roles', d.roles),
      ],
    },
    {
      section: d.navLearning,
      items: [
        it('#/courses', d.courses),
        it('#/cohorts', d.cohorts),
        it('#/quizzes', d.quizzes),
        it('#/assignments', d.assignments),
        it('#/scorm', d.scorm),
        it('#/files', d.files),
      ],
    },
    {
      section: d.navDelivery,
      items: [
        it('#/attendance', d.attendance),
        it('#/live', d.live),
        it('#/community', d.community),
        it('#/grades', d.grades),
        it('#/certificates', d.certificates),
      ],
    },
    { section: d.navCommerce, items: [it('#/commerce', d.commerce)] },
    {
      section: d.navInsight,
      items: [
        it('#/reports', d.reports),
        it('#/alerts', d.alerts),
        it('#/notifications', d.notifications),
        it('#/system', d.system),
        it('#/data', d.dataAi),
      ],
    },
    { section: d.navConfig, items: [it('#/settings', d.settings)] },
  ];
}

async function loginPage(root: HTMLElement): Promise<void> {
  const d = t();
  root.innerHTML = `<div class="lms-login-wrap"><div class="card lms-login-card"><div class="row g-0">
    <div class="col-md-6 lms-login-side d-none d-md-block">
      <div class="d-flex align-items-center gap-2 mb-4"><span class="lms-brand-mark" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg></span><strong>LMS Headless</strong></div>
      <h1>Selamat datang kembali.</h1>
      <p class="opacity-75">Kelola organisasi, kursus, dan pembelajaran dalam satu panel enterprise.</p>
      <ul class="small"><li>Multi-organisasi &amp; white-label</li><li>RBAC 29 permission server-side</li><li>PWA + API siap Flutter</li></ul>
    </div>
    <div class="col-12 col-md-6"><div class="lms-login-form">
      <h2 class="card-title mb-1">LMS Admin</h2>
      <p class="text-muted">${d.login} — ${d.organizations}</p>
      <form id="login-form" novalidate>
      <label class="form-label" for="email">${d.email}</label>
      <input id="email" type="email" class="form-control mb-2" required autocomplete="username" aria-required="true">
      <label class="form-label" for="password">${d.password}</label>
      <div class="input-group mb-3"><input id="password" type="password" class="form-control" required autocomplete="current-password" aria-required="true"><button type="button" class="btn btn-outline-secondary" id="pw-toggle" aria-label="Show password">👁</button></div>
      <div id="login-err" aria-live="assertive"></div>
      <button class="btn btn-primary w-100" type="submit" id="login-btn">${d.login}</button></form>
      <div class="mt-3 d-flex justify-content-between align-items-center gap-2">
      <select id="login-lang" class="form-select form-select-sm w-auto" aria-label="Language">
        <option value="en"${lang() === 'en' ? ' selected' : ''}>EN</option>
        <option value="id"${lang() === 'id' ? ' selected' : ''}>ID</option>
        <option value="ar"${lang() === 'ar' ? ' selected' : ''}>AR</option>
      </select>${themeToggleHtml(THEME_KEY)}</div>
    </div></div></div></div></div>`;
  bindThemeToggles(THEME_KEY);
  bindSwUpdates();
  (root.querySelector('#pw-toggle') as HTMLButtonElement).addEventListener('click', (e) => {
    const inp = root.querySelector('#password') as HTMLInputElement;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    (e.currentTarget as HTMLButtonElement).setAttribute('aria-label', inp.type === 'password' ? 'Show password' : 'Hide password');
  });
  (root.querySelector('#login-lang') as HTMLSelectElement).addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    localStorage.setItem('admin-locale', v);
    applyLocaleDir(v);
    void loginPage(root);
  });
  (root.querySelector('#login-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = root.querySelector('#login-btn') as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    const email = (root.querySelector('#email') as HTMLInputElement).value.trim();
    const password = (root.querySelector('#password') as HTMLInputElement).value;
    if (!email || !password) {
      (root.querySelector('#login-err') as HTMLElement).innerHTML =
        `<div class="alert alert-warning" role="alert">${esc(email ? d.password : d.email)} wajib diisi.</div>`;
      btn.disabled = false;
      return;
    }
    try {
      await login(email, password);
      location.hash = '#/';
    } catch (err) {
      (root.querySelector('#login-err') as HTMLElement).innerHTML =
        `<div class="alert alert-danger" role="alert">${esc(err instanceof Error ? err.message : t().failed)}</div>`;
      btn.disabled = false;
      (root.querySelector('#password') as HTMLInputElement).focus();
    }
  });
}

function iconFor(hash: string): string {
  const p = (inner: string) =>
    `<svg class="lms-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${inner}</svg>`;
  const paths: Record<string, string> = {
    '#/': '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    '#/organizations': '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>',
    '#/users': '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    '#/roles': '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/>',
    '#/courses': '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M8 7.5h8M8 11h6"/>',
    '#/cohorts': '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
    '#/quizzes': '<path d="M9 3h6v4l3 12a1.5 1.5 0 0 1-1.5 1.8h-9A1.5 1.5 0 0 1 6 19L9 7z"/><path d="M10 13h4"/>',
    '#/assignments': '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 11h6M9 15h4"/>',
    '#/scorm': '<path d="M12 3v10m0 0 4-4m-4 4-4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    '#/files': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    '#/attendance': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M9 15l2 2 4-4"/>',
    '#/live': '<rect x="3" y="5" width="13" height="12" rx="2"/><path d="M16 10l5-3v9z"/>',
    '#/community': '<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/>',
    '#/grades': '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5"/>',
    '#/certificates': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    '#/commerce': '<circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/><path d="M3 4h2l2.5 11h10.5l2-8H7"/>',
    '#/reports': '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    '#/alerts': '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17.5v.5"/>',
    '#/notifications': '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    '#/system': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    '#/data': '<ellipse cx="12" cy="5.5" rx="8" ry="2.5"/><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13"/>',
    '#/settings': '<circle cx="12" cy="12" r="3"/><path d="M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  };
  return p(paths[hash] ?? '<circle cx="12" cy="12" r="4"/>');
}

function visibleGroups(): NavGroup[] {
  const me = getMe();
  const restricted = new Set(['#/roles', '#/system']);
  return navGroups()
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => me?.isSuperAdmin || !restricted.has(i.hash)),
    }))
    .filter((g) => g.items.length > 0);
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
  const initials = (me?.name ?? me?.email ?? '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  if (localStorage.getItem('admin-collapse') === '1') document.body.classList.add('lms-collapsed');
  app.innerHTML = `<div class="page"><a href="#view" class="visually-hidden-focusable">${t().skip}</a>
    <aside class="navbar navbar-vertical navbar-expand-lg" id="sidebar">
      <div class="container-fluid"><button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu" aria-controls="sidebar-menu" aria-expanded="false" aria-label="Menu">
        <span class="navbar-toggler-icon"></span></button>
      <h1 class="navbar-brand" id="brand-name"><span class="lms-brand-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg></span><span class="lms-brand-name">LMS Admin<small id="brand-sub">${esc(orgs.find((o) => o.id === currentOrgId())?.name ?? 'Headless')}</small></span></h1>
      <div class="collapse navbar-collapse" id="sidebar-menu">
      <ul class="navbar-nav pt-lg-3" id="nav-list">
        ${visibleGroups()
          .map((g) =>
            [
              ...(g.section ? [`<li class="nav-section" aria-hidden="true">${g.section}</li>`] : []),
              ...g.items.map(
                (n) =>
                  `<li class="nav-item"><a class="nav-link" href="${n.hash}" data-nav="${n.hash}" title="${n.title}">${iconFor(n.hash)}<span class="nav-link-title">${n.label}</span></a></li>`
              ),
            ].join('')
          )
          .join('')}
      </ul>
      </div></div></aside>
    <div class="page-wrapper">
      <header class="navbar navbar-expand-md d-print-none sticky-top lms-topbar">
        <div class="container-xl d-flex gap-2 align-items-center flex-wrap">
          <button class="btn btn-sm btn-outline-secondary d-none d-lg-inline-flex" id="lms-collapse" aria-label="Toggle sidebar">☰</button>
          <nav aria-label="breadcrumb"><ol class="breadcrumb mb-0" id="crumbs"></ol></nav>
          <div class="ms-auto d-flex gap-2 align-items-center flex-wrap">
            ${onlineIndicatorHtml()}
            <form id="g-search" class="d-none d-md-flex" role="search"><input id="g-q" type="search" class="form-control form-control-sm" placeholder="${t().search}" aria-label="${t().search}"></form>
            <a href="#/notifications" class="btn btn-sm btn-outline-primary position-relative" aria-label="Notifications">🔔<span id="notif-badge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger d-none">0</span></a>
            <select id="org-sel" class="form-select form-select-sm w-auto" aria-label="Organization">
              ${orgs.map((o) => `<option value="${o.id}"${o.id === currentOrgId() ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
            </select>
            <select id="lang-sel" class="form-select form-select-sm w-auto" aria-label="Language">
              <option value="en"${lang() === 'en' ? ' selected' : ''}>EN</option>
              <option value="id"${lang() === 'id' ? ' selected' : ''}>ID</option>
              <option value="ar"${lang() === 'ar' ? ' selected' : ''}>AR</option>
            </select>
            ${themeToggleHtml(THEME_KEY)}
            <span class="avatar avatar-sm" aria-hidden="true">${esc(initials)}</span>
            <span class="text-muted small d-none d-md-inline">${esc(me?.name ?? '')}</span>
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
  (document.getElementById('lms-collapse') as HTMLButtonElement | null)?.addEventListener(
    'click',
    () => {
      const on = document.body.classList.toggle('lms-collapsed');
      localStorage.setItem('admin-collapse', on ? '1' : '0');
    }
  );
  (document.getElementById('logout') as HTMLButtonElement).addEventListener(
    'click',
    (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (btn.disabled) return;
      btn.disabled = true;
      void logout().finally(() => {
        btn.disabled = false;
      });
    }
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
  const groups = navGroups();
  const items = groups.flatMap((g) => g.items);
  const item = items.find((n) => n.hash === `#${route}`) ?? items[0];
  const section = groups.find((g) => g.items.some((n) => n.hash === item.hash))?.section;
  (document.getElementById('crumbs') as HTMLElement).innerHTML = section
    ? `<li class="breadcrumb-item">${section}</li><li class="breadcrumb-item active" aria-current="page">${item.title}</li>`
    : `<li class="breadcrumb-item">Home</li><li class="breadcrumb-item active" aria-current="page">${item.title}</li>`;
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
    else if (route.startsWith('/alerts')) await renderAlerts(view);
    else if (route.startsWith('/system')) await renderSystem(view);
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

// Serialized navigation: a slow view must never overwrite a newer one.
let navChain: Promise<void> = Promise.resolve();
function navigate(): void {
  navChain = navChain.then(() => router());
}
window.addEventListener('hashchange', navigate);
navigate();
