import { chromium } from 'playwright';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { newContext } from './extract.js';

// Serie "Las buenas noticias segun Jesus" (pub=gnj). El numero de episodio
// coincide con el numero de "track" en la API de medios.

const INDEX_URL = 'https://www.jw.org/es/biblioteca/%C3%ADndices/guia-videos-buenas-noticias-segun-jesus/';
const MEDIA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PUBMEDIA = 'https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json&pub=gnj&fileformat=mp4&alllangs=0&track=&langwritten=S&txtCMSLang=S';

const vttPath = (ep) => `vtt/ep${ep}.vtt`;

// Consulta la API de medios y devuelve un Map track -> URL del subtitulo VTT.
async function fetchSubtitleMap() {
  const res = await fetch(PUBMEDIA, { headers: { 'User-Agent': MEDIA_UA } });
  if (!res.ok) throw new Error(`API de medios respondio ${res.status}`);
  const j = await res.json();
  const files = j.files.S;
  const fmt = Object.keys(files)[0];
  const byTrack = new Map();
  for (const x of files[fmt]) {
    if (!byTrack.has(x.track) && x.subtitles && x.subtitles.url) byTrack.set(x.track, x.subtitles.url);
  }
  return byTrack;
}

// Descarga (si no existe) el VTT de un episodio concreto.
async function downloadVtt(byTrack, ep) {
  const dest = vttPath(ep);
  if (fs.existsSync(dest)) { console.log(`  ${dest} ya existe`); return dest; }
  fs.mkdirSync('vtt', { recursive: true });
  const url = byTrack.get(ep);
  if (!url) throw new Error(`No hay subtitulos para el episodio ${ep}`);
  const r = await fetch(url, { headers: { 'User-Agent': MEDIA_UA } });
  if (!r.ok) throw new Error(`Descarga VTT ep${ep} respondio ${r.status}`);
  fs.writeFileSync(dest, await r.text(), 'utf8');
  console.log(`  descargado ${dest}`);
  return dest;
}

// Lee la pagina indice y devuelve las guias de cada episodio en orden.
async function discoverGuides(page) {
  await page.goto(INDEX_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const guides = await page.evaluate(() => {
    const byHref = new Map();
    for (const a of document.querySelectorAll('a')) {
      const href = a.href || '';
      if (!/guia-videos-buenas-noticias-segun-jesus\/.+-videos\/?$/i.test(href)) continue;
      const title = a.textContent.replace(/\s+/g, ' ').trim();
      // Cada episodio tiene 2 anclas (imagen sin texto + titulo); nos quedamos con el texto.
      const prev = byHref.get(href);
      if (!prev) byHref.set(href, { title, url: href });
      else if (title.length > prev.title.length) prev.title = title;
    }
    return [...byHref.values()];
  });
  // El indice lista los episodios en orden (EPISODIO 1..N).
  return guides.map((g, i) => ({ ...g, episode: i + 1 }));
}

const ABBR = {
  'Mt': 'Mateo', 'Mr': 'Marcos', 'Lu': 'Lucas', 'Jn': 'Juan',
  'Hch': 'Hechos', 'Ro': 'Romanos', 'Isa': 'Isaías', 'Sl': 'Salmo', 'Sal': 'Salmo',
  'Zac': 'Zacarías', 'Mal': 'Malaquías', 'Dt': 'Deuteronomio', 'Le': 'Levítico',
  'Ex': 'Éxodo', 'Gé': 'Génesis', 'Da': 'Daniel', 'Os': 'Oseas', 'Miq': 'Miqueas',
};

function expandRefs(text) {
  // "Mr 1:21-29; Lu 4:31-37" -> "Marcos 1:21-29; Lucas 4:31-37"
  return text.split(';').map(part => {
    const m = part.trim().match(/^([1-3]?\s?[A-Za-zÁÉÍÓÚáéíóú]+)\s+(.*)$/);
    if (!m) return part.trim();
    const abbr = m[1].replace(/\s+/g, '');
    return `${ABBR[abbr] || m[1]} ${m[2]}`;
  }).join('; ');
}

function tsToSeconds(t) {
  // "00:02:39.37" or "02:39"
  const parts = t.split(':').map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

async function scrapeGuide(page, guideUrl) {
  await page.goto(guideUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('a[data-targetverses]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    // Numero de episodio real segun el lank del video (pub-gnj_N_VIDEO).
    let episode = null;
    for (const a of document.querySelectorAll('a[href*="lank=pub-gnj_"]')) {
      const m = a.getAttribute('href').match(/lank=pub-gnj_(\d+)_VIDEO/);
      if (m) { episode = parseInt(m[1], 10); break; }
    }
    const scenes = [];
    // Cada escena: un <p> con <strong>desc</strong> (<a ts=..>gnj N ..</a>) seguido de <p> con jsBibleLink
    const descPs = [...document.querySelectorAll('p')].filter(p => {
      const a = p.querySelector('a[href*="ts="]');
      return a && p.querySelector('strong');
    });
    for (const p of descPs) {
      const strong = p.querySelector('strong');
      const tsA = p.querySelector('a[href*="ts="]');
      const href = tsA.getAttribute('href');
      const tsm = href.match(/ts=([\d:.]+)-([\d:.]+)/);
      // subir hasta el bloque de escena y buscar los enlaces bíblicos dentro
      let block = p.closest('.dc-columns') || p.parentElement.parentElement;
      const bibleLinks = block ? [...block.querySelectorAll('a[data-targetverses]')] : [];
      const refsText = bibleLinks.map(a => a.textContent.replace(/\s+/g, ' ').trim()).join(' ')
        .replace(/;\s*$/, '').trim();
      scenes.push({
        description: strong.textContent.replace(/\s+/g, ' ').trim(),
        tsStartRaw: tsm ? tsm[1] : null,
        tsEndRaw: tsm ? tsm[2] : null,
        refsText,
        refs: bibleLinks.map(a => ({ label: a.textContent.replace(/\s+/g, ' ').trim(), tv: a.getAttribute('data-targetverses'), href: a.getAttribute('href') })),
      });
    }
    return { episode, scenes };
  });
}

function parseVtt(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const blocks = raw.split('\n\n');
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    const tl = lines.find(l => l.includes('-->'));
    if (!tl) continue;
    const m = tl.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!m) continue;
    const textLines = lines.slice(lines.indexOf(tl) + 1)
      .map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    if (!textLines.length) continue;
    cues.push({ start: tsToSeconds(m[1]), end: tsToSeconds(m[2]), lines: textLines });
  }
  return cues;
}

