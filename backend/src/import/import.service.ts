import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, groups, students, teachers } from '../db/schema';
import { GroupsService } from '../groups/groups.service';
import { StudentsService } from '../students/students.service';
import { TeachersService } from '../teachers/teachers.service';
import { countOccupiedSeats } from '../common/seats';
import { normalizePhone } from '../leads/phone';
import { AuditService } from '../audit/audit.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { type FieldDef, fieldForHeader, parseCell, validateForm } from '../custom-fields/custom-field-values';
import {
  COLUMNS, MAX_ROWS, cellText, mapHeader, nameKey, parseGroup, parseStudent, parseTeacher, slotsOverlap,
  type GroupRow, type ImportKind, type StudentRow,
} from './import-sheet';

export interface ImportRow {
  row: number; // the sheet's row number
  values: Record<string, string>;
  status: 'create' | 'exists' | 'error';
  errors: string[];
  note?: string;
}

export interface ImportReport {
  kind: ImportKind;
  rows: ImportRow[];
  counts: { create: number; exists: number; error: number };
  unknownColumns: string[];
}

type Plan =
  | { kind: 'teachers'; row: ImportRow; data: NonNullable<ReturnType<typeof parseTeacher>['value']> }
  | { kind: 'groups'; row: ImportRow; data: GroupRow & { teacherId?: string; branchId?: string } }
  | { kind: 'students'; row: ImportRow; data: StudentRow & { groupIds: string[]; customFields: Record<string, unknown> } };

/**
 * Excel import of teachers, groups and students, in two steps:
 * 1. preview - every row is read and checked (required fields, formats,
 *    the teacher/branch/group it names, timetable clashes, free seats);
 *    rows that already exist are marked and will be skipped; nothing is
 *    written;
 * 2. run - the same checks again; if any row has an error, nothing is
 *    written; otherwise the rows are created one by one through the same
 *    services as the forms (price history, timetable, enrollment, audit).
 * Uploading the same file again creates nothing new: what exists is
 * skipped. If the run stops half way (the server fails), upload it again.
 */
