import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

// PDF helpers for importing test books: several files become one "book",
// its pages are read as text (to find the tests), and the pages of one
// section are cut out as a small PDF for the AI to read.

export async function mergePdfs(buffers: Buffer[]): Promise<{ pdf: Buffer; pages: number; starts: number[] }> {
  const out = await PDFDocument.create();
  const starts: number[] = [];
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    starts.push(out.getPageCount() + 1);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return { pdf: Buffer.from(await out.save()), pages: out.getPageCount(), starts };
}

// Text of every page ('' for a scanned page).
export async function pageTexts(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: false });
  return (text as string[]).map((t) => t.replace(/\s+/g, ' ').trim());
}

// A PDF with just these pages (1-based, in the given order, duplicates dropped).
export async function subPdf(pdf: Buffer, pages: number[]): Promise<Buffer> {
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const count = src.getPageCount();
  const idx = [...new Set(pages)].filter((p) => p >= 1 && p <= count).map((p) => p - 1);
  const out = await PDFDocument.create();
  (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}
