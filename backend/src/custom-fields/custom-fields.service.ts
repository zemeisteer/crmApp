import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { customFieldDefinitions, customFieldValues, leads, students } from '../db/schema';
import {
  displayValue,
  type EntityType,
  type FieldDef,
  type FieldError,
  type FieldOption,
  type FieldValue,
  LIMITS,
  mapLeadValue,
  validateForm,
} from './custom-field-values';
import type { CreateCustomFieldDto, UpdateCustomFieldDto } from './dto/custom-field.dto';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;
export type DefinitionRow = typeof customFieldDefinitions.$inferSelect;

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

// "Ota-onaning ish joyi" -> "ota_onaning_ish_joyi": a stable key for imports
// and integrations; the label can change freely afterwards.
function keyFromLabel(label: string): string {
  const latin = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ'`’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const k = /^[a-z]/.test(latin) ? latin : `f_${latin}`;
  return (k || 'field').slice(0, 40).replace(/_+$/, '');
}

const optionId = () => `o_${randomBytes(6).toString('hex')}`;

/** A field error as the API answers it: 400 with the list, so a form can mark each field. */
export function fieldErrors(errors: FieldError[]) {
  return new BadRequestException({ code: 'CUSTOM_FIELDS_INVALID', message: errors.map((e) => `${e.label}: ${e.error}`).join('; '), errors });
}

