import { h, api, toast, modal, field, ago, can, describe } from './core.js';

/* ==================== MEDIA LIBRARY ==================== */
export async function MediaView(rerender) {
  const media = await api('/media');

  const uploadDialog = () => {
    const fileInput = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm,text/html' });
    const nameInput = h('input', { placeholder: 'Optional display name' });
    const tagsInput = h('input', { placeholder: 'summer, offers' });
    const durInput = h('input', { type: 'number', value: 10, min: 1 });
    modal({
      title: 'Upload media', subtitle: 'JPG, PNG, WebP, MP4, WebM or HTML5 banner.',
      body: h('div', {}, field('File', fileInput), field('Name', nameInput),
        h('div', { class: 'field-row' }, field('Tags (comma separated)', tagsInput), field('Image duration (s)', durInput))),
      confirmText: 'Upload',
      onConfirm: async () => {
        if (!fileInput.files[0]) throw new Error('Choose a file first');
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        if (nameInput.value) fd.append('name', nameInput.value);
        fd.append('duration', durInput.value || 10);
        fd.append('tags', JSON.stringify(tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean)));
        await api('/media', { method: 'POST', form: fd });
        toast('Media uploaded', 'ok'); rerender();
      },
    });
  };

  const linkDialog = () => {
    const url = h('input', { placeholder: 'https://cdn.example.com/banner.jpg' });
    const name = h('input', { placeholder: 'Diwali banner' });
    const type = h('select', {}, h('option', { value: 'image' }, 'Image'), h('option', { value: 'video' }, 'Video'), h('option', { value: 'html' }, 'HTML5'));
    const dur = h('input', { type: 'number', value: 10, min: 1 });
    modal({
      title: 'Link CDN media', subtitle: 'Reference media already hosted on your CDN.',
      body: h('div', {}, field('Name', name), field('URL', url), h('div', { class: 'field-row' }, field('Type', type), field('Duration (s)', dur))),
      confirmText: 'Add',
      onConfirm: async () => {
        await api('/media/link', { method: 'POST', body: { name: name.value, url: url.value, type: type.value, duration: Number(dur.value) } });
        toast('Media added', 'ok'); rerender();
      },
    });
  };

  const detail = async (m) => {
    const versions = await api(`/media/${m.id}/versions`);
    const replaceInput = h('input', { type: 'file' });
    modal({
      title: m.name, subtitle: `${m.type} · v${m.version} · ${(m.bytes / 1e6).toFixed(1)} MB`,
      body: h('div', {},
        h('div', { style: 'height:180px;background:#060c18;border-radius:8px;display:grid;place-items:center;overflow:hidden' },
          m.type === 'video' ? h('video', { src: m.url, controls: 'true', style: 'max-width:100%;max-height:100%' })
            : h('img', { src: m.url, style: 'max-width:100%;max-height:100%;object-fit:contain' })),
        m.status !== 'approved' ? h('div', { class: 'row mt' },
          h('span', { class: 'badge warn' }, 'Pending approval'),
          can('content:approve') && h('button', { class: 'btn-sm', onclick: async () => { await api(`/media/${m.id}/approve`, { method: 'POST' }); toast('Approved', 'ok'); rerender(); } }, 'Approve')) : null,
        can('content:write') && h('div', {}, field('Replace file (keeps version history)', replaceInput),
          h('button', { class: 'btn-sm mt', onclick: async () => {
            if (!replaceInput.files[0]) return toast('Choose a file', 'bad');
            const fd = new FormData(); fd.append('file', replaceInput.files[0]);
            await api(`/media/${m.id}/replace`, { method: 'POST', form: fd });
            toast('Replaced', 'ok'); rerender();
          } }, 'Upload replacement')),
        h('h3', { class: 'mt' }, 'Version history'),
        h('table', {}, h('tbody', {}, versions.map((v) => h('tr', {},
          h('td', {}, `v${v.version}`), h('td', { class: 'small muted' }, ago(v.created_at)),
          h('td', {}, can('content:write') && v.version !== m.version
            ? h('button', { class: 'btn-sm', onclick: async () => { await api(`/media/${m.id}/restore/${v.version}`, { method: 'POST' }); toast('Restored', 'ok'); rerender(); } }, 'Restore')
            : h('span', { class: 'tiny muted' }, 'current')))))),
        can('content:write') && h('button', { class: 'btn-sm btn-danger mt', onclick: async () => {
          try { await api(`/media/${m.id}`, { method: 'DELETE' }); toast('Deleted'); rerender(); }
          catch (e) { toast(describe(e), 'bad'); } } }, 'Delete media')),
    });
  };

  return h('div', {},
    h('div', { class: 'between mb' },
      h('div', { class: 'muted small' }, `${media.length} assets`),
      can('content:write') && h('div', { class: 'row' },
        h('button', { onclick: linkDialog }, 'Link CDN URL'),
        h('button', { class: 'btn-primary', onclick: uploadDialog }, '+ Upload media'))),
    media.length ? h('div', { class: 'media-grid' }, media.map((m) =>
      h('div', { class: 'media-card', onclick: () => detail(m) },
        h('div', { class: 'thumb' }, m.type === 'video'
          ? h('video', { src: m.url, muted: 'true' })
          : h('img', { src: m.url, onerror: (e) => (e.target.style.display = 'none') })),
        h('div', { class: 'info' },
          h('div', { class: 'small', style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, m.name),
          h('div', { class: 'tiny muted' }, `${m.type} · ${m.duration}s`),
          m.status !== 'approved' && h('span', { class: 'badge warn tiny' }, 'pending')))))
      : h('div', { class: 'empty' }, 'No media yet. Upload an image or video to get started.'));
}

