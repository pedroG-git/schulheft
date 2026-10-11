// Texterkennung (OCR): erkannter Text als unsichtbare, markierbare Ebene über Bildern und eingescannten PDF-Seiten
const FONT_CSS = 'Helvetica, Arial, sans-serif';
export const SCAN_MIN = 20;   // weniger Zeichen auf einer PDF-Seite = eingescannt (gleiche Grenze wie im Server)

async function call(url, body) {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'X-Schulheft': '1', 'Content-Type': 'image/png' }, body } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}
const q = encodeURIComponent;
// Bild: Server erkennt (oder liest aus dem Zwischenspeicher). PDF-Seite: nur Zwischenspeicher → { missing: true }
export const fetchOcr = (path, page) => call(`/api/ocr?p=${q(path)}${page ? `&page=${page}` : ''}`);
// Gezeichnete PDF-Seite erkennen lassen (wird unter Datei + Seite gemerkt)
export const postOcr = (path, page, blob) => call(`/api/ocr?p=${q(path)}&page=${page}`, blob);

// Text aus pdf.js-Textinhalt / OCR-Ergebnis
export const tcText = tc => tc.items.map(it => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('');
export const isScan = tc => tcText(tc).replace(/\s/g, '').length < SCAN_MIN;
export const ocrText = r => (r?.lines || []).map(l => l.text).join('\n');

let ctx;
function measure(s, size) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${size}px ${FONT_CSS}`;
  return ctx.measureText(s).width || 1;
}

// Ebene bauen wie die pdf.js-Textebene: Position in %, Schriftgröße über --font-height × Zoom (CSS),
// Breite über --scale-x auf das erkannte Wort gestreckt → passt bei jedem Zoom ohne Neuaufbau.
// pageW = Seitenbreite in Seiteneinheiten (PDF-Punkte bzw. Bildpixel); r.width/height = Pixel des erkannten Bildes.
export function buildOcrLayer(container, r, pageW) {
  container.innerHTML = '';
  container.classList.add('ocr');
  const unit = pageW / r.width, px = 100 / r.width, py = 100 / r.height;
  const frag = document.createDocumentFragment();
  for (const line of r.lines || []) {
    const words = line.words?.length ? line.words : [line];
    words.forEach((w, i) => {
      const next = words[i + 1];
      // Leerzeichen gehört zum Wort und füllt die Lücke bis zum nächsten → Kopieren ergibt "Wort Wort"
      const text = next ? w.text + ' ' : w.text;
      const width = (next ? Math.max(w.w, next.x - w.x) : w.w) * unit;
      const fh = Math.max(1, w.h * unit);
      const s = document.createElement('span');
      s.textContent = text;
      s.style.cssText = `left:${(w.x * px).toFixed(3)}%;top:${(w.y * py).toFixed(3)}%;font-family:${FONT_CSS};--font-height:${fh.toFixed(2)}px;--scale-x:${(width / measure(text, fh)).toFixed(4)}`;
      frag.append(s);
    });
    const br = document.createElement('br');
    br.setAttribute('role', 'presentation');
    frag.append(br);
  }
  const end = document.createElement('div');
  end.className = 'endOfContent';
  frag.append(end);
  container.append(frag);
}
