// Schulheft – Hauptprogramm: Seitenleiste, Tabs, Ansichten, Suche, Dialoge
import { api, rawUrl, dirname, basename, resolve, isDoc, isImage, prettyName, lessonLabel } from './api.js';
import { renderOverview, lessonForm } from './overview.js';
import { renderHome, dueChip, byDue } from './home.js';
import { createEditor, wrap, linePrefix, insertText, gotoLine, toggleTaskLine, linkIcon } from './editor.js';
import { renderNote, taskLines, parseFront } from './render.js';
import { DocViewer } from './docviewer.js';
import { helpHtml } from './help.js';
import { renderSettings } from './settings.js';
import { latestOnly } from './latest.js';
import { openOrganizer, filesFromDrop, runBatch } from './organizer.js';
import { isLesson, isSectionHeading, sectionRange, linkHref, materialLinkLine, materialLinkChange } from '../lib/lesson.js';
import { keys, localizeKeys, setServerPlatform, revealLabel, restoreHint } from './platform.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Einstellungen im Browser merken (darf fehlen)
const store = {
  get(k, d) { try { const v = localStorage.getItem('schulheft:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('schulheft:' + k, JSON.stringify(v)); } catch { /* egal */ } },
  del(k) { try { localStorage.removeItem('schulheft:' + k); } catch { /* egal */ } },
};
// Diese Werte sind Pfade im Notizordner → gehören zu genau einem Ordner (Farben, Layout usw. gelten immer)
const ROOT_KEYS = ['tabs', 'activeTab', 'recent', 'doc', 'openFolders'];

const state = {
  tabs: [],            // { path, view, mtime, dirty, mode, host, readEl }
  active: -1,
  page: 'notes',       // notes | important | todos | settings | help | overview | home
  open: new Set(store.get('openFolders', [])),
  docOpen: false,
  activePane: 'center',
};

// ── Kleine UI-Bausteine ──────────────────────────────────────────
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, isError ? 5000 : 2200);
}

// Meldung mit Knopf (z. B. „Rückgängig“), bleibt länger stehen
function toastAction(msg, label, fn) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span> <button class="toast-btn">${esc(label)}</button>`;
  t.className = 'show action';
  $('.toast-btn', t).onclick = () => { t.className = ''; fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 10000);
}

function ask({ title, text = '', buttons, input, locked }) {   // locked: Esc/Klick daneben schließen nicht
  return new Promise(res => {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card" role="dialog">
      <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
      ${input ? `<input class="modal-input" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}">` : ''}
      <div class="modal-btns">${buttons.map((b, i) => `<button class="btn ${b.danger ? 'danger' : i === 0 ? 'primary' : ''}" data-id="${b.id}">${esc(b.label)}</button>`).join('')}</div></div>`;
    m.classList.add('show');
    const inp = $('.modal-input', m);
    const done = id => { m.classList.remove('show'); m.innerHTML = ''; document.removeEventListener('keydown', key, true); res(input ? (id === buttons[0].id ? inp.value.trim() : null) : id); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!locked) done(buttons[buttons.length - 1].id); }
      if (e.key === 'Enter' && (inp || !e.target.closest('button'))) { e.preventDefault(); e.stopPropagation(); done(buttons[0].id); }
    };
    document.addEventListener('keydown', key, true);
    m.onclick = e => { const b = e.target.closest('button[data-id]'); if (b) done(b.dataset.id); else if (e.target === m && !locked) done(buttons[buttons.length - 1].id); };
    setTimeout(() => (inp ? (inp.focus(), inp.select()) : $('.modal-btns button', m).focus()), 0);
  });
}

function menu(anchor, items, at) {
  const m = $('#menu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
  m.classList.add('show');
  // Im Fenster halten: zu weit rechts → nach links aufklappen, zu weit unten → nach oben (über dem Knopf)
  const r = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor.getBoundingClientRect();
  const W = m.offsetWidth, H = m.offsetHeight, gap = at ? 0 : 4;
  let x = at ? at.x : r.left, y = r.bottom + gap;
  if (x + W > innerWidth - 8) x = (at ? at.x : r.right) - W;
  if (y + H > innerHeight - 8 && r.top - gap - H >= 8) y = r.top - gap - H;
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - W - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, innerHeight - H - 8))}px`;
  const close = () => { m.classList.remove('show'); document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (!m.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  m.onclick = e => { const b = e.target.closest('button[data-i]'); if (!b) return; close(); items[+b.dataset.i].run(); };
}

// ── Seitenleiste: Ordnerbaum ─────────────────────────────────────
async function loadTrees() {
  const [notes, docs] = await Promise.all([api.tree('notes'), api.tree('docs')]);
  state.notesTree = notes;
  state.docsTree = docs;
  renderTree($('#tree-notes'), notes, 'notes');
  renderTree($('#tree-docs'), docs, 'docs');
  renderTabs();
}

function renderTree(root, nodes, kind) {
  const html = (list, depth) => list.map(n => {
    const pad = `style="--d:${depth}"`;
    if (n.dir) {
      const open = state.open.has(n.path);
      const count = countFiles(n);
      return `<li><div class="node folder ${open ? 'open' : ''}" data-path="${esc(n.path)}" data-dir="1" draggable="${kind === 'notes'}" ${pad}>
          <span class="caret">›</span><span class="ico">${open ? '📂' : '📁'}</span><span class="name">${esc(n.name)}</span><span class="count">${count || ''}</span>
          <button class="node-more" title="Mehr">⋯</button></div>
        ${open ? `<ul>${n.lessons ? `<li><div class="node file overview-node ${state.page === 'overview' && state.overviewDir === n.path ? 'active' : ''}" data-overview="${esc(n.path)}" style="--d:${depth + 1}"><span class="caret"></span><span class="ico">📚</span><span class="name">Übersicht</span></div></li>` : ''}${html(n.children, depth + 1)}</ul>` : ''}</li>`;
    }
    const ico = n.lesson ? '🗓' : kind === 'notes' ? '📝' : /\.pdf$/i.test(n.name) ? '📄' : '🖼';
    const label = n.lesson ? lessonLabel(n.lesson, n.path) : kind === 'notes' ? n.name.replace(/\.md$/, '') : n.name;
    const tab = state.tabs.find(t => t.path === n.path);
    const active = (kind === 'notes' && state.tabs[state.active]?.path === n.path && state.page === 'notes') || (kind === 'docs' && doc?.path === n.path);
    return `<li><div class="node file ${active ? 'active' : ''}" data-path="${esc(n.path)}" draggable="true" ${pad} title="${esc(n.name)}">
        <span class="caret"></span><span class="ico">${ico}</span><span class="name">${esc(label)}</span>${tab?.dirty ? '<span class="dot" title="Nicht gespeichert"></span>' : ''}
        <button class="node-more" title="Mehr">⋯</button></div></li>`;
  }).join('');
  root.innerHTML = `<ul>${html(nodes, 0)}</ul>` + (nodes.length ? '' : '<p class="empty">Leer</p>');
}
const countFiles = n => n.children.reduce((s, c) => s + (c.dir ? countFiles(c) : 1), 0);

function bindTree(root, kind) {
  root.addEventListener('click', e => {
    const node = e.target.closest('.node');
    if (!node) return;
    if (node.dataset.overview) { showOverview(node.dataset.overview); return; }
    const p = node.dataset.path;
    if (e.target.closest('.node-more')) { e.stopPropagation(); nodeMenu(node, kind); return; }
    if (node.dataset.dir) {
      state.open.has(p) ? state.open.delete(p) : state.open.add(p);
      store.set('openFolders', [...state.open]);
      renderTree(root, kind === 'notes' ? state.notesTree : state.docsTree, kind);
    } else if (kind === 'notes') openNote(p);
    else openDoc(p);
  });
  root.addEventListener('contextmenu', e => {
    const node = e.target.closest('.node');
    if (!node || node.dataset.overview) return;
    e.preventDefault();
    nodeMenu(node, kind, { x: e.clientX, y: e.clientY });
  });
  // Ziehen: Notiz in Ordner verschieben, oder Dokument in eine Notiz als Link
  root.addEventListener('dragstart', e => {
    const node = e.target.closest('.node');
    if (!node) return;
    e.dataTransfer.setData('application/x-schulheft', node.dataset.path);
    e.dataTransfer.setData('text/plain', node.dataset.path);
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  if (kind === 'notes') {
    root.addEventListener('dragover', e => {
      const f = e.target.closest('.node.folder');
      if (!f || !e.dataTransfer.types.includes('application/x-schulheft')) return;
      e.preventDefault();
      root.querySelectorAll('.drop').forEach(n => n.classList.remove('drop'));
      f.classList.add('drop');
    });
    root.addEventListener('dragleave', e => e.target.closest('.node')?.classList.remove('drop'));
    root.addEventListener('drop', async e => {
      const f = e.target.closest('.node.folder');
      root.querySelectorAll('.drop').forEach(n => n.classList.remove('drop'));
      const p = e.dataTransfer.getData('application/x-schulheft');
      if (!f || !p) return;
      e.preventDefault();
      if (dirname(p) === f.dataset.path) return;
      try {
        const res = await api.move(p, f.dataset.path);
        retarget(p, res.path);
        state.open.add(f.dataset.path);
        await loadTrees();
        toast(`Verschoben nach ${basename(f.dataset.path)}`);
      } catch (err) { toast(err.message, true); }
    });
  }
}

function nodeMenu(node, kind, at) {
  const p = node.dataset.path, isDir = !!node.dataset.dir;
  const items = [];
  if (kind === 'notes') {
    const dir = isDir ? p : dirname(p);
    items.push({ label: 'Neue Stunde hier', run: () => newLesson(dir) }, { label: 'Neue Notiz hier', run: () => newNote(dir) }, { label: 'Neuer Ordner hier', run: () => newFolder(dir) }, '-');
    if (isDir) items.push({ label: 'Übersicht zeigen', run: () => showOverview(p) }, '-');
  }
  if (!isDir && kind === 'docs') {
    items.push({ label: 'Öffnen', run: () => openDoc(p) });
    if (currentTab()) items.push({ label: 'Als Link in die Notiz einfügen', run: () => insertLink(p) });
    items.push('-');
  }
  if (!isDir && kind === 'notes' && currentTab() && currentTab().path !== p) items.push({ label: 'Als Link in die Notiz einfügen', run: () => insertLink(p) }, '-');
  items.push({ label: 'Umbenennen …', run: () => renameNode(p, isDir) });
  items.push({ label: revealLabel(), run: () => api.reveal(p).catch(e => toast(e.message, true)) });
  items.push('-', { label: 'In den Papierkorb', danger: true, run: () => trashNode(p, isDir) });
  menu(node, items, at);
}

async function newNote(dir = defaultDir()) {
  const today = new Date().toISOString().slice(0, 10);
  const name = await ask({ title: 'Neue Notiz', text: `Ordner: ${dir || 'Notizordner (oberste Ebene)'}`, input: { value: today, placeholder: 'Titel der Notiz' }, buttons: [{ id: 'ok', label: 'Erstellen' }, { id: 'no', label: 'Abbrechen' }] });
  if (!name) return;
  try {
    const res = await api.create(dir, name, 'note');
    state.open.add(dir);
    await loadTrees();
    await openNote(res.path);
    const t = currentTab(); if (t) gotoLine(t.view, 4);
  } catch (e) { toast(e.message, true); }
}

async function newFolder(dir = '') {
  const name = await ask({ title: 'Neuer Ordner', text: `In: ${dir || 'Notizordner (oberste Ebene)'}`, input: { placeholder: dir ? 'Name, z. B. Bruchrechnung' : 'Name, z. B. Mathe' }, buttons: [{ id: 'ok', label: 'Erstellen' }, { id: 'no', label: 'Abbrechen' }] });
  if (!name) return;
  try { const res = await api.create(dir, name, 'folder'); state.open.add(dir); state.open.add(res.path); await loadTrees(); }
  catch (e) { toast(e.message, true); }
}

// ── Stunden ──────────────────────────────────────────────────────
function lessonCtx() {
  return {
    openNote, toast, openNewLesson, toggleTask, applyLive, showPage, openInbox,
    inboxCount: () => state.inbox?.length || 0,
    openDoc: openPath,                          // PDF/Bild rechts, andere Dateien im Standardprogramm
    active: page => state.page === page,
    tree: () => state.notesTree || [],
    notesIn: dir => (findNode(state.notesTree || [], dir)?.children || []).filter(c => !c.dir).map(c => c.path),
    afterCreate: async (p, dir) => { dir.split('/').forEach((_, i, a) => state.open.add(a.slice(0, i + 1).join('/'))); store.set('openFolders', [...state.open]); await loadTrees(); },
  };
}
// Offene Tabs haben vielleicht ungespeicherte Haken → Aufgaben aus dem Editor lesen (unsaved = anders als auf der Platte)
// Zeilennummern kommen von der Platte; im Editor können Zeilen dazugekommen sein → dieselbe Aufgabe in der Nähe suchen (td.line = Editor-Zeile)
function applyLive(todos) {
  const key = l => l.replace(/\[[ xX]\]/, '[ ]').trim();
  for (const td of todos) {
    const t = state.tabs.find(x => x.path === td.path);
    if (!t) continue;
    const doc = t.view.state.doc, want = key(td.text);
    let n = 0;
    for (let d = 0; d <= 60 && !n; d++) for (const c of [td.line + d, td.line - d]) if (!n && c >= 1 && c <= doc.lines && key(doc.line(c).text) === want) n = c;
    if (!n) continue;
    const l = doc.line(n).text, done = /\[[xX]\]/.test(l);
    td.unsaved = t.dirty && done !== td.done;
    td.line = n; td.text = l.trim(); td.done = done;
  }
  return todos;
}
// Haken setzen = Notiz öffnen und dort ändern, gespeichert wird mit ⌘S
async function toggleTask(p, line) {
  const cur = state.page;
  await openNote(p);
  const t = currentTab();
  if (t?.path === p) toggleTaskLine(t.view, line - 1);
  showPage(cur);
  toast(keys('Geändert – in der Notiz mit ⌘S speichern'));
}
function findNode(nodes, p) { for (const n of nodes) { if (n.path === p) return n; if (n.dir) { const f = findNode(n.children, p); if (f) return f; } } return null; }
function lessonMetaOf(p) { return findNode(state.notesTree || [], p)?.lesson; }

async function newLesson(dir) {
  const p = await lessonForm(lessonCtx(), { dir: dir || (currentTab() ? dirname(currentTab().path) : undefined) });
  if (p) await openNewLesson(p);
}
// Neue Stunde öffnen, Cursor unter „## Mitschrift“
async function openNewLesson(p) {
  await openNote(p); const t = currentTab(); if (t) { setMode(t, 'edit'); const n = t.view.state.doc.toString().split('\n').findIndex(l => l === '## Mitschrift'); if (n >= 0) { const line = t.view.state.doc.line(n + 2); t.view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true }); t.view.focus(); } }
}
function showOverview(dir) {
  state.overviewDir = dir;
  state.open.add(dir);
  showPage('overview');
}

async function renameNode(p, isDir) {
  const cur = isDir ? basename(p) : basename(p).replace(/\.md$/, '');
  const name = await ask({ title: 'Umbenennen', input: { value: cur }, buttons: [{ id: 'ok', label: 'Umbenennen' }, { id: 'no', label: 'Abbrechen' }] });
  if (!name || name === cur) return;
  try {
    const res = await api.rename(p, name);
    retarget(p, res.path);
    if (state.open.has(p)) { state.open.delete(p); state.open.add(res.path); }
    await loadTrees();
  } catch (e) { toast(e.message, true); }
}

async function trashNode(p, isDir) {
  const open = state.tabs.filter(t => t.path === p || t.path.startsWith(p + '/'));
  const a = await ask({ title: `„${basename(p)}“ in den Papierkorb?`, text: (isDir ? 'Der ganze Ordner mit Inhalt. ' : '') + restoreHint() + (open.some(t => t.dirty) ? ' Ungespeicherte Änderungen gehen verloren.' : ''), buttons: [{ id: 'yes', label: 'In den Papierkorb', danger: true }, { id: 'no', label: 'Abbrechen' }] });
  if (a !== 'yes') return;
  try {
    await api.trash(p);
    open.forEach(t => closeTab(state.tabs.indexOf(t), true));
    if (doc.path && (doc.path === p || doc.path.startsWith(p + '/'))) { doc.close(); hideDoc(); }
    await loadTrees();
    toast('In den Papierkorb gelegt');
  } catch (e) { toast(e.message, true); }
}

// Nach Umbenennen/Verschieben: offene Tabs auf den neuen Pfad setzen
function retarget(from, to) {
  for (const t of state.tabs) {
    if (t.path === from) t.path = to;
    else if (t.path.startsWith(from + '/')) t.path = to + t.path.slice(from.length);
  }
  renderTabs(); saveSession();
}

const defaultDir = () => currentTab() ? dirname(currentTab().path) : '';

// ── Notiz-Tabs ───────────────────────────────────────────────────
const currentTab = () => state.tabs[state.active];

async function openNote(p, line, restore = false) {
  if (!restore) showPage('notes');
  let i = state.tabs.findIndex(t => t.path === p);
  if (i < 0) {
    let data;
    try { data = await api.read(p); } catch (e) { if (!restore) toast(`Konnte ${basename(p)} nicht öffnen: ${e.message}`, true); return; }
    const host = document.createElement('div');
    host.className = 'editor-host';
    const readEl = document.createElement('div');
    readEl.className = 'read-view markdown';
    $('#editors').append(host, readEl);
    const tab = { path: p, mtime: data.mtime, dirty: false, mode: 'edit', host, readEl };
    tab.view = createEditor(host, {
      doc: data.text,
      onChange: () => { setTabDirty(tab, !(tab.savedDoc && tab.view.state.doc.eq(tab.savedDoc))); scheduleMatBar(tab); },
      onSave: () => saveTab(tab),
      onOpenLink: link => openLink(link, dirname(tab.path)),
      onPasteImage: file => pasteImage(tab, file),
    });
    tab.savedDoc = tab.view.state.doc;   // zuletzt gespeicherter Text (⌘Z bis dahin = wieder sauber)
    state.tabs.push(tab);
    i = state.tabs.length - 1;
  }
  if (restore) { state.tabs[i].mode = 'edit'; return; }
  activateTab(i);
  if (line) { const t = currentTab(); setMode(t, 'edit'); setTimeout(() => gotoLine(t.view, line), 30); }
}

function activateTab(i) {
  state.active = i;
  state.tabs.forEach((t, k) => {
    t.host.hidden = k !== i || t.mode !== 'edit';
    t.readEl.hidden = k !== i || t.mode !== 'read';
  });
  const t = currentTab();
  $('#note-empty').hidden = !!t;
  $('#note-toolbar').hidden = !t;
  if (t) { syncModeButtons(t); if (t.mode === 'read') renderRead(t); else setTimeout(() => t.view.focus(), 0); }
  renderMatBar(t);
  renderTabs();
  refreshTreeHighlight();
  saveSession();
}

function renderTabs() {
  $('#tabs').innerHTML = state.tabs.map((t, i) => `
    <div class="tab ${i === state.active ? 'on' : ''} ${t.dirty ? 'dirty' : ''}" data-i="${i}" title="${esc(t.path)}">
      <span class="tab-name">${esc(lessonMetaOf(t.path) ? lessonLabel(lessonMetaOf(t.path), t.path) : prettyName(t.path))}</span>
      <button class="tab-x" title="${t.dirty ? 'Nicht gespeichert – schließen' : 'Schließen'}"><span class="x">✕</span><span class="d"></span></button>
    </div>`).join('');
}

async function closeTab(i, force = false) {
  const t = state.tabs[i];
  if (!t) return true;
  if (t.dirty && !force) {
    const a = await ask({ title: `Änderungen in „${prettyName(t.path)}“ speichern?`, text: 'Sonst gehen deine Änderungen verloren.', buttons: [{ id: 'save', label: 'Speichern' }, { id: 'drop', label: 'Nicht speichern', danger: true }, { id: 'no', label: 'Abbrechen' }] });
    if (a === 'no') return false;
    if (a === 'save' && !(await saveTab(t))) return false;
  }
  t.view.destroy(); t.host.remove(); t.readEl.remove();
  state.tabs.splice(i, 1);
  if (state.active >= state.tabs.length) state.active = state.tabs.length - 1;
  else if (i < state.active) state.active--;
  activateTab(state.active);
  if (!state.tabs.length && state.page === 'notes') showPage('home');   // letzte Notiz zu → Startseite statt leerer Fläche
  return true;
}

function setTabDirty(t, d) {
  if (t.dirty === d) return;
  t.dirty = d;
  renderTabs();
  refreshTreeHighlight();
  updateTitle();
}

async function saveTab(t, force = false) {
  if (!t.dirty && !force) { toast('Schon gespeichert'); return true; }
  try {
    const saved = t.view.state.doc;
    const res = await api.write(t.path, saved.toString(), t.mtime, force);
    t.mtime = res.mtime;
    t.savedDoc = saved;
    setTabDirty(t, !t.view.state.doc.eq(saved));
    toast('Gespeichert ✓');
    if (t.mode === 'read') renderRead(t);
    if (t.view.state.doc.line(1).text === '---') loadTrees().then(renderTabs);
    return true;
  } catch (e) {
    if (e.status === 410) {
      const a = await ask({ title: 'Die Notiz gibt es nicht mehr', text: `„${prettyName(t.path)}“ wurde verschoben, aufgeteilt oder gelöscht. Soll sie trotzdem unter dem alten Namen neu gespeichert werden?`, buttons: [{ id: 'save', label: 'Trotzdem speichern' }, { id: 'no', label: 'Abbrechen' }] });
      return a === 'save' ? saveTab(t, true) : false;
    }
    if (e.status === 409) {
      const a = await ask({ title: 'Die Notiz wurde woanders geändert', text: `„${prettyName(t.path)}“ wurde geändert, seit du sie geöffnet hast (z. B. in einem anderen Programm).`, buttons: [{ id: 'over', label: 'Meine Version speichern', danger: true }, { id: 'reload', label: 'Andere Version laden' }, { id: 'no', label: 'Abbrechen' }] });
      if (a === 'over') return saveTab(t, true);
      if (a === 'reload') { await reloadTab(t); return true; }
      return false;
    }
    toast('Speichern fehlgeschlagen: ' + e.message, true);
    return false;
  }
}

async function reloadTab(t) {
  const data = await api.read(t.path);
  t.savedDoc = null;
  t.view.dispatch({ changes: { from: 0, to: t.view.state.doc.length, insert: data.text } });
  t.savedDoc = t.view.state.doc;
  t.mtime = data.mtime;
  setTabDirty(t, false);
  if (t.mode === 'read') renderRead(t);
  if (t === currentTab()) renderMatBar(t);
}

// ── Material-Leiste: Karten aus „## Material“ oben in der Notiz ──
// Datei-Links → Karten, Web-Links und Text → kurze Zeilen
function parseMaterial(src) {
  const lines = src.split('\n');
  const r = sectionRange(lines, 'material');
  if (!r) return null;
  const out = { files: [], online: [], text: [] };
  for (let i = r[0] + 1; i < r[1]; i++) {
    const l = lines[i];
    if (/^#{3,}\s/.test(l)) continue;
    const text = l.replace(/^\s*[-*+]\s*/, '').trim();
    if (!text) continue;
    const m = text.match(/^!?\[([^\]]*)\]\(<?([^)\s>]+)>?\)\s*(?:·\s*)?(.*)$/);
    const item = m ? { label: m[1], target: m[2], sub: m[3], line: i + 1 } : { text, line: i + 1 };
    if (m && !/^https?:/.test(m[2])) out.files.push(item);
    else if (m) out.online.push(item);
    else out.text.push(item);
  }
  return out.files.length + out.online.length + out.text.length ? out : null;
}
let matTimer;
function scheduleMatBar(t) { clearTimeout(matTimer); matTimer = setTimeout(() => { if (t === currentTab()) renderMatBar(t); }, 500); }
function renderMatBar(t) {
  const bar = $('#mat-bar');
  const mat = t && parseMaterial(t.view.state.doc.toString());
  if (!mat || state.page !== 'notes') { bar.hidden = true; return; }
  const open = store.get('matOpen', true);
  const card = it => `<button class="mat-card" data-target="${esc(it.target)}" title="${esc(it.target.split('/').pop().replace(/%20/g, ' '))}"><span class="mc-ico">${linkIcon(it.target)}</span><span class="mc-txt"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
  const row = (it, ico) => it.target
    ? `<button class="mat-row" data-target="${esc(it.target)}"><span>${linkIcon(it.target)}</span>${esc(it.label)}${it.sub ? ` <small>${esc(it.sub)}</small>` : ''}</button>`
    : `<button class="mat-row" data-line="${it.line}"><span>${ico}</span>${esc(it.text)}</button>`;
  const n = mat.files.length + mat.text.length + mat.online.length;
  bar.innerHTML = `<button class="mat-toggle" title="Material ein-/ausklappen">${open ? '▾' : '▸'} Material <span>${n}</span></button>
    ${open ? `<div class="mat-body">
      ${mat.files.length ? `<div class="mat-cards">${mat.files.map(card).join('')}</div>` : ''}
      ${mat.text.length || mat.online.length ? `<div class="mat-rows">${mat.online.map(it => row(it, '🖥')).join('')}${mat.text.map(it => row(it, '📖')).join('')}</div>` : ''}
    </div>` : ''}`;
  bar.hidden = false;
  bar.onclick = e => {
    if (e.target.closest('.mat-toggle')) { store.set('matOpen', !open); renderMatBar(t); return; }
    const b = e.target.closest('[data-target],[data-line]');
    if (!b) return;
    if (b.dataset.target) openLink(b.dataset.target, dirname(t.path));
    else { setMode(t, 'edit'); setTimeout(() => gotoLine(t.view, +b.dataset.line), 30); }
  };
}

// Lesemodus
function setMode(t, mode) {
  t.mode = mode;
  if (t === currentTab()) activateTab(state.active);
}
function syncModeButtons(t) {
  document.querySelectorAll('#mode-switch button').forEach(b => b.classList.toggle('on', b.dataset.mode === t.mode));
  $('#note-toolbar').classList.toggle('reading', t.mode === 'read');
}
function renderRead(t) {
  const src = t.view.state.doc.toString();
  const box = renderNote(src, dirname(t.path));
  if (parseMaterial(src)) {
    const h = [...box.querySelectorAll('h2')].find(x => isSectionHeading('## ' + x.textContent.trim(), 'material'));
    for (let n = h; n && !(n !== h && n.tagName === 'H2');) { const next = n.nextElementSibling; n.remove(); n = next; }
  }
  const scroll = t.readEl.scrollTop;
  t.readEl.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'read-inner';
  inner.append(...box.childNodes);
  t.readEl.append(inner);
  t.readEl.scrollTop = scroll;
  const tasks = taskLines(src);
  t.readEl.onclick = e => {
    const a = e.target.closest('a[data-local]');
    if (a) { e.preventDefault(); openPath(a.dataset.local); return; }
    const cb = e.target.closest('input[data-task]');
    if (cb) { toggleTaskLine(t.view, tasks[+cb.dataset.task]); renderRead(t); }
  };
  t.readEl.ondblclick = e => {
    if (e.target.closest('a, input')) return;
    setMode(t, 'edit');
  };
}

// Links öffnen: Webseiten im Browser, Dokumente rechts, Notizen als Tab
function openLink(link, fromDir) {
  if (/^https?:/.test(link)) { window.open(link, '_blank', 'noopener'); return; }
  let p; try { p = resolve(fromDir, decodeURI(link.split('#')[0])); } catch { p = resolve(fromDir, link); }
  openPath(p);
}
function openPath(p) {
  if (isDoc(p)) openDoc(p);
  else if (p.endsWith('.md')) openNote(p);
  else api.open(p).catch(e => e.status === 400 ? api.reveal(p).catch(e2 => toast(e2.message, true)) : toast(e.message, true));   // Word, PowerPoint …; sonst im Dateimanager zeigen
}

const linkText = linkHref;
function insertLink(target) {
  const t = currentTab();
  if (!t) { toast('Zuerst eine Notiz öffnen'); return; }
  setMode(t, 'edit');
  const label = isDoc(target) ? basename(target).replace(/\.[^.]+$/, '') : prettyName(target);
  const md = `${isImage(target) && dirname(target).startsWith(dirname(t.path)) ? '!' : ''}[${label}](${linkText(target, dirname(t.path))})`;
  insertText(t.view, md);
}

async function pasteImage(t, file) {
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const name = file.name && file.name !== 'image.png' ? file.name : `bild-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
  try {
    const res = await api.upload(dirname(t.path) + '/bilder', name, file);
    insertText(t.view, `![${basename(res.path).replace(/\.[^.]+$/, '')}](${linkText(res.path, dirname(t.path))})`);
    toast('Bild gespeichert in „bilder“');
    loadTrees();
  } catch (e) { toast(e.message, true); }
}