/* ==================== PLAYLISTS ==================== */
export async function PlaylistsView(rerender) {
  const [playlists, media] = await Promise.all([api('/playlists'), api('/media')]);

  const editor = (existing) => {
    let items = existing ? existing.items.map((i) => ({ media_id: i.media_id, duration: i.duration })) : [];
    const nameInput = h('input', { value: existing?.name || '', placeholder: 'Morning promos' });
    const list = h('div');

    const draw = () => {
      list.innerHTML = '';
      if (!items.length) list.appendChild(h('div', { class: 'empty small' }, 'Add media below.'));
      items.forEach((it, idx) => {
        const m = media.find((x) => x.id === it.media_id);
        const dur = h('input', { type: 'number', value: it.duration, min: 1, onchange: (e) => (items[idx].duration = Number(e.target.value)) });
        list.appendChild(h('div', { class: 'pl-item', draggable: 'true',
          ondragstart: (e) => e.dataTransfer.setData('text/plain', idx),
          ondragover: (e) => e.preventDefault(),
          ondrop: (e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain'));
            const [moved] = items.splice(from, 1); items.splice(idx, 0, moved); draw(); } },
          h('span', { class: 'drag-handle' }, '⠿'),
          m?.type === 'video' ? h('video', { class: 'thumb', src: m.url }) : h('img', { class: 'thumb', src: m?.url || '' }),
          h('div', { style: 'flex:1;min-width:0' },
            h('div', { class: 'small' }, m?.name || 'missing'),
            h('div', { class: 'tiny muted' }, m?.type || '')),
          dur, h('span', { class: 'tiny muted' }, 's'),
          h('button', { class: 'btn-sm btn-danger', onclick: () => { items.splice(idx, 1); draw(); } }, '✕')));
      });
    };
    draw();

    const picker = h('select', {}, h('option', { value: '' }, '+ Add media…'),
      media.map((m) => h('option', { value: m.id }, `${m.name} (${m.type})`)));
    picker.onchange = () => {
      const m = media.find((x) => x.id === picker.value);
      if (m) { items.push({ media_id: m.id, duration: m.duration }); draw(); }
      picker.value = '';
    };

    modal({
      title: existing ? 'Edit playlist' : 'New playlist', wide: true,
      body: h('div', {}, field('Playlist name', nameInput),
        h('label', {}, 'Items (drag to reorder)'), list, h('div', { class: 'mt' }, picker)),
      confirmText: existing ? 'Save changes' : 'Create playlist',
      onConfirm: async () => {
        const body = { name: nameInput.value.trim(), items };
        if (!body.name) throw new Error('Name is required');
        existing ? await api(`/playlists/${existing.id}`, { method: 'PATCH', body })
                 : await api('/playlists', { method: 'POST', body });
        toast('Playlist saved', 'ok'); rerender();
      },
    });
  };

  const preview = (p) => {
    const stage = h('div', { style: 'height:320px;background:#000;border-radius:10px;position:relative;overflow:hidden' });
    const label = h('div', { class: 'tiny muted mt' });
    modal({ title: `Preview: ${p.name}`, wide: true, body: h('div', {}, stage, label) });
    let i = 0, timer;
    const step = () => {
      const it = p.items[i % p.items.length];
      if (!it) { stage.appendChild(h('div', { class: 'empty' }, 'Playlist is empty')); return; }
      stage.innerHTML = '';
      stage.appendChild(it.media.type === 'video'
        ? h('video', { src: it.media.url, autoplay: 'true', muted: 'true', style: 'width:100%;height:100%;object-fit:contain' })
        : h('img', { src: it.media.url, style: 'width:100%;height:100%;object-fit:contain' }));
      label.textContent = `${i % p.items.length + 1}/${p.items.length} · ${it.media.name} · ${it.duration}s`;
      i++;
      timer = setTimeout(step, it.duration * 1000);
    };
    step();
    const obs = new MutationObserver(() => { if (!document.querySelector('.modal-bg')) { clearTimeout(timer); obs.disconnect(); } });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  };

  return h('div', {},
    h('div', { class: 'between mb' },
      h('div', { class: 'muted small' }, `${playlists.length} playlists`),
      can('content:write') && h('button', { class: 'btn-primary', onclick: () => editor(null) }, '+ New playlist')),
    playlists.length ? h('div', { class: 'grid g2' }, playlists.map((p) =>
      h('div', { class: 'card' },
        h('div', { class: 'between' }, h('strong', {}, p.name),
          p.status !== 'approved' && h('span', { class: 'badge warn' }, 'pending')),
        h('div', { class: 'tiny muted mt' }, `${p.items.length} items · ${p.total_duration}s loop`),
        h('div', { class: 'row mt' }, p.items.slice(0, 5).map((i) =>
          i.media.type === 'video' ? h('video', { src: i.media.url, style: 'width:52px;height:34px;object-fit:cover;border-radius:4px' })
            : h('img', { src: i.media.url, style: 'width:52px;height:34px;object-fit:cover;border-radius:4px' }))),
        h('div', { class: 'row mt' },
          h('button', { class: 'btn-sm', onclick: () => preview(p) }, 'Preview'),
          can('content:write') && h('button', { class: 'btn-sm', onclick: () => editor(p) }, 'Edit'),
          p.status !== 'approved' && can('content:approve') && h('button', { class: 'btn-sm', onclick: async () => { await api(`/playlists/${p.id}/approve`, { method: 'POST' }); toast('Approved', 'ok'); rerender(); } }, 'Approve'),
          can('content:write') && h('button', { class: 'btn-sm btn-danger', onclick: async () => {
            try { await api(`/playlists/${p.id}`, { method: 'DELETE' }); toast('Deleted'); rerender(); }
            catch (e) { toast(describe(e), 'bad'); } } }, 'Delete')))))
      : h('div', { class: 'empty' }, 'No playlists yet. Create one to assign to your screens.'));
}

