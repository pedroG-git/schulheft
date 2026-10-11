// Dokument-Betrachter: PDFs und Bilder anzeigen und mit Text, Stift, Marker … bearbeiten
import * as pdfjs from 'pdfjs-dist';
import { PDFDocument, rgb, degrees, LineCapStyle, BlendMode } from 'pdf-lib';
import { api, rawUrl, basename, isImage } from './api.js';
import { fetchOcr, postOcr, buildOcrLayer, isScan, tcText, ocrText } from './ocr.js';
import { keys } from './platform.js';
import { embedTextFont, pdfSafe } from './pdftext.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/dist/pdf.worker.min.mjs';

const SVGNS = 'http://www.w3.org/2000/svg';
const FONT_CSS = 'Helvetica, Arial, sans-serif';
const LINE_H = 1.25;

export const TOOLS = [
  { id: 'select', label: 'Auswählen', icon: '↖', hint: 'Anmerkungen auswählen, verschieben; Text im Dokument markieren und kopieren (auch in Bildern und Scans)' },
  { id: 'text', label: 'Text', icon: 'T', hint: keys('Klicken und schreiben. Fertig: daneben klicken, Esc oder ⌘Enter') },
  { id: 'note', label: 'Notizzettel', icon: '▤', hint: keys('Gelber Zettel mit Text. Fertig: daneben klicken, Esc oder ⌘Enter') },
  { id: 'pen', label: 'Stift', icon: '✎', hint: 'Frei zeichnen' },
  { id: 'hl', label: 'Marker', icon: '▮', hint: 'Textmarker' },
  { id: 'arrow', label: 'Pfeil', icon: '↗', hint: 'Pfeil ziehen' },
  { id: 'rect', label: 'Rahmen', icon: '▭', hint: 'Rahmen ziehen' },
  { id: 'cover', label: 'Abdecken', icon: '◻', hint: 'Weiße Fläche über alten Text, dann neu schreiben' },
  { id: 'eraser', label: 'Radierer', icon: '⌫', hint: 'Anmerkung anklicken zum Löschen' },
];
export const COLORS = ['#d6336c', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#6741d9', '#212529'];
const HL_COLORS = ['#ffd43b', '#8ce99a', '#74c0fc', '#ffa8a8', '#e599f7'];
const SIZES = { text: [10, 14, 20], note: [10, 12, 16], pen: [1.5, 3, 6], hl: [10, 16, 24], arrow: [1.5, 3, 5], rect: [1.5, 3, 5] };

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
// Stand der Anmerkungen als Text (zum Vergleich mit dem gespeicherten Stand)
const snap = items => JSON.stringify(items, (k, v) => k === '_editing' ? undefined : v);
// Größte Kantenlänge / Pixelzahl einer Seite beim Zeichnen (sonst riesige Bilder bei 500 %)
const MAX_SIDE = 4096, MAX_PIXELS = 4096 * 4096;
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };

// Unicode-Schrift für den PDF-Export (einmal laden; fehlt sie, nimmt embedTextFont Helvetica)
let fontBytes;
const textFontBytes = () => (fontBytes ??= fetch('dist/LiberationSans-Regular.ttf').then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null));

