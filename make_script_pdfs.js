import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const episodes = JSON.parse(fs.readFileSync('script_data.json', 'utf8'));
const OUT_DIR = 'output';
fs.mkdirSync(OUT_DIR, { recursive: true });

// Paleta (colores oficiales de jw.org) — igual que los PDF de versículos.
const COLOR_TITLE = '#1a3d5c';
const COLOR_ACCENT = '#d65a00';   // naranja jw.org
const COLOR_REF = '#d65a00';      // naranja jw.org para referencias
const COLOR_SCENE = '#1a3d5c';    // azul oscuro para el título de escena
const COLOR_TEXT = '#292929';     // gris casi negro del texto
const COLOR_MUTED = '#666666';

const TEXT_SIZE = 11;
const LINE_GAP = 2;

function slug(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

function buildPdf(ep, index) {
  const fileName = ep.daySlug
    ? `${ep.fileIndex ?? index}_${ep.daySlug}_episodio_${ep.episode}_guion.pdf`
    : `episodio_${ep.episode}_${slug(ep.title)}_guion.pdf`;
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
    .text(ep.series, { align: 'center' });
  doc.moveDown(0.2);
  doc.fillColor(COLOR_TITLE).font('Helvetica-BoldOblique').fontSize(15)
    .text(`“${ep.title}”`, { align: 'center' });
  doc.moveDown(0.4);

  const y = doc.y + 4;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(COLOR_ACCENT).lineWidth(1.2).stroke();
  doc.moveDown(1.2);

  doc.fillColor(COLOR_MUTED).font('Helvetica-Oblique').fontSize(9)
    .text('Guion literal de la película (subtítulos oficiales de jw.org), organizado por escena. '
      + 'En cada escena se indican los pasajes bíblicos que se representan.', { align: 'left' });
  doc.moveDown(1);

  // ---- Escenas ----
  for (const scene of ep.scenes) {
    // Evitar que el encabezado de escena quede huérfano al final de la página.
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(0.5);

    // Título de escena
    doc.fillColor(COLOR_SCENE).font('Helvetica-Bold').fontSize(13)
      .text(scene.description, { align: 'left' });
    doc.moveDown(0.15);

    // Referencias bíblicas + timecode
    const tc = scene.timeStart && scene.timeEnd
      ? `  (${scene.timeStart.replace(/\.\d+$/, '')}–${scene.timeEnd.replace(/\.\d+$/, '')})` : '';
    if (scene.references) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_REF)
        .text(scene.references, { continued: !!tc });
      if (tc) doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLOR_MUTED).text(tc);
    } else if (tc) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLOR_MUTED).text(tc.trim());
    }
    doc.moveDown(0.35);

    // Cuerpo del guion (párrafos justificados)
    doc.font('Helvetica').fontSize(TEXT_SIZE).fillColor(COLOR_TEXT);
    for (const para of scene.paragraphs) {
      doc.text(para, { align: 'justify', lineGap: LINE_GAP });
      doc.moveDown(0.35);
    }
    doc.moveDown(0.4);
  }

  // ---- Pie de página con numeración ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(COLOR_MUTED).font('Helvetica').fontSize(8)
      .text(`${ep.series} — “${ep.title}” · guion — página ${i - range.start + 1} de ${range.count}`,
        doc.page.margins.left, doc.page.height - 40,
        { width: pageWidth, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return new Promise((resolve) => stream.on('finish', () => resolve(filePath)));
}

const files = [];
for (let i = 0; i < episodes.length; i++) {
  files.push(await buildPdf(episodes[i], i + 1));
}
console.log('PDFs de guion generados:');
files.forEach(f => console.log('  ' + f));
