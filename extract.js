import { chromium } from 'playwright';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BOOK_NAMES } from './books.js';

const BASE = 'https://www.jw.org/es/biblioteca/programas/programa-asamblea-regional-2026';
const DAYS = [
  { slug: 'viernes', label: 'Viernes' },
  { slug: 'sabado', label: 'Sábado' },
  { slug: 'domingo', label: 'Domingo' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function newContext(browser) {
  return browser.newContext({
    userAgent: UA,
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  });
}

// Convierte un id BBCCCVVV en {book, chapter, verse}
function parseId(id) {
  const n = String(id).replace(/\D/g, '');
  return {
    book: parseInt(n.slice(0, 2), 10),
    chapter: parseInt(n.slice(2, 5), 10),
    verse: parseInt(n.slice(5, 8), 10),
  };
}

// Extrae de la página del día: título del episodio, subtítulo y la lista de referencias de la película.
async function scrapeDay(page, day) {
  const url = `${BASE}/${day.slug}/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const raw = await page.evaluate(() => {
    const article = document.querySelector('article') || document.body;
    const all = Array.from(article.querySelectorAll('*'));
    const audio = all.find(e => e.children.length === 0 && /PRODUCCIÓN AUDIOVISUAL/i.test(e.textContent));
    if (!audio) return null;
    // Subir hasta el <p> contenedor
    let p = audio;
    while (p && p.tagName !== 'P') p = p.parentElement;
    if (!p) return null;

    // Recorrer hermanos: acumular títulos hasta encontrar el <p> con enlaces bíblicos
    const titleParts = [];
    let sib = p.nextElementSibling;
    while (sib && !sib.querySelector('a.jsBibleLink')) {
      const t = sib.innerText.trim();
      if (t) titleParts.push(t);
      sib = sib.nextElementSibling;
    }
    const scriptureP = sib;
    if (!scriptureP) return null;

    // Subtítulo (texto antes del primer paréntesis)
    const fullText = scriptureP.innerText.trim();
    const subtitle = fullText.split('(')[0].trim().replace(/^[“"]|[”"]$/g, '').trim();

    const links = Array.from(scriptureP.querySelectorAll('a.jsBibleLink')).map(a => ({
      targetverses: a.getAttribute('data-targetverses') || '',
      href: a.getAttribute('href') || '',
      text: a.innerText.trim(),
    }));

    return { episodeTitle: titleParts.join(' '), subtitle, links };
  });

  if (!raw) throw new Error(`No se encontró la sección de película en ${day.slug}`);

  // Construir mapa numeroLibro -> slug de URL a partir de los href
  const slugByBook = {};
  const references = [];
  for (const link of raw.links) {
    const tv = link.targetverses;
    if (!tv) continue;
    const [startRaw, endRaw] = tv.includes('-') ? tv.split('-') : [tv, tv];
    const start = parseId(startRaw);
    const end = parseId(endRaw);

    // slug del libro desde el href: .../libros/<slug>/<cap>/
    const m = link.href.match(/\/libros\/([^/]+)\/(\d+)\//);
    if (m) slugByBook[start.book] = decodeURIComponent(m[1]);

    references.push({ start, end });
  }

  return {
    daySlug: day.slug,
    dayLabel: day.label,
    url,
    episodeTitle: raw.episodeTitle,
    subtitle: raw.subtitle,
    references,
    slugByBook,
  };
}

// Descarga y limpia todos los versículos de un capítulo. Devuelve { numVerso: texto }
async function scrapeChapter(page, slug, chapter) {
  const url = `https://www.jw.org/es/biblioteca/biblia/biblia-estudio/libros/${encodeURIComponent(slug)}/${chapter}/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const verses = {};
    document.querySelectorAll('span.verse').forEach(sp => {
      const id = sp.id;
      if (!/^v\d{6,}$/.test(id)) return;
      const num = parseInt(id.slice(-3), 10);
      const clone = sp.cloneNode(true);
      clone.querySelectorAll('sup, a, .chapterNum, .footnote, .parNum, .marker').forEach(e => e.remove());
      const text = clone.textContent.replace(/\s+/g, ' ').trim();
      if (text) verses[num] = text;
    });
    return verses;
  });
}

// Expande una referencia (posible multi-capítulo) en unidades {chapter, from, to}
function expandRef(ref) {
  const units = [];
  const { start, end } = ref;
  if (start.chapter === end.chapter) {
    units.push({ chapter: start.chapter, from: start.verse, to: end.verse });
  } else {
    units.push({ chapter: start.chapter, from: start.verse, to: Infinity });
    for (let c = start.chapter + 1; c < end.chapter; c++) {
      units.push({ chapter: c, from: 1, to: Infinity });
    }
    units.push({ chapter: end.chapter, from: 1, to: end.verse });
  }
  return units;
}

function refHeading(ref, bookName) {
  const { start, end } = ref;
  if (start.chapter === end.chapter) {
    if (start.verse === end.verse) return `${bookName} ${start.chapter}:${start.verse}`;
    return `${bookName} ${start.chapter}:${start.verse}-${end.verse}`;
  }
  return `${bookName} ${start.chapter}:${start.verse}-${end.chapter}:${end.verse}`;
}

async function buildMovies(page) {
  const chapterCache = new Map(); // key slug|chapter -> verses
  const movies = [];

  for (const day of DAYS) {
    console.log(`\n== Procesando ${day.label} ==`);
    const info = await scrapeDay(page, day);
    console.log(`  Episodio: ${info.episodeTitle}`);
    console.log(`  Subtítulo: ${info.subtitle}`);
    console.log(`  Referencias: ${info.references.length}`);

    const resolvedRefs = [];
    for (const ref of info.references) {
      const bookNum = ref.start.book;
      const slug = info.slugByBook[bookNum];
      const bookName = BOOK_NAMES[bookNum] || slug;
      const units = expandRef(ref);
      const verses = [];
      for (const u of units) {
        const key = `${slug}|${u.chapter}`;
        if (!chapterCache.has(key)) {
          console.log(`    Descargando ${slug} ${u.chapter}...`);
          chapterCache.set(key, await scrapeChapter(page, slug, u.chapter));
        }
        const chapVerses = chapterCache.get(key);
        const nums = Object.keys(chapVerses).map(Number).sort((a, b) => a - b);
        for (const n of nums) {
          if (n >= u.from && n <= u.to) {
            verses.push({ chapter: u.chapter, num: n, text: chapVerses[n] });
          }
        }
      }
      resolvedRefs.push({
        heading: refHeading(ref, bookName),
        book: bookName,
        multiChapter: ref.start.chapter !== ref.end.chapter,
        verses,
      });
    }

    movies.push({
      day: day.label,
      daySlug: day.slug,
      url: info.url,
      series: info.episodeTitle,
      title: info.subtitle,
      references: resolvedRefs,
    });
  }
  return movies;
}

async function main() {
  const browser = await chromium.launch();
  const context = await newContext(browser);
  const page = await context.newPage();
  const movies = await buildMovies(page);
  await browser.close();
  fs.writeFileSync('data.json', JSON.stringify(movies, null, 2), 'utf8');
  console.log('\n✔ Datos guardados en data.json');
}

export { buildMovies, newContext, scrapeDay, scrapeChapter, expandRef, refHeading, DAYS };

// Ejecutar main() solo si el script se corre directamente
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exit(1); });
}
