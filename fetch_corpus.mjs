// Descarga (y cachea) los 4 Evangelios completos y genera bible_corpus.json,
// un índice de todos sus versículos para poder localizar en la Biblia el
// origen de CUALQUIER frase que diga la película, aunque la Guía de videos no
// liste ese versículo en ninguna escena.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { newContext, scrapeChapter } from './extract.js';

// slug de jw.org -> [abreviatura, número de capítulos]
const GOSPELS = {
  mateo: ['Mt', 28],
  marcos: ['Mr', 16],
  lucas: ['Lu', 24],
  juan: ['Jn', 21],
};

const CACHE_FILE = 'bible_chapters.json';
const CORPUS_FILE = 'bible_corpus.json';

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
  const cache = loadCache();
  const size0 = cache.size;
  console.log(`Caché de capítulos: ${size0} en disco (${CACHE_FILE}).`);

  let browser = null, page = null;
  async function ensurePage() {
    if (page) return page;
    console.log('Lanzando navegador (hay capítulos que descargar)...');
    browser = await chromium.launch();
    const context = await newContext(browser);
    page = await context.newPage();
    return page;
  }

  const corpus = [];
  for (const [slug, [abbrev, nChapters]] of Object.entries(GOSPELS)) {
    for (let ch = 1; ch <= nChapters; ch++) {
      const key = `${slug}|${ch}`;
      if (!cache.has(key)) {
        console.log(`  Descargando ${slug} ${ch}...`);
        const p = await ensurePage();
        cache.set(key, await scrapeChapter(p, slug, ch));
      }
      const verses = cache.get(key);
      for (const num of Object.keys(verses).map(Number).sort((a, b) => a - b)) {
        corpus.push({ abbrev, chapter: ch, num, text: verses[num] });
      }
    }
  }

  if (browser) await browser.close();
  saveCache(cache);
  fs.writeFileSync(CORPUS_FILE, JSON.stringify(corpus), 'utf8');
  const fetched = cache.size - size0;
  console.log(`\n✔ Corpus de Evangelios guardado en ${CORPUS_FILE} (${corpus.length} versículos).`);
  console.log(fetched > 0
    ? `  (${fetched} capítulos nuevos descargados; caché total: ${cache.size})`
    : `  (sin descargas: todo provino del caché en disco)`);
}

main().catch(err => { console.error(err); process.exit(1); });