/* ==================== TICKERS ==================== */
export async function TickersView(rerender) {
  const tickers = await api('/tickers');
  const editor = (t) => {
    const name = h('input', { value: t?.name || '', placeholder: 'Store hours notice' });
    const text = h('textarea', { rows: 3 }, t?.text || '');
    const pos = h('select', {}, h('option', { value: 'bottom' }, 'Bottom'), h('option', { value: 'top' }, 'Top'));
    if (t) pos.value = t.position;
    const speed = h('input', { type: 'number', value: t?.speed || 60, min: 10, max: 300 });
    const color = h('input', { type: 'color', value: t?.color || '#ffffff' });
    const bg = h('input', { type: 'color', value: t?.background || '#111827' });
    const start = h('input', { type: 'time', value: t?.start_time || '' });
    const end = h('input', { type: 'time', value: t?.end_time || '' });
    modal({
      title: t ? 'Edit flash news' : 'New flash news',
      subtitle: 'Scrolling ticker shown over the playlist.',
      body: h('div', {}, field('Name', name), field('Message', text),
        h('div', { class: 'field-row' }, field('Position', pos), field('Scroll speed', speed)),
        h('div', { class: 'field-row' }, field('Text color', color), field('Background', bg)),
        h('div', { class: 'field-row' }, field('Show from (local)', start), field('Show until (local)', end))),
      confirmText: 'Save',
      onConfirm: async () => {
        const body = { name: name.value, text: text.value, position: pos.value, speed: Number(speed.value),
          color: color.value, background: bg.value, start_time: start.value || null, end_time: end.value || null };
        t ? await api(`/tickers/${t.id}`, { method: 'PATCH', body }) : await api('/tickers', { method: 'POST', body });
        toast('Flash news saved', 'ok'); rerender();
      },
    });
  };

  return h('div', {},
    h('div', { class: 'between mb' },
      h('div', { class: 'muted small' }, `${tickers.length} tickers`),
      can('content:write') && h('button', { class: 'btn-primary', onclick: () => editor(null) }, '+ New flash news')),
    tickers.length ? h('div', { class: 'grid g2' }, tickers.map((t) =>
      h('div', { class: 'card' },
        h('div', { class: 'between' }, h('strong', {}, t.name), h('span', { class: 'badge' }, t.position)),
        h('div', { style: `margin-top:10px;padding:10px;border-radius:6px;background:${t.background};color:${t.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis` }, t.text),
        h('div', { class: 'tiny muted mt' }, t.start_time ? `Active ${t.start_time}–${t.end_time}` : 'Always on'),
        h('div', { class: 'row mt' },
          can('content:write') && h('button', { class: 'btn-sm', onclick: () => editor(t) }, 'Edit'),
          can('content:write') && h('button', { class: 'btn-sm btn-danger', onclick: async () => { await api(`/tickers/${t.id}`, { method: 'DELETE' }); toast('Deleted'); rerender(); } }, 'Delete')))))
      : h('div', { class: 'empty' }, 'No flash news yet.'));
}