let measureCtx;
function textWidth(s, size) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${size}px ${FONT_CSS}`;
  return measureCtx.measureText(s).width;
}
function noteBox(it) {
  const lines = (it.text || ' ').split('\n');
  const pad = it.size * 0.6;
  const w = Math.max(it.size * 8, ...lines.map(l => textWidth(l, it.size))) + 2 * pad;
  const h = lines.length * it.size * LINE_H + 2 * pad;
  return { lines, pad, w, h };
}

export class DocViewer {
  constructor(root, { onState, toast, ask }) {
    this.root = root;
    this.onState = onState;   // Status (dirty, Titel) an die App melden
    this.toast = toast;
    this.ask = ask;
    this.tool = 'select';
    this.color = COLORS[1];
    this.hlColor = HL_COLORS[0];
    this.sizeIdx = 1;
    this.zoom = 1;
    this.fit = true;
    this.items = [];
    this.undoStack = [];
    this.redoStack = [];
    this.selected = null;
    this.dirty = false;
    this.savedSnap = '[]';
    this.openSeq = 0;
    this.path = null;
    this.build();
  }

  // ── Grundgerüst ───────────────────────────────────────────────
  build() {
    this.root.innerHTML = `
      <div class="doc-head">
        <div class="doc-title" title=""></div>
        <span class="doc-status" hidden></span>
        <div class="doc-actions">
          <button class="icon-btn" data-act="zoomout" title="Verkleinern">−</button>
          <button class="chip" data-act="fit" title="An Breite anpassen">100%</button>
          <button class="icon-btn" data-act="zoomin" title="Vergrößern">+</button>
          <span class="sep"></span>
          <button class="icon-btn" data-act="undo" title="${keys('Rückgängig (⌘Z)')}">↶</button>
          <button class="icon-btn" data-act="redo" title="${keys('Wiederholen (⌘⇧Z)')}">↷</button>
          <span class="sep"></span>
          <button class="btn primary small" data-act="save" title="${keys('Speichern (⌘S)')}">Speichern</button>
          <button class="icon-btn" data-act="more" title="Mehr">⋯</button>
          <button class="icon-btn" data-act="close" title="Schließen">✕</button>
        </div>
      </div>
      <div class="doc-tools"></div>
      <div class="doc-scroll" tabindex="-1"><div class="doc-pages"></div></div>`;
    this.titleEl = this.root.querySelector('.doc-title');
    this.statusEl = this.root.querySelector('.doc-status');
    this.toolsEl = this.root.querySelector('.doc-tools');
    this.scrollEl = this.root.querySelector('.doc-scroll');
    this.pagesEl = this.root.querySelector('.doc-pages');
    const head = this.root.querySelector('.doc-head');
    // Knöpfe nehmen keinen Fokus: ein offenes Textfeld bleibt aktiv, sonst geht der Fokus in den Dokument-Bereich
    for (const el of [head, this.toolsEl]) el.addEventListener('mousedown', e => {
      if (!e.target.closest('button')) return;
      e.preventDefault();
      if (!this.editing) this.scrollEl.focus({ preventScroll: true });
    });
    head.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'zoomin') { this.fit = false; this.setZoom(this.zoom * 1.2); }
      if (act === 'zoomout') { this.fit = false; this.setZoom(this.zoom / 1.2); }
      if (act === 'fit') { this.fit = true; this.setZoom(this.fitZoom()); }
      if (act === 'undo') this.undo();
      if (act === 'redo') this.redo();
      if (act === 'save') this.save();
      if (act === 'close') this.onState({ close: true });
      if (act === 'more') this.onState({ menu: e.target.closest('[data-act]') });
    });
    this.renderTools();
    new ResizeObserver(() => { if (this.fit && this.pages?.length) this.setZoom(this.fitZoom()); }).observe(this.scrollEl);
    this.root.addEventListener('keydown', e => this.onKey(e));
    // Klick ins Dokument: Fokus hierher (damit Entf und ⌘Z nicht in der Notiz landen), leere Fläche hebt die Auswahl auf
    this.scrollEl.addEventListener('pointerdown', e => {
      if (e.target.closest('textarea')) return;
      if (!this.editing) this.scrollEl.focus({ preventScroll: true });
      if (!e.target.closest('[data-id]')) this.select(null);
      if (this.tool !== 'select') getSelection()?.removeAllRanges();
    }, true);
    // pdf.js-Textebene: beim Ziehen deckt .endOfContent die Seite ab, damit die Auswahl nicht ans Seitenende springt
    this.pagesEl.addEventListener('mousedown', e => e.target.closest('.textLayer')?.classList.add('selecting'));
    window.addEventListener('pointerup', () => {
      this.pagesEl.querySelectorAll('.textLayer.selecting').forEach(t => t.classList.remove('selecting'));
      this.endErase();
    });
  }

  renderTools() {
    if (this.readOnly) { this.toolsEl.innerHTML = '<span class="doc-note">GIF kann nicht bearbeitet werden</span>'; return; }
    // Farben und Größen passen zu dem, was gerade bearbeitet oder ausgewählt ist, sonst zum Werkzeug
    const src = this.editing?.item || this.items.find(i => i.id === this.selected);
    const kind = this.toolKind = src?.type || this.tool;
    const sizes = SIZES[kind];
    const colors = kind === 'hl' ? HL_COLORS : COLORS;
    const cur = src ? src.color : kind === 'hl' ? this.hlColor : this.color;
    const showColor = !['select', 'eraser', 'cover', 'note'].includes(kind);
    let sizeIdx = this.sizeIdx;
    if (src && sizes) {
      const v = (src.type === 'text' || src.type === 'note' ? src.size : src.width) / this.unit;
      sizeIdx = sizes.reduce((b, s, i) => Math.abs(s - v) < Math.abs(sizes[b] - v) ? i : b, 0);
    }
    this.toolsEl.innerHTML = `
      <div class="tool-group">${TOOLS.map(t => `<button class="tool ${t.id === this.tool ? 'on' : ''}" data-tool="${t.id}" title="${t.label}: ${t.hint}"><span class="ti">${t.icon}</span><span class="tl">${t.label}</span></button>`).join('')}</div>
      ${showColor ? `<div class="tool-group colors">${colors.map(c => `<button class="swatch ${c === cur ? 'on' : ''}" data-color="${c}" style="--c:${c}" title="Farbe"></button>`).join('')}</div>` : ''}
      ${sizes ? `<div class="tool-group sizes">${['S', 'M', 'L'].map((s, i) => `<button class="chip ${i === sizeIdx ? 'on' : ''}" data-size="${i}" title="Größe">${s}</button>`).join('')}</div>` : ''}
      ${this.selected && !this.editing ? `<div class="tool-group"><button class="chip danger" data-del="1">Auswahl löschen</button></div>` : ''}`;
    this.toolsEl.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const kind = this.toolKind;
      if (b.dataset.tool) {
        this.editing?.commit();
        this.tool = b.dataset.tool; this.select(null);
        getSelection()?.removeAllRanges();
        this.updateMode();
      }
      if (b.dataset.color) {
        const c = b.dataset.color;
        if (kind === 'hl') this.hlColor = c; else this.color = c;
        if (this.editing) this.editing.restyle({ color: c });
        else if (this.selected) this.restyleSelected({ color: c });
      }
      if (b.dataset.size) {
        this.sizeIdx = +b.dataset.size;
        if (this.editing) this.editing.restyle({ size: this.sizeFor(kind) });
        else if (this.selected) this.resizeSelected();
      }
      if (b.dataset.del) this.deleteItem(this.selected);
      this.renderTools();
    };
  }

  updateMode() {
    this.root.dataset.tool = this.readOnly ? 'view' : this.tool;
    this.root.classList.toggle('readonly', !!this.readOnly);
  }

  get unit() { return this.kind === 'image' ? (this.pages[0].w / 612) : 1; }
  sizeFor(tool) { return (SIZES[tool] || [1, 1, 1])[this.sizeIdx] * this.unit; }

  // ── Öffnen / Schließen ────────────────────────────────────────
  // Gibt false zurück, wenn inzwischen ein anderes Dokument geöffnet wurde. { page }: zu dieser Seite (ab 1) springen
  async open(path, { page } = {}) {
    const seq = ++this.openSeq;
    this.editing?.commit();
    this.ocrChain = null; this.ocrBusy = 0; clearTimeout(this.busyTimer); this.status('');
    this.path = path;
    this.kind = isImage(path) ? 'image' : 'pdf';
    this.readOnly = /\.gif$/i.test(path);
    this.titleEl.textContent = basename(path);
    this.titleEl.title = path;
    this.pagesEl.innerHTML = '<div class="doc-loading">Lädt …</div>';
    this.items = []; this.undoStack = []; this.redoStack = []; this.selected = null;
    this.savedSnap = '[]';
    this.setDirty(false);
    this.updateMode();
    this.renderTools();
    try {
      const info = await api.doc(path);
      if (seq !== this.openSeq) return false;
      this.base = info.base;
      this.hasBackup = info.hasBackup;
      this.items = info.items || [];
      this.savedSnap = snap(this.items);
      if (this.kind === 'pdf') await this.loadPdf(seq);
      else await this.loadImage(seq);
    } catch (e) {
      if (seq !== this.openSeq) return false;   // abgebrochen, weil ein anderes Dokument geöffnet wurde
      throw e;
    }
    if (seq !== this.openSeq) return false;
    this.fit = true;
    this.setZoom(this.fitZoom(), true);
    this.updateMode();
    this.renderTools();
    this.scrollEl.scrollTop = 0;
    if (page > 1) this.goto(page);
    // Bilder: erkannten Text darüberlegen (markieren, kopieren)
    if (this.kind === 'image') this.showOcr(this.pages[0]);
    return true;
  }

  // Zu einer Seite (ab 1) springen und sie kurz hervorheben
  goto(n) {
    const p = this.pages?.[n - 1];
    if (!p) return;
    const sc = this.scrollEl;
    sc.scrollTop += p.el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
    p.el.classList.remove('flash'); void p.el.offsetWidth; p.el.classList.add('flash');
    setTimeout(() => p.el.classList.remove('flash'), 1600);
  }

  async loadPdf(seq) {
    const data = await (await fetch(rawUrl(this.base))).arrayBuffer();
    if (seq !== this.openSeq) return;
    this.loadingTask?.destroy();
    const task = this.loadingTask = pdfjs.getDocument({ data, isEvalSupported: false });
    const pdf = await task.promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ index: i - 1, page, vp, w: vp.width, h: vp.height });
    }
    if (seq !== this.openSeq) return;
    this.pdf = pdf;
    this.pages = pages;
    this.buildPages();
  }

  async loadImage(seq) {
    const img = new Image();
    img.src = rawUrl(this.base);
    await img.decode();
    if (seq !== this.openSeq) return;
    this.image = img;
    this.pages = [{ index: 0, w: img.naturalWidth, h: img.naturalHeight }];
    this.buildPages();
  }

  buildPages() {
    this.pagesEl.innerHTML = '';
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(es => es.forEach(e => {
      const p = this.pages[+e.target.dataset.page];
      p.visible = e.isIntersecting;
      if (p.visible && p.renderedZoom !== this.zoom) this.renderPage(p);
    }), { root: this.scrollEl, rootMargin: '600px 0px' });
    for (const p of this.pages) {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.page = p.index;
      if (this.kind === 'image') { p.canvas = this.image.cloneNode(); p.canvas.className = 'page-img'; }
      else p.canvas = document.createElement('canvas');
      p.text = document.createElement('div');
      p.text.className = 'textLayer';
      p.svg = document.createElementNS(SVGNS, 'svg');
      p.svg.setAttribute('viewBox', `0 0 ${p.w} ${p.h}`);
      p.svg.classList.add('annot');
      el.append(p.canvas, p.text, p.svg);
      p.el = el;
      this.pagesEl.append(el);
      this.observer.observe(el);
      this.bindPage(p);
      this.drawItems(p);
    }
  }

  close() {
    this.openSeq++;
    this.editing?.commit();
    this.observer?.disconnect();
    this.loadingTask?.destroy();
    this.loadingTask = null;
    this.pdf = null;
    this.path = null;
    this.pages = [];
    this.pagesEl.innerHTML = '';
    this.setDirty(false);
  }

  // ── Zoom und Seiten zeichnen ──────────────────────────────────
  fitZoom() {
    const w = this.scrollEl.clientWidth - 32;
    const maxW = Math.max(...this.pages.map(p => p.w));
    return Math.max(0.2, Math.min(4, w / maxW));
  }

  setZoom(z, force) {
    z = Math.max(0.2, Math.min(5, z));
    if (!force && Math.abs(z - this.zoom) < 0.001) return;
    const sc = this.scrollEl, ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
    this.zoom = z;
    this.root.querySelector('[data-act=fit]').textContent = `${Math.round(z * 100)}%`;
    for (const p of this.pages) {
      p.el.style.width = `${p.w * z}px`;
      p.el.style.height = `${p.h * z}px`;
      p.el.style.setProperty('--scale-factor', z);
      p.el.style.setProperty('--total-scale-factor', z);
      if (p.visible) this.renderPage(p);
    }
    sc.scrollTop = ratio * sc.scrollHeight;
    this.editing?.reposition();
  }

  async renderPage(p) {
    if (this.kind === 'image') { p.renderedZoom = this.zoom; return; }
    const zoom = this.zoom;
    p.renderedZoom = zoom;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(zoom * dpr, MAX_SIDE / Math.max(p.w, p.h), Math.sqrt(MAX_PIXELS / (p.w * p.h)));
    const vp = p.page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    try {
      p.task?.cancel();
      p.task = p.page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp });
      await p.task.promise;
    } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
    if (p.renderedZoom !== zoom) return;
    canvas.className = 'page-canvas';
    p.canvas.replaceWith(canvas);
    p.canvas = canvas;
    // Textebene, damit man Text im PDF markieren und kopieren kann; eingescannte Seiten: erkannter Text (OCR)
    try {
      const tc = await this.textContent(p);
      if (p.renderedZoom !== zoom) return;
      if (isScan(tc)) { this.showOcr(p); return; }   // OCR-Ebene passt sich selbst dem Zoom an
      p.tl?.cancel();
      p.text.innerHTML = '';
      const tl = p.tl = new pdfjs.TextLayer({ textContentSource: tc, container: p.text, viewport: p.page.getViewport({ scale: zoom }) });
      await tl.render();
      const end = document.createElement('div');
      end.className = 'endOfContent';
      p.text.append(end);
    } catch { /* kein Text */ }
  }

  // ── Text im Dokument (pdf.js-Text oder Texterkennung) ─────────
  textContent(p) {
    return p.tc ??= p.page.getTextContent({ includeMarkedContent: true, disableNormalization: true }).catch(e => { p.tc = null; throw e; });
  }

  // Kleiner Hinweis im Kopf ("Text wird erkannt …"), erst nach kurzer Zeit sichtbar (Zwischenspeicher ist sofort da)
  status(text, title = '') {
    clearTimeout(this.statusTimer);
    this.statusEl.textContent = text; this.statusEl.title = title;
    this.statusEl.hidden = !text;
  }
  async track(promise) {
    const seq = this.openSeq;
    if (!this.ocrBusy++) this.busyTimer = setTimeout(() => { if (this.ocrBusy && seq === this.openSeq) this.status('Text wird erkannt …'); }, 300);
    try { return await promise; } catch (e) {
      if (seq === this.openSeq) { this.status('Keine Texterkennung', e.message); this.statusTimer = setTimeout(() => this.status(''), 5000); }
      throw e;
    } finally {
      if (seq === this.openSeq && !--this.ocrBusy) {
        clearTimeout(this.busyTimer);
        if (this.statusEl.textContent === 'Text wird erkannt …') this.status('');
      }
    }
  }

  // Erkannter Text einer Seite: Zwischenspeicher, sonst (PDF) Seite scharf zeichnen und erkennen lassen
  pageOcr(p) {
    const path = this.path;
    p.ocrP ??= (async () => {
      if (this.kind === 'image') return fetchOcr(path);
      const hit = await fetchOcr(path, p.index + 1);
      if (!hit.missing) return hit;
      // Nacheinander zeichnen (Speicher), der Server erkennt höchstens 2 gleichzeitig
      const job = async () => postOcr(path, p.index + 1, await this.pagePng(p));
      const run = (this.ocrChain || Promise.resolve()).then(job, job);
      this.ocrChain = run.catch(() => {});
      return run;
    })().catch(e => { p.ocrP = null; throw e; });
    return p.ocrP;
  }

  async pagePng(p) {
    // ~2200 px breit (mind. 2×, höchstens 4×) – gut lesbar für die Texterkennung
    const scale = Math.min(4, Math.max(2, 2200 / p.w), Math.sqrt(MAX_PIXELS / (p.w * p.h)));
    const vp = p.page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    return blob;
  }

  showOcr(p) {
    if (p.ocrShown) return;
    p.ocrShown = true;
    this.track(this.pageOcr(p)).then(r => { if (p.el.isConnected) buildOcrLayer(p.text, r, p.w); }, () => { p.ocrShown = false; });
  }

  // Ganzer Text des Dokuments (Seiten mit Trennzeile), erkennt fehlende Seiten bei Bedarf
  async allText() {
    const seq = this.openSeq, out = [];
    for (const p of this.pages || []) {
      const ocr = () => this.track(this.pageOcr(p)).then(ocrText, () => '');   // Fehler: Seite ohne Text
      let t;
      if (this.kind === 'pdf') { const tc = await this.textContent(p); t = isScan(tc) ? await ocr() : tcText(tc); }
      else t = await ocr();
      if (seq !== this.openSeq) return null;
      out.push(t.trim());
    }
    return out.length === 1 ? out[0] : out.map((t, i) => `— Seite ${i + 1} —\n${t}`).join('\n\n');
  }
  async copyAllText() {
    try {
      const t = await this.allText();
      if (t == null) return;
      if (!t.trim()) { this.toast('Kein Text gefunden'); return; }
      await navigator.clipboard.writeText(t);
      this.toast(`Text kopiert (${t.length} Zeichen)`);
    } catch (e) { this.toast('Text kopieren fehlgeschlagen: ' + e.message, true); }
  }

  // ── Anmerkungen zeichnen (SVG) ────────────────────────────────
  drawItems(p) {
    p.svg.innerHTML = '';
    for (const it of this.items.filter(i => i.page === p.index && !i._editing)) p.svg.append(this.itemEl(it));
  }

  itemEl(it) {
    const g = document.createElementNS(SVGNS, 'g');
    g.dataset.id = it.id;
    if (this.selected === it.id) g.classList.add('sel');
    const add = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); g.append(e); return e; };
    const pathD = pts => pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
    if (it.type === 'pen' || it.type === 'hl') {
      const d = pathD(it.pts.length === 1 ? [it.pts[0], [it.pts[0][0] + 0.1, it.pts[0][1]]] : it.pts);
      add('path', { d, class: 'hit', 'stroke-width': Math.max(it.width, 10 * this.unit) });
      add('path', { d, fill: 'none', stroke: it.color, 'stroke-width': it.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...(it.type === 'hl' ? { opacity: 0.4, style: 'mix-blend-mode:multiply' } : {}) });
    } else if (it.type === 'arrow') {
      const d = arrowPath(it);
      add('path', { d, class: 'hit', 'stroke-width': Math.max(it.width, 10 * this.unit) });
      add('path', { d, fill: 'none', stroke: it.color, 'stroke-width': it.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    } else if (it.type === 'rect' || it.type === 'cover') {
      const r = normRect(it);
      if (it.type === 'cover') add('rect', { ...r, fill: '#ffffff', stroke: this.tool === 'select' || this.tool === 'eraser' || this.tool === 'cover' ? '#adb5bd' : 'none', 'stroke-dasharray': '3 3', 'stroke-width': 0.5 * this.unit });
      else { add('rect', { ...r, class: 'hit', fill: 'none', 'stroke-width': Math.max(it.width, 10 * this.unit) }); add('rect', { ...r, fill: 'none', stroke: it.color, 'stroke-width': it.width }); }
    } else if (it.type === 'text' || it.type === 'note') {
      let x = it.x, y = it.y, lines = (it.text || '').split('\n');
      if (it.type === 'note') {
        const b = noteBox(it);
        add('rect', { x: it.x, y: it.y, width: b.w, height: b.h, rx: 2 * this.unit, fill: '#fff3bf', stroke: '#f2c94c', 'stroke-width': 0.8 * this.unit });
        x += b.pad; y += b.pad;
      } else {
        const w = Math.max(it.size, ...lines.map(l => textWidth(l, it.size)));
        add('rect', { x: it.x - 2, y: it.y - 2, width: w + 4, height: lines.length * it.size * LINE_H + 4, class: 'hitbox' });
      }
      const tx = add('text', { 'font-size': it.size, fill: it.type === 'note' ? '#212529' : it.color, 'font-family': FONT_CSS });
      lines.forEach((l, i) => {
        const ts = document.createElementNS(SVGNS, 'tspan');
        ts.setAttribute('x', x);
        ts.setAttribute('y', y + it.size * 0.8 + i * it.size * LINE_H);
        ts.textContent = l || ' ';
        tx.append(ts);
      });
    }
    return g;
  }

  redraw(pageIdx) {
    for (const p of this.pages) if (pageIdx == null || p.index === pageIdx) this.drawItems(p);
  }

  // ── Eingabe auf einer Seite ───────────────────────────────────
  pt(p, e) {
    const r = p.el.getBoundingClientRect();
    return [(e.clientX - r.left) / this.zoom, (e.clientY - r.top) / this.zoom];
  }

  bindPage(p) {
    const svg = p.svg;
    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.readOnly) return;
      // Erster Klick neben ein offenes Textfeld beendet nur die Eingabe
      if (this.editing) { e.preventDefault(); this.editing.commit(); return; }
      const target = e.target.closest('[data-id]');
      const it = target && this.items.find(i => i.id === target.dataset.id);
      const start = this.pt(p, e);
      const tool = this.tool;

      // Radierer: ein Zug = ein Schritt zum Rückgängigmachen
      if (tool === 'eraser') { e.preventDefault(); this.eraseSnap = clone(this.items); if (it) this.removeItem(it.id); return; }

      if (tool === 'select' || ((tool === 'text' || tool === 'note') && it && (it.type === tool))) {
        if (!it) return;
        e.preventDefault(); e.stopPropagation();
        this.select(it.id);
        const orig = clone(it); let moved = false;
        svg.setPointerCapture(e.pointerId);
        const move = ev => {
          const q = this.pt(p, ev), dx = q[0] - start[0], dy = q[1] - start[1];
          if (!moved && Math.hypot(dx, dy) * this.zoom < 3) return;
          if (!moved) { this.pushUndo(); moved = true; }
          moveItem(it, orig, dx, dy);
          this.redraw(p.index);
        };
        const up = () => {
          svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up);
          if (moved) this.changed();
          else if ((it.type === 'text' || it.type === 'note') && tool !== 'select') this.editText(p, it);
        };
        svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up);
        return;
      }

      e.preventDefault();
      if (tool === 'text' || tool === 'note') {
        const item = { id: uid(), type: tool, page: p.index, x: start[0], y: start[1] - (tool === 'text' ? this.sizeFor(tool) * 0.6 : 0), text: '', size: this.sizeFor(tool), color: this.color };
        this.editText(p, item, true);
        return;
      }

      svg.setPointerCapture(e.pointerId);
      const item = { id: uid(), type: tool, page: p.index, color: tool === 'hl' ? this.hlColor : this.color, width: this.sizeFor(tool) };
      if (tool === 'pen' || tool === 'hl') item.pts = [start];
      else { item.x1 = item.x = start[0]; item.y1 = item.y = start[1]; item.x2 = start[0]; item.y2 = start[1]; item.w = 0; item.h = 0; }
      let el = null;
      const move = ev => {
        const q = this.pt(p, ev);
        if (item.pts) {
          const last = item.pts[item.pts.length - 1];
          if (Math.hypot(q[0] - last[0], q[1] - last[1]) * this.zoom < 1.5) return;
          // Marker: gerade Linie, wenn Shift gedrückt
          if (tool === 'hl' && ev.shiftKey) item.pts = [item.pts[0], [q[0], item.pts[0][1]]];
          else item.pts.push(q);
        } else { item.x2 = q[0]; item.y2 = q[1]; item.w = q[0] - item.x; item.h = q[1] - item.y; }
        const n = this.itemEl(item);
        el ? el.replaceWith(n) : svg.append(n);
        el = n;
      };
      const up = () => {
        svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up);
        el?.remove();
        const tiny = item.pts ? false : Math.hypot(item.x2 - item.x1, item.y2 - item.y1) * this.zoom < 4;
        if (tiny) return;
        if (item.pts) item.pts = simplify(item.pts, 0.4 / this.zoom);
        this.pushUndo();
        this.items.push(item);
        this.changed();
        this.redraw(p.index);
      };
      svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up);
    });
    svg.addEventListener('pointermove', e => {
      if (this.tool !== 'eraser' || !this.eraseSnap || !(e.buttons & 1)) return;
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]');
      if (t) this.removeItem(t.dataset.id);
    });
    // Doppelklick (Auswählen) auf Text oder Zettel: bearbeiten
    svg.addEventListener('dblclick', e => {
      if (this.readOnly || this.editing) return;
      // Wegen setPointerCapture ist das Ziel oft das SVG selbst → Element unter dem Zeiger suchen
      const t = e.target.closest('[data-id]') || document.elementsFromPoint(e.clientX, e.clientY).find(el => el.closest?.('[data-id]'))?.closest('[data-id]');
      const it = t && this.items.find(i => i.id === t.dataset.id);
      if (it && (it.type === 'text' || it.type === 'note')) this.editText(p, it);
    });
  }

  endErase() {
    if (!this.eraseSnap) return;
    if (this.eraseSnap.length !== this.items.length) { this.undoStack.push(this.eraseSnap); this.redoStack = []; this.changed(); }
    this.eraseSnap = null;
  }

  // Textfeld direkt auf der Seite. Fertig mit Klick daneben, Esc oder ⌘Enter (leer = nichts)
  editText(p, it, isNew = false) {
    this.editing?.commit();
    const draft = { ...it };   // Farbe und Größe können sich während der Eingabe ändern
    const ta = document.createElement('textarea');
    ta.className = `inline-text ${it.type}`;
    ta.value = it.text;
    ta.spellcheck = true;
    ta.lang = 'de';
    p.el.append(ta);
    const orig = isNew ? null : this.items.find(i => i.id === it.id);
    if (orig) { orig._editing = true; p.svg.querySelector(`[data-id="${it.id}"]`)?.remove(); }
    const fit = () => {
      const z = this.zoom, d = draft;
      const pad = d.type === 'note' ? d.size * 0.6 : 0;
      ta.style.left = `${d.x * z}px`; ta.style.top = `${d.y * z}px`;
      ta.style.fontSize = `${d.size * z}px`;
      ta.style.lineHeight = String(LINE_H);
      ta.style.padding = `${pad * z}px`;
      ta.style.color = d.type === 'note' ? '#212529' : d.color;
      const lines = ta.value.split('\n');
      const w = Math.max(d.size * (d.type === 'note' ? 8 : 4), ...lines.map(l => textWidth(l + 'm', d.size)));
      ta.style.width = `${(w + 2 * pad) * z + 4}px`;
      ta.style.height = `${(lines.length * d.size * LINE_H + 2 * pad) * z + 4}px`;
    };
    fit();
    ta.addEventListener('input', fit);
    let done = false;
    const commit = (refocus = true) => {
      if (done) return; done = true;
      this.editing = null;
      ta.remove();
      const text = ta.value.replace(/\s+$/, '');
      if (orig) delete orig._editing;
      const styled = draft.color !== it.color || draft.size !== it.size;
      if (isNew ? text : (text !== it.text || (text && styled))) {
        this.pushUndo();
        if (!text) this.items = this.items.filter(i => i.id !== it.id);
        else if (isNew) this.items.push({ ...draft, text });
        else Object.assign(orig, { text, color: draft.color, size: draft.size });
        this.changed();
      }
      if (this.tool !== 'select') this.select(null);
      this.redraw(p.index);
      this.renderTools();
      if (refocus) this.scrollEl.focus({ preventScroll: true });
    };
    ta.addEventListener('blur', () => commit(false));
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commit(); }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); this.save(); }
    });
    this.editing = { commit, reposition: fit, item: draft, restyle: patch => { Object.assign(draft, patch); fit(); ta.focus({ preventScroll: true }); } };
    this.renderTools();
    ta.focus({ preventScroll: true });
    requestAnimationFrame(() => { if (!done) ta.focus({ preventScroll: true }); });
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    for (const p of this.pages || []) p.svg.querySelectorAll('[data-id]').forEach(g => g.classList.toggle('sel', g.dataset.id === id));
    this.renderTools();
  }

  restyleSelected(patch) {
    const it = this.items.find(i => i.id === this.selected);
    if (!it || it.type === 'cover' || it.type === 'note') return;
    this.pushUndo(); Object.assign(it, patch); this.changed(); this.redraw(it.page);
  }
  resizeSelected() {
    const it = this.items.find(i => i.id === this.selected);
    if (!it || !SIZES[it.type]) return;
    this.pushUndo();
    if (it.type === 'text' || it.type === 'note') it.size = this.sizeFor(it.type); else it.width = this.sizeFor(it.type);
    this.changed(); this.redraw(it.page);
  }

  // Entfernen ohne eigenen Rückgängig-Schritt (Radierer sammelt einen Zug)
  removeItem(id) {
    const it = this.items.find(i => i.id === id);
    if (!it) return null;
    this.items = this.items.filter(i => i.id !== id);
    if (this.selected === id) this.select(null);
    this.redraw(it.page);
    return it;
  }
  deleteItem(id) {
    if (!this.items.some(i => i.id === id)) return;
    this.pushUndo();
    this.removeItem(id);
    this.changed();
  }

  onKey(e) {
    if (/^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { e.preventDefault(); this.deleteItem(this.selected); }
    else if (e.key === 'Escape') this.select(null);
  }

  // ── Rückgängig ────────────────────────────────────────────────
  pushUndo() { this.undoStack.push(clone(this.items)); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = []; }
  undo() { this.editing?.commit(); if (!this.undoStack.length) return; this.redoStack.push(clone(this.items)); this.items = this.undoStack.pop(); this.select(null); this.changed(); this.redraw(); }
  redo() { this.editing?.commit(); if (!this.redoStack.length) return; this.undoStack.push(clone(this.items)); this.items = this.redoStack.pop(); this.select(null); this.changed(); this.redraw(); }

  // Ungespeichert = anders als der zuletzt gespeicherte Stand (Rückgängig bis dahin = wieder sauber)
  changed() { this.setDirty(snap(this.items) !== this.savedSnap); }
  setDirty(d) { this.dirty = d; this.root.classList.toggle('dirty', d); this.onState({ dirty: d }); }

  // ── Speichern ─────────────────────────────────────────────────
  async save() {
    if (!this.path || this.readOnly) { if (this.readOnly) this.toast('GIF-Bilder können nicht bearbeitet werden'); return false; }
    this.editing?.commit();
    if (!this.dirty) { this.toast('Keine Änderungen'); return true; }
    try {
      this.toast('Speichert …');
      const saved = snap(this.items);
      const bytes = this.kind === 'pdf' ? await this.exportPdf() : await this.exportImage();
      const res = await api.saveDoc(this.path, toBase64(bytes), this.items);
      this.base = res.base;
      this.hasBackup = true;
      this.savedSnap = saved;
      this.changed();
      this.toast('Gespeichert ✓ (Original liegt in _Original)');
      return true;
    } catch (err) {
      console.error(err);
      this.toast('Speichern fehlgeschlagen: ' + err.message, true);
      return false;
    }
  }

  async exportPdf() {
    const src = await (await fetch(rawUrl(this.base))).arrayBuffer();
    const doc = await PDFDocument.load(src, { ignoreEncryption: true });
    const font = await embedTextFont(doc, await textFontBytes());
    const pages = doc.getPages();
    for (const it of this.items) {
      const pg = pages[it.page], info = this.pages[it.page];
      if (!pg || !info) continue;
      const P = (x, y) => info.vp.convertToPdfPoint(x, y);
      const svgD = pts => pts.map((q, i) => { const [x, y] = P(q[0], q[1]); return `${i ? 'L' : 'M'}${x.toFixed(2)} ${(-y).toFixed(2)}`; }).join(' ');
      const rot = degrees(info.vp.rotation || 0);
      const stroke = (d, color, width, extra = {}) => pg.drawSvgPath(d, { x: 0, y: 0, borderColor: hexRgb(color), borderWidth: width, borderLineCap: LineCapStyle.Round, ...extra });
      const rectPts = r => [[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height], [r.x, r.y]];
      if (it.type === 'pen') stroke(svgD(it.pts.length > 1 ? it.pts : [it.pts[0], [it.pts[0][0] + 0.1, it.pts[0][1]]]), it.color, it.width);
      else if (it.type === 'hl') stroke(svgD(it.pts.length > 1 ? it.pts : [it.pts[0], [it.pts[0][0] + 0.1, it.pts[0][1]]]), it.color, it.width, { borderOpacity: 0.4, blendMode: BlendMode.Multiply });
      else if (it.type === 'arrow') arrowSegments(it).forEach(seg => stroke(svgD(seg), it.color, it.width));
      else if (it.type === 'rect') stroke(svgD(rectPts(normRect(it))) + ' Z', it.color, it.width);
      else if (it.type === 'cover') pg.drawSvgPath(svgD(rectPts(normRect(it))) + ' Z', { x: 0, y: 0, color: rgb(1, 1, 1) });
      else if (it.type === 'text' || it.type === 'note') {
        let x = it.x, y = it.y;
        if (it.type === 'note') {
          const b = noteBox(it);
          pg.drawSvgPath(svgD(rectPts({ x: it.x, y: it.y, width: b.w, height: b.h })) + ' Z', { x: 0, y: 0, color: hexRgb('#fff3bf'), borderColor: hexRgb('#f2c94c'), borderWidth: 0.8 });
          x += b.pad; y += b.pad;
        }
        it.text.split('\n').forEach((line, i) => {
          if (!line) return;
          const [px, py] = P(x, y + it.size * 0.8 + i * it.size * LINE_H);
          pg.drawText(pdfSafe(line, font), { x: px, y: py, size: it.size, font, color: hexRgb(it.type === 'note' ? '#212529' : it.color), rotate: rot });
        });
      }
    }
    return doc.save();
  }

  async exportImage() {
    const { w, h } = this.pages[0];
    const img = new Image();
    img.src = rawUrl(this.base);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    for (const it of this.items) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const poly = pts => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); };
      if (it.type === 'pen' || it.type === 'hl') {
        if (it.type === 'hl') { ctx.globalAlpha = 0.4; ctx.globalCompositeOperation = 'multiply'; }
        poly(it.pts.length > 1 ? it.pts : [it.pts[0], [it.pts[0][0] + 0.1, it.pts[0][1]]]);
        ctx.strokeStyle = it.color; ctx.lineWidth = it.width; ctx.stroke();
      } else if (it.type === 'arrow') {
        ctx.strokeStyle = it.color; ctx.lineWidth = it.width;
        arrowSegments(it).forEach(seg => { poly(seg); ctx.stroke(); });
      } else if (it.type === 'rect') {
        const r = normRect(it); ctx.strokeStyle = it.color; ctx.lineWidth = it.width; ctx.strokeRect(r.x, r.y, r.width, r.height);
      } else if (it.type === 'cover') {
        const r = normRect(it); ctx.fillStyle = '#fff'; ctx.fillRect(r.x, r.y, r.width, r.height);
      } else if (it.type === 'text' || it.type === 'note') {
        let x = it.x, y = it.y;
        if (it.type === 'note') {
          const b = noteBox(it);
          ctx.fillStyle = '#fff3bf'; ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = 0.8 * this.unit;
          ctx.fillRect(it.x, it.y, b.w, b.h); ctx.strokeRect(it.x, it.y, b.w, b.h);
          x += b.pad; y += b.pad;
        }
        ctx.fillStyle = it.type === 'note' ? '#212529' : it.color;
        ctx.font = `${it.size}px ${FONT_CSS}`;
        it.text.split('\n').forEach((l, i) => ctx.fillText(l, x, y + it.size * 0.8 + i * it.size * LINE_H));
      }
      ctx.restore();
    }
    const type = /\.png$/i.test(this.path) ? 'image/png' : /\.webp$/i.test(this.path) ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise(r => c.toBlob(r, type, 0.92));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async restoreOriginal() {
    if (!this.hasBackup) { this.toast('Es gibt noch kein gesichertes Original'); return; }
    const ok = await this.ask({ title: 'Original wiederherstellen?', text: 'Alle Anmerkungen in diesem Dokument werden entfernt. Die Anmerkungs-Datei geht in den Papierkorb.', buttons: [{ id: 'yes', label: 'Wiederherstellen', danger: true }, { id: 'no', label: 'Abbrechen' }] });
    if (ok !== 'yes') return;
    await api.restoreDoc(this.path);
    this.setDirty(false);
    await this.open(this.path);
    this.toast('Original wiederhergestellt');
  }
}

// ── Geometrie ───────────────────────────────────────────────────
function normRect(it) {
  return { x: Math.min(it.x, it.x + it.w), y: Math.min(it.y, it.y + it.h), width: Math.abs(it.w), height: Math.abs(it.h) };
}
function arrowSegments(it) {
  const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1), L = Math.max(8, it.width * 4);
  const head = s => [it.x2 - L * Math.cos(a + s), it.y2 - L * Math.sin(a + s)];
  return [[[it.x1, it.y1], [it.x2, it.y2]], [head(0.45), [it.x2, it.y2], head(-0.45)]];
}
function arrowPath(it) {
  return arrowSegments(it).map(seg => seg.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ')).join(' ');
}
function moveItem(it, o, dx, dy) {
  if (it.pts) it.pts = o.pts.map(q => [q[0] + dx, q[1] + dy]);
  if ('x' in o) { it.x = o.x + dx; it.y = o.y + dy; }
  if ('x1' in o) { it.x1 = o.x1 + dx; it.y1 = o.y1 + dy; it.x2 = o.x2 + dx; it.y2 = o.y2 + dy; }
}
// Punkte einer Linie ausdünnen (Ramer-Douglas-Peucker)
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