// ── Material: Datei aus dem Finder auf eine Notiz ziehen ─────────
// Stunde → Datei nach <Einheit>/Material/ (Originalname), Link unter „## Material“. Andere Notiz → Bild nach bilder/, Link an der Stelle
const docLabel = p => basename(p).replace(/\.[^.]+$/, '').trim() || basename(p);
async function dropFiles(t, files, e) {
  const lesson = isLesson(parseFront(t.view.state.doc.toString()).meta);
  if (!lesson && t.mode === 'edit') { const pos = t.view.posAtCoords({ x: e.clientX, y: e.clientY }); if (pos != null) t.view.dispatch({ selection: { anchor: pos } }); }
  let n = 0;
  for (const f of files) {
    try {
      const res = await api.uploadMaterial(t.path, f.name || 'datei', f);
      if (res.lesson) { addMaterialLink(t, res.path); toast(`Gespeichert in ${res.path} · Link unter „Material“ (${keys('⌘S')})`); }
      else { insertText(t.view, `${res.image ? '!' : ''}[${docLabel(res.path)}](${linkText(res.path, dirname(t.path))})\n`); toast(`Gespeichert in ${res.path}`); }
      n++;
    } catch (err) { toast(`${f.name}: ${err.message}`, true); }
  }
  if (n) { loadTrees(); if (t.mode === 'read' && t === currentTab()) renderRead(t); }
}
function addMaterialLink(t, target) {
  // Link in die Liste unter „## Material“ (Abschnitt anlegen, wenn er fehlt) – gleiche Regel wie auf dem Server (lib/lesson.js)
  t.view.dispatch({ changes: materialLinkChange(t.view.state.doc.toString(), materialLinkLine(target, t.path)) });
}

