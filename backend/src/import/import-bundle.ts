import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ImportKind } from './import-sheet';

/** The order a bundle is imported in: what a row names must exist first. */
export const BUNDLE_ORDER: ImportKind[] = ['teachers', 'groups', 'students'];
export const BUNDLE_SHEETS: Record<ImportKind, string> = { teachers: "O'qituvchilar", groups: 'Guruhlar', students: "O'quvchilar" };

const MAX_FILES = 10;
const MAX_UNZIPPED = 20 * 1024 * 1024;

/** A sheet's or a file's name -> the kind it holds ("o'qituvchi" and "o'quvchi" kept apart). */
export function kindOfName(name: string): ImportKind | null {
  const n = name.toLowerCase().replace(/[‘’ʻʼ`']/g, '');
  if (/izoh|help|note/.test(n)) return null;
  if (/teacher|oqituvchi|ustoz/.test(n)) return 'teachers';
  if (/group|guruh/.test(n)) return 'groups';
  if (/student|oquvchi|talaba/.test(n)) return 'students';
  return null;
}

async function sheetAsWorkbook(ws: ExcelJS.Worksheet): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const copy = wb.addWorksheet('Import');
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    copy.getRow(n).values = row.values as ExcelJS.CellValue[];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * What a bundle holds, per kind, as a single-kind workbook each: the sheets
 * of one .xlsx named after a kind, or the .xlsx files of a .zip named after
 * one. Anything else in it is left alone.
 */
export async function bundleParts(buffer: Buffer): Promise<Partial<Record<ImportKind, Buffer>>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new BadRequestException("Fayl o'qilmadi: .xlsx yoki .zip yuklang");
  }
  const out: Partial<Record<ImportKind, Buffer>> = {};
  const isWorkbook = !!zip.file('[Content_Types].xml') && !!zip.file('xl/workbook.xml');
  if (isWorkbook) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    for (const ws of wb.worksheets) {
      const kind = kindOfName(ws.name);
      if (kind && !out[kind]) out[kind] = await sheetAsWorkbook(ws);
    }
    return out;
  }
  const files = Object.values(zip.files).filter((f) => !f.dir && /\.xlsx$/i.test(f.name) && !f.name.split('/').pop()!.startsWith('~$'));
  if (files.length > MAX_FILES) throw new BadRequestException(`ZIP ichida ko'pi bilan ${MAX_FILES} ta Excel fayl`);
  let total = 0;
  for (const f of files) {
    const kind = kindOfName(f.name.split('/').pop()!);
    if (!kind || out[kind]) continue;
    const bytes = await f.async('nodebuffer');
    total += bytes.length;
    if (total > MAX_UNZIPPED) throw new BadRequestException('ZIP ochilganda juda katta');
    out[kind] = bytes;
  }
  return out;
}
