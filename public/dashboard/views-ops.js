import { h, api, state, toast, modal, field, ago, fmtDate, can, describe, money, setToken } from './core.js';
import { t as tr } from './i18n.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ==================== SCHEDULES ==================== */
export async function SchedulesView(rerender) {
  const [schedules, playlists, tickers, branches, screens] = await Promise.all([
    api('/schedules'), api('/playlists'), api('/tickers'), api('/branches'), api('/screens'),
  ]);

  const editor = (s) => {
    const name = h('input', { value: s?.name || '', placeholder: 'Breakfast menu' });
    const ctype = h('select', {}, h('option', { value: 'playlist' }, 'Playlist'), h('option', { value: 'ticker' }, 'Flash news'));
    const content = h('select', {});
    const ttype = h('select', {}, h('option', { value: 'org' }, 'Whole organization'), h('option', { value: 'branch' }, 'Branch'), h('option', { value: 'screen' }, 'Single screen'));
    const target = h('select', {});
    const start = h('input', { type: 'time', value: s?.start_time || '07:00' });
    const end = h('input', { type: 'time', value: s?.end_time || '11:00' });
    const sdate = h('input', { type: 'date', value: s?.start_date || '' });
    const edate = h('input', { type: 'date', value: s?.end_date || '' });
    const prio = h('input', { type: 'number', value: s?.priority || 0 });
    const dayBoxes = DAYS.map((d, i) => {
      const cb = h('input', { type: 'checkbox', checked: s ? s.days_of_week.includes(i) : true, style: 'width:auto' });
      return { cb, el: h('label', { class: 'row', style: 'margin:0;gap:5px' }, cb, d), i };
    });

    const fillContent = () => {
      content.innerHTML = '';
      const opts = ctype.value === 'ticker' ? tickers : playlists;
      opts.forEach((o) => content.appendChild(h('option', { value: o.id }, o.name)));
      if (s) content.value = s.content_id;
    };
    const fillTarget = () => {
      target.innerHTML = '';
      target.disabled = ttype.value === 'org';
      const opts = ttype.value === 'branch' ? branches : ttype.value === 'screen' ? screens : [];
      opts.forEach((o) => target.appendChild(h('option', { value: o.id }, o.name)));
      if (s?.target_id) target.value = s.target_id;
    };
    ctype.onchange = fillContent; ttype.onchange = fillTarget;
    if (s) { ctype.value = s.content_type; ttype.value = s.target_type; }
    fillContent(); fillTarget();

    modal({
      title: s ? 'Edit schedule' : 'New schedule', wide: true,
      subtitle: 'Times use each branch\'s local timezone. The most specific target wins conflicts.',
      body: h('div', {}, field('Schedule name', name),
        h('div', { class: 'field-row' }, field('Content type', ctype), field('Content', content)),
        h('div', { class: 'field-row' }, field('Applies to', ttype), field('Target', target)),
        h('div', { class: 'field-row' }, field('Start time', start), field('End time', end)),
        h('div', { class: 'field-row' }, field('Start date (optional)', sdate), field('End date (optional)', edate)),
        h('label', {}, 'Days of week'), h('div', { class: 'row' }, dayBoxes.map((d) => d.el)),
        field('Priority (higher wins ties)', prio)),
      confirmText: 'Save schedule',
      onConfirm: async () => {
        const body = {
          name: name.value, content_type: ctype.value, content_id: content.value,
          target_type: ttype.value, target_id: ttype.value === 'org' ? null : target.value,
          start_time: start.value, end_time: end.value,
          start_date: sdate.value || null, end_date: edate.value || null,
          days_of_week: dayBoxes.filter((d) => d.cb.checked).map((d) => d.i),
          priority: Number(prio.value) || 0,
        };
        const r = s ? await api(`/schedules/${s.id}`, { method: 'PATCH', body })
                    : await api('/schedules', { method: 'POST', body });
        if (r.conflicts?.length) toast(`Saved. Overlaps ${r.conflicts.length} schedule(s) — precedence applied.`, '');
        else toast('Schedule saved', 'ok');
        rerender();
      },
    });
  };

  const previewScreen = async (screenId) => {
    const p = await api(`/schedules/preview/${screenId}`);
    modal({ title: 'What is playing now', subtitle: `${p.timezone} · local ${p.local.time} (${DAYS[p.local.dow]})`,
      body: h('div', {},
        h('div', { class: 'row mb' }, h('span', { class: 'badge info' }, `source: ${p.resolved.source}`)),
        h('h3', {}, 'Active schedules'),
        p.active.length ? h('div', {}, p.active.map((a) => h('div', { class: 'row small', style: 'padding:6px 0' },
          h('span', { class: 'badge' }, a.target_type), a.name, h('span', { class: 'tiny muted' }, a.content_type))))
          : h('div', { class: 'muted small' }, 'No schedule active — using static assignment.')) });
  };

  const rows = schedules.map((s) => h('tr', {},
    h('td', {}, h('div', {}, s.name), h('div', { class: 'tiny muted' }, s.content_type)),
    h('td', {}, h('span', { class: 'badge' }, s.target_type)),
    h('td', { class: 'small' }, `${s.start_time} – ${s.end_time}`,
      s.start_date && h('div', { class: 'tiny muted' }, `${s.start_date} → ${s.end_date || 'open'}`)),
    h('td', { class: 'tiny muted' }, s.days_of_week.length === 7 ? 'Every day' : s.days_of_week.map((d) => DAYS[d]).join(', ')),
    h('td', {}, String(s.priority)),
    h('td', {}, can('content:publish') && h('div', { class: 'row' },
      h('button', { class: 'btn-sm', onclick: () => editor(s) }, 'Edit'),
      h('button', {
        class: 'btn-sm btn-danger',
        onclick: async () => { await api(`/schedules/${s.id}`, { method: 'DELETE' }); toast('Deleted'); rerender(); },
      }, 'Delete')))));

  const table = h('div', { class: 'card' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Schedule', 'Applies to', 'Window', 'Days', 'Priority', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, rows)));

  const empty = h('div', { class: 'empty' }, tr('schedules.empty'));

  const toolbar = h('div', { class: 'between mb' },
    h('div', { class: 'muted small' }, `${schedules.length} schedules`),
    h('div', { class: 'row' },
      screens.length
        ? h('select', { onchange: (e) => e.target.value && previewScreen(e.target.value) },
            h('option', { value: '' }, 'Preview a screen...'),
            screens.map((s) => h('option', { value: s.id }, s.name)))
        : null,
      can('content:publish') && h('button', { class: 'btn-primary', onclick: () => editor(null) }, tr('schedules.new'))));

  return h('div', {}, toolbar, schedules.length ? table : empty);
}

/* ==================== ANALYTICS ==================== */
export async function AnalyticsView() {
  const [uptime, content, overview] = await Promise.all([
    api('/analytics/uptime'), api('/analytics/content'), api('/analytics/overview'),
  ]);
  const csv = () => {
    const rows = [['screen', 'branch', 'uptime_pct', 'online_hours', 'status'],
      ...uptime.screens.map((s) => [s.screen, s.branch, s.uptime_pct, s.online_hours, s.current_status])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'brandcast-uptime.csv' });
    a.click();
  };

  return h('div', {},
    h('div', { class: 'grid g4 mb' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, tr('analytics.fleet_uptime')),
        h('div', { class: 'v', style: `color:${uptime.fleet_uptime_pct >= 99.5 ? 'var(--ok)' : 'var(--warn)'}` }, `${uptime.fleet_uptime_pct}%`),
        h('div', { class: 'd' }, 'Target 99.5%')),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Screens'), h('div', { class: 'v' }, String(overview.total_screens)), h('div', { class: 'd' }, `${overview.online_screens} online`)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Total plays'), h('div', { class: 'v' }, String(content.by_media.reduce((a, m) => a + m.plays, 0))), h('div', { class: 'd' }, 'Last 30 days')),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Play time'), h('div', { class: 'v' }, `${Math.round(content.by_media.reduce((a, m) => a + (m.seconds || 0), 0) / 3600)}h`), h('div', { class: 'd' }, 'Cumulative'))),

    h('div', { class: 'card mb' },
      h('div', { class: 'between mb' }, h('h3', {}, tr('analytics.screen_uptime')), h('button', { class: 'btn-sm', onclick: csv }, tr('common.export'))),
      uptime.screens.length ? h('table', {},
        h('thead', {}, h('tr', {}, ['Screen', 'Branch', 'Uptime', 'Online hours', 'Status'].map((x) => h('th', {}, x)))),
        h('tbody', {}, uptime.screens.map((s) => h('tr', {},
          h('td', {}, s.screen), h('td', { class: 'muted small' }, s.branch || '—'),
          h('td', {}, h('div', {}, `${s.uptime_pct}%`), h('div', { class: 'bar' }, h('i', { style: `width:${s.uptime_pct}%` }))),
          h('td', { class: 'small muted' }, String(s.online_hours)),
          h('td', {}, h('span', { class: `badge ${s.current_status === 'online' ? 'ok' : 'bad'}` }, s.current_status))))))
        : h('div', { class: 'empty' }, 'No screens to report on.')),

    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h3', {}, tr('analytics.top_media')),
        content.by_media.length ? h('table', {}, h('tbody', {}, content.by_media.slice(0, 10).map((m) => h('tr', {},
          h('td', {}, m.media?.name || m.media_id), h('td', { class: 'muted small' }, m.media?.type || ''),
          h('td', {}, `${m.plays} plays`), h('td', { class: 'muted small' }, `${Math.round((m.seconds || 0) / 60)} min`)))))
          : h('div', { class: 'empty small' }, 'No play data yet. Pair a screen and let it run.')),
      h('div', { class: 'card' }, h('h3', {}, tr('analytics.playlist_perf')),
        content.by_playlist.length ? h('table', {}, h('tbody', {}, content.by_playlist.slice(0, 10).map((p) => h('tr', {},
          h('td', {}, p.playlist?.name || '—'), h('td', {}, `${p.plays} plays`),
          h('td', { class: 'muted small' }, `${Math.round((p.seconds || 0) / 60)} min`)))))
          : h('div', { class: 'empty small' }, 'No playlist data yet.'))));
}

