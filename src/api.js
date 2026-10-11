// Kleine Helfer für die Server-Schnittstelle
async function call(method, url, body, raw, signal) {
  const opts = { method, headers: { 'X-Schulheft': '1' }, signal };
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Fehler ${res.status}`); e.status = res.status; throw e; }
  return data;
}
const q = p => encodeURIComponent(p);

export const api = {
  info: () => call('GET', '/api/info'),
  setup: root => call('POST', '/api/setup', { root }),
  tree: kind => call('GET', `/api/tree?kind=${kind}`),
  read: p => call('GET', `/api/text?p=${q(p)}`),
  write: (p, text, baseMtime, force) => call('PUT', `/api/text?p=${q(p)}`, { text, baseMtime, force }),
  create: (dir, name, type) => call('POST', '/api/new', { dir, name, type }),
  rename: (p, name) => call('POST', '/api/rename', { p, name }),
  move: (p, dir) => call('POST', '/api/move', { p, dir }),
  trash: p => call('POST', '/api/trash', { p }),
  reveal: p => call('POST', '/api/reveal', { p }),
  open: p => call('POST', '/api/open', { p }),
  upload: (dir, name, blob) => call('POST', `/api/upload?dir=${q(dir)}&name=${q(name)}`, blob, true),
  search: (s, signal) => call('GET', `/api/search?q=${q(s)}`, undefined, false, signal),
  overview: () => call('GET', '/api/overview'),
  lessons: (dir, full) => call('GET', `/api/lessons?${dir ? `dir=${q(dir)}&` : ''}${full ? 'full=1' : ''}`),
  settings: () => call('GET', '/api/settings'),
  saveSettings: data => call('PUT', '/api/settings', data),
  material: dir => call('GET', `/api/material?dir=${q(dir)}`),
  uploadMaterial: (note, name, blob) => call('POST', `/api/material?note=${q(note)}&name=${q(name)}`, blob, true),
  inbox: () => call('GET', '/api/inbox'),
  checkFiles: items => call('POST', '/api/files/check', { items }),
  addFile: (dest, name, blob, batch, keep) => call('POST', `/api/files/add?dest=${q(dest)}&name=${q(name)}&batch=${q(batch)}${keep ? '&dup=keep' : ''}`, blob, true),
  moveFiles: (batch, items) => call('POST', '/api/files/move', { batch, items }),
  undoFiles: batch => call('POST', '/api/files/undo', { batch }),
  createLesson: data => call('POST', '/api/lesson', data),
  doc: p => call('GET', `/api/doc?p=${q(p)}`),
  saveDoc: (p, data, items) => call('POST', `/api/doc/save?p=${q(p)}`, { data, items }),
  restoreDoc: p => call('POST', `/api/doc/restore?p=${q(p)}`, {}),
};

export const rawUrl = p => `/api/raw?p=${q(p)}&t=${Date.now()}`;

// Pfade: alles relativ zum Notizordner
export function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
export function basename(p) { return p.slice(p.lastIndexOf('/') + 1); }
export function resolve(fromDir, rel) {
  const parts = fromDir ? fromDir.split('/') : [];
  for (const s of rel.split('/')) {
    if (s === '..') parts.pop();
    else if (s && s !== '.') parts.push(s);
  }
  return parts.join('/');
}
export function relative(fromDir, to) {
  const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}
export const isDoc = p => /\.(pdf|png|jpe?g|gif|webp)$/i.test(p);
export const isImage = p => /\.(png|jpe?g|gif|webp)$/i.test(p);
export const prettyName = p => basename(p).replace(/\.md$/i, '');

// Datum und Stunden-Beschriftung
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function fmtDate(iso, withYear = true) {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${WD[d.getDay()]} ${m[3]}.${m[2]}.${withYear ? m[1] : ''}`;
}
export function todayIso() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// Kurze Zeit für Listen: "08:00–09:30" → "08:00", "1. Stunde" bleibt
export const shortZeit = z => ((z || '').match(/^\d{1,2}:\d{2}/) || [z || ''])[0];
// Titel einer Stunde: Dateiname ohne Datum, sonst Einheit oder Fach
export const lessonTitle = (m, p) => (p ? prettyName(p).replace(/^\d{4}-\d{2}-\d{2}\s*/, '') : '') || m.einheit || m.fach || '';
export const lessonLabel = (m, p) => `${fmtDate(m.datum, false)} ${shortZeit(m.zeit)} · ${lessonTitle(m, p)}`.replace(/\s+/g, ' ');
