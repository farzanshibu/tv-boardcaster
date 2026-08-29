import { h, api, state, setToken, toast, modal, field, fmtDate, ago, can, describe, money } from './core.js';
import { t as tr, fmtNumber } from './i18n.js';

/* ==================== AUTH ==================== */
export function LoginView(navigate) {
  const wrap = h('div', { class: 'auth-wrap' });
  let mode = 'login';
  const render = () => {
    wrap.innerHTML = '';
    const err = h('div');
    const f = {};
    const inp = (k, attrs) => (f[k] = h('input', attrs));
    f.country = h('select', {},
      h('option', { value: 'IN' }, 'India (GST invoicing)'),
      h('option', { value: 'US' }, 'United States'));

    const submit = async () => {
      err.innerHTML = '';
      try {
        const data = mode === 'login'
          ? await api('/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value, totp: f.totp?.value || undefined } })
          : await api('/auth/signup', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value, org_name: f.org.value, country: f.country.value } });
        setToken(data.token);
        location.hash = '/dashboard';
        location.reload();
      } catch (e) {
        if (e.data?.error === 'totp_required') { mode = 'totp'; render(); return; }
        err.appendChild(h('div', { class: 'err' }, describe(e)));
      }
    };
    const onKey = (e) => e.key === 'Enter' && submit();

    wrap.appendChild(h('div', { class: 'auth-card' },
      h('div', { class: 'logo' }, 'Brandcast TV'),
      h('h1', {}, mode === 'signup' ? tr('auth.signup_title') : tr('auth.signin')),
      h('p', { class: 'sub' }, mode === 'signup' ? tr('auth.signup_sub') : tr('auth.signin_sub')),
      err,
      mode === 'signup' && field(tr('auth.name'), inp('name', { placeholder: 'Riya Sharma', onkeydown: onKey })),
      mode === 'signup' && field(tr('auth.org'), inp('org', { placeholder: 'Acme Retail', onkeydown: onKey })),
      mode === 'signup' && field(tr('auth.country'), f.country),
      field(tr('auth.email'), inp('email', { type: 'email', placeholder: 'you@company.com', onkeydown: onKey })),
      field(tr('auth.password'), inp('password', { type: 'password', placeholder: '••••••••', onkeydown: onKey })),
      mode === 'totp' && field(tr('auth.totp'), inp('totp', { placeholder: '123456', onkeydown: onKey })),
      h('div', { class: 'mt' }, h('button', { class: 'btn-primary', style: 'width:100%', onclick: submit },
        mode === 'signup' ? tr('auth.create') : tr('auth.signin'))),
      h('div', { class: 'row mt', style: 'justify-content:space-between' },
        h('button', { class: 'btn-ghost btn-sm', onclick: () => { mode = mode === 'signup' ? 'login' : 'signup'; render(); } },
          mode === 'signup' ? tr('auth.have_account') : tr('auth.need_account')),
        h('a', { class: 'small', href: '/tv', target: '_blank' }, tr('auth.open_tv') + ' \u2192'))));
  };
  render();
  return wrap;
}

/* ==================== OVERVIEW ==================== */
export async function DashboardView() {
  const [o, screens, notifs] = await Promise.all([
    api('/analytics/overview'), api('/screens'), api('/notifications').catch(() => []),
  ]);
  const plan = o.plan, usage = o.usage;
  const nearLimit = usage.screens >= plan.max_screens * 0.8;

  return h('div', {},
    nearLimit && h('div', { class: 'banner' },
      `You are using ${usage.screens} of ${plan.max_screens} screens on ${plan.name}. `,
      h('a', { href: '#/billing' }, 'Upgrade your plan →')),

    h('div', { class: 'grid g4' },
      stat(tr('stat.total_screens'), o.total_screens, `${o.branches} branches`),
      stat(tr('stat.online_now'), o.online_screens, `${o.offline_screens} offline`, o.offline_screens ? 'warn' : 'ok'),
      stat(tr('stat.playlists'), o.playlists, `${o.media} media assets`),
      stat(tr('stat.publishes'), o.publishes_24h, `Plan: ${plan.name}`)),

    h('div', { class: 'grid g2 mt' },
      h('div', { class: 'card' },
        h('div', { class: 'between mb' }, h('h3', {}, 'Screen health'),
          h('a', { href: '#/screens', class: 'small' }, 'View all')),
        screens.length
          ? h('table', {}, h('tbody', {}, screens.slice(0, 8).map((s) =>
              h('tr', {},
                h('td', {}, h('div', { class: 'row' },
                  h('span', { class: `dot ${s.status === 'online' ? 'ok' : 'bad'}` }),
                  h('div', {}, h('div', {}, s.name), h('div', { class: 'tiny muted' }, s.branch_name || '—')))),
                h('td', { class: 'small muted' }, s.playlist_name || 'No playlist'),
                h('td', { class: 'small muted' }, ago(s.last_sync_at))))))
          : h('div', { class: 'empty' }, 'No screens paired yet.')),

      h('div', { class: 'card' },
        h('h3', {}, 'Recent activity'),
        o.recent_activity.length
          ? h('div', {}, o.recent_activity.map((a) =>
              h('div', { class: 'row', style: 'padding:8px 0;border-bottom:1px solid var(--line)' },
                h('span', { class: 'badge info' }, a.action),
                h('span', { class: 'small muted' }, a.actor_email || 'system'),
                h('span', { class: 'tiny muted', style: 'margin-left:auto' }, ago(a.created_at)))))
          : h('div', { class: 'empty' }, 'No activity yet.'))),

    notifs.filter((n) => !n.read).length ? h('div', { class: 'card mt' },
      h('div', { class: 'between mb' }, h('h3', {}, 'Alerts'),
        h('button', { class: 'btn-sm', onclick: async () => { await api('/notifications/read', { method: 'POST' }); location.reload(); } }, 'Mark all read')),
      notifs.filter((n) => !n.read).slice(0, 6).map((n) =>
        h('div', { class: 'row small', style: 'padding:6px 0' },
          h('span', { class: `badge ${n.kind.includes('offline') ? 'bad' : 'ok'}` }, n.kind),
          n.message, h('span', { class: 'tiny muted', style: 'margin-left:auto' }, ago(n.created_at))))) : null);
}