@Injectable()
export class ImportService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly teachersService: TeachersService,
    private readonly groupsService: GroupsService,
    private readonly studentsService: StudentsService,
    private readonly audit: AuditService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async template(kind: ImportKind, tenantId?: string) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Import');
    // Students: the center's own fields are columns too (by their label).
    const custom = kind === 'students' && tenantId ? await this.customFields.list(tenantId, 'STUDENT') : [];
    const cols = [
      ...COLUMNS[kind],
      ...custom.map((d) => ({
        key: `cf_${d.id}`, title: d.label, aliases: [], required: d.required, example: '',
        hint: d.options.length ? d.options.filter((o) => !o.archived).map((o) => o.label).join(' | ') : d.fieldType,
      })),
    ];
    ws.columns = cols.map((c) => ({ header: c.required ? `${c.title} *` : c.title, key: c.key, width: Math.max(14, c.title.length + 4, c.example.length + 2) }));
    ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.example])));
    ws.getRow(1).font = { bold: true };
    const help = wb.addWorksheet('Izoh');
    help.columns = [{ header: 'Ustun', key: 'c', width: 22 }, { header: 'Majburiy', key: 'r', width: 10 }, { header: 'Qiymat', key: 'h', width: 50 }];
    for (const c of cols) help.addRow({ c: c.title, r: c.required ? 'ha' : '', h: c.hint ?? '' });
    help.getRow(1).font = { bold: true };
    return wb.xlsx.writeBuffer();
  }

  private async read(kind: ImportKind, buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Fayl o'qilmadi: .xlsx formatidagi Excel fayl yuklang");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Faylda varaq yo'q");
    const header: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { header[col] = cellText(cell.value).replace(/\s*\*$/, ''); });
    const { at, unknown, missing } = mapHeader(kind, header);
    // Columns no built-in field claims: kept by their header, for the center's own fields.
    const extra = header.map((h, col) => ({ h, col })).filter(({ h, col }) => h && !Object.values(at).includes(col));
    if (missing.length) throw new BadRequestException(`Majburiy ustun yo'q: ${missing.join(', ')}. Shablonni yuklab oling.`);
    const rows: Array<{ row: number; values: Record<string, string> }> = [];
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return;
      const values: Record<string, string> = {};
      for (const [key, col] of Object.entries(at)) values[key] = cellText(r.getCell(col).value).trim();
      for (const { h, col } of extra) values[`@${h}`] = cellText(r.getCell(col).value).trim();
      if (Object.values(values).some(Boolean)) rows.push({ row: n, values });
    });
    if (rows.length === 0) throw new BadRequestException("Faylda ma'lumot qatori yo'q");
    if (rows.length > MAX_ROWS) throw new BadRequestException(`Bir faylda ko'pi bilan ${MAX_ROWS} qator`);
    return { rows, unknown: unknown.filter(Boolean) };
  }

  private async plan(tenantId: string, kind: ImportKind, buffer: Buffer): Promise<{ report: ImportReport; plans: Plan[] }> {
    const { rows, unknown } = await this.read(kind, buffer);
    const out: ImportRow[] = [];
    const plans: Plan[] = [];
    const seen = new Map<string, number>(); // key -> first row in the file
    const dup = (key: string, row: number, r: ImportRow) => {
      const first = seen.get(key);
      if (first !== undefined) r.errors.push(`${first}-qator bilan bir xil`);
      else seen.set(key, row);
    };

    if (kind === 'teachers') {
      const existing = await this.db.select({ fullName: teachers.fullName, phone: teachers.phone }).from(teachers).where(and(eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
      const byPhone = new Set(existing.map((t) => normalizePhone(t.phone)).filter(Boolean));
      const byName = new Set(existing.filter((t) => !t.phone).map((t) => nameKey(t.fullName)));
      for (const { row, values } of rows) {
        const p = parseTeacher(values);
        const r: ImportRow = { row, values, status: 'create', errors: [...p.errors] };
        if (p.value) {
          const phone = normalizePhone(p.value.phone);
          dup(phone ? `p:${phone}` : `n:${nameKey(p.value.fullName)}`, row, r);
          if (!r.errors.length && ((phone && byPhone.has(phone)) || (!phone && byName.has(nameKey(p.value.fullName))))) {
            r.status = 'exists';
            r.note = phone ? 'Bu telefon raqamli o\'qituvchi bor' : 'Bu ismli o\'qituvchi bor';
          } else if (!r.errors.length) plans.push({ kind, row: r, data: p.value });
        }
        out.push(r);
      }
    }

    if (kind === 'groups') {
      const ts = await this.db.select({ id: teachers.id, fullName: teachers.fullName }).from(teachers).where(and(eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
      const bs = await this.db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.tenantId, tenantId));
      const gs = await this.db.select({ name: groups.name }).from(groups).where(and(eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      const existing = new Set(gs.map((g) => nameKey(g.name)));
      const accepted: Array<{ row: number; teacherId: string; days: string; start: string; end: string }> = [];
      for (const { row, values } of rows) {
        const p = parseGroup(values);
        const r: ImportRow = { row, values, status: 'create', errors: [...p.errors] };
        if (p.value) {
          const g = p.value;
          dup(`g:${nameKey(g.name)}`, row, r);
          let teacherId: string | undefined;
          if (g.teacher) {
            const found = ts.filter((t) => nameKey(t.fullName) === nameKey(g.teacher!));
            if (found.length === 0) r.errors.push(`O'qituvchi topilmadi: ${g.teacher} (avval o'qituvchilarni qo'shing yoki import qiling)`);
            else if (found.length > 1) r.errors.push(`Bu ismli o'qituvchi bir nechta: ${g.teacher}`);
            else teacherId = found[0].id;
          }
          let branchId: string | undefined;
          if (g.branch) {
            const found = bs.filter((b) => nameKey(b.name) === nameKey(g.branch!));
            if (found.length !== 1) r.errors.push(`Filial topilmadi: ${g.branch}`);
            else branchId = found[0].id;
          }
          if (!r.errors.length && existing.has(nameKey(g.name))) {
            r.status = 'exists';
            r.note = 'Bu nomli guruh bor';
          } else if (!r.errors.length) {
            if (teacherId && g.scheduleDays && g.startTime) {
              const end = g.endTime ?? addMinutesHHMM(g.startTime, 90);
              const slot = { days: g.scheduleDays, start: g.startTime, end };
              const clash = await this.groupsService.findScheduleConflicts(tenantId, teacherId, g.scheduleDays, g.startTime, undefined, end);
              if (clash.length) r.errors.push(`O'qituvchi bu vaqtda band: ${clash.map((c) => c.name).join(', ')}`);
              const inFile = accepted.find((a) => a.teacherId === teacherId && slotsOverlap(a, slot));
              if (inFile) r.errors.push(`O'qituvchi ${inFile.row}-qatordagi guruh bilan bir vaqtda`);
              if (!r.errors.length) accepted.push({ row, teacherId, ...slot });
            }
            if (!r.errors.length) plans.push({ kind, row: r, data: { ...g, teacherId, branchId } });
          }
        }
        out.push(r);
      }
    }

    if (kind === 'students') {
      // Custom-field columns by label or "cf:<key>"; they are no longer "unknown".
      const defs = (await this.customFields.list(tenantId, 'STUDENT')) as (FieldDef & { key: string })[];
      const customCols = new Map<string, FieldDef & { key: string }>();
      for (const u of unknown) {
        const d = fieldForHeader(defs, u);
        if (d) customCols.set(u, d);
      }
      for (const u of customCols.keys()) unknown.splice(unknown.indexOf(u), 1);
      const gs = await this.db.select({ id: groups.id, name: groups.name, maxStudents: groups.maxStudents }).from(groups).where(and(eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      const ss = await this.db.select({ fullName: students.fullName, phone: students.phone, parentPhone: students.parentPhone }).from(students).where(and(eq(students.tenantId, tenantId), isNull(students.deletedAt)));
      const key = (s: { fullName: string; phone?: string | null; parentPhone?: string | null }) => `${nameKey(s.fullName)}|${normalizePhone(s.phone) ?? ''}|${normalizePhone(s.parentPhone) ?? ''}`;
      const existing = new Set(ss.map(key));
      const wanted = new Map<string, number>(); // group id -> seats this file takes
      const pending: Array<{ r: ImportRow; data: StudentRow & { groupIds: string[]; customFields: Record<string, unknown> } }> = [];
      for (const { row, values } of rows) {
        const p = parseStudent(values);
        const r: ImportRow = { row, values: Object.fromEntries(Object.entries(values).filter(([k]) => !k.startsWith('@'))), status: 'create', errors: [...p.errors] };
        const customInput: Record<string, unknown> = {};
        for (const [header, def] of customCols) {
          const c = parseCell(def, values[`@${header}`] ?? '');
          if (c.error) r.errors.push(`${def.label}: ${c.error}`);
          else if (c.value !== undefined) customInput[def.id] = c.value;
          if (values[`@${header}`]) r.values[header] = values[`@${header}`];
        }
        for (const e of validateForm(defs, customInput, 'create').errors) r.errors.push(`${e.label}: ${e.error}`);
        if (p.value) {
          const st = p.value;
          dup(`s:${key(st)}`, row, r);
          const groupIds: string[] = [];
          for (const name of st.groups) {
            const found = gs.filter((g) => nameKey(g.name) === nameKey(name));
            if (found.length !== 1) r.errors.push(found.length ? `Bu nomli guruh bir nechta: ${name}` : `Guruh topilmadi: ${name}`);
            else groupIds.push(found[0].id);
          }
          if (!r.errors.length && existing.has(key(st))) {
            r.status = 'exists';
            r.note = "Bu o'quvchi bor";
          } else if (!r.errors.length) {
            for (const id of groupIds) wanted.set(id, (wanted.get(id) ?? 0) + 1);
            pending.push({ r, data: { ...st, groupIds, customFields: customInput } });
          }
        }
        out.push(r);
      }
      // Free seats: rows past a group's capacity get the error.
      for (const g of gs.filter((x) => wanted.has(x.id))) {
        const free = Math.max(0, g.maxStudents - (await countOccupiedSeats(this.db, g.id)));
        let used = 0;
        for (const p of pending) {
          if (!p.data.groupIds.includes(g.id)) continue;
          used++;
          if (used > free) p.r.errors.push(`"${g.name}" guruhida joy yo'q (bo'sh: ${free})`);
        }
      }
      for (const p of pending) if (!p.r.errors.length) plans.push({ kind, row: p.r, data: p.data });
    }

    for (const r of out) if (r.errors.length) r.status = 'error';
    const counts = { create: 0, exists: 0, error: 0 };
    for (const r of out) counts[r.status]++;
    return { report: { kind, rows: out, counts, unknownColumns: unknown }, plans: plans.filter((p) => p.row.status === 'create') };
  }

  preview(tenantId: string, kind: ImportKind, buffer: Buffer) {
    return this.plan(tenantId, kind, buffer).then((p) => p.report);
  }

  async run(tenantId: string, userId: string, kind: ImportKind, buffer: Buffer) {
    const { report, plans } = await this.plan(tenantId, kind, buffer);
    if (report.counts.error > 0) {
      throw new BadRequestException({ message: `${report.counts.error} ta qatorda xato: hech narsa saqlanmadi. Tuzatib, qayta yuklang.`, report });
    }
    let created = 0;
    for (const p of plans) {
      try {
        if (p.kind === 'teachers') {
          await this.teachersService.create(tenantId, userId, p.data);
        } else if (p.kind === 'groups') {
          const g = p.data;
          await this.groupsService.create(tenantId, userId, {
            name: g.name, subject: g.subject, teacherId: g.teacherId, branchId: g.branchId, monthlyPrice: g.monthlyPrice, maxStudents: g.maxStudents,
            scheduleDays: g.scheduleDays, startTime: g.startTime, endTime: g.endTime, startDate: g.startDate, level: g.level,
          });
        } else {
          const s = p.data;
          await this.studentsService.create(tenantId, userId, { fullName: s.fullName, phone: s.phone, parentPhone: s.parentPhone, birthDate: s.birthDate, gender: s.gender, groupIds: s.groupIds, customFields: s.customFields });
        }
        created++;
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        throw new BadRequestException({
          message: `${p.row.row}-qatorda to'xtadi (${why}). ${created} ta qator saqlandi. Faylni qayta yuklang: saqlanganlari o'tkazib yuboriladi.`,
          created,
        });
      }
    }
    this.audit.log({ tenantId, userId, action: 'import', entityType: kind, entityId: kind, meta: { created, skipped: report.counts.exists } });
    return { created, skipped: report.counts.exists, report };
  }
}

function addMinutesHHMM(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