// ── Werkzeugleiste des Editors ───────────────────────────────────
const HEADINGS = ['# ', '## ', '### ', '#### '];
const MARKERS = ['!! ', 'EXAM: ', 'DEF: ', '?? '];
const LISTS = ['- [ ] ', '- [x] ', '- ', '1. '];
function bindToolbar() {
  $('#note-toolbar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  $('#note-toolbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    const t = currentTab();
    if (!b || !t) return;
    const v = t.view, c = b.dataset.cmd;
    if (b.dataset.mode) { setMode(t, b.dataset.mode); return; }
    if (t.mode === 'read' && c !== 'save') setMode(t, 'edit');
    if (c === 'h1') linePrefix(v, '# ', HEADINGS);
    if (c === 'h2') linePrefix(v, '## ', HEADINGS);
    if (c === 'h3') linePrefix(v, '### ', HEADINGS);
    if (c === 'bold') wrap(v, '**');
    if (c === 'italic') wrap(v, '*');
    if (c === 'list') linePrefix(v, '- ', LISTS);
    if (c === 'todo') linePrefix(v, '- [ ] ', LISTS);
    if (c === 'imp') linePrefix(v, '!! ', MARKERS);
    if (c === 'exam') linePrefix(v, 'EXAM: ', MARKERS);
    if (c === 'def') linePrefix(v, 'DEF: ', MARKERS);
    if (c === 'ask') linePrefix(v, '?? ', MARKERS);
    if (c === 'hl') wrap(v, '==');
    if (c === 'red') wrap(v, '!!');
    if (c === 'char') insertText(v, b.textContent);
    if (c === 'link') palette('link');
    if (c === 'image') $('#image-input').click();
    if (c === 'find') { import('@codemirror/search').then(m => m.openSearchPanel(v)); }
    if (c === 'save') saveTab(t);
  });
  $('#image-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f && currentTab()) pasteImage(currentTab(), f);
    e.target.value = '';
  });
  $('#tabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const i = +tab.dataset.i;
    if (e.target.closest('.tab-x')) closeTab(i); else activateTab(i);
  });
  $('#tabs').addEventListener('auxclick', e => { const tab = e.target.closest('.tab'); if (tab && e.button === 1) closeTab(+tab.dataset.i); });
  // Dokument oder Notiz aus der Seitenleiste in den Editor ziehen → Link
  $('#editors').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('application/x-schulheft')) e.preventDefault(); }, true);
  $('#editors').addEventListener('drop', e => {
    const p = e.dataTransfer.getData('application/x-schulheft');
    const t = currentTab();
    if (!p || !t) return;
    e.preventDefault(); e.stopPropagation();
    const pos = t.view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos != null) t.view.dispatch({ selection: { anchor: pos } });
    insertLink(p);
  }, true);
}

