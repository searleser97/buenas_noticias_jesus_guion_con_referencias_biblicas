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

const TEXT_SIZE = 11;
const LINE_GAP = 2;

function slug(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

function buildPdf(ep) {
  const fileName = `episodio_${ep.episode}_${slug(ep.title)}_comparacion.pdf`;
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
    .text('Comparación: guion vs. texto bíblico', { align: 'center' });
  doc.moveDown(0.4);

  const y = doc.y + 4;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(COLOR_ACCENT).lineWidth(1.2).stroke();
  doc.moveDown(1);

  // ---- Leyenda ----
  doc.fontSize(10).font('Helvetica').fillColor(COLOR_TEXT).text('Leyenda:  ', { continued: true });
  doc.fillColor(COLOR_TEXT).font('Helvetica').text('texto igual al bíblico', { continued: true });
  doc.fillColor(COLOR_TEXT).text('   ·   ', { continued: true });
  doc.fillColor(COLOR_ADD).font('Helvetica-Bold').text('añadido por el guion', { continued: true });
  doc.fillColor(COLOR_TEXT).font('Helvetica').text('   ·   ', { continued: true });
  doc.fillColor(COLOR_DEL).font('Helvetica').text('omitido de la Biblia', { strike: true, continued: false });
  doc.moveDown(0.5);
  doc.fillColor(COLOR_MUTED).font('Helvetica-Oblique').fontSize(9)
    .text('Comparación palabra por palabra. Las escenas citan relatos paralelos (Mateo, Marcos, '
      + 'Lucas); las palabras únicas del relato que la película no narra aparecen como omitidas. '
      + 'Se comparan solo palabras (sin puntuación).', { align: 'left' });
  doc.moveDown(0.8);

  // ---- Escenas ----
  for (const scene of ep.scenes) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(0.5);

    doc.fillColor(COLOR_SCENE).font('Helvetica-Bold').fontSize(13)
      .text(scene.description, { align: 'left' });
    doc.moveDown(0.15);

    if (scene.references) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_ACCENT)
        .text(scene.references, { align: 'left' });
    }
    if (scene.usedRefs && scene.usedRefs.length) {
      doc.font('Helvetica').fontSize(8.5).fillColor(COLOR_MUTED)
        .text('Representado (comparado): ' + scene.usedRefs.join(' ').replace(/;+$/,''), { align: 'left' });
    }
    if (scene.skippedRefs && scene.skippedRefs.length) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(COLOR_MUTED)
        .text('No representado (relato paralelo, no se compara): ' + scene.skippedRefs.join(' ').replace(/;+$/,''), { align: 'left' });
    }
    doc.moveDown(0.35);

    // Cuerpo: flujo de tokens con color por tipo.
    doc.fontSize(TEXT_SIZE);
    const toks = scene.tokens;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      const last = i === toks.length - 1;
      let color = COLOR_TEXT, font = 'Helvetica', strike = false;
      if (tk.t === 'add') { color = COLOR_ADD; font = 'Helvetica-Bold'; }
      else if (tk.t === 'del') { color = COLOR_DEL; strike = true; }
      doc.fillColor(color).font(font).text(tk.w, { continued: true, strike, lineGap: LINE_GAP });
      // Separador (espacio) sin estilo: strike explícito en false para no heredarlo.
      doc.fillColor(COLOR_TEXT).font('Helvetica').text(last ? '' : ' ', { continued: !last, strike: false, lineGap: LINE_GAP });
    }
    doc.moveDown(0.6);
  }

  // ---- Pie de página ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(8)
      .text(`${ep.series || ''} — “${ep.title}” · comparación — página ${i - range.start + 1} de ${range.count}`,
        doc.page.margins.left, doc.page.height - 40,
        { width: pageWidth, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => resolve(filePath)));
}

const files = [];
for (const ep of movies) files.push(await buildPdf(ep));
console.log('PDFs de comparación generados:');
files.forEach(f => console.log('  ' + f));
