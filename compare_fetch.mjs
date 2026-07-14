// Obtiene el texto bíblico real de los versículos referenciados en cada escena
// del guion (script_data.json) y lo guarda junto al texto del guion para
// poder compararlos después (compare_bible.py).
import { chromium } from 'playwright';
import fs from 'node:fs';
import { newContext, scrapeChapter, expandRef } from './extract.js';

// Convierte un id BBCCCVVV en {book, chapter, verse}
function parseId(id) {
  const n = String(id).replace(/\D/g, '');
  return {
    book: parseInt(n.slice(0, 2), 10),
    chapter: parseInt(n.slice(2, 5), 10),
    verse: parseInt(n.slice(5, 8), 10),
  };
}

function slugFromHref(href) {
  if (!href) return null;
  const m = href.match(/\/libros\/([^/#?]+)/);
  return m ? m[1] : null;
}

// Texto de un rango de versículos de un único ref (posible multi-capítulo).
async function fetchRefText(page, slug, tv, cache) {
  const parts = String(tv).split('-');
  const start = parseId(parts[0]);
  const end = parts[1] ? parseId(parts[1]) : { ...start };
  const units = expandRef({ start, end });
  const verses = [];
  for (const u of units) {
    const key = `${slug}|${u.chapter}`;
    if (!cache.has(key)) {
      console.log(`    Descargando ${slug} ${u.chapter}...`);
      cache.set(key, await scrapeChapter(page, slug, u.chapter));
    }
    const chapVerses = cache.get(key);
    const nums = Object.keys(chapVerses).map(Number).sort((a, b) => a - b);
    for (const n of nums) {
      if (n >= u.from && n <= u.to) verses.push({ chapter: u.chapter, num: n, text: chapVerses[n] });
    }
  }
  return verses;
}

async function main() {
  const data = JSON.parse(fs.readFileSync('script_data.json', 'utf8'));
  const browser = await chromium.launch();
  const context = await newContext(browser);
  const page = await context.newPage();
  const cache = new Map();

  const out = [];
  for (const movie of data) {
    console.log(`\n== Episodio ${movie.episode}: ${movie.title} ==`);
    const scenesOut = [];
    for (const scene of movie.scenes) {
      const refsOut = [];
      for (const ref of scene.refs || []) {
        const slug = slugFromHref(ref.href);
        if (!slug || !ref.tv) { refsOut.push({ label: ref.label, verses: [] }); continue; }
        const verses = await fetchRefText(page, slug, ref.tv, cache);
        refsOut.push({ label: ref.label, verses });
      }
      const bibleText = refsOut
        .flatMap(r => r.verses.map(v => v.text))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const scriptText = (scene.paragraphs || []).join(' ').replace(/\s+/g, ' ').trim();
      scenesOut.push({
        description: scene.description,
        references: scene.references,
        refs: refsOut,
        bibleText,
        scriptText,
      });
    }
    out.push({
      episode: movie.episode,
      day: movie.day || null,
      title: movie.title,
      series: movie.series,
      scenes: scenesOut,
    });
  }

  await browser.close();
  fs.writeFileSync('bible_scenes.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('\n✔ Texto bíblico por escena guardado en bible_scenes.json');
}

main().catch(err => { console.error(err); process.exit(1); });