// ── Dateien hinzufügen: irgendwo ins Fenster ziehen, oder Knopf „Dateien hinzufügen“ ──
// Auf die offene Notiz → wie bisher (Stunde: Material + Link). Auf einen Ordner im Baum → in den Ordner. Sonst → „Dateien einsortieren“.
function bindFileDrop() {
  const ov = $('#drop-overlay'), msg = $('.drop-msg', ov);
  let hideTimer;
  const isFiles = e => e.dataTransfer?.types?.includes('Files') && !e.dataTransfer.types.includes('application/x-schulheft');
  const targetOf = e => {
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest('#organizer')) return { kind: 'organize' };
    const folder = el?.closest('.tree .node.folder');
    if (folder) return { kind: 'folder', el: folder, path: folder.dataset.path };
    const t = currentTab();
    if (el?.closest('#editors') && t && state.page === 'notes') return { kind: 'note', el: $('#editors'), tab: t };
    return { kind: 'organize' };
  };
  const clear = () => { ov.className = ''; document.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target')); };
  document.addEventListener('dragover', e => {
    if (!isFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const t = targetOf(e);
    document.querySelectorAll('.drop-target').forEach(n => n !== t.el && n.classList.remove('drop-target'));
    t.el?.classList.add('drop-target');
    const lesson = t.tab && isLesson(parseFront(t.tab.view.state.doc.toString()).meta);
    msg.textContent = t.kind === 'folder' ? `In den Ordner „${basename(t.path)}“ legen`
      : t.kind === 'note' ? (lesson ? `Zur Stunde „${prettyName(t.tab.path)}“ – in den Ordner Material` : `In die Notiz „${prettyName(t.tab.path)}“ einfügen`)
      : $('#organizer') ? 'Loslassen – kommt zu den anderen Dateien dazu' : 'Loslassen – danach wählst du, wohin die Dateien kommen';
    ov.className = 'show ' + t.kind;
    clearTimeout(hideTimer); hideTimer = setTimeout(clear, 250);   // dragleave ist unzuverlässig
  }, true);
  document.addEventListener('drop', e => {
    if (!isFiles(e)) return;
    e.preventDefault(); e.stopPropagation();   // Browser soll die Datei nicht öffnen; CodeMirror soll sie nicht als Text einfügen
    clear();
    const t = targetOf(e), x = e.clientX, y = e.clientY;
    filesFromDrop(e.dataTransfer).then(files => {
      if (!files.length) { toast('Keine Dateien gefunden', true); return; }
      if (t.kind === 'note') dropFiles(t.tab, files, { clientX: x, clientY: y });
      else if (t.kind === 'folder') sendToFolder(files, t.path);
      else organize({ files });
    });
  }, true);
  $('#add-files').addEventListener('click', () => $('#add-input').click());
  $('#add-input').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) organize({ files }); });
  $('#inbox-btn').addEventListener('click', openInbox);
}

