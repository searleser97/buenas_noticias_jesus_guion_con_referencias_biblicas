import fs from 'node:fs';
import { EPISODES, parseVtt } from './extract_scripts.mjs';

// Tokeniza a palabras (minúsculas, sin puntuación) para comparar palabras + orden.
function tokens(str) {
  return str
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Reconstruye el flujo de palabras del VTT aplicando el mismo dedupe de líneas
// idénticas consecutivas que usa la extracción.
function vttWords(cues) {
  const words = [];
  let lastLine = '';
  for (const c of cues) {
    for (const line of c.lines) {
      if (line === lastLine) continue;
      lastLine = line;
      words.push(...tokens(line));
    }
  }
  return words;
}

const data = JSON.parse(fs.readFileSync('script_data.json', 'utf8'));
let ok = true;

for (const ep of EPISODES) {
  const epData = data.find(d => d.episode === ep.episode);
  const cues = parseVtt(ep.vtt);
  const srcWords = vttWords(cues);
  const pdfWords = [];
  for (const scene of epData.scenes) {
    for (const para of scene.paragraphs) pdfWords.push(...tokens(para));
  }

  let mismatch = -1;
  const n = Math.min(srcWords.length, pdfWords.length);
  for (let i = 0; i < n; i++) {
    if (srcWords[i] !== pdfWords[i]) { mismatch = i; break; }
  }

  const same = mismatch === -1 && srcWords.length === pdfWords.length;
  console.log(`Episodio ${ep.episode}: VTT=${srcWords.length} palabras, guion=${pdfWords.length} palabras -> ${same ? 'OK (coincidencia exacta)' : 'DIFERENCIA'}`);
  if (!same) {
    ok = false;
    if (mismatch >= 0) {
      const ctx = i => srcWords.slice(Math.max(0, i - 4), i + 4).join(' ');
      console.log(`  primera diferencia en palabra #${mismatch}:`);
      console.log(`    VTT  : ...${ctx(mismatch)}...`);
      console.log(`    guion: ...${pdfWords.slice(Math.max(0, mismatch - 4), mismatch + 4).join(' ')}...`);
    } else {
      const longer = srcWords.length > pdfWords.length ? 'VTT' : 'guion';
      const extra = (srcWords.length > pdfWords.length ? srcWords : pdfWords).slice(n, n + 8).join(' ');
      console.log(`  longitudes distintas; sobran palabras en ${longer}: "${extra}..."`);
    }
  }
}

console.log(ok ? '\nTODAS LAS VERIFICACIONES PASARON: el guion coincide palabra por palabra con los subtitulos.' : '\nHAY DIFERENCIAS.');
process.exit(ok ? 0 : 1);