@Injectable()
export class CustomFieldsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ---- definitions --------------------------------------------------------

  list(tenantId: string, entityType: EntityType, includeArchived = false) {
    return this.db.select().from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, entityType), includeArchived ? undefined : isNull(customFieldDefinitions.archivedAt)))
      .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.createdAt));
  }

  private async row(tenantId: string, id: string, db: Executor = this.db) {
    const [def] = await db.select().from(customFieldDefinitions).where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.tenantId, tenantId)));
    if (!def) throw new NotFoundException('Maydon topilmadi');
    return def;
  }

  private async activeCount(tenantId: string, entityType: string, db: Executor = this.db) {
    const [{ n }] = await db.select({ n: count() }).from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, entityType), isNull(customFieldDefinitions.archivedAt)));
    return Number(n);
  }

  private async valueCount(definitionId: string, db: Executor = this.db) {
    const [{ n }] = await db.select({ n: count() }).from(customFieldValues).where(eq(customFieldValues.definitionId, definitionId));
    return Number(n);
  }

  /** Option ids that some record has chosen (they are archived, never deleted). */
  private async usedOptionIds(definitionId: string, db: Executor = this.db) {
    const rows = await db.select({ value: customFieldValues.value }).from(customFieldValues).where(eq(customFieldValues.definitionId, definitionId));
    const used = new Set<string>();
    for (const r of rows) for (const v of Array.isArray(r.value) ? r.value : [r.value]) if (typeof v === 'string') used.add(v);
    return used;
  }

  private cleanOptions(fieldType: string, input: { id?: string; label: string; archived?: boolean }[] | undefined, before: FieldOption[], used: Set<string>): FieldOption[] {
    if (fieldType !== 'SELECT' && fieldType !== 'MULTI_SELECT') return [];
    const known = new Map(before.map((o) => [o.id, o]));
    const out: FieldOption[] = [];
    const labels = new Set<string>();
    for (const o of input ?? []) {
      const label = String(o.label ?? '').trim().slice(0, LIMITS.optionLabelLength);
      if (!label) throw new BadRequestException("Variant nomi bo'sh bo'lmasin");
      const id = o.id && known.has(o.id) ? o.id : optionId();
      if (out.some((x) => x.id === id)) throw new BadRequestException('Variant ikki marta berilgan');
      const archived = !!o.archived;
      if (!archived) {
        if (labels.has(label.toLowerCase())) throw new BadRequestException(`"${label}" varianti takrorlangan`);
        labels.add(label.toLowerCase());
      }
      out.push(archived ? { id, label, archived: true } : { id, label });
    }
    // An option some record has chosen is never dropped: it is kept, archived.
    for (const o of before) {
      if (!out.some((x) => x.id === o.id) && used.has(o.id)) out.push({ id: o.id, label: o.label, archived: true });
    }
    if (out.filter((o) => !o.archived).length === 0) throw new BadRequestException('Kamida bitta variant kiriting');
    if (out.filter((o) => !o.archived).length > LIMITS.optionsPerField) throw new BadRequestException(`Ko'pi bilan ${LIMITS.optionsPerField} ta variant`);
    if (out.length > LIMITS.optionsPerField * 4) throw new BadRequestException('Variantlar juda ko\'p');
    return out;
  }

  /** A lead field may carry its value to a student field of the same type, options through an explicit map. */
  private async checkMapping(tenantId: string, def: { entityType: string; fieldType: string; options: FieldOption[] }, studentFieldId: string | null | undefined, optionMap: Record<string, string> | null | undefined, db: Executor = this.db) {
    if (studentFieldId === undefined && optionMap === undefined) return {};
    if (def.entityType !== 'LEAD' && (studentFieldId || optionMap)) throw new BadRequestException("Bog'lash faqat lid maydonlari uchun");
    if (!studentFieldId) return { studentFieldId: null, optionMap: null };
    const [target] = await db.select().from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.id, studentFieldId), eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, 'STUDENT')));
    if (!target) throw new BadRequestException("O'quvchi maydoni topilmadi");
    if (target.fieldType !== def.fieldType) throw new BadRequestException("Faqat bir xil turdagi maydonlarni bog'lash mumkin");
    let map: Record<string, string> | null = null;
    if (def.fieldType === 'SELECT' || def.fieldType === 'MULTI_SELECT') {
      map = {};
      const mine = new Set(def.options.map((o) => o.id));
      const theirs = new Set(target.options.map((o) => o.id));
      for (const [from, to] of Object.entries(optionMap ?? {})) {
        if (!mine.has(from) || !theirs.has(to)) throw new BadRequestException("Variantlar bog'lanishi noto'g'ri");
        map[from] = to;
      }
    }
    return { studentFieldId: target.id, optionMap: map };
  }

  async create(tenantId: string, userId: string, dto: CreateCustomFieldDto) {
    const label = dto.label.trim().slice(0, LIMITS.labelLength);
    if (!label) throw new BadRequestException('Maydon nomini kiriting');
    const key = dto.key?.trim() || keyFromLabel(label);
    if (!KEY_RE.test(key)) throw new BadRequestException("Kalit: lotin kichik harflari, raqam va _ (harf bilan boshlanadi)");
    return this.db.transaction(async (tx) => {
      // One writer per center and entity at a time, so the limit holds under concurrency.
      await tx.execute(sqlLock(tenantId, dto.entityType));
      if ((await this.activeCount(tenantId, dto.entityType, tx)) >= LIMITS.activeFieldsPerEntity) {
        throw new BadRequestException(`Ko'pi bilan ${LIMITS.activeFieldsPerEntity} ta faol maydon`);
      }
      const options = this.cleanOptions(dto.fieldType, dto.options, [], new Set());
      const mapping = await this.checkMapping(tenantId, { entityType: dto.entityType, fieldType: dto.fieldType, options }, dto.studentFieldId, dto.optionMap, tx);
      try {
        const [def] = await tx.insert(customFieldDefinitions).values({
          tenantId,
          entityType: dto.entityType,
          key,
          label,
          fieldType: dto.fieldType,
          required: !!dto.required,
          sortOrder: dto.sortOrder ?? (await this.nextOrder(tenantId, dto.entityType, tx)),
          options,
          portalVisible: dto.entityType === 'STUDENT' ? !!dto.portalVisible : false,
          createdByUserId: userId,
          ...mapping,
        }).returning();
        this.audit.log({ tenantId, userId, action: 'custom_field.create', entityType: 'custom_field', entityId: def.id, meta: { entityType: def.entityType, key: def.key, fieldType: def.fieldType, required: def.required } });
        return def;
      } catch (err) {
        if ((err as { code?: string; cause?: { code?: string } }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') {
          throw new ConflictException({ code: 'KEY_TAKEN', message: `"${key}" kaliti band` });
        }
        throw err;
      }
    });
  }

  private async nextOrder(tenantId: string, entityType: string, db: Executor) {
    const rows = await db.select({ o: customFieldDefinitions.sortOrder }).from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, entityType)));
    return rows.length ? Math.max(...rows.map((r) => r.o)) + 1 : 0;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateCustomFieldDto) {
    return this.db.transaction(async (tx) => {
      const before = await this.row(tenantId, id, tx);
      await tx.execute(sqlLock(tenantId, before.entityType));
      const set: Partial<typeof customFieldDefinitions.$inferInsert> = { updatedAt: new Date() };
      if (dto.label !== undefined) {
        const label = dto.label.trim().slice(0, LIMITS.labelLength);
        if (!label) throw new BadRequestException('Maydon nomini kiriting');
        set.label = label;
      }
      let fieldType = before.fieldType;
      if (dto.fieldType !== undefined && dto.fieldType !== before.fieldType) {
        // Changing the type would reinterpret stored answers: only while there are none.
        if ((await this.valueCount(id, tx)) > 0) {
          throw new ConflictException({ code: 'TYPE_LOCKED', message: "Maydonda qiymatlar bor: turini o'zgartirib bo'lmaydi. Uni arxivlab, yangisini yarating." });
        }
        fieldType = dto.fieldType;
        set.fieldType = fieldType;
        if (fieldType !== 'SELECT' && fieldType !== 'MULTI_SELECT') set.options = [];
      }
      let options = before.options;
      if (dto.options !== undefined || (set.fieldType && (fieldType === 'SELECT' || fieldType === 'MULTI_SELECT'))) {
        options = this.cleanOptions(fieldType, dto.options ?? before.options, before.options, await this.usedOptionIds(id, tx));
        set.options = options;
      }
      if (dto.required !== undefined) set.required = dto.required;
      if (dto.sortOrder !== undefined) set.sortOrder = dto.sortOrder;
      if (dto.portalVisible !== undefined) set.portalVisible = before.entityType === 'STUDENT' ? dto.portalVisible : false;
      // Mapping: a new target, or a new option map for the current target.
      if (dto.studentFieldId !== undefined || dto.optionMap !== undefined) {
        const target = dto.studentFieldId !== undefined ? dto.studentFieldId : before.studentFieldId;
        Object.assign(set, await this.checkMapping(tenantId, { entityType: before.entityType, fieldType, options }, target, dto.optionMap ?? before.optionMap, tx));
      }
      // A type change unlinks a mapping that no longer fits.
      if (set.fieldType && before.studentFieldId && set.studentFieldId === undefined) {
        set.studentFieldId = null;
        set.optionMap = null;
      }
      const [def] = await tx.update(customFieldDefinitions).set(set).where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.tenantId, tenantId))).returning();
      this.audit.log({ tenantId, userId, action: 'custom_field.update', entityType: 'custom_field', entityId: id, meta: { changed: Object.keys(set).filter((k) => k !== 'updatedAt') } });
      return def;
    });
  }

  /** Archived: hidden from forms, never required, values kept (and still exported). */
  async archive(tenantId: string, userId: string, id: string) {
    const def = await this.row(tenantId, id);
    if (def.archivedAt) return def;
    const [row] = await this.db.update(customFieldDefinitions).set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.tenantId, tenantId))).returning();
    this.audit.log({ tenantId, userId, action: 'custom_field.archive', entityType: 'custom_field', entityId: id });
    return row;
  }

  async restore(tenantId: string, userId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const def = await this.row(tenantId, id, tx);
      if (!def.archivedAt) return def;
      await tx.execute(sqlLock(tenantId, def.entityType));
      if ((await this.activeCount(tenantId, def.entityType, tx)) >= LIMITS.activeFieldsPerEntity) {
        throw new BadRequestException(`Ko'pi bilan ${LIMITS.activeFieldsPerEntity} ta faol maydon`);
      }
      const [row] = await tx.update(customFieldDefinitions).set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.tenantId, tenantId))).returning();
      this.audit.log({ tenantId, userId, action: 'custom_field.restore', entityType: 'custom_field', entityId: id });
      return row;
    });
  }

  // ---- values -------------------------------------------------------------

  private col(entityType: EntityType) {
    return entityType === 'STUDENT' ? customFieldValues.studentId : customFieldValues.leadId;
  }

  /** All stored values of a record: definition id -> value (archived fields included). */
  async valuesOf(tenantId: string, entityType: EntityType, entityId: string, db: Executor = this.db): Promise<Record<string, FieldValue>> {
    const rows = await db.select({ definitionId: customFieldValues.definitionId, value: customFieldValues.value }).from(customFieldValues)
      .where(and(eq(customFieldValues.tenantId, tenantId), eq(this.col(entityType), entityId)));
    return Object.fromEntries(rows.map((r) => [r.definitionId, r.value as FieldValue]));
  }

  /**
   * Checks a form's custom values for a record (create: required fields
   * must be answered). Throws 400 with every field error. The caller writes
   * the result with `write` once the record itself is saved.
   */
  async validate(tenantId: string, entityType: EntityType, input: Record<string, unknown> | undefined, mode: 'create' | 'update', entityId?: string, db: Executor = this.db) {
    if (mode === 'update' && (!input || Object.keys(input).length === 0)) return {};
    const defs = await db.select().from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, entityType)));
    const current = entityId ? await this.valuesOf(tenantId, entityType, entityId, db) : {};
    const { values, errors } = validateForm(defs as FieldDef[], input, mode, current);
    if (errors.length) throw fieldErrors(errors);
    return values;
  }

  /** Writes checked values: one row per field, so two people editing different fields never undo each other. */
  async write(db: Executor, tenantId: string, entityType: EntityType, entityId: string, values: Record<string, FieldValue | null>, userId: string | null) {
    const now = new Date();
    for (const [definitionId, value] of Object.entries(values)) {
      const col = this.col(entityType);
      if (value === null) {
        await db.delete(customFieldValues).where(and(eq(customFieldValues.definitionId, definitionId), eq(col, entityId), eq(customFieldValues.tenantId, tenantId)));
        continue;
      }
      await db.insert(customFieldValues).values({
        tenantId, definitionId, value, updatedAt: now, updatedByUserId: userId,
        ...(entityType === 'STUDENT' ? { studentId: entityId } : { leadId: entityId }),
      }).onConflictDoUpdate({ target: [customFieldValues.definitionId, col], set: { value, updatedAt: now, updatedByUserId: userId } });
    }
  }

  /** Values for a record known to exist in this center (the caller checked access). */
  async read(tenantId: string, entityType: EntityType, entityId: string) {
    return this.valuesOf(tenantId, entityType, entityId);
  }

  /**
   * The student values a converted lead carries over: each lead field mapped
   * to a student field, options through its map, then the convert form's own
   * values on top. A mapped value that cannot be carried is an error, never
   * silently dropped. For an existing student, a field it already has is
   * left as it is unless the form sets it.
   */
  async valuesForConversion(tenantId: string, leadId: string, overrides: Record<string, unknown> | undefined, existingStudentId: string | null, db: Executor = this.db) {
    const defs = await db.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.tenantId, tenantId));
    const byId = new Map(defs.map((d) => [d.id, d]));
    const leadValues = await this.valuesOf(tenantId, 'LEAD', leadId, db);
    const studentNow = existingStudentId ? await this.valuesOf(tenantId, 'STUDENT', existingStudentId, db) : {};
    const carried: Record<string, unknown> = {};
    const errors: FieldError[] = [];
    for (const [defId, value] of Object.entries(leadValues)) {
      const leadDef = byId.get(defId);
      if (!leadDef?.studentFieldId) continue;
      const target = byId.get(leadDef.studentFieldId);
      if (!target || target.archivedAt) continue;
      if (target.id in studentNow) continue;
      if (overrides && target.id in overrides) continue;
      const m = mapLeadValue(leadDef as FieldDef & { optionMap: Record<string, string> | null }, target as FieldDef, value);
      if (!m.ok) errors.push({ fieldId: target.id, label: target.label, error: m.error });
      else if (m.value !== null) carried[target.id] = m.value;
    }
    if (errors.length) throw fieldErrors(errors);
    const merged = { ...carried, ...overrides };
    if (existingStudentId) return this.validate(tenantId, 'STUDENT', merged, 'update', existingStudentId, db);
    return this.validate(tenantId, 'STUDENT', merged, 'create', undefined, db);
  }

  /** The student's fields the center shows in the cabinet (portalVisible), as label and text. */
  async portalFields(tenantId: string, studentId: string) {
    const defs = await this.db.select().from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, 'STUDENT'), eq(customFieldDefinitions.portalVisible, true), isNull(customFieldDefinitions.archivedAt)))
      .orderBy(asc(customFieldDefinitions.sortOrder));
    if (defs.length === 0) return [];
    const values = await this.valuesOf(tenantId, 'STUDENT', studentId);
    return defs.filter((d) => d.id in values).map((d) => ({ id: d.id, label: d.label, value: displayValue(d as FieldDef, values[d.id]) }));
  }

  /** Export columns: every student field (archived ones marked), and each student's text per field. */
  async exportColumns(tenantId: string, studentIds: string[]) {
    const defs = await this.db.select().from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, 'STUDENT')))
      .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.createdAt));
    const rows = studentIds.length && defs.length
      ? await this.db.select().from(customFieldValues).where(and(eq(customFieldValues.tenantId, tenantId), inArray(customFieldValues.definitionId, defs.map((d) => d.id))))
      : [];
    const byStudent = new Map<string, Record<string, FieldValue>>();
    for (const r of rows) {
      if (!r.studentId) continue;
      const m = byStudent.get(r.studentId) ?? {};
      m[r.definitionId] = r.value as FieldValue;
      byStudent.set(r.studentId, m);
    }
    return {
      columns: defs.map((d) => ({ id: d.id, header: d.archivedAt ? `${d.label} (arxiv)` : d.label })),
      text: (studentId: string, defId: string) => {
        const d = defs.find((x) => x.id === defId)!;
        return displayValue(d as FieldDef, byStudent.get(studentId)?.[defId]);
      },
    };
  }

  /** Whether `entityId` is a record of this center (values never attach to another center's record). */
  async assertEntity(tenantId: string, entityType: EntityType, entityId: string, db: Executor = this.db) {
    const table = entityType === 'STUDENT' ? students : leads;
    const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, entityId), eq(table.tenantId, tenantId)));
    if (!row) throw new NotFoundException('Topilmadi');
  }
}

function sqlLock(tenantId: string, entityType: string) {
  return sql`select pg_advisory_xact_lock(hashtext(${`cf:${tenantId}:${entityType}`}))`;
}