// Ungespeicherte Änderungen in betroffenen Stunden zuerst sichern; danach neu laden (der Server hat den Link eingetragen)
async function saveTargets(lessons) {
  for (const t of state.tabs) if (lessons.includes(t.path) && t.dirty && !(await saveTab(t))) throw new Error('Erst die Stunde speichern');
}
async function reloadTargets(lessons) {
  for (const t of state.tabs) if (lessons.includes(t.path)) await reloadTab(t).catch(() => {});
  loadTrees().catch(() => {});
  refreshInbox();
  if (state.page === 'home') renderHome($('#page-view'), lessonCtx()).catch(() => {});
  if (state.page === 'notes' && currentTab()) renderMatBar(currentTab());
}
async function batchDone(res) {
  await reloadTargets(res.lessons);
  const parts = [];
  if (res.skipped.length) parts.push(`${res.skipped.length} übersprungen (gab es schon)`);
  const binNote = res.trashed.length ? `${res.trashed.length} doppelte ${res.trashed.length === 1 ? 'Kopie' : 'Kopien'} aus dem Eingang im Papierkorb (nicht rückgängig – bei Bedarf im Papierkorb wiederherstellen)` : '';
  if (binNote) parts.push(binNote);
  if (res.errors.length) parts.push(`${res.errors.length} Fehler: ${res.errors[0]}`);
  const head = `${res.done} ${res.done === 1 ? 'Datei' : 'Dateien'} einsortiert`;
  if (!res.done) { toast(parts.join(' · ') || 'Nichts einsortiert', !!res.errors.length || !!binNote); return; }
  toastAction([head, ...parts].join(' · '), 'Rückgängig', async () => {
    try {
      await saveTargets(res.lessons);
      const u = await api.undoFiles(res.batch);
      await reloadTargets(res.lessons);
      toast(u.problems.length ? `Rückgängig, aber: ${u.problems[0]}` : binNote ? 'Rückgängig gemacht – die Kopien im Papierkorb bitte dort wiederherstellen' : 'Rückgängig gemacht', !!u.problems.length || !!binNote);
    } catch (e) { toast(e.message, true); }
  });
}
function organize(what) {
  openOrganizer({ tree: () => state.notesTree || [], beforeWrite: saveTargets, finish: batchDone, toast }, what);
}
async function sendToFolder(files, dir) {
  const ok = files.filter(f => /\.(pdf|png|jpe?g|gif|webp|heic|heif|docx?|pptx?|xlsx?|odt|ods|odp|txt)$/i.test(f.name));
  const res = await runBatch(ok.map(f => ({ file: f, dest: dir, name: f.name })));
  if (ok.length < files.length) res.errors.push(`${files.length - ok.length} Datei(en): Dateityp geht nicht`);
  state.open.add(dir); store.set('openFolders', [...state.open]);
  batchDone(res);
}
// Eingang: Dateien, die noch einsortiert werden wollen (Knopf in der Seitenleiste und auf der Startseite, nur wenn nicht leer)
async function refreshInbox() {
  try { state.inbox = (await api.inbox()).files; } catch { state.inbox = []; }
  const n = state.inbox.length, b = $('#inbox-btn');
  b.hidden = !n;
  b.innerHTML = `📥 Eingang <b>${n}</b>`;
  b.title = `${n} ${n === 1 ? 'Datei wartet' : 'Dateien warten'} darauf, einsortiert zu werden`;
  $('#add-files').classList.toggle('with-inbox', !!n);
  $('#add-files').textContent = n ? '+ Dateien' : '+ Dateien hinzufügen';
}
async function openInbox() {
  await refreshInbox();
  if (!state.inbox.length) { toast('Der Eingang ist leer'); return; }
  organize({ inbox: state.inbox });
}

