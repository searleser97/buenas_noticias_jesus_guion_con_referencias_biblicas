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
// `ensurePage` lanza el navegador solo si hace falta descargar algo (perezoso):
// si el capítulo ya está en el caché de disco, no se llama a jw.org.
async function fetchRefText(ensurePage, slug, tv, cache) {
  const parts = String(tv).split('-');
  const start = parseId(parts[0]);
  const end = parts[1] ? parseId(parts[1]) : { ...start };
  const units = expandRef({ start, end });
  const verses = [];
  for (const u of units) {
    const key = `${slug}|${u.chapter}`;
    if (!cache.has(key)) {
      console.log(`    Descargando ${slug} ${u.chapter}...`);
      const page = await ensurePage();
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

// Caché persistente de capítulos ({ "slug|capitulo": { num: texto } }) para
// respaldar el resultado del API y permitir corridas sin red.
const CACHE_FILE = 'bible_chapters.json';

function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))));
    } catch { /* caché corrupto: se regenera */ }
  }
  return new Map();
}

function saveCache(cache) {
  const obj = {};
  for (const [k, v] of [...cache.entries()].sort()) obj[k] = v;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 1), 'utf8');
}

async function main() {
  const data = JSON.parse(fs.readFileSync('script_data.json', 'utf8'));
  const cache = loadCache();
  const cacheSize0 = cache.size;
  console.log(`Caché de capítulos: ${cacheSize0} en disco (${CACHE_FILE}).`);

  let browser = null, page = null;
  async function ensurePage() {
    if (page) return page;
    console.log('Lanzando navegador (hay capítulos que descargar)...');
    browser = await chromium.launch();
    const context = await newContext(browser);
    page = await context.newPage();
    return page;
  }

  const out = [];
  for (const movie of data) {
    console.log(`\n== Episodio ${movie.episode}: ${movie.title} ==`);
    const scenesOut = [];
    for (const scene of movie.scenes) {
      const refsOut = [];
      for (const ref of scene.refs || []) {
        const slug = slugFromHref(ref.href);
        if (!slug || !ref.tv) { refsOut.push({ label: ref.label, verses: [] }); continue; }
        const verses = await fetchRefText(ensurePage, slug, ref.tv, cache);
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
        timeStart: scene.timeStart || null,
        timeEnd: scene.timeEnd || null,
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

  if (browser) await browser.close();
  saveCache(cache);
  fs.writeFileSync('bible_scenes.json', JSON.stringify(out, null, 2), 'utf8');
  const fetched = cache.size - cacheSize0;
  console.log(`\n✔ Texto bíblico por escena guardado en bible_scenes.json`);
  console.log(fetched > 0
    ? `  (${fetched} capítulos nuevos descargados; caché total: ${cache.size})`
    : `  (sin descargas: todo provino del caché en disco)`);
}

main().catch(err => { console.error(err); process.exit(1); });
