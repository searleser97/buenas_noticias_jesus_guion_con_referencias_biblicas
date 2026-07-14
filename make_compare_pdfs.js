import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const movies = JSON.parse(fs.readFileSync('compare_diff.json', 'utf8'));
const OUT_DIR = 'output';
fs.mkdirSync(OUT_DIR, { recursive: true });

// Paleta jw.org (igual que los demas PDF) + colores del diff.
const COLOR_TITLE = '#1a3d5c';
const COLOR_ACCENT = '#d65a00';
const COLOR_SCENE = '#1a3d5c';
const COLOR_TEXT = '#292929';
const COLOR_MUTED = '#666666';
const COLOR_ADD = '#1a7f37';   // verde: añadido por el guion
const COLOR_DEL = '#cf222e';   // rojo: omitido de la Biblia
const COLOR_VERSENUM = '#4a6da7'; // azul jw.org para números de versículo

const TEXT_SIZE = 11;
const NUM_SIZE = 12;
const LINE_GAP = 2;

function slug(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

// "00:01:23" -> "1:23" ; "01:02:03" -> "1:02:03". Quita horas/minutos ceros.
function fmtTime(t) {
  if (!t) return null;
  const p = String(t).split(':').map(Number);
  let h = 0, m = 0, s = 0;
  if (p.length === 3) [h, m, s] = p;
  else if (p.length === 2) [m, s] = p;
  else [s] = p;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function fmtRange(start, end) {
  const a = fmtTime(start), b = fmtTime(end);
  if (!a && !b) return null;
  if (a && b) return `${a}–${b}`;
  return a || b;
}

function buildPdf(ep) {
  const fileName = `episodio_${ep.episode}_${slug(ep.title)}_guion.pdf`;
  const filePath = path.join(OUT_DIR, fileName);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 }, bufferPages: true });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ---- Encabezado ----
  if (ep.day) {
    doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(11)
      .text('Asamblea Regional 2026 · “Felices para siempre”', { align: 'center' });
    doc.moveDown(0.2);
    doc.fillColor(COLOR_ACCENT).font('Helvetica-Bold').fontSize(12)
      .text(`Producción audiovisual — ${ep.day}`, { align: 'center' });
  } else {
    doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(11)
      .text('Las buenas noticias según Jesús', { align: 'center' });
  }
  doc.moveDown(0.6);
  doc.fillColor(COLOR_TITLE).font('Helvetica-Bold').fontSize(20)
    .text(ep.series || '', { align: 'center' });
  doc.moveDown(0.2);
  doc.fillColor(COLOR_TITLE).font('Helvetica-BoldOblique').fontSize(15)
    .text(`“${ep.title}”`, { align: 'center' });
  doc.moveDown(0.2);
  doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(11)
    .text('Texto bíblico con lo que el guion añade y omite', { align: 'center' });
  doc.moveDown(0.4);

  const y = doc.y + 4;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(COLOR_ACCENT).lineWidth(1.2).stroke();
  doc.moveDown(1);

  // ---- Leyenda ----
  doc.fontSize(10).font('Helvetica').fillColor(COLOR_TEXT).text('Leyenda:  ', { continued: true });
  doc.fillColor(COLOR_TEXT).font('Helvetica').text('texto bíblico', { continued: true });
  doc.fillColor(COLOR_TEXT).text('   ·   ', { continued: true });
  doc.fillColor(COLOR_ADD).font('Helvetica-Bold').text('añadido por el guion', { continued: true });
  doc.fillColor(COLOR_TEXT).font('Helvetica').text('   ·   ', { continued: true });
  doc.fillColor(COLOR_DEL).font('Helvetica').text('omitido por el guion', { strike: true, continued: false });
  doc.moveDown(0.5);
  doc.fillColor(COLOR_MUTED).font('Helvetica-Oblique').fontSize(9)
    .text('El texto base es el de la Biblia (versículo por versículo), con el número de '
      + 'versículo en azul. En verde, las palabras que el guion añade; tachado en rojo, las '
      + 'palabras bíblicas que el guion no dice. Cuando una escena combina varios relatos '
      + '(Mateo, Marcos, Lucas, Juan), se mezclan en un solo texto continuo, indicando con la '
      + 'abreviatura del libro de dónde proviene cada parte.',
      { align: 'left' });
  doc.moveDown(0.8);

  // ---- Escenas ----
  for (const scene of ep.scenes) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(1.1);

    doc.fillColor(COLOR_SCENE).font('Helvetica-Bold').fontSize(13)
      .text(scene.description, { align: 'left' });
    doc.moveDown(0.15);

    const timeRange = fmtRange(scene.timeStart, scene.timeEnd);
    if (timeRange) {
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(COLOR_MUTED)
        .text(`Minuto ${timeRange}`, { align: 'left' });
      doc.moveDown(0.1);
    }

    if (scene.references) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_ACCENT)
        .text(scene.references, { align: 'left' });
    }
    doc.moveDown(0.35);

    // Cuerpo en formato de guion: cada oración del guion en su propia línea,
    // precedida de una viñeta y con sangría francesa (las líneas que se parten
    // se alinean bajo el texto, no bajo la viñeta), con los números de
    // versículo en azul + procedencia de libro y el diff superpuesto
    // (verde = añadido, rojo tachado = omitido).
    doc.font('Helvetica').fontSize(TEXT_SIZE);
    const leftX = doc.page.margins.left;
    const HANG = 15;
    const contentX = leftX + HANG;
    const contentW = pageWidth - HANG;

    // Divide los tokens en líneas del guion (separadas por 'br').
    const lines = [[]];
    for (const tk of scene.tokens) {
      if (tk.t === 'br') lines.push([]);
      else lines[lines.length - 1].push(tk);
    }

    for (const line of lines) {
      if (line.length === 0) continue;
      if (doc.y > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();

      const y0 = doc.y;
      // Viñeta en el margen izquierdo.
      doc.font('Helvetica-Bold').fontSize(TEXT_SIZE).fillColor(COLOR_VERSENUM)
        .text('•', leftX, y0, { width: HANG, continued: false });
      doc.y = y0;

      let firstFrag = true;
      const emit = (str, opts) => {
        if (firstFrag) {
          firstFrag = false;
          doc.text(str, contentX, y0, { ...opts, width: contentW });
        } else {
          doc.text(str, { ...opts, width: contentW });
        }
      };
      const BASE = { continued: true, align: 'left', lineGap: LINE_GAP };

      for (let idx = 0; idx < line.length; idx++) {
        const tk = line[idx];
        const last = idx === line.length - 1;
        const sp = { ...BASE, strike: false, continued: !last };
        if (tk.t === 'book') {
          doc.font('Helvetica-Bold').fontSize(TEXT_SIZE).fillColor(COLOR_ACCENT); emit(tk.w, BASE);
          doc.font('Helvetica').fontSize(TEXT_SIZE).fillColor(COLOR_TEXT); emit(' ', sp);
        } else if (tk.t === 'vnum') {
          doc.font('Helvetica-Bold').fontSize(NUM_SIZE).fillColor(COLOR_VERSENUM); emit(tk.w, BASE);
          doc.font('Helvetica').fontSize(TEXT_SIZE).fillColor(COLOR_TEXT); emit(' ', sp);
        } else {
          let color = COLOR_TEXT, font = 'Helvetica', strike = false;
          if (tk.t === 'add') { color = COLOR_ADD; font = 'Helvetica-Bold'; }
          else if (tk.t === 'del') { color = COLOR_DEL; strike = true; }
          doc.font(font).fontSize(TEXT_SIZE).fillColor(color); emit(tk.w, { ...BASE, strike });
          doc.font('Helvetica').fontSize(TEXT_SIZE).fillColor(COLOR_TEXT); emit(' ', sp);
        }
      }
      doc.moveDown(0.45);
    }
    doc.moveDown(0.35);
  }

  // ---- Pie de página ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(8)
      .text(`${ep.series || ''} — “${ep.title}” · guion — página ${i - range.start + 1} de ${range.count}`,
        doc.page.margins.left, doc.page.height - 40,
        { width: pageWidth, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => resolve(filePath)));
}

const files = [];
for (const ep of movies) files.push(await buildPdf(ep));
console.log('PDFs de guion generados:');
files.forEach(f => console.log('  ' + f));