const stat = (k, v, d, tone) => h('div', { class: 'stat' },
  h('div', { class: 'k' }, k),
  h('div', { class: 'v', style: tone === 'warn' ? 'color:var(--warn)' : tone === 'ok' ? 'color:var(--ok)' : '' },
    typeof v === 'number' ? fmtNumber(v) : String(v)),
  h('div', { class: 'd' }, d));

/* ==================== SCREENS ==================== */
export async function ScreensView(rerender) {
  const [screens, branches, playlists, tickers] = await Promise.all([
    api('/screens'), api('/branches'), api('/playlists'), api('/tickers'),
  ]);

  const openPair = () => {
    const codeInput = h('input', { class: 'otp-input', maxlength: '4', inputmode: 'numeric', placeholder: '0000' });
    const nameInput = h('input', { placeholder: 'Front Counter Display' });
    const branchSel = h('select', {}, branches.map((b) => h('option', { value: b.id }, `${b.name} (${b.timezone})`)));
    const plSel = h('select', {}, h('option', { value: '' }, 'No playlist'), playlists.map((p) => h('option', { value: p.id }, p.name)));
    const tkSel = h('select', {}, h('option', { value: '' }, 'No flash news'), tickers.map((t) => h('option', { value: t.id }, t.name)));
    const orSel = h('select', {}, h('option', { value: 'landscape' }, 'Landscape'), h('option', { value: 'portrait' }, 'Portrait'));
    const locInput = h('input', { placeholder: 'Near entrance' });

    modal({
      title: 'Add New Screen',
      subtitle: 'Enter the 4-digit code shown on the TV, then configure the screen.',
      body: h('div', {},
        field('Pairing code from TV', codeInput),
        field('Screen name', nameInput),
        field('Branch', branchSel),
        h('div', { class: 'field-row' }, field('Playlist', plSel), field('Flash news', tkSel)),
        h('div', { class: 'field-row' }, field('Orientation', orSel), field('Location tag', locInput))),
      confirmText: 'Pair & go live',
      onConfirm: async () => {
        const r = await api('/screens', { method: 'POST', body: {
          code: codeInput.value.trim() || undefined, name: nameInput.value.trim(), branch_id: branchSel.value,
          playlist_id: plSel.value || null, ticker_id: tkSel.value || null,
          orientation: orSel.value, location_tag: locInput.value || null } });
        toast(r.paired ? `${r.name} is live` : `${r.name} created (pair a TV later)`, 'ok');
        rerender();
      },
    });
  };

  const bulk = () => {
    const plSel = h('select', {}, playlists.map((p) => h('option', { value: p.id }, p.name)));
    const branchSel = h('select', {}, h('option', { value: '' }, 'All branches'), branches.map((b) => h('option', { value: b.id }, b.name)));
    modal({
      title: 'Bulk publish',
      subtitle: 'Assign one playlist to many screens and push instantly.',
      body: h('div', {}, field('Playlist', plSel), field('Target', branchSel)),
      confirmText: 'Publish now',
      onConfirm: async () => {
        const body = { playlist_id: plSel.value };
        if (branchSel.value) body.branch_ids = [branchSel.value]; else body.all = true;
        const r = await api('/publish/bulk', { method: 'POST', body });
        toast(`Published to ${r.targeted} screens (${r.delivered} delivered instantly)`, 'ok');
        rerender();
      },
    });
  };

  const detail = async (id) => {
    const s = await api(`/screens/${id}`);
    const ev = await api(`/screens/${id}/events`);
    modal({
      title: s.name, subtitle: `${s.branch_name || '—'} · ${s.os_type || 'web'} · ${s.resolution || 'unknown'}`, wide: true,
      body: h('div', {},
        h('div', { class: 'row mb' },
          h('span', { class: `badge ${s.status === 'online' ? 'ok' : 'bad'}` }, s.status),
          h('span', { class: 'badge' }, `Playlist: ${s.playlist_name || 'none'}`),
          h('span', { class: 'badge' }, `Source: ${s.effective.source}`),
          h('span', { class: 'badge' }, `Synced ${ago(s.last_sync_at)}`)),
        s.effective.conflicts?.length ? h('div', { class: 'err' },
          `Schedule conflict: ${s.effective.conflicts.map((c) => c.name).join(', ')} — most specific target wins.`) : null,
        h('div', { class: 'row mb' },
          can('content:publish') && h('button', { class: 'btn-sm', onclick: async () => { const r = await api(`/screens/${id}/publish`, { method: 'POST' }); toast(r.delivered ? 'Pushed live' : 'Queued (screen offline)', r.delivered ? 'ok' : ''); } }, tr('screens.publish_now')),
          can('content:publish') && h('button', { class: 'btn-sm', onclick: async () => { try { await api(`/screens/${id}/rollback`, { method: 'POST' }); toast('Rolled back', 'ok'); rerender(); } catch (e) { toast(describe(e), 'bad'); } } }, tr('screens.rollback')),
          can('screen:write') && h('button', { class: 'btn-sm', onclick: async () => { await api(`/screens/${id}/unpair`, { method: 'POST' }); toast('Unpaired'); rerender(); } }, tr('screens.unpair')),
          can('screen:write') && h('button', { class: 'btn-sm btn-danger', onclick: async () => { if (confirm(`Delete ${s.name}?`)) { await api(`/screens/${id}`, { method: 'DELETE' }); toast('Deleted'); rerender(); } } }, 'Delete')),
        h('h3', { class: 'mt' }, 'Recent sync events'),
        h('table', {}, h('tbody', {}, [...ev.publishes.slice(0, 6).map((p) =>
          h('tr', {}, h('td', {}, h('span', { class: `badge ${p.status === 'rendered' ? 'ok' : p.status === 'delivered' ? 'info' : 'warn'}` }, p.status)),
            h('td', { class: 'small muted' }, `publish · ${p.source}`), h('td', { class: 'small muted' }, ago(p.created_at)))),
          ...ev.status.slice(0, 8).map((e) =>
            h('tr', {}, h('td', {}, h('span', { class: 'badge' }, e.kind)),
              h('td', { class: 'small muted' }, e.detail || ''), h('td', { class: 'small muted' }, ago(e.created_at))))]))),
    });
  };

  return h('div', {},
    h('div', { class: 'between mb' },
      h('div', { class: 'row' },
        h('span', { class: 'badge ok' }, `${screens.filter((s) => s.status === 'online').length} online`),
        h('span', { class: 'badge bad' }, `${screens.filter((s) => s.status !== 'online').length} offline`)),
      h('div', { class: 'row' },
        can('content:publish') && screens.length ? h('button', { onclick: bulk }, tr('screens.bulk')) : null,
        can('screen:write') && h('button', { class: 'btn-primary', onclick: openPair }, tr('screens.add')))),

    screens.length ? h('div', { class: 'grid g3' }, screens.map((s) =>
      h('div', { class: 'screen-card', onclick: () => detail(s.id) },
        h('div', { class: 'between' },
          h('div', { class: 'row' }, h('span', { class: `dot ${s.status === 'online' ? 'ok' : 'bad'}` }), h('strong', {}, s.name)),
          h('span', { class: 'tiny muted' }, s.orientation)),
        h('div', { class: 'tiny muted mt' }, s.branch_name || 'No branch'),
        h('div', { class: 'small mt' }, s.playlist_name || h('span', { class: 'muted' }, tr('screens.no_playlist'))),
        s.ticker_name && h('div', { class: 'tiny muted' }, `Ticker: ${s.ticker_name}`),
        h('div', { class: 'tiny muted mt' }, `Last sync ${ago(s.last_sync_at)}`))))
      : h('div', { class: 'empty' },
          h('div', {}, tr('screens.empty')),
          h('div', { class: 'small mt' }, 'Open the TV player, then click "Add New Screen" and enter the 4-digit code.'),
          h('a', { href: '/tv', target: '_blank', class: 'small' }, 'Open TV player →')));
}
