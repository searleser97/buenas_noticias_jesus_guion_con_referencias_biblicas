// Helpers de scraping de jw.org reutilizados por el pipeline de guion
// (compare_fetch.mjs, fetch_corpus.mjs, extract_scripts.mjs): crear el contexto
// del navegador, descargar el texto de un capítulo de la Biblia y expandir un
// rango de versículos que puede cruzar capítulos.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function newContext(browser) {
  return browser.newContext({
    userAgent: UA,
    locale: 'es-ES',
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
  });
}

// Descarga y limpia todos los versículos de un capítulo. Devuelve { numVerso: texto }
async function scrapeChapter(page, slug, chapter) {
  const url = `https://www.jw.org/es/biblioteca/biblia/biblia-estudio/libros/${encodeURIComponent(slug)}/${chapter}/`;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('span.verse', { timeout: 30000 });
      await page.waitForTimeout(800);
      break;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(`    reintento ${attempt}/${maxAttempts - 1} (${slug} ${chapter}): ${err.name}`);
      await page.waitForTimeout(2000 * attempt);
    }
  }
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

export { newContext, scrapeChapter, expandRef };
