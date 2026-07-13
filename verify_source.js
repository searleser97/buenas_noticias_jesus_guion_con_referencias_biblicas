import fs from 'node:fs';
import { chromium } from 'playwright';
import { buildMovies, newContext } from './extract.js';

// Verifica que data.json coincida EXACTAMENTE (palabras y orden) con una
// re-extracción en vivo desde jw.org.

const saved = JSON.parse(fs.readFileSync('data.json', 'utf8'));

const browser = await chromium.launch();
const context = await newContext(browser);
const page = await context.newPage();
console.log('Re-extrayendo en vivo desde jw.org para comparar...');
const fresh = await buildMovies(page);
await browser.close();

let problems = 0;
const norm = (s) => s.normalize('NFC');

function fail(msg) { problems++; console.log('  ✗ ' + msg); }

if (saved.length !== fresh.length) fail(`Número de películas: guardado ${saved.length} vs vivo ${fresh.length}`);

for (let m = 0; m < Math.min(saved.length, fresh.length); m++) {
  const a = saved[m], b = fresh[m];
  console.log(`\n== ${b.day} — ${b.series} ==`);
  if (a.series !== b.series) fail(`Serie/episodio difiere: "${a.series}" vs "${b.series}"`);
  if (a.title !== b.title) fail(`Subtítulo difiere: "${a.title}" vs "${b.title}"`);
  if (a.references.length !== b.references.length) fail(`Número de referencias: ${a.references.length} vs ${b.references.length}`);

  for (let r = 0; r < Math.min(a.references.length, b.references.length); r++) {
    const ra = a.references[r], rb = b.references[r];
    if (ra.heading !== rb.heading) fail(`Ref ${r}: encabezado "${ra.heading}" vs "${rb.heading}"`);
    if (ra.verses.length !== rb.verses.length) {
      fail(`Ref "${rb.heading}": nº versículos ${ra.verses.length} vs ${rb.verses.length}`);
    }
    const n = Math.min(ra.verses.length, rb.verses.length);
    let refOk = true;
    for (let v = 0; v < n; v++) {
      const va = ra.verses[v], vb = rb.verses[v];
      // Verifica ORDEN (capítulo y número en la misma posición)
      if (va.chapter !== vb.chapter || va.num !== vb.num) {
        fail(`Ref "${rb.heading}" pos ${v}: orden ${va.chapter}:${va.num} vs ${vb.chapter}:${vb.num}`);
        refOk = false;
      }
      // Verifica PALABRAS exactas
      if (norm(va.text) !== norm(vb.text)) {
        refOk = false;
        fail(`Ref "${rb.heading}" ${vb.chapter}:${vb.num}: texto difiere`);
        console.log(`      guardado: ${JSON.stringify(va.text)}`);
        console.log(`      vivo:     ${JSON.stringify(vb.text)}`);
      }
    }
    if (refOk && ra.verses.length === rb.verses.length) {
      console.log(`  ✓ ${rb.heading} (${n} versículos coinciden)`);
    }
  }
}

console.log('\n' + '='.repeat(50));
if (problems === 0) {
  console.log('✔ VERIFICACIÓN A (fuente): data.json coincide EXACTAMENTE con jw.org en vivo.');
} else {
  console.log(`✗ VERIFICACIÓN A: ${problems} discrepancia(s) encontradas.`);
  process.exit(1);
}