/* ==================== BRANCHES ==================== */
export async function BranchesView(rerender) {
  const [branches, playlists, tickers] = await Promise.all([api('/branches'), api('/playlists'), api('/tickers')]);
  const TZ = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'UTC'];

  const editor = (b) => {
    const name = h('input', { value: b?.name || '', placeholder: 'Koramangala Store' });
    const tz = h('select', {}, TZ.map((t) => h('option', { value: t }, t)));
    if (b) tz.value = b.timezone;
    const addr = h('input', { value: b?.address || '', placeholder: '80 Feet Road, Bengaluru' });
    const pl = h('select', {}, h('option', { value: '' }, 'None'), playlists.map((p) => h('option', { value: p.id }, p.name)));
    const tk = h('select', {}, h('option', { value: '' }, 'None'), tickers.map((t) => h('option', { value: t.id }, t.name)));
    if (b) { pl.value = b.default_playlist_id || ''; tk.value = b.default_ticker_id || ''; }
    modal({
      title: b ? 'Edit branch' : 'New branch',
      subtitle: 'Branch defaults apply to screens with no explicit assignment.',
      body: h('div', {}, field('Branch name', name), field('Timezone', tz), field('Address', addr),
        b ? h('div', { class: 'field-row' }, field('Default playlist', pl), field('Default flash news', tk)) : null),
      confirmText: 'Save',
      onConfirm: async () => {
        const body = { name: name.value, timezone: tz.value, address: addr.value };
        if (b) { body.default_playlist_id = pl.value || null; body.default_ticker_id = tk.value || null;
                 await api(`/branches/${b.id}`, { method: 'PATCH', body }); }
        else await api('/branches', { method: 'POST', body });
        toast('Branch saved', 'ok'); rerender();
      },
    });
  };

  return h('div', {},
    h('div', { class: 'between mb' },
      h('div', { class: 'muted small' }, `${branches.length} branches`),
      can('branch:write') && h('button', { class: 'btn-primary', onclick: () => editor(null) }, '+ New branch')),
    h('div', { class: 'card' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Branch', 'Timezone', 'Screens', 'Local time', 'Status', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, branches.map((b) => h('tr', {},
        h('td', {}, h('div', {}, b.name), h('div', { class: 'tiny muted' }, b.address || '—')),
        h('td', { class: 'small muted' }, b.timezone),
        h('td', {}, String(b.screen_count)),
        h('td', { class: 'small muted' }, new Date().toLocaleTimeString('en-GB', { timeZone: b.timezone, hour: '2-digit', minute: '2-digit' })),
        h('td', {}, h('span', { class: `badge ${b.status === 'active' ? 'ok' : ''}` }, b.status)),
        h('td', {}, can('branch:write') && h('div', { class: 'row' },
          h('button', { class: 'btn-sm', onclick: () => editor(b) }, 'Edit'),
          b.status === 'active' && h('button', { class: 'btn-sm btn-danger', onclick: async () => { await api(`/branches/${b.id}`, { method: 'DELETE' }); toast('Archived'); rerender(); } }, 'Archive')))))))));
}
