// Baut public/dist/app.js aus src/ (einmal nach Änderungen ausführen: npm run build)
// Pfade relativ zu dieser Datei → geht aus jedem Ordner heraus und auf Windows, macOS und Linux.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => path.join(HERE, ...p);

mkdirSync(at('public', 'dist'), { recursive: true });
copyFileSync(at('node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'), at('public', 'dist', 'pdf.worker.min.mjs'));
// Unicode-Schrift für den PDF-Export (Liberation Sans, SIL OFL – Lizenz liegt daneben)
for (const f of ['LiberationSans-Regular.ttf', 'LICENSE_LIBERATION']) copyFileSync(at('node_modules', 'pdfjs-dist', 'standard_fonts', f), at('public', 'dist', f));
await build({
  entryPoints: [at('src', 'main.js')],
  absWorkingDir: HERE,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  outfile: at('public', 'dist', 'app.js'),
  logLevel: 'warning',
});
console.log('Gebaut: public/dist/app.js');