// ── Seiten: Wichtig, Aufgaben, Einstellungen, Hilfe ──────────────
function showPage(page) {
  state.page = page;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  $('#page-view').onclick = null;
  if (page !== 'notes') $('#mat-bar').hidden = true;
  $('#notes-view').hidden = page !== 'notes';
  $('#page-view').hidden = page === 'notes';
  if (page === 'important') renderImportant();
  if (page === 'todos') renderTodos();
  if (page === 'settings') renderSettings($('#page-view'), { toast, ask, info: state.info, changeRoot, tree: () => state.notesTree || [], active: p => state.page === p }).catch(e => toast(e.message, true));
  if (page === 'help') $('#page-view').innerHTML = helpHtml;
  if (page === 'overview') renderOverview($('#page-view'), state.overviewDir, lessonCtx());
  if (page === 'home') renderHome($('#page-view'), lessonCtx()).catch(e => toast(e.message, true));
  if (page === 'notes') activateTab(state.active);
  refreshTreeHighlight();
}

const KIND = { '!!': ['imp', 'Wichtig'], 'EXAM:': ['exam', 'Prüfung'], 'TEST:': ['exam', 'Prüfung'], 'DEF:': ['def', 'Definition'], '??': ['ask', 'Frage'] };
function kindOf(text) {
  const m = text.match(/^(?:[-*+]\s+)?(!!|EXAM:|TEST:|DEF:|\?\?)/);
  return m ? KIND[m[1]] : ['mark', 'Markiert'];
}
let importantFilter = 'all';
async function renderImportant() {
  const pv = $('#page-view');
  pv.innerHTML = '<div class="page-pad"><p class="sub">Lädt …</p></div>';
  const { marked } = await api.overview();
  const counts = {};
  marked.forEach(m => { const k = kindOf(m.text)[0]; counts[k] = (counts[k] || 0) + 1; });
  const filters = [['all', 'Alle', marked.length], ['imp', 'Wichtig'], ['exam', 'Prüfung'], ['def', 'Definition'], ['ask', 'Frage'], ['mark', 'Markiert']];
  const list = marked.filter(m => importantFilter === 'all' || kindOf(m.text)[0] === importantFilter);
  pv.innerHTML = `<div class="page-pad">
    <div class="view-head"><div><h1>Wichtig</h1><p class="sub">Alle markierten Zeilen aus allen Notizen. Klick öffnet die Stelle.</p></div></div>
    <div class="chips">${filters.map(([k, l, n]) => `<button class="chip k-${k} ${importantFilter === k ? 'on' : ''}" data-k="${k}">${l} <b>${n ?? counts[k] ?? 0}</b></button>`).join('')}</div>
    ${groupByNote(list, m => {
      const [k, label] = kindOf(m.text);
      const body = renderNote(m.text.replace(/^(?:[-*+]\s+)?(!!|EXAM:|TEST:|DEF:|\?\?)\s*/, ''), dirname(m.path)).innerHTML;
      return `<div class="item mk-row k-${k}" data-path="${esc(m.path)}" data-line="${m.line}"><span class="badge k-${k}">${label}</span><div class="item-text">${body}</div></div>`;
    }) || '<p class="empty">Keine Einträge</p>'}</div>`;
  pv.onclick = e => {
    const c = e.target.closest('.chip[data-k]');
    if (c) { importantFilter = c.dataset.k; renderImportant(); return; }
    const it = e.target.closest('.item[data-path]');
    if (it && !e.target.closest('a')) openNote(it.dataset.path, +it.dataset.line);
  };
}

async function renderTodos() {
  const pv = $('#page-view');
  pv.innerHTML = '<div class="page-pad"><p class="sub">Lädt …</p></div>';
  const { todos } = await api.overview();
  applyLive(todos);   // ungespeicherte Haken aus offenen Tabs
  const open = todos.filter(t => !t.done), done = todos.filter(t => t.done);
  // Offene Aufgaben mit Frist (auch geschätzt: nächste Stunde) zuerst, nach Datum
  const dated = open.filter(t => t.due).sort(byDue), undated = open.filter(t => !t.due);
  const row = (td, src) => `<div class="item todo ${td.done ? 'done' : ''}" data-path="${esc(td.path)}" data-line="${td.line}">
      <input type="checkbox" ${td.done ? 'checked' : ''} title="Abhaken (danach speichern)">
      <div class="item-text">${renderNote(td.text.replace(/^[-*+]\s+\[[ xX]\]\s*/, ''), dirname(td.path)).innerHTML}${src ? `<div class="td-meta">${dueChip(td)}<span class="td-src">${esc(src)}</span></div>` : ''}</div></div>`;
  pv.innerHTML = `<div class="page-pad">
    <div class="view-head"><div><h1>Aufgaben</h1><p class="sub">${open.length} offen${dated.length ? ` (${dated.length} mit Frist)` : ''} · ${done.length} erledigt · aus allen Notizen (Zeilen mit „- [ ]“)</p></div></div>
    ${dated.length ? `<section class="group"><h2>Nach Frist</h2>${dated.map(td => row(td, td.lesson ? lessonLabel(td.lesson, td.path) : prettyName(td.path))).join('')}</section>` : ''}
    ${groupByNote(undated, td => row(td)) || (dated.length ? '' : '<p class="empty">Alles erledigt 🎉</p>')}
    ${done.length ? `<details class="done-list"><summary>Erledigt (${done.length})</summary>${groupByNote(done, td => row(td))}</details>` : ''}</div>`;
  pv.onclick = async e => {
    const it = e.target.closest('.item[data-path]');
    if (!it || e.target.closest('a')) return;
    if (e.target.matches('input[type=checkbox]')) { await toggleTask(it.dataset.path, +it.dataset.line); return; }
    openNote(it.dataset.path, +it.dataset.line);
  };
}

