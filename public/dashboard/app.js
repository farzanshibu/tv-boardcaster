import { h, api, state, toast, logout, can, describe } from './core.js';
import { LoginView, DashboardView, ScreensView } from './views-core.js';
import { MediaView, PlaylistsView, TickersView, BranchesView } from './views-content.js';
import { SchedulesView, AnalyticsView, TeamView, BillingView, SettingsView, AuditView, SuperadminView, AcceptInviteView } from './views-ops.js';

const ROUTES = {
  '/dashboard':  { title: 'Overview',            view: DashboardView,  icon: '▦' },
  '/screens':    { title: 'Screens',             view: ScreensView,    icon: '▶' },
  '/media':      { title: 'Media Library',       view: MediaView,      icon: '◈' },
  '/playlists':  { title: 'Playlists',           view: PlaylistsView,  icon: '≣' },
  '/tickers':    { title: 'Flash News',          view: TickersView,    icon: '⟿' },
  '/schedules':  { title: 'Scheduling',          view: SchedulesView,  icon: '◷' },
  '/branches':   { title: 'Branches',            view: BranchesView,   icon: '⌂' },
  '/analytics':  { title: 'Analytics',           view: AnalyticsView,  icon: '◔' },
  '/team':       { title: 'Team & Roles',        view: TeamView,       icon: '👥' },
  '/billing':    { title: 'Billing',             view: BillingView,    icon: '₹',  perm: 'billing:write' },
  '/audit':      { title: 'Audit Log',           view: AuditView,      icon: '⎙',  perm: 'org:write' },
  '/settings':   { title: 'Settings',            view: SettingsView,   icon: '⚙' },
  '/admin':      { title: 'Platform Admin',      view: SuperadminView, icon: '★',  superadmin: true },
};

const NAV = [
  { sep: 'Operate', items: ['/dashboard', '/screens', '/schedules', '/analytics'] },
  { sep: 'Content', items: ['/media', '/playlists', '/tickers'] },
  { sep: 'Organization', items: ['/branches', '/team', '/billing', '/audit', '/settings'] },
];

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
  const route = ROUTES[p] || ROUTES['/dashboard'];
  if (route.superadmin && !isSuper) return (location.hash = '/dashboard');
  if (route.perm && !can(route.perm)) return (location.hash = '/dashboard');

  const body = h('div', { class: 'content' }, h('div', { class: 'muted' }, 'Loading…'));

  const nav = NAV.map((group) => [
    h('div', { class: 'nav-sep' }, group.sep),
    group.items.filter((key) => {
      const r = ROUTES[key];
      return !(r.perm && !can(r.perm));
    }).map((key) => h('button', {
      class: `nav-item ${key === p ? 'active' : ''}`,
      onclick: () => (location.hash = key),
    }, h('span', {}, ROUTES[key].icon), ROUTES[key].title)),
  ]);

  root().innerHTML = '';
  root().appendChild(h('div', { class: 'app' },
    h('div', { class: 'sidebar' },
      h('div', { class: 'brand' }, 'Brandcast TV'),
      nav,
      isSuper ? [h('div', { class: 'nav-sep' }, 'Platform'),
        h('button', { class: `nav-item ${p === '/admin' ? 'active' : ''}`, onclick: () => (location.hash = '/admin') }, h('span', {}, '★'), 'Platform Admin')] : null,
      h('div', { class: 'spacer' }),
      h('a', { class: 'nav-item', href: '/tv', target: '_blank' }, h('span', {}, '⧉'), 'Open TV player'),
      h('button', { class: 'nav-item', onclick: logout }, h('span', {}, '⏻'), 'Sign out')),

    h('div', { class: 'main' },
      h('div', { class: 'topbar' },
        h('div', {}, h('h2', {}, route.title),
          state.me.org && h('div', { class: 'tiny muted' }, `${state.me.org.name} · ${state.me.plan.name}`)),
        h('div', { class: 'right' },
          state.impersonating || state.me.impersonating
            ? h('span', { class: 'badge warn' }, 'Support session') : null,
          h('span', { class: 'badge' }, state.me.user.role),
          h('span', { class: 'tiny muted' }, state.me.user.email))),
      body)));

  try {
    const node = await route.view(() => { state.me = null; render(); });
    body.innerHTML = '';
    body.appendChild(node);
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'err' }, describe(e)));
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

window.addEventListener('hashchange', render);
render();
