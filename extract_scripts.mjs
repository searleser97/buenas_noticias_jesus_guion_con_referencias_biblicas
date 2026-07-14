import { chromium } from 'playwright';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { newContext } from './extract.js';

// Metadatos de los 3 episodios que se presentan en la asamblea 2026.
// El número de episodio coincide con el número de "track" en la API de medios (pub=gnj).
const EPISODES = [
  {
    episode: 4, day: 'Viernes', daySlug: 'viernes',
    title: 'Para eso he venido',
    guide: 'https://www.jw.org/es/biblioteca/%C3%ADndices/guia-videos-buenas-noticias-segun-jesus/Para-eso-he-venido-Gu%C3%ADa-de-videos/',
    vtt: 'vtt/ep4.vtt',
  },
  {
    episode: 5, day: 'Sábado', daySlug: 'sabado',
    title: 'Impactados con su manera de enseñar',
    guide: 'https://www.jw.org/es/biblioteca/%C3%ADndices/guia-videos-buenas-noticias-segun-jesus/Impactados-con-su-manera-de-ense%C3%B1ar-Gu%C3%ADa-de-videos/',
    vtt: 'vtt/ep5.vtt',
  },
  {
    episode: 6, day: 'Domingo', daySlug: 'domingo',
    title: '¿Eres tú el que tiene que venir?',
    guide: 'https://www.jw.org/es/biblioteca/%C3%ADndices/guia-videos-buenas-noticias-segun-jesus/Eres-t%C3%BA-el-que-tiene-que-venir-Gu%C3%ADa-de-videos/',
    vtt: 'vtt/ep6.vtt',
  },
];

const MEDIA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PUBMEDIA = 'https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?output=json&pub=gnj&fileformat=mp4&alllangs=0&track=&langwritten=S&txtCMSLang=S';

// Descarga los subtitulos VTT oficiales de cada episodio desde la API de medios de jw.org.
async function downloadVtts() {
  fs.mkdirSync('vtt', { recursive: true });
  const res = await fetch(PUBMEDIA, { headers: { 'User-Agent': MEDIA_UA } });
  if (!res.ok) throw new Error(`API de medios respondio ${res.status}`);
  const j = await res.json();
  const files = j.files.S;
  const fmt = Object.keys(files)[0];
  const byTrack = new Map();
  for (const x of files[fmt]) {
    if (!byTrack.has(x.track) && x.subtitles && x.subtitles.url) byTrack.set(x.track, x.subtitles.url);
  }
  for (const ep of EPISODES) {
    if (fs.existsSync(ep.vtt)) { console.log(`  ${ep.vtt} ya existe`); continue; }
    const url = byTrack.get(ep.episode);
    if (!url) throw new Error(`No hay subtitulos para el episodio ${ep.episode}`);
    const r = await fetch(url, { headers: { 'User-Agent': MEDIA_UA } });
    if (!r.ok) throw new Error(`Descarga VTT ep${ep.episode} respondio ${r.status}`);
    fs.writeFileSync(ep.vtt, await r.text(), 'utf8');
    console.log(`  descargado ${ep.vtt}`);
  }
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

async function scrapeGuide(page, ep) {
  await page.goto(ep.guide, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('a[data-targetverses]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
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
      // Buscar el siguiente <p> con enlaces bíblicos
      let refsText = '';
      let el = p.parentElement;
      // subir hasta el bloque de escena y buscar los enlaces bíblicos dentro
      let block = p.closest('.dc-columns') || p.parentElement.parentElement;
      const bibleLinks = block ? [...block.querySelectorAll('a[data-targetverses]')] : [];
      refsText = bibleLinks.map(a => a.textContent.replace(/\s+/g, ' ').trim()).join(' ')
        .replace(/;\s*$/, '').trim();
      scenes.push({
        description: strong.textContent.replace(/\s+/g, ' ').trim(),
        tsStartRaw: tsm ? tsm[1] : null,
        tsEndRaw: tsm ? tsm[2] : null,
        refsText,
        refs: bibleLinks.map(a => ({ label: a.textContent.replace(/\s+/g, ' ').trim(), tv: a.getAttribute('data-targetverses') })),
      });
    }
    return scenes;
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
  console.log('Descargando subtitulos VTT oficiales...');
  await downloadVtts();
  const browser = await chromium.launch();
  const context = await newContext(browser);
  const page = await context.newPage();
  const out = [];
  for (const ep of EPISODES) {
    console.log(`Episodio ${ep.episode}: extrayendo guía...`);
    const scenes = await scrapeGuide(page, ep);
    for (const s of scenes) {
      s.tsStart = s.tsStartRaw ? tsToSeconds(s.tsStartRaw) : 0;
      s.tsEnd = s.tsEndRaw ? tsToSeconds(s.tsEndRaw) : 0;
      s.refsText = expandRefs(s.refsText);
    }
    const cues = parseVtt(ep.vtt);
    assignCues(scenes, cues);
    const outScenes = scenes.map(s => ({
      description: s.description,
      timeStart: s.tsStartRaw,
      timeEnd: s.tsEndRaw,
      references: s.refsText,
      refs: s.refs,
      paragraphs: cuesToParagraphs(s._cues),
    }));
    const totalCues = cues.length;
    const assigned = outScenes.reduce((n, s) => n + s.paragraphs.length, 0);
    console.log(`  escenas: ${outScenes.length}, cues: ${totalCues}, párrafos: ${assigned}`);
    out.push({
      episode: ep.episode, day: ep.day, daySlug: ep.daySlug,
      title: ep.title, series: `Episodio ${ep.episode}`,
      guide: ep.guide, scenes: outScenes,
    });
  }
  await browser.close();
  fs.writeFileSync('script_data.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('Escrito script_data.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { EPISODES, downloadVtts, scrapeGuide, parseVtt, assignCues, cuesToParagraphs, expandRefs, tsToSeconds };