/* ==================== TEAM ==================== */
export async function TeamView(rerender) {
  const [users, branches, invites] = await Promise.all([
    api('/users'), api('/branches'), can('user:write') ? api('/users/invites').catch(() => []) : [],
  ]);
  const ROLES = ['owner', 'admin', 'branch_manager', 'content_editor', 'viewer'];
  const LABEL = { owner: 'Owner', admin: 'Admin', branch_manager: 'Branch Manager', content_editor: 'Content Editor', viewer: 'Viewer' };

  const invite = () => {
    const email = h('input', { type: 'email', placeholder: 'colleague@company.com' });
    const role = h('select', {}, ROLES.filter((r) => r !== 'owner').map((r) => h('option', { value: r }, LABEL[r])));
    const branchWrap = h('div');
    const boxes = branches.map((b) => {
      const cb = h('input', { type: 'checkbox', style: 'width:auto' });
      branchWrap.appendChild(h('label', { class: 'row', style: 'margin:4px 0' }, cb, b.name));
      return { cb, id: b.id };
    });
    modal({
      title: 'Invite team member',
      body: h('div', {}, field('Email', email), field('Role', role),
        h('label', {}, 'Branch access (for Branch Managers)'), branchWrap),
      confirmText: 'Send invite',
      onConfirm: async () => {
        const r = await api('/users/invite', { method: 'POST', body: {
          email: email.value, role: role.value, branch_ids: boxes.filter((b) => b.cb.checked).map((b) => b.id) } });
        toast('Invite created', 'ok');
        modal({ title: 'Invite link', subtitle: 'Share this link with your teammate.',
          body: h('div', {}, h('input', { value: `${location.origin}/#/accept-invite?token=${r.invite_token}`, readonly: 'true' })) });
        rerender();
      },
    });
  };

  const roleCell = (u) => can('user:write') && u.role !== 'owner'
    ? h('select', {
        onchange: async (e) => {
          await api(`/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } });
          toast('Role updated', 'ok');
        },
      }, ROLES.filter((r) => r !== 'owner').map((r) =>
        h('option', { value: r, selected: r === u.role ? 'true' : null }, LABEL[r])))
    : h('span', { class: 'badge info' }, LABEL[u.role] || u.role);

  const branchCell = (u) => u.branch_ids.length
    ? u.branch_ids.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(', ')
    : 'All';

  const removeBtn = (u) => can('user:write') && u.role !== 'owner' && h('button', {
    class: 'btn-sm btn-danger',
    onclick: async () => {
      if (!confirm(`Remove ${u.email}?`)) return;
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast('Removed'); rerender();
    },
  }, 'Remove');

  const memberRows = users.map((u) => h('tr', {},
    h('td', {}, h('div', {}, u.name), h('div', { class: 'tiny muted' }, u.email)),
    h('td', {}, roleCell(u)),
    h('td', { class: 'small muted' }, branchCell(u)),
    h('td', {}, h('span', { class: `badge ${u.two_factor ? 'ok' : ''}` }, u.two_factor ? 'on' : 'off')),
    h('td', {}, removeBtn(u))));

  const membersCard = h('div', { class: 'card mb' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Member', 'Role', 'Branch access', '2FA', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, memberRows)));

  const inviteRows = invites.map((i) => h('tr', {},
    h('td', {}, i.email),
    h('td', {}, h('span', { class: 'badge' }, i.role)),
    h('td', { class: 'tiny muted' }, ago(i.created_at)),
    h('td', {}, h('button', {
      class: 'btn-sm',
      onclick: () => {
        navigator.clipboard?.writeText(`${location.origin}/#/accept-invite?token=${i.token}`);
        toast('Link copied', 'ok');
      },
    }, 'Copy link'))));

  const invitesCard = h('div', { class: 'card' },
    h('h3', {}, tr('team.pending')),
    h('table', {}, h('tbody', {}, inviteRows)));

  const toolbar = h('div', { class: 'between mb' },
    h('div', { class: 'muted small' }, `${users.length} members`),
    can('user:write') && h('button', { class: 'btn-primary', onclick: invite }, tr('team.invite')));

  return h('div', {}, toolbar, membersCard, invites.length ? invitesCard : null);
}

