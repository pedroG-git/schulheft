// Schulheft – „Dateien einsortieren“: neue Dateien (Drop, Dateiauswahl) oder Dateien aus dem Eingang an ein Ziel bringen.
// Ziel = Stunde (→ Material/ + Link), Ordner oder „Später – in den Eingang“. Ein Klick auf „Einsortieren“, danach Rückgängig möglich.
import { api, rawUrl, basename, lessonLabel } from './api.js';
import { suggestLesson, INBOX_DIR } from '../lib/lesson.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Hinzufügen: nur PDF, Bilder (auch HEIC) und Office-Dateien (gleiche Liste wie ADD_EXT in server.js)
export const ADD_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'];
const OK_EXT = new RegExp(`(${ADD_EXT.map(e => e.replace('.', '\\.')).join('|')})$`, 'i');
const IMG = /\.(png|jpe?g|gif|webp)$/i;
const SYS = new Set(['.DS_Store', 'desktop.ini', 'Thumbs.db', '.localized']);
const extOf = n => (n.match(/\.[^./]+$/) || [''])[0];
export const fmtSize = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);
const icon = n => (IMG.test(n) || /\.hei[cf]$/i.test(n) ? '🖼' : /\.pdf$/i.test(n) ? '📄' : /\.(pptx?|odp)$/i.test(n) ? '📊' : /\.(xlsx?|ods)$/i.test(n) ? '📈' : '📃');

// Dateien aus einem Drop – auch ganze Ordner (flach eingesammelt, ohne versteckte Dateien).
// Muss synchron im drop-Ereignis aufgerufen werden (danach ist dataTransfer leer).
export function filesFromDrop(dt) {
  const fallback = [...(dt.files || [])];
  const entries = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Promise.resolve(fallback);
  const out = [];
  const walk = async e => {
    if (e.name.startsWith('.') || SYS.has(e.name)) return;
    if (e.isFile) out.push(await new Promise((ok, no) => e.file(ok, no)));
    else if (e.isDirectory) {
      const r = e.createReader();
      for (;;) {
        const list = await new Promise((ok, no) => r.readEntries(ok, no));
        if (!list.length) break;
        for (const c of list) await walk(c);
      }
    }
  };
  return (async () => { try { for (const e of entries) await walk(e); return out; } catch { return fallback.filter(f => f.size || f.type); } })();
}

// Name mit der ursprünglichen Endung (wer sie beim Umbenennen weglässt, bekommt sie wieder)
const finalName = (value, orig) => { const v = String(value || '').trim() || orig, e = extOf(orig); return extOf(v).toLowerCase() === e.toLowerCase() ? v : v + e; };
const batchId = () => 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

// Eine Liste ausführen: rows [{ file | from, dest, name, keep, trash }] → { done, skipped, trashed, errors, lessons, batch }
// trash: gleiche Datei liegt schon im Ziel → Kopie im Eingang in den Papierkorb (nicht rückgängig zu machen)
export async function runBatch(rows, progress = () => {}) {
  const batch = batchId(), res = { done: 0, skipped: [], trashed: [], errors: [], lessons: new Set(), batch };
  const uploads = rows.filter(r => r.file), moves = rows.filter(r => r.from);
  let i = 0;
  for (const r of uploads) {
    progress(++i, rows.length);
    try {
      const x = await api.addFile(r.dest, r.name, r.file, batch, r.keep);
      if (x.status === 'duplicate') res.skipped.push(`${r.name} (schon da: ${basename(x.existing)})`);
      else { res.done++; if (x.lesson) res.lessons.add(x.lesson); }
    } catch (e) { res.errors.push(`${r.name}: ${e.message}`); }
  }
  if (moves.length) {
    progress(rows.length, rows.length);
    try {
      const { results } = await api.moveFiles(batch, moves.map(r => ({ from: r.from, dest: r.dest, name: r.name, dup: r.trash ? 'trash' : r.keep ? 'keep' : '' })));
      results.forEach((x, k) => {
        if (x.status === 'moved') { res.done++; if (x.lesson) res.lessons.add(x.lesson); }
        else if (x.status === 'duplicate') res.skipped.push(`${moves[k].name} (schon da: ${basename(x.existing)})`);
        else if (x.status === 'trashed') res.trashed.push(moves[k].name);
        else if (x.status === 'error') res.errors.push(`${moves[k].name}: ${x.error}`);
      });
    } catch (e) { res.errors.push(e.message); }
  }
  res.lessons = [...res.lessons];
  return res;
}

