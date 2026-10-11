// Markdown → HTML für den Lesemodus, mit den farbigen Markierungen
import { marked } from 'marked';
import { resolve, rawUrl, isImage, fmtDate } from './api.js';
import { parseFront } from '../lib/lesson.js';

marked.setOptions({ gfm: true, breaks: true });

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Code-Blöcke erkennen wie marked: ``` oder ~~~ (auch in > Zitaten), Ende mit gleichem Zeichen und mindestens gleicher Länge.
// Gibt eine Funktion zurück: Zeile → true, wenn sie zu einem Code-Block gehört (inkl. Zaun-Zeilen)
export function fenceTracker() {
  let open = null;
  return line => {
    const m = line.match(/^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/);
    if (open) { if (m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) open = null; return true; }
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) { open = m[1]; return true; }
    return false;
  };
}

// Aufgabenzeile wie bei marked: "- [ ] Text", auch "1. [x] …", "1) …" und in "> - [ ] …"
export const TASK_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)( |x|X)\] +\S/;

// Nur Text außerhalb von `Code` verändern
const outsideCode = (line, fn) => line.split(/(`[^`]*`)/).map((part, i) => i % 2 ? part : fn(part)).join('');

// Vor dem Rendern: Zeilenmarker in Spans verpacken (außer in Code-Blöcken)
function preprocess(src) {
  const inFence = fenceTracker();
  return src.split('\n').map(line => {
    if (inFence(line)) return line;
    line = outsideCode(line, t => t.replace(/==([^=\n]+)==/g, '<mark>$1</mark>'));
    const m = line.match(/^(\s*(?:[-*+]\s+|\d+\.\s+|>\s*)?)(!!|EXAM:|TEST:|DEF:|\?\?)(.*)$/);
    if (m) {
      const cls = { '!!': 'imp', 'EXAM:': 'exam', 'TEST:': 'exam', 'DEF:': 'def', '??': 'ask' }[m[2]];
      const rest = outsideCode(m[3], t => t.replace(/!!([^!\n]+)!!/g, '<span class="red">$1</span>'));
      return `${m[1]}<span class="mk mk-${cls}"><span class="mk-tag">${esc(m[2])}</span>${rest}</span>`;
    }
    return outsideCode(line, t => t.replace(/!!([^!\n]+)!!/g, '<span class="red">$1</span>'));
  }).join('\n');
}

// Kopf (--- … ---) vom Text trennen – gemeinsam mit dem Server (lib/lesson.js)
export { parseFront };

// Kopf einer Stunde als kurze Teile: Datum · Zeit · Fach / Einheit · Lehrkraft · Raum
export const lessonBits = meta => [fmtDate(meta.datum), meta.zeit, [meta.fach, meta.einheit].filter(Boolean).join(' / '), meta.lehrkraft, meta.raum && `Raum ${meta.raum}`].filter(Boolean);

export function lessonCard(meta) {
  const bits = lessonBits(meta);
  return `<div class="lesson-card"><span class="lc-tag">Stunde</span>${bits.map(b => `<span>${esc(b)}</span>`).join('<span class="lc-dot">·</span>')}</div>`;
}

export function renderNote(src, noteDir) {
  const { meta, body } = parseFront(String(src ?? '').replace(/\r\n?/g, '\n'));   // Windows-Zeilenenden
  const html = (meta?.typ === 'stunde' ? lessonCard(meta) : '') + marked.parse(preprocess(body));
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll('script, iframe, object, embed').forEach(n => n.remove());
  box.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name)) n.removeAttribute(a.name); }));
  // Bilder und Links relativ zum Ordner der Notiz auflösen
  box.querySelectorAll('img').forEach(img => {
    const s = img.getAttribute('src') || '';
    if (!/^(https?:|data:)/.test(s)) img.src = rawUrl(resolve(noteDir, decodeURI(s)));
  });
  box.querySelectorAll('a').forEach(a => {
    const h = a.getAttribute('href') || '';
    if (/^https?:/.test(h)) { a.target = '_blank'; a.rel = 'noopener'; a.classList.add('ext'); }
    else if (h && !h.startsWith('#')) {
      a.dataset.local = resolve(noteDir, decodeURI(h));
      a.classList.add(isImage(h) ? 'img-link' : /\.pdf$/i.test(h) ? 'pdf-link' : 'note-link');
    }
  });
  // Aufgaben-Kästchen klickbar machen (n-tes Kästchen ↔ n-te Aufgabenzeile)
  box.querySelectorAll('input[type=checkbox]').forEach((cb, i) => { cb.disabled = false; cb.dataset.task = i; });
  return box;
}

// Zeilennummern (0-basiert) aller Aufgaben, in derselben Reihenfolge wie im HTML
export function taskLines(src) {
  const out = [], inFence = fenceTracker();
  src.split(/\r?\n/).forEach((l, i) => { if (!inFence(l) && TASK_RE.test(l)) out.push(i); });
  return out;
}
