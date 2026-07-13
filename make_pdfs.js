import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { BOOK_NAMES } from './books.js';

const movies = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const OUT_DIR = 'output';
fs.mkdirSync(OUT_DIR, { recursive: true });

// Paleta (colores oficiales de jw.org)
const COLOR_TITLE = '#1a3d5c';
const COLOR_ACCENT = '#d65a00';   // naranja jw.org (etiquetas / separador)
const COLOR_VERSENUM = '#4a6da7'; // azul jw.org para números de versículo
const COLOR_REF = '#d65a00';      // naranja jw.org para encabezados de referencia
const COLOR_TEXT = '#292929';     // gris casi negro del texto bíblico
const COLOR_MUTED = '#666666';

function slugForFile(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

function buildPdf(movie, index) {
  const epMatch = movie.series.match(/Episodio\s+(\d+)/i);
  const epNum = epMatch ? epMatch[1] : String(index);
  const fileName = `${index}_${movie.daySlug}_episodio_${epNum}.pdf`;
  const filePath = path.join(OUT_DIR, fileName);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 }, bufferPages: true });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ---- Portada / encabezado ----
  doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(11)
    .text('Asamblea Regional 2026 · “Felices para siempre”', { align: 'center' });
  doc.moveDown(0.2);
  doc.fillColor(COLOR_ACCENT).font('Helvetica-Bold').fontSize(12)
    .text(`Producción audiovisual — ${movie.day}`, { align: 'center' });
  doc.moveDown(0.6);
  doc.fillColor(COLOR_TITLE).font('Helvetica-Bold').fontSize(20)
    .text(movie.series, { align: 'center' });
  doc.moveDown(0.2);
  doc.fillColor(COLOR_TITLE).font('Helvetica-BoldOblique').fontSize(15)
    .text(`“${movie.title}”`, { align: 'center' });
  doc.moveDown(0.4);

  // línea separadora
  const y = doc.y + 4;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(COLOR_ACCENT).lineWidth(1.2).stroke();
  doc.moveDown(1.2);

  doc.fillColor(COLOR_MUTED).font('Helvetica-Oblique').fontSize(9)
    .text('Textos bíblicos utilizados en la película, en orden de aparición. Traducción del Nuevo Mundo (jw.org).', { align: 'left' });
  doc.moveDown(1);

  // ---- Referencias ----
  const TEXT_SIZE = 11;
  const NUM_SIZE = 12; // números de versículo un poco más grandes que el texto
  for (const ref of movie.references) {
    // Encabezado de referencia (nombre del libro + cita) con formato distintivo
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.4);
    doc.fillColor(COLOR_REF).font('Helvetica-Bold').fontSize(13)
      .text(ref.heading, { align: 'left' });
    // Espacio superior extra: con baseline 'alphabetic' la primera línea se
    // apoya en su línea base, por lo que el texto sube ~1 ascendente.
    doc.moveDown(0.15);
    doc.font('Helvetica').fontSize(TEXT_SIZE);
    doc.y += doc.currentLineHeight() * 0.85;

    // Cuerpo de los versículos, fluyendo con números resaltados.
    // 'baseline: alphabetic' alinea el número (mayor) y el texto por la línea
    // base inferior, en vez de por la parte superior.
    // 'lineGap' agrega un poco de espacio entre líneas para facilitar la lectura.
    const LINE_GAP = 2;
    let prevChapter = null;
    ref.verses.forEach((v, i) => {
      // En rangos multi-capítulo mostramos "cap:versículo" al cambiar de capítulo.
      let label;
      if (ref.multiChapter && v.chapter !== prevChapter) {
        label = `${v.chapter}:${v.num} `;
      } else {
        label = `${v.num} `;
      }
      prevChapter = v.chapter;

      doc.font('Helvetica-Bold').fillColor(COLOR_VERSENUM).fontSize(NUM_SIZE)
        .text(label, { continued: true, align: 'justify', baseline: 'alphabetic', lineGap: LINE_GAP });
      doc.font('Helvetica').fillColor(COLOR_TEXT).fontSize(TEXT_SIZE)
        .text(v.text + '  ', { continued: i < ref.verses.length - 1, align: 'justify', baseline: 'alphabetic', lineGap: LINE_GAP });
    });
    // cerrar el flujo continuo
    doc.text('', { continued: false });
    doc.moveDown(0.6);
  }

  // ---- Pie de página con numeración ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Poner el margen inferior en 0 evita que pdfkit agregue páginas en blanco
    // al escribir dentro de la zona del margen.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(8)
      .text(`${movie.series} — página ${i - range.start + 1} de ${range.count}`,
        doc.page.margins.left, doc.page.height - 40,
        { width: pageWidth, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => resolve(filePath)));
}

const files = [];
for (let i = 0; i < movies.length; i++) {
  files.push(await buildPdf(movies[i], i + 1));
}
console.log('✔ PDFs generados:');
files.forEach(f => console.log('  ' + f));