/* ==================== BILLING ==================== */
export async function BillingView(rerender) {
  const b = await api('/billing');
  const cur = b.subscription?.plan;
  const currency = b.estimated_next_invoice.currency;

  const subscribe = (planKey) => {
    const cycle = h('select', {}, h('option', { value: 'monthly' }, 'Monthly'), h('option', { value: 'yearly' }, 'Yearly (15% off)'));
    const gw = h('select', {}, h('option', { value: 'razorpay' }, 'Razorpay (UPI, cards — India)'), h('option', { value: 'stripe' }, 'Stripe (international cards)'));
    const card = h('input', { placeholder: '4242 4242 4242 4242' });
    modal({
      title: `Subscribe to ${b.plans[planKey].name}`,
      subtitle: `${money(b.plans[planKey].price_per_screen, currency)} per screen / month · ${b.usage.screens} screens`,
      body: h('div', {}, field('Billing cycle', cycle), field('Payment gateway', gw), field('Card / UPI reference', card),
        h('div', { class: 'small muted mt' }, 'Card data is handled by the PCI-DSS compliant gateway; Brandcast TV never stores it.')),
      confirmText: 'Confirm subscription',
      onConfirm: async () => {
        await api('/billing/subscribe', { method: 'POST', body: { plan: planKey, billing_cycle: cycle.value, gateway: gw.value } });
        toast('Subscription active', 'ok'); rerender();
      },
    });
  };

  const planCard = ([key, p]) => h('div', { class: `plan-card ${key === cur ? 'current' : ''}` },
    h('div', { class: 'between' },
      h('strong', {}, p.name),
      key === cur && h('span', { class: 'badge ok' }, 'current')),
    h('div', { class: 'price' },
      p.price_per_screen ? money(p.price_per_screen, currency) : 'Free',
      p.price_per_screen ? h('span', { class: 'tiny muted' }, ' /screen/mo') : null),
    h('ul', {},
      h('li', {}, `${p.max_screens} screens`),
      h('li', {}, `${p.max_users} users`),
      p.features.slice(3).map((f) => h('li', {}, f))),
    can('billing:write') && key !== cur && h('button', {
      class: 'btn-primary btn-sm', style: 'width:100%', onclick: () => subscribe(key),
    }, b.plans[cur]?.price_per_screen > p.price_per_screen ? 'Downgrade' : 'Upgrade'));

  const statsRow = h('div', { class: 'grid g3 mb' },
    h('div', { class: 'stat' },
      h('div', { class: 'k' }, tr('billing.current_plan')),
      h('div', { class: 'v' }, b.plan.name),
      h('div', { class: 'd' }, b.subscription?.status || '-')),
    h('div', { class: 'stat' },
      h('div', { class: 'k' }, tr('billing.active_screens')),
      h('div', { class: 'v' }, `${b.usage.screens}/${b.plan.max_screens}`),
      h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, b.usage.screens / b.plan.max_screens * 100)}%` }))),
    h('div', { class: 'stat' },
      h('div', { class: 'k' }, tr('billing.next_invoice')),
      h('div', { class: 'v' }, money(b.estimated_next_invoice.subtotal + b.estimated_next_invoice.tax, currency)),
      h('div', { class: 'd' }, b.estimated_next_invoice.tax ? 'incl. GST 18%' : 'no tax')));

  const banner = b.near_limit
    ? h('div', { class: 'banner' },
        `You are close to your plan limits (${b.usage.screens}/${b.plan.max_screens} screens, ${b.usage.users}/${b.plan.max_users} users).`)
    : null;

  const invoicesCard = h('div', { class: 'card' },
    h('h3', {}, tr('billing.invoices')),
    b.invoices.length
      ? h('table', {},
          h('thead', {}, h('tr', {}, ['Invoice', 'Plan', 'Screens', 'Subtotal', 'Tax', 'Total', 'Date', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, b.invoices.map((i) => invoiceRow(b, i, api))))
      : h('div', { class: 'empty small' }, 'No invoices yet.'));

  return h('div', {},
    banner,
    statsRow,
    h('div', { class: 'grid g4 mb' }, Object.entries(b.plans).map(planCard)),
    invoicesCard);
}

function invoiceRow(b, i, api) {
  return h('tr', {},
    h('td', { class: 'small' }, i.number),
    h('td', {}, i.plan),
    h('td', {}, String(i.screens)),
    h('td', {}, money(i.subtotal, i.currency)),
    h('td', { class: 'muted small' }, `${money(i.tax, i.currency)} ${i.tax ? '(GST)' : ''}`),
    h('td', {}, h('strong', {}, money(i.total, i.currency))),
    h('td', { class: 'small muted' }, fmtDate(i.created_at)),
    h('td', {}, h('button', { class: 'btn-sm', onclick: () => openInvoice(i.id) }, 'View')));
}

async function openInvoice(id) {
  const inv = await api(`/billing/invoices/${id}`);
  const lines = inv.line_items.map((l) => `${l.description}  ${l.amount}`).join('\n');
  const doc = [
    'BRANDCAST TV - TAX INVOICE',
    `Invoice: ${inv.number}`,
    `Date:    ${new Date(inv.created_at).toLocaleDateString()}`,
    '',
    `Bill to: ${inv.bill_to.organization}`,
    `GSTIN:   ${inv.bill_to.gstin || 'not provided'}`,
    '',
    lines,
    '',
    `Subtotal: ${inv.subtotal} ${inv.currency}`,
    `${inv.tax_label}: ${inv.tax}`,
    `TOTAL:    ${inv.total} ${inv.currency}`,
    `Status:   ${inv.status.toUpperCase()}`,
    '',
    `Issuer GSTIN: ${inv.issuer.gstin}`,
  ].join('\n');
  const w = window.open('', '_blank');
  if (w) w.document.write(`<pre style="font-family:ui-monospace;padding:32px;line-height:1.7">${doc}</pre>`);
}

/* ==================== SETTINGS ==================== */
export async function SettingsView(rerender) {
  const me = state.me;
  const org = me.org;
  const nameInput = h('input', { value: org.name });
  const gstin = h('input', { value: org.gstin || '', placeholder: '29AABCB1234C1ZX' });
  const req2fa = h('input', { type: 'checkbox', checked: org.require_2fa, style: 'width:auto' });
  const approval = h('input', { type: 'checkbox', checked: org.approval_required, style: 'width:auto' });

  const setup2fa = async () => {
    const r = await api('/auth/2fa/setup', { method: 'POST' });
    modal({ title: 'Two-factor authentication', subtitle: 'Add this secret to your authenticator app.',
      body: h('div', {}, h('div', { class: 'ok-box', style: 'font-family:ui-monospace;word-break:break-all' }, r.secret),
        h('div', { class: 'small muted' }, 'You will be asked for a 6-digit code at next sign-in.')) });
  };

  return h('div', { class: 'grid g2' },
    h('div', { class: 'card' }, h('h3', {}, tr('settings.org')),
      field('Name', nameInput), field('GSTIN (India)', gstin),
      h('label', { class: 'row mt' }, req2fa, 'Require 2FA for all members'),
      h('label', { class: 'row' }, approval, 'Require admin approval before content publishes'),
      can('org:write') && h('button', { class: 'btn-primary mt', onclick: async () => {
        await api('/org', { method: 'PATCH', body: { name: nameInput.value, gstin: gstin.value,
          require_2fa: req2fa.checked, approval_required: approval.checked } });
        toast('Settings saved', 'ok'); location.reload();
      } }, 'Save settings')),

    h('div', { class: 'card' }, h('h3', {}, tr('settings.account')),
      h('div', { class: 'small' }, me.user.name), h('div', { class: 'tiny muted mb' }, me.user.email),
      h('div', { class: 'row mb' }, h('span', { class: 'badge info' }, me.user.role),
        h('span', { class: `badge ${me.user.two_factor ? 'ok' : ''}` }, me.user.two_factor ? '2FA on' : '2FA off')),
      h('div', { class: 'row' },
        h('button', { class: 'btn-sm', onclick: setup2fa }, me.user.two_factor ? 'Re-enroll 2FA' : 'Enable 2FA'),
        me.user.two_factor && !org.require_2fa && h('button', { class: 'btn-sm', onclick: async () => { await api('/auth/2fa/disable', { method: 'POST' }); toast('2FA disabled'); location.reload(); } }, 'Disable 2FA')),
      h('h3', { class: 'mt' }, 'TV client'),
      h('div', { class: 'small muted' }, 'Open the browser kiosk player on any smart TV, then pair with the shown code.'),
      h('a', { class: 'btn btn-sm', href: '/tv', target: '_blank', style: 'display:inline-block;margin-top:8px' }, 'Open TV player'),
      h('h3', { class: 'mt' }, 'Plan features'),
      h('div', { class: 'row' }, state.me.plan.features.map((f) => h('span', { class: 'badge' }, f)))));
}

/* ==================== AUDIT LOG ==================== */
export async function AuditView() {
  const logs = await api('/audit-logs');
  return h('div', { class: 'card' }, h('h3', {}, tr('audit.title')),
    logs.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Action', 'Actor', 'Target', 'When', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, logs.map((l) => h('tr', {},
        h('td', {}, h('span', { class: 'badge info' }, l.action)),
        h('td', { class: 'small' }, l.actor_email || 'system'),
        h('td', { class: 'tiny muted' }, l.target || '—'),
        h('td', { class: 'small muted' }, fmtDate(l.created_at)),
        h('td', {}, l.impersonated ? h('span', { class: 'badge warn' }, 'support') : null)))))
      : h('div', { class: 'empty' }, 'No audit entries yet.'));
}

/* ==================== SUPERADMIN ==================== */
export async function SuperadminView(rerender) {
  const [tenants, health] = await Promise.all([api('/admin/tenants'), api('/admin/health')]);
  const FLAGS = ['scheduling', 'analytics', 'rbac', 'sso', 'approval', 'monitoring', 'residency'];

  const flagsDialog = (t) => {
    const boxes = FLAGS.map((f) => {
      const cb = h('input', { type: 'checkbox', checked: t.feature_flags[f] ?? t.plan.features.includes(f), style: 'width:auto' });
      return { f, cb, el: h('label', { class: 'row', style: 'margin:5px 0' }, cb, f) };
    });
    modal({ title: `Feature flags — ${t.name}`, subtitle: 'Overrides plan defaults for staged rollout.',
      body: h('div', {}, boxes.map((b) => b.el)),
      confirmText: 'Apply flags',
      onConfirm: async () => {
        await api(`/admin/tenants/${t.id}/flags`, { method: 'POST', body: { flags: Object.fromEntries(boxes.map((b) => [b.f, b.cb.checked])) } });
        toast('Flags updated', 'ok'); rerender();
      } });
  };

  const impersonate = async (t) => {
    if (!confirm(`Start an audit-logged support session in ${t.name}?`)) return;
    const r = await api(`/admin/tenants/${t.id}/impersonate`, { method: 'POST', body: { reason: 'support' } });
    setToken(r.token); location.hash = '/dashboard'; location.reload();
  };

  const statCard = (k, v, d) => h('div', { class: 'stat' },
    h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)), d ? h('div', { class: 'd' }, d) : null);

  const tenantRow = (t) => h('tr', {},
    h('td', {}, h('div', {}, t.name), h('div', { class: 'tiny muted' }, t.country)),
    h('td', {}, h('select', {
      onchange: async (e) => {
        await api(`/admin/tenants/${t.id}/plan`, { method: 'POST', body: { plan: e.target.value } });
        toast('Plan changed', 'ok'); rerender();
      },
    }, ['trial', 'starter', 'growth', 'enterprise'].map((pl) =>
      h('option', { value: pl, selected: pl === t.plan_tier ? 'true' : null }, pl)))),
    h('td', {}, `${t.usage.screens} (${t.online_screens} on)`),
    h('td', {}, String(t.usage.users)),
    h('td', {}, money(t.revenue_mrr)),
    h('td', {}, h('span', { class: `badge ${t.status === 'active' ? 'ok' : 'bad'}` }, t.status)),
    h('td', {}, h('div', { class: 'row' },
      h('button', { class: 'btn-sm', onclick: () => flagsDialog(t) }, 'Flags'),
      h('button', { class: 'btn-sm', onclick: () => impersonate(t) }, tr('admin.support_login')),
      h('button', {
        class: 'btn-sm btn-danger',
        onclick: async () => {
          const r = await api(`/admin/tenants/${t.id}/suspend`, { method: 'POST' });
          toast(`Now ${r.status}`); rerender();
        },
      }, t.status === 'active' ? 'Suspend' : 'Restore'))));

  const stats = h('div', { class: 'grid g4 mb' },
    statCard('Organizations', health.organizations, null),
    statCard('Screens', health.screens, `${health.online_screens} online`),
    statCard('Live sessions', health.connected_sessions, `${health.publishes_24h} publishes/24h`),
    statCard('MRR', money(health.mrr), `${health.alerts} offline alerts`));

  const tenantsCard = h('div', { class: 'card mb' },
    h('div', { class: 'between mb' },
      h('h3', {}, tr('admin.tenants')),
      h('button', {
        class: 'btn-sm',
        onclick: async () => {
          const r = await api('/admin/jobs/run', { method: 'POST' });
          toast(`Jobs ran (${r.republished} republished)`, 'ok'); rerender();
        },
      }, 'Run jobs now')),
    h('table', {},
      h('thead', {}, h('tr', {}, ['Organization', 'Plan', 'Screens', 'Users', 'MRR', 'Status', 'Actions'].map((x) => h('th', {}, x)))),
      h('tbody', {}, tenants.map(tenantRow))));

  const healthCard = h('div', { class: 'card' },
    h('h3', {}, tr('admin.health')),
    h('div', { class: 'row' },
      h('span', { class: 'badge ok' }, `uptime ${Math.round(health.uptime_seconds / 60)}m`),
      h('span', { class: 'badge' }, `memory ${health.memory_mb} MB`),
      health.plan_distribution.map((p) => h('span', { class: 'badge info' }, `${p.plan_tier}: ${p.c}`))));

  return h('div', {}, stats, tenantsCard, healthCard);
}

/* ==================== ACCEPT INVITE ==================== */
export function AcceptInviteView() {
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token');
  const name = h('input', { placeholder: 'Your name' });
  const pw = h('input', { type: 'password', placeholder: tr('invite.password_hint') });
  const err = h('div');
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('div', { class: 'logo' }, 'Brandcast TV'),
    h('h1', {}, tr('invite.title')),
    h('p', { class: 'sub' }, tr('invite.sub')),
    err, field(tr('auth.name'), name), field(tr('auth.password'), pw),
    h('button', { class: 'btn-primary mt', style: 'width:100%', onclick: async () => {
      try {
        const r = await api('/users/accept-invite', { method: 'POST', body: { token, name: name.value, password: pw.value } });
        setToken(r.token); location.hash = '/dashboard'; location.reload();
      } catch (e) { err.innerHTML = ''; err.appendChild(h('div', { class: 'err' }, describe(e))); }
    } }, tr('invite.join'))));
}