// ── Dialog ──────────────────────────────────────────────────────
let open = null;   // offener Dialog: weitere Dateien kommen dazu
const sha256 = async file => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');

// ctx: { tree(), beforeWrite(lessons), finish(result) }
export function openOrganizer(ctx, { files = [], inbox = [] }) {
  const rowsFromFiles = list => list.map(f => ({ id: Math.random().toString(36).slice(2), orig: f.name || 'Datei', name: f.name || 'Datei', size: f.size, file: f, ok: OK_EXT.test(f.name || '') }));
  if (open) { open.add(rowsFromFiles(files)); return; }
  const inboxMode = !files.length;
  let rows = inboxMode ? inbox.map(f => ({ id: f.path, orig: f.name, name: f.name, size: f.size, from: f.path, ok: true })) : rowsFromFiles(files);
  let lessons = [], folders = [], suggestion = null, dest = null, loaded = false, busy = false, picker = null;
  const urls = [];

  const el = document.createElement('div');
  el.id = 'organizer';
  el.innerHTML = '<div class="org-card" role="dialog" aria-label="Dateien einsortieren"></div>';
  document.body.appendChild(el);
  const card = el.firstChild;

  const lessonOf = p => lessons.find(l => l.path === p);
  const label = d => {
    if (d === INBOX_DIR) return '📥 Später – in den Eingang';
    if (d === '') return '📁 Notizordner (oberste Ebene)';
    const l = lessonOf(d);
    if (l) return `🗓 ${[l.meta.fach, l.meta.einheit].filter(Boolean).join(' · ')} – ${lessonLabel(l.meta, l.path)}`;
    return '📁 ' + d.split('/').join(' / ');
  };
  const destOf = r => r.dest ?? dest;
  const skipped = r => r.dup && (r.from ? !r.trash : r.skip);   // Eingang: „Nein“ = bleibt im Eingang
  const usable = () => rows.filter(r => r.ok && destOf(r) != null && !skipped(r) && !(inboxMode && destOf(r) === INBOX_DIR));

  function render() {
    const n = usable().length, bad = rows.filter(r => !r.ok).length;
    card.innerHTML = `
      <div class="org-head"><h3>Dateien einsortieren</h3><span class="org-sub">${rows.length} ${rows.length === 1 ? 'Datei' : 'Dateien'}${inboxMode ? ' im Eingang' : ''}</span></div>
      <label class="org-all">Wohin? <button class="org-dest main" data-pick="all" title="Ziel für alle Dateien">${!loaded ? 'Lädt …' : dest == null ? 'Bitte wählen' : esc(label(dest))} ▾</button></label>
      ${suggestion && dest !== suggestion ? `<button class="org-suggest" data-set="${esc(suggestion)}">Vorschlag: ${esc(label(suggestion))}</button>` : ''}
      <ul class="org-list">${rows.map(r => `<li class="org-row ${r.ok ? '' : 'bad'}" data-id="${esc(r.id)}">
        <span class="org-thumb">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : icon(r.orig)}</span>
        <span class="org-main">
          <input class="org-name" value="${esc(r.name)}" title="Name (zum Umbenennen ändern)" ${r.ok ? '' : 'disabled'}>
          <span class="org-meta">${fmtSize(r.size)}${r.ok ? ` · <button class="org-dest small" data-pick="${esc(r.id)}" title="Nur für diese Datei ein anderes Ziel">${r.dest == null ? 'Ziel wie oben' : esc(label(r.dest))} ▾</button>` : ' · <b>Dateityp geht nicht</b> (nur PDF, Bilder, Word, Excel, PowerPoint)'}</span>
          ${r.dup && r.from ? `<span class="org-dup">⚠ Diese Datei liegt dort schon (gleicher Inhalt: ${esc(basename(r.dup))}). Die Kopie im Eingang in den Papierkorb legen?
            <label><input type="radio" name="trash-${esc(r.id)}" data-trash="${esc(r.id)}" value="1" ${r.trash ? 'checked' : ''}> Ja</label>
            <label><input type="radio" name="trash-${esc(r.id)}" data-trash="${esc(r.id)}" value="0" ${r.trash ? '' : 'checked'}> Nein, im Eingang lassen</label></span>`
          : r.dup ? `<span class="org-dup">⚠ Gibt es dort schon: ${esc(basename(r.dup))} <label><input type="checkbox" data-skip="${esc(r.id)}" ${r.skip ? 'checked' : ''}> überspringen</label></span>` : ''}
        </span>
        <button class="org-x" data-remove="${esc(r.id)}" title="Nicht einsortieren">✕</button></li>`).join('')}</ul>
      ${bad ? `<p class="org-note">${bad} ${bad === 1 ? 'Datei wird' : 'Dateien werden'} übersprungen (Dateityp).</p>` : ''}
      <div class="modal-btns"><button class="btn primary" data-act="go" ${n && !busy ? '' : 'disabled'}>${busy ? 'Einsortieren …' : `Einsortieren${n ? ` (${n})` : ''}`}</button><button class="btn" data-act="cancel">Abbrechen</button></div>`;
    if (picker) renderPicker();
  }

  // Ziel-Auswahl: Suche über Stunden (Fach, Einheit, Datum) und Ordner
  function renderPicker() {
    const q = picker.q.trim().toLowerCase();
    const match = s => !q || q.split(/\s+/).every(w => s.toLowerCase().includes(w));
    const opts = [];
    if (picker.for !== 'all') opts.push(['__same', 'Wie oben (alle Dateien)']);
    if (suggestion) opts.push([suggestion, '★ ' + label(suggestion)]);
    if (!inboxMode) opts.push([INBOX_DIR, label(INBOX_DIR)]);
    const ls = lessons.filter(l => match(`${label(l.path)} ${l.meta.datum} ${l.path}`)).slice(0, 80);
    const fs = folders.filter(f => match(f)).slice(0, 80);
    let box = card.querySelector('.org-picker');
    if (!box) {
      box = document.createElement('div'); box.className = 'org-picker';
      box.innerHTML = '<input class="org-search" placeholder="Suchen: Fach, Einheit, Datum (z. B. Mathe 12.10.) …"><div class="org-opts"></div>';
      card.appendChild(box);
      const inp = box.firstChild; inp.value = picker.q;
      inp.addEventListener('input', () => { picker.q = inp.value; renderPicker(); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = box.querySelector('[data-opt]'); if (b) { e.preventDefault(); choose(b.dataset.opt); } } });
      setTimeout(() => inp.focus(), 0);
    }
    const group = (t, list) => list.length ? `<p class="org-g">${t}</p>${list.map(([v, l]) => `<button data-opt="${esc(v)}" class="${v === (picker.for === 'all' ? dest : rows.find(r => r.id === picker.for)?.dest) ? 'on' : ''}">${esc(l)}</button>`).join('')}` : '';
    box.querySelector('.org-opts').innerHTML = (q ? '' : group('', opts))
      + group('Stunden', ls.map(l => [l.path, label(l.path)])) + group('Ordner', fs.map(f => [f, label(f)]))
      + (!ls.length && !fs.length ? '<p class="org-g">Nichts gefunden</p>' : '');
  }
  function choose(v) {
    if (picker.for === 'all') dest = v;
    else { const r = rows.find(x => x.id === picker.for); if (r) r.dest = v === '__same' ? null : v; }
    picker = null; render(); checkDups();
  }

  // Doppelte: gleiche Größe + SHA-256 im Ziel? (Standard: überspringen)
  let checkSeq = 0;
  async function checkDups() {
    const my = ++checkSeq, list = rows.filter(r => r.ok && destOf(r) != null);
    try {
      for (const r of list) if (r.file && !r.sha && r.size < 300 * 1048576) r.sha = await sha256(r.file);
      const { items } = await api.checkFiles(list.map(r => r.file ? { dest: destOf(r), size: r.size, sha256: r.sha || '' } : { dest: destOf(r), from: r.from }));
      if (my !== checkSeq) return;
      list.forEach((r, i) => { const d = items[i]?.duplicate || null; if (d !== r.dup) { r.dup = d; r.skip = true; r.trash = true; } });
      if (!picker) render();
    } catch { /* Prüfung ist nur ein Hinweis – der Server prüft beim Einsortieren noch einmal */ }
  }

  function close() {
    open = null; urls.forEach(u => URL.revokeObjectURL(u)); el.remove();
    document.removeEventListener('keydown', key, true);
  }
  const key = e => {
    if (e.key !== 'Escape' || document.querySelector('#modal.show')) return;
    e.preventDefault(); e.stopPropagation();
    if (picker) { picker = null; render(); } else if (!busy) close();
  };
  document.addEventListener('keydown', key, true);

  async function go() {
    const list = usable();
    if (!list.length || busy) return;
    busy = true; render();
    const lessonsHit = [...new Set(list.map(destOf).filter(d => d.endsWith('.md')))];
    try {
      await ctx.beforeWrite(lessonsHit);   // ungespeicherte Änderungen in diesen Stunden zuerst sichern
      const res = await runBatch(list.map(r => ({ file: r.file, from: r.from, dest: destOf(r), name: finalName(r.name, r.orig), keep: !!r.dup && !r.skip && !r.from, trash: !!r.dup && !!r.from && !!r.trash })),
        (i, n) => { const b = card.querySelector('[data-act=go]'); if (b) b.textContent = `Einsortieren … ${i}/${n}`; });
      close();
      ctx.finish(res);
    } catch (e) { busy = false; render(); ctx.toast?.(e.message, true); }
  }

  el.addEventListener('click', e => {
    if (e.target === el && !busy) { if (picker) { picker = null; render(); } else close(); return; }
    const t = e.target.closest('[data-pick],[data-set],[data-opt],[data-remove],[data-act]');
    if (!t) { if (picker && !e.target.closest('.org-picker')) { picker = null; render(); } return; }
    if (t.dataset.opt != null) return choose(t.dataset.opt);
    if (t.dataset.pick) { picker = picker?.for === t.dataset.pick ? null : { for: t.dataset.pick, q: '' }; render(); return; }
    if (t.dataset.set != null) { dest = t.dataset.set; render(); checkDups(); return; }
    if (t.dataset.remove) { rows = rows.filter(r => r.id !== t.dataset.remove); if (!rows.length) close(); else render(); return; }
    if (t.dataset.act === 'cancel' && !busy) close();
    if (t.dataset.act === 'go') go();
  });
  el.addEventListener('input', e => { if (e.target.matches('.org-name')) { const r = rows.find(x => x.id === e.target.closest('.org-row').dataset.id); if (r) r.name = e.target.value; } });
  el.addEventListener('change', e => {
    if (e.target.dataset.trash) { const r = rows.find(x => x.id === e.target.dataset.trash); if (r) { r.trash = e.target.value === '1'; render(); } return; }
    if (e.target.dataset.skip) { const r = rows.find(x => x.id === e.target.dataset.skip); if (r) { r.skip = e.target.checked; render(); } } });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.org-name')) { e.preventDefault(); go(); } });

  const thumbs = list => list.forEach(r => {
    if (!IMG.test(r.orig)) return;
    if (r.file) { r.thumb = URL.createObjectURL(r.file); urls.push(r.thumb); } else r.thumb = rawUrl(r.from);
  });
  thumbs(rows);
  open = { add: more => { thumbs(more); rows.push(...more); render(); checkDups(); } };
  render();

  // Ziele laden: Stunden (neueste zuerst), Ordner aus dem Baum, Vorschlag laut Stundenplan
  Promise.all([api.lessons(null, false).catch(() => []), api.settings().catch(() => ({}))]).then(([ls, settings]) => {
    lessons = ls.slice().sort((a, b) => `${b.meta.datum} ${b.meta.zeit}`.localeCompare(`${a.meta.datum} ${a.meta.zeit}`));
    const walk = (nodes, out) => { for (const n of nodes) if (n.dir) { out.push(n.path); walk(n.children, out); } return out; };
    folders = walk(ctx.tree(), []);
    suggestion = suggestLesson(settings, ls);
    dest = suggestion ?? (inboxMode ? null : INBOX_DIR);
    loaded = true;
    if (open) { render(); checkDups(); }
  });
}