// Asigna cada cue a la escena cuyo inicio es el mayor <= cue.start (particiona por inicio de escena).
function assignCues(scenes, cues) {
  const starts = scenes.map(s => s.tsStart);
  for (const s of scenes) s._cues = [];
  for (const c of cues) {
    let idx = 0;
    for (let i = 0; i < starts.length; i++) {
      if (c.start >= starts[i] - 0.5) idx = i; else break;
    }
    scenes[idx]._cues.push(c);
  }
}

// Convierte los cues de una escena en párrafos de diálogo/narración legibles.
// Divide en un nuevo párrafo cuando hay una pausa de tiempo notable o un guion de diálogo.
function cuesToParagraphs(cues, gapThreshold = 2.0) {
  const paras = [];
  let buf = '';
  let lastLine = '';
  let prevEnd = null;
  const flush = () => { if (buf.trim()) paras.push(buf.trim()); buf = ''; };
  for (const c of cues) {
    const gap = prevEnd == null ? 0 : c.start - prevEnd;
    prevEnd = c.end;
    const bigGap = gap >= gapThreshold;
    for (let li = 0; li < c.lines.length; li++) {
      const line = c.lines[li];
      if (line === lastLine) continue; // dedupe idéntico consecutivo
      lastLine = line;
      const isDash = line.startsWith('—') || line.startsWith('-');
      if (isDash) {
        flush();
        buf = line.replace(/^-\s?/, '— ');
      } else if (li === 0 && bigGap && buf && /[.!?…»"]$/.test(buf.trim())) {
        // Pausa notable + oración ya terminada => nuevo párrafo.
        flush();
        buf = line;
      } else {
        buf = buf ? `${buf} ${line}` : line;
      }
    }
  }
  flush();
  return paras;
}

async function main() {
  // Episodios a procesar: por CLI (p. ej. `node extract_scripts.mjs 1 2 3`),
  // o TODOS los episodios de la serie por defecto.
  const argEps = process.argv.slice(2).map(Number).filter(n => Number.isInteger(n) && n > 0);

  console.log('Consultando subtitulos oficiales...');
  const byTrack = await fetchSubtitleMap();

  const browser = await chromium.launch();
  const context = await newContext(browser);
  const page = await context.newPage();

  console.log('Descubriendo guias de episodios...');
  const guides = await discoverGuides(page);
  const byEp = new Map(guides.map(g => [g.episode, g]));

  // Sin argumentos: procesar todos los episodios descubiertos en el indice.
  const selected = argEps.length ? argEps : guides.map(g => g.episode);
  console.log(`Episodios a procesar: ${selected.join(', ')}`);

  const out = [];
  for (const epNum of selected) {
    const guide = byEp.get(epNum);
    if (!guide) { console.log(`Episodio ${epNum}: no encontrado en el indice, se omite.`); continue; }
    console.log(`Episodio ${epNum} (${guide.title}): extrayendo guia...`);
    const { episode: lankEp, scenes } = await scrapeGuide(page, guide.url);
    const episode = lankEp || epNum;
    if (lankEp && lankEp !== epNum) {
      console.log(`  aviso: el indice sugeria ${epNum} pero el video es el episodio ${lankEp}; se usa ${lankEp}.`);
    }
    await downloadVtt(byTrack, episode);

    for (const s of scenes) {
      s.tsStart = s.tsStartRaw ? tsToSeconds(s.tsStartRaw) : 0;
      s.tsEnd = s.tsEndRaw ? tsToSeconds(s.tsEndRaw) : 0;
      s.refsText = expandRefs(s.refsText);
    }
    const cues = parseVtt(vttPath(episode));
    assignCues(scenes, cues);
    const outScenes = scenes.map(s => ({
      description: s.description,
      timeStart: s.tsStartRaw,
      timeEnd: s.tsEndRaw,
      references: s.refsText,
      refs: s.refs,
      paragraphs: cuesToParagraphs(s._cues),
    }));
    const assigned = outScenes.reduce((n, s) => n + s.paragraphs.length, 0);
    console.log(`  escenas: ${outScenes.length}, cues: ${cues.length}, parrafos: ${assigned}`);

    out.push({
      episode,
      title: guide.title.replace(/^[“"'\s]+|[”"'\s]+$/g, ''),
      series: `Episodio ${episode}`,
      guide: guide.url,
      scenes: outScenes,
    });
  }
  await browser.close();
  // Ordenar por numero de episodio para una salida estable.
  out.sort((a, b) => a.episode - b.episode);
  fs.writeFileSync('script_data.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('Escrito script_data.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { fetchSubtitleMap, downloadVtt, discoverGuides, scrapeGuide, parseVtt, assignCues, cuesToParagraphs, expandRefs, tsToSeconds, vttPath };