function groupByNote(list, row) {
  const groups = new Map();
  list.forEach(m => { if (!groups.has(m.path)) groups.set(m.path, []); groups.get(m.path).push(m); });
  return [...groups].map(([p, items]) => `<section class="group"><h2><span class="g-folder">${esc(dirname(p))}</span> ${esc(prettyName(p))}</h2>
    ${items.map((m, i) => `${m.heading && m.heading !== items[i - 1]?.heading ? `<div class="g-head">${esc(m.heading)}</div>` : ''}${row(m)}`).join('')}</section>`).join('');
}

// ── Dokument-Bereich rechts ──────────────────────────────────────
let doc;
async function openDoc(p, page) {
  if (doc.path === p) { showDoc(); if (page) doc.goto(page); return; }
  doc.editing?.commit();
  if (doc.dirty) {
    const a = await ask({ title: `Änderungen in „${basename(doc.path)}“ speichern?`, buttons: [{ id: 'save', label: 'Speichern' }, { id: 'drop', label: 'Nicht speichern', danger: true }, { id: 'no', label: 'Abbrechen' }] });
    if (a === 'no') return;
    if (a === 'save' && !(await doc.save())) return;
  }
  showDoc();
  let ok;
  try { ok = await doc.open(p, { page }); } catch (e) {
    // Inzwischen ein anderes Dokument geöffnet → alten Fehler (z. B. "Loading aborted") ignorieren
    if (doc.path !== p || e?.name === 'AbortException') return;
    toast(`Konnte ${basename(p)} nicht öffnen: ${e.message}`, true); doc.close(); hideDoc(); return;
  }
  if (!ok) return;
  store.set('doc', p);
  refreshTreeHighlight();
}
function showDoc() {
  state.docOpen = true;
  $('#app').classList.add('with-doc');
  $('#docpane').hidden = false; $('#splitter').hidden = false;
}
function hideDoc() {
  state.docOpen = false;
  $('#app').classList.remove('with-doc');
  $('#docpane').hidden = true; $('#splitter').hidden = true;
  store.set('doc', null);
  refreshTreeHighlight();
}
async function closeDoc() {
  doc.editing?.commit();
  if (doc.dirty) {
    const a = await ask({ title: `Änderungen in „${basename(doc.path)}“ speichern?`, buttons: [{ id: 'save', label: 'Speichern' }, { id: 'drop', label: 'Nicht speichern', danger: true }, { id: 'no', label: 'Abbrechen' }] });
    if (a === 'no') return;
    if (a === 'save' && !(await doc.save())) return;
  }
  doc.close();
  hideDoc();
}

function bindSplitter() {
  const sp = $('#splitter'), main = $('#main');
  const apply = r => { r = Math.max(0.2, Math.min(0.85, r)); main.style.setProperty('--doc-w', `${r * 100}%`); return r; };
  let ratio = apply(store.get('docRatio', 0.5));
  sp.addEventListener('pointerdown', e => {
    e.preventDefault();
    sp.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const rect = main.getBoundingClientRect();
    const move = ev => { ratio = apply((rect.right - ev.clientX) / rect.width); };
    const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); store.set('docRatio', ratio); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('dblclick', () => { ratio = apply(0.5); store.set('docRatio', ratio); });
}

// ── Suche (⌘K) ───────────────────────────────────────────────────
let allDocsFlat = [], allNotesFlat = [];
function flatten(nodes, out = []) { nodes.forEach(n => n.dir ? flatten(n.children, out) : out.push(n.path)); return out; }

function palette(mode = 'open') {
  allDocsFlat = flatten(state.docsTree || []); allNotesFlat = flatten(state.notesTree || []);
  const p = $('#palette');
  p.innerHTML = `<div class="pal-card">
    <input class="pal-input" placeholder="${mode === 'link' ? 'Dokument oder Notiz suchen, die verlinkt werden soll …' : 'Notizen, Dokumente und Text durchsuchen …'}" spellcheck="false">
    <div class="pal-list"></div>
    <div class="pal-foot">↑↓ auswählen · Enter ${mode === 'link' ? 'Link einfügen' : 'öffnen'} · Esc schließen</div></div>`;
  p.classList.add('show');
  const input = $('.pal-input', p), list = $('.pal-list', p);
  let results = [], sel = 0, status = '';
  const textSearch = latestOnly((q, signal) => api.search(q, signal));
  const recent = store.get('recent', []);
  const show = () => {
    let html = '', group = '';
    results.forEach((r, i) => {
      if (r.group !== group) { group = r.group; html += `<div class="pal-group">${group}</div>`; }
      html += `<div class="pal-item ${i === sel ? 'on' : ''}" data-i="${i}"><span class="ico">${r.icon}</span><span class="pal-main">${r.html}</span><span class="pal-sub">${esc(r.sub || '')}</span></div>`;
    });
    if (status) html += `${results.some(r => r.group === 'Im Text') ? '' : '<div class="pal-group">Im Text</div>'}<div class="pal-status">${status}</div>`;
    list.innerHTML = html || '<div class="pal-empty">Nichts gefunden</div>';
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const hl = (text, q) => { const i = text.toLowerCase().indexOf(q.toLowerCase()); return i < 0 || !q ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length)); };
  const fileItem = (path, group, q) => ({ group, path, icon: path.endsWith('.md') ? '📝' : /\.pdf$/i.test(path) ? '📄' : '🖼', html: hl(path.endsWith('.md') ? prettyName(path) : basename(path), q), sub: dirname(path) });
  const update = async () => {
    const q = input.value.trim();
    status = '';
    if (!q) {
      textSearch.cancel();
      results = [...recent.filter(r => mode !== 'link' || r !== currentTab()?.path).slice(0, 8).map(r => fileItem(r, 'Zuletzt geöffnet', '')),
        ...(mode === 'link' ? allDocsFlat.slice(0, 30).map(d => fileItem(d, 'Dokumente', '')) : [])];
      sel = 0; show(); return;
    }
    const ql = q.toLowerCase();
    const words = ql.split(/\s+/);
    const match = s => words.every(w => s.toLowerCase().includes(w));
    results = [
      ...allNotesFlat.filter(n => match(n)).slice(0, 10).map(n => fileItem(n, 'Notizen', q)),
      ...allDocsFlat.filter(d => match(d)).slice(0, 15).map(d => fileItem(d, 'Dokumente', q)),
    ];
    const inText = mode !== 'link' && q.length >= 2;
    if (inText) status = 'Suche im Text …';   // Platzhalter → Liste springt nicht, wenn die Treffer kommen
    else textSearch.cancel();
    sel = 0; show();
    if (!inText) return;
    const out = await textSearch(q);
    if (!out) return;                          // neuere Eingabe unterwegs
    status = '';
    if (out.error) { status = 'Suche im Text fehlgeschlagen'; show(); return; }
    const res = out.value;
    results.push(...res.lines.map(l => ({ group: 'Im Text', path: l.path, line: l.line, icon: '›', html: hl(l.text, q), sub: `${prettyName(l.path)} · Z. ${l.line}` })));
    results.push(...(res.doclines || []).map(l => ({ group: 'In Dokumenten', path: l.path, page: l.page, icon: /\.pdf$/i.test(l.path) ? '📄' : '🖼', html: hl(l.text, q), sub: `${/\.pdf$/i.test(l.path) ? `S. ${l.page} · ` : ''}${basename(l.path)}` })));
    show();
  };
  const close = () => { textSearch.cancel(); p.classList.remove('show'); p.innerHTML = ''; };
  const choose = r => {
    if (!r) return;
    close();
    if (mode === 'link') insertLink(r.path);
    else if (r.line) openNote(r.path, r.line);
    else if (r.page) openDoc(r.path, r.page);
    else openPath(r.path);
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); show(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); show(); }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[sel]); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  list.addEventListener('click', e => { const it = e.target.closest('.pal-item'); if (it) choose(results[+it.dataset.i]); });
  p.onclick = e => { if (e.target === p) close(); };
  update();
  input.focus();
}

