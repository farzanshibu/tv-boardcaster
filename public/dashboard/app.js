import { h, api, state, toast, logout, can, describe } from './core.js';
import { t as tr, locale, setLocale, LOCALES, applyDocumentLocale } from './i18n.js';
import { LoginView, DashboardView, ScreensView } from './views-core.js';
import { MediaView, PlaylistsView, TickersView, BranchesView } from './views-content.js';
import { SchedulesView, AnalyticsView, TeamView, BillingView, SettingsView, AuditView, SuperadminView, AcceptInviteView } from './views-ops.js';

const ROUTES = {
  '/dashboard':  { key: 'nav.overview',  view: DashboardView,  icon: '▦' },
  '/screens':    { key: 'nav.screens',   view: ScreensView,    icon: '▶' },
  '/media':      { key: 'nav.media',     view: MediaView,      icon: '◈' },
  '/playlists':  { key: 'nav.playlists', view: PlaylistsView,  icon: '≣' },
  '/tickers':    { key: 'nav.tickers',   view: TickersView,    icon: '⟿' },
  '/schedules':  { key: 'nav.schedules', view: SchedulesView,  icon: '◷' },
  '/branches':   { key: 'nav.branches',  view: BranchesView,   icon: '⌂' },
  '/analytics':  { key: 'nav.analytics', view: AnalyticsView,  icon: '◔' },
  '/team':       { key: 'nav.team',      view: TeamView,       icon: '👥' },
  '/billing':    { key: 'nav.billing',   view: BillingView,    icon: '₹',  perm: 'billing:write' },
  '/audit':      { key: 'nav.audit',     view: AuditView,      icon: '⎙',  perm: 'org:write' },
  '/settings':   { key: 'nav.settings',  view: SettingsView,   icon: '⚙' },
  '/admin':      { key: 'nav.admin',     view: SuperadminView, icon: '★',  superadmin: true },
};

const NAV = [
  { sep: 'nav.operate', items: ['/dashboard', '/screens', '/schedules', '/analytics'] },
  { sep: 'nav.content', items: ['/media', '/playlists', '/tickers'] },
  { sep: 'nav.org', items: ['/branches', '/team', '/billing', '/audit', '/settings'] },
];

const titleOf = (r) => tr(r.key);

const root = () => document.getElementById('root');
const path = () => (location.hash.slice(1) || '/dashboard').split('?')[0];

async function render() {
  const p = path();

  if (p === '/accept-invite') { root().innerHTML = ''; root().appendChild(AcceptInviteView()); return; }
  if (!state.token) { root().innerHTML = ''; root().appendChild(LoginView()); return; }

  if (!state.me) {
    try { state.me = await api('/auth/me'); }
    catch { logout(); return; }
    connectLive();
  }

  const isSuper = state.me.user.role === 'superadmin';
  // A superadmin outside a support session has no tenant data; tenant routes would 403.
  if (isSuper && !state.me.org && p !== '/admin') { location.hash = '/admin'; return; }
  const route = ROUTES[p] || ROUTES['/dashboard'];
  if (route.superadmin && !isSuper) return (location.hash = '/dashboard');
  if (route.perm && !can(route.perm)) return (location.hash = '/dashboard');

  const body = h('div', { class: 'content', role: 'region', 'aria-live': 'polite', 'aria-busy': 'true', tabindex: '-1' },
    h('div', { class: 'muted' }, tr('common.loading')));

  const nav = (isSuper && !state.me.org ? [] : NAV).map((group) => [
    h('div', { class: 'nav-sep' }, tr(group.sep)),
    group.items.filter((key) => {
      const r = ROUTES[key];
      return !(r.perm && !can(r.perm));
    }).map((key) => h('button', {
      class: `nav-item ${key === p ? 'active' : ''}`,
      onclick: () => (location.hash = key),
      'aria-current': key === p ? 'page' : null,
    }, h('span', { 'aria-hidden': 'true' }, ROUTES[key].icon), titleOf(ROUTES[key]))),
  ]);

  root().innerHTML = '';
  root().appendChild(h('a', { href: '#main-content', class: 'skip-link' }, tr('action.skip')));
  root().appendChild(h('div', { class: 'app' },
    h('nav', { class: 'sidebar', 'aria-label': 'Main navigation' },
      h('div', { class: 'brand' }, 'Brandcast TV'),
      nav,
      isSuper ? [h('div', { class: 'nav-sep' }, tr('nav.platform')),
        h('button', {
          class: `nav-item ${p === '/admin' ? 'active' : ''}`,
          onclick: () => (location.hash = '/admin'),
          'aria-current': p === '/admin' ? 'page' : null,
        }, h('span', { 'aria-hidden': 'true' }, '★'), tr('nav.admin'))] : null,
      h('div', { class: 'spacer' }),
      h('a', { class: 'nav-item', href: '/tv', target: '_blank' }, h('span', { 'aria-hidden': 'true' }, '⧉'), tr('action.opentv')),
      h('button', { class: 'nav-item', onclick: logout }, h('span', { 'aria-hidden': 'true' }, '⏻'), tr('action.signout'))),

    h('main', { class: 'main', id: 'main-content' },
      h('header', { class: 'topbar' },
        h('div', {}, h('h2', {}, titleOf(route)),
          state.me.org
            ? h('div', { class: 'tiny muted' }, `${state.me.org.name} · ${state.me.plan?.name || ''}`)
            : h('div', { class: 'tiny muted' }, tr('nav.platform'))),
        h('div', { class: 'right' },
          h('select', {
            'aria-label': tr('common.language'), class: 'lang-select',
            onchange: (e) => { setLocale(e.target.value); render(); },
          }, Object.entries(LOCALES).map(([code, label]) =>
            h('option', { value: code, selected: code === locale ? 'true' : null }, label))),
          state.impersonating || state.me.impersonating
            ? h('span', { class: 'badge warn' }, 'Support session') : null,
          h('span', { class: 'badge' }, state.me.user.role),
          h('span', { class: 'tiny muted' }, state.me.user.email))),
      body)));

  try {
    const node = await route.view(() => { state.me = null; render(); });
    body.innerHTML = '';
    body.appendChild(node);
    body.setAttribute('aria-busy', 'false');
    document.title = `${titleOf(route)} — Brandcast TV`;
  } catch (e) {
    body.innerHTML = '';
    body.setAttribute('aria-busy', 'false');
    body.appendChild(h('div', { class: 'err', role: 'alert' }, describe(e)));
  }
}

/* live dashboard updates over WebSocket */
function connectLive() {
  if (state.ws) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/dashboard/session?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'screen_status') {
      toast(`Screen ${m.status === 'online' ? 'came online' : 'went offline'}`, m.status === 'online' ? 'ok' : 'bad');
      if (['/dashboard', '/screens'].includes(path())) { state.me = null; render(); }
    }
  };
  ws.onclose = () => { state.ws = null; setTimeout(() => state.token && connectLive(), 5000); };
}

applyDocumentLocale();
window.addEventListener('hashchange', render);
render();
