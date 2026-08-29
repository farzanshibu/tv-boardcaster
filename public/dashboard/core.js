/* Brandcast TV dashboard — tiny reactive runtime, no build step. */
import { locale } from './i18n.js';

export const state = {
  token: localStorage.getItem('bc_token') || null,
  me: null, route: location.hash.slice(1) || '/dashboard',
  cache: {}, ws: null,
};

/* ---------------- API ---------------- */
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method, headers, body: form ? form : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.me) logout();
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  }
  return data;
}

export function setToken(t) {
  state.token = t;
  t ? localStorage.setItem('bc_token', t) : localStorage.removeItem('bc_token');
}
export function logout() { setToken(null); state.me = null; state.ws?.close(); location.hash = '/login'; location.reload(); }

/* ---------------- DOM helpers ---------------- */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}`, role: 'status', 'aria-live': 'polite' }, message);
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3600);
}

let modalSeq = 0;
export function modal({ title, subtitle, body, confirmText = 'Save', onConfirm, wide }) {
  const root = $('#modal-root');
  const previouslyFocused = document.activeElement;
  const titleId = `modal-title-${++modalSeq}`;
  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKeydown, true);
    previouslyFocused?.focus?.();
  };
  const onKeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusables = root.querySelectorAll('button, input, select, textarea, a[href]');
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKeydown, true);
  const form = h('div', {}, body);
  const errBox = h('div', { role: 'alert', 'aria-live': 'assertive' });
  const confirmBtn = h('button', {
    class: 'btn-primary',
    onclick: async () => {
      confirmBtn.disabled = true;
      try { await onConfirm(form); close(); }
      catch (e) { errBox.innerHTML = ''; errBox.appendChild(h('div', { class: 'err' }, describe(e))); }
      finally { confirmBtn.disabled = false; }
    },
  }, confirmText);

  root.appendChild(h('div', { class: 'modal-bg', onclick: (e) => e.target.classList.contains('modal-bg') && close() },
    h('div', {
      class: 'modal', style: wide ? 'max-width:760px' : '',
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
    },
      h('h3', { id: titleId }, title),
      subtitle && h('p', { class: 'muted small' }, subtitle),
      errBox, form,
      h('div', { class: 'actions' },
        h('button', { onclick: close }, 'Cancel'),
        onConfirm && confirmBtn))));
  setTimeout(() => $('.modal input, .modal select')?.focus(), 40);
  return { close };
}

export const describe = (e) => ({
  screen_limit_reached: 'Screen limit reached for your plan. Upgrade to add more screens.',
  user_limit_reached: 'User limit reached for your plan. Upgrade to invite more users.',
  feature_not_in_plan: 'This feature requires a higher plan.',
  screen_name_taken_in_branch: 'A screen with that name already exists in this branch.',
  invalid_code: 'That pairing code is not valid.',
  code_expired: 'That pairing code has expired. Generate a new one on the TV.',
  playlist_assigned_to_screens: 'This playlist is assigned to screens. Reassign them first.',
  media_in_use: 'This media is used in a playlist.',
  forbidden: 'Your role does not permit this action.',
}[e?.data?.error || e?.message] || e?.data?.error || e?.message || 'Something went wrong');

export const fmtDate = (s) => (s ? new Date(s).toLocaleString() : '—');
export const ago = (s) => {
  if (!s) return 'never';
  const d = (Date.now() - Date.parse(s)) / 1000;
  if (d < 60) return `${Math.round(d)}s ago`;
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
};
export const money = (n, c = 'INR') => {
  // Currency comes from the org; digit grouping follows the reader's locale.
  const region = c === 'INR' ? 'IN' : 'US';
  return new Intl.NumberFormat(`${locale}-${region}`, {
    style: 'currency', currency: c, maximumFractionDigits: 0,
  }).format(n || 0);
};

let fieldSeq = 0;
export const field = (label, input) => {
  const id = input.id || `f${++fieldSeq}`;
  input.id = id;
  return h('div', {}, h('label', { for: id }, label), input);
};
export const can = (perm) => {
  const P = {
    viewer: ['read'], content_editor: ['read', 'content:write'],
    branch_manager: ['read', 'content:write', 'content:publish', 'screen:write'],
    admin: ['read', 'content:write', 'content:publish', 'content:approve', 'screen:write', 'branch:write', 'user:write', 'org:write'],
    owner: ['read', 'content:write', 'content:publish', 'content:approve', 'screen:write', 'branch:write', 'user:write', 'org:write', 'billing:write'],
    superadmin: ['*'],
  }[state.me?.user?.role] || [];
  return P.includes('*') || P.includes(perm);
};