// ── Allgemein ────────────────────────────────────────────────────
function refreshTreeHighlight() {
  if (state.notesTree) renderTree($('#tree-notes'), state.notesTree, 'notes');
  if (state.docsTree) renderTree($('#tree-docs'), state.docsTree, 'docs');
  updateTitle();
}
function anyDirty() { return state.tabs.some(t => t.dirty) || doc?.dirty; }
function updateTitle() { document.title = (anyDirty() ? '● ' : '') + 'Schulheft'; }

function saveSession() {
  store.set('tabs', state.tabs.map(t => ({ path: t.path, mode: t.mode })));
  store.set('activeTab', state.tabs[state.active]?.path || null);
  const t = currentTab();
  if (t) store.set('recent', [t.path, ...store.get('recent', []).filter(r => r !== t.path)].slice(0, 15));
}

function setTheme(th) {
  document.documentElement.dataset.theme = th;
  store.set('theme', th);
  document.querySelectorAll('#themes button').forEach(b => b.classList.toggle('on', b.dataset.theme === th));
}

// Wenn die App wieder in den Vordergrund kommt: Änderungen von außen übernehmen
async function syncFromDisk() {
  loadTrees().catch(() => {});
  refreshInbox();
  for (const t of state.tabs) {
    try {
      const data = await api.read(t.path);
      if (Math.abs(data.mtime - t.mtime) < 1) continue;
      if (!t.dirty) { await reloadTab(t); toast(`„${prettyName(t.path)}“ wurde von außen aktualisiert`); }
    } catch (e) { if (e.status === 404) toast(`„${prettyName(t.path)}“ gibt es nicht mehr`, true); }
  }
  if (state.page === 'overview') renderOverview($('#page-view'), state.overviewDir, lessonCtx());
  if (state.page === 'home') renderHome($('#page-view'), lessonCtx()).catch(() => {});
}

// ── Notizordner: erster Start und Wechsel ────────────────────────
// Ordner wählen → Server legt ihn an und merkt ihn sich → App neu laden
async function chooseRoot(info, first) {
  let value = info.root || info.suggested, err = info.problem || '';
  for (;;) {
    const intro = first ? 'Wo sollen deine Notizen und Dokumente liegen? Der Ordner wird angelegt, wenn es ihn noch nicht gibt. Das Programm liegt getrennt davon – Updates ändern nichts an deinen Dateien.'
      : 'Die App zeigt danach die Notizen aus dem neuen Ordner. Der alte Ordner bleibt, wie er ist (nichts wird verschoben).';
    const v = await ask({
      title: first ? 'Willkommen im Schulheft' : 'Notizordner ändern', text: (err ? `⚠ ${err} ` : '') + intro, locked: first,
      input: { value, placeholder: info.suggested },
      buttons: first ? [{ id: 'ok', label: 'Ordner verwenden' }] : [{ id: 'ok', label: 'Ordner verwenden' }, { id: 'no', label: 'Abbrechen' }],
    });
    if (v == null) return false;
    try { await api.setup(v); location.reload(); return true; } catch (e) { value = v; err = e.message; }
  }
}
function forgetOtherRoot(id) {
  if (store.get('rootId', null) === id) return;
  ROOT_KEYS.forEach(k => store.del(k));
  store.set('rootId', id);
  state.open = new Set();
}
// Ordner wechseln (Knopf auf der Einstellungsseite)
function changeRoot() {
  if (anyDirty()) { toast(keys('Zuerst alles speichern (⌘S)'), true); return; }
  chooseRoot(state.info, false);
}

async function init() {
  setTheme(store.get('theme', 'papier'));
  localizeKeys(document.body);
  state.info = await api.info();
  setServerPlatform(state.info.platform);
  if (!state.info.root) { await chooseRoot(state.info, true); return; }   // erster Start (oder Ordner fehlt)
  forgetOtherRoot(state.info.rootId);

  doc = new DocViewer($('#docpane'), {
    toast, ask,
    onState: s => {
      if (s.close) closeDoc();
      if (s.menu) menu(s.menu, [
        ...(currentTab() ? [{ label: 'Als Link in die Notiz einfügen', run: () => insertLink(doc.path) }] : []),
        { label: 'Text kopieren', run: () => doc.copyAllText() },
        { label: revealLabel(), run: () => api.reveal(doc.path).catch(e => toast(e.message, true)) },
        '-',
        { label: 'Original wiederherstellen …', danger: true, run: () => doc.restoreOriginal() },
      ]);
      if ('dirty' in s) updateTitle();
    },
  });

  bindTree($('#tree-notes'), 'notes');
  bindTree($('#tree-docs'), 'docs');
  bindToolbar();
  bindFileDrop();
  bindSplitter();

  $('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-page]'); if (b) showPage(b.dataset.page); });
  $('#search-btn').addEventListener('click', () => palette());
  $('#new-note').addEventListener('click', () => newNote());
  $('#new-lesson').addEventListener('click', () => newLesson());
  $('#today-btn').addEventListener('click', () => showPage('home'));   // Heute = Startseite (Stunden von heute: öffnen oder anlegen)
  $('#new-folder').addEventListener('click', () => newFolder(''));
  $('#empty-new').addEventListener('click', () => newNote());
  $('#empty-search').addEventListener('click', () => palette());
  $('#themes').addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (b) setTheme(b.dataset.theme); });
  $('#toggle-sidebar').addEventListener('click', () => $('#app').classList.toggle('no-sidebar'));
  document.querySelectorAll('.side-section > h4').forEach(h => h.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    h.parentElement.classList.toggle('collapsed');
    store.set('collapsed:' + h.parentElement.id, h.parentElement.classList.contains('collapsed'));
  }));
  document.querySelectorAll('.side-section').forEach(s => s.classList.toggle('collapsed', store.get('collapsed:' + s.id, false)));

  // Welcher Bereich ist aktiv (für ⌘S)?
  $('#docpane').addEventListener('pointerdown', () => { state.activePane = 'doc'; }, true);
  $('#center').addEventListener('pointerdown', () => { state.activePane = 'center'; }, true);
  $('#center').addEventListener('focusin', () => { state.activePane = 'center'; });

  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (state.activePane === 'doc' && state.docOpen) doc.save();
      else if (currentTab()) saveTab(currentTab());
    }
    if (mod && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'p')) { e.preventDefault(); palette(); }
    if (mod && e.key === '\\') { e.preventDefault(); $('#app').classList.toggle('no-sidebar'); }
    if (mod && e.key.toLowerCase() === 'e' && currentTab() && state.page === 'notes') { e.preventDefault(); const t = currentTab(); setMode(t, t.mode === 'edit' ? 'read' : 'edit'); }
  });

  // Beim Schließen fragen, wenn etwas nicht gespeichert ist
  window.addEventListener('beforeunload', e => { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('focus', syncFromDisk);

  await loadTrees();
  await refreshInbox();
  // Letzte Sitzung wiederherstellen
  for (const t of store.get('tabs', [])) {
    try { await openNote(t.path, null, true); const tab = state.tabs.find(x => x.path === t.path); if (tab) tab.mode = t.mode || 'edit'; } catch { /* gelöscht */ }
  }
  const act = state.tabs.findIndex(t => t.path === store.get('activeTab'));
  state.active = state.tabs.length ? (act >= 0 ? act : 0) : -1;
  if (state.page === 'notes') activateTab(state.active); else renderTabs();
  const lastDoc = store.get('doc', null);
  if (lastDoc) openDoc(lastDoc).catch(() => hideDoc());
  if (state.page === 'notes') showPage('home');   // Start: „Heute & diese Woche“ (offene Tabs bleiben unter „Notizen“)
}

init().catch(e => { console.error(e); toast('Fehler beim Start: ' + e.message, true); });
