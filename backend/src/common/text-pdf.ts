import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { join } from 'path';

// Turns AI-written text (light markdown: "# " headings, "- " bullets,
// "1. " items, **bold**) into a clean A4 PDF students can open or print.

const FONT_PATH = join(process.cwd(), 'assets', 'fonts', 'Geist-Regular.ttf');

// Geist lacks the Uzbek okina (ʻ); the typographic quote looks the same.
const clean = (s: string) => s.replace(/ʻ/g, '‘').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/\*([^*\s][^*]*)\*/g, '$1').replace(/`/g, '');

export function renderTextPdf(opts: { title: string; subtitle?: string; body: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: opts.title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (existsSync(FONT_PATH)) doc.font(FONT_PATH);
    doc.fillColor('#111827').fontSize(20).text(clean(opts.title), { align: 'left' });
    if (opts.subtitle) doc.moveDown(0.2).fillColor('#6B7280').fontSize(10.5).text(clean(opts.subtitle));
    doc.moveDown(0.6);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#E5E7EB').stroke();
    doc.moveDown(0.8);

    for (const raw of opts.body.replace(/\r/g, '').split('\n')) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        doc.moveDown(0.5);
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        doc.moveDown(0.3);
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#E5E7EB').stroke();
        doc.moveDown(0.5);
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        doc.moveDown(0.4).fillColor('#1E1B4B').fontSize(heading[1].length <= 2 ? 15 : 13).text(clean(heading[2]));
        doc.moveDown(0.25);
        continue;
      }
      // A line that is only bold text reads as a heading too.
      const boldOnly = line.trim().match(/^\*\*(.+)\*\*:?$/);
      if (boldOnly) {
        doc.moveDown(0.3).fillColor('#1E1B4B').fontSize(12.5).text(clean(boldOnly[1]));
        doc.moveDown(0.15);
        continue;
      }
      const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
      if (bullet) {
        const indent = 14 + Math.min(3, Math.floor(bullet[1].length / 2)) * 14;
        doc.fillColor('#1F2937').fontSize(11).text(`•  ${clean(bullet[2])}`, doc.page.margins.left + indent, doc.y, { lineGap: 2 });
        doc.x = doc.page.margins.left;
        continue;
      }
      doc.fillColor('#1F2937').fontSize(11).text(clean(line), doc.page.margins.left, doc.y, { lineGap: 2 });
    }

    doc.end();
  });
}

// Safe file name from a title ("Unit 5: Present Perfect" -> "Unit-5-Present-Perfect.pdf").
export function pdfFileName(title: string) {
  const base = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `${base || 'material'}.pdf`;
}
