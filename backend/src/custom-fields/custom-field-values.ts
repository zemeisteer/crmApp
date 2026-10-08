// Pure rules for custom-field values: what each type accepts, how it is
// stored, what counts as empty. Kept free of the database so the rules are
// unit-tested on their own (custom-field-values.spec.ts).

export const FIELD_TYPES = ['TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const ENTITY_TYPES = ['STUDENT', 'LEAD'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const LIMITS = {
  activeFieldsPerEntity: 30,
  optionsPerField: 50,
  labelLength: 80,
  optionLabelLength: 80,
  text: 500,
  longText: 5000,
  multiPicks: 50,
  maxAbsNumber: 1e12,
};

export interface FieldOption {
  id: string;
  label: string;
  archived?: boolean;
}

export interface FieldDef {
  id: string;
  label: string;
  fieldType: FieldType | string;
  required: boolean;
  options: FieldOption[];
  archivedAt?: Date | string | null;
}

/** A stored value: string (text, date, option id), number, boolean or a list of option ids. */
export type FieldValue = string | number | boolean | string[];

/** Present but empty: "" or no picks. `false` and `0` are answers, not empty. */
export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: string) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type Normalized = { ok: true; value: FieldValue | null } | { ok: false; error: string };

/**
 * Checks one incoming value against its field. `null` clears the value. An
 * archived option may stay chosen (it was valid when picked) but cannot be
 * newly picked.
 */
export function normalizeValue(def: FieldDef, raw: unknown, current?: FieldValue | null): Normalized {
  if (raw === null) return { ok: true, value: null };
  const live = new Set(def.options.filter((o) => !o.archived).map((o) => o.id));
  const known = new Set(def.options.map((o) => o.id));
  switch (def.fieldType) {
    case 'TEXT':
    case 'LONG_TEXT': {
      if (typeof raw !== 'string') return { ok: false, error: 'TEXT_EXPECTED' };
      const max = def.fieldType === 'TEXT' ? LIMITS.text : LIMITS.longText;
      if (raw.length > max) return { ok: false, error: 'TOO_LONG' };
      // One line for short text; control characters never.
      // eslint-disable-next-line no-control-regex
      const cleaned = def.fieldType === 'TEXT' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ') : raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
      return { ok: true, value: cleaned };
    }
    case 'NUMBER':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, error: 'NUMBER_EXPECTED' };
      if (Math.abs(raw) > LIMITS.maxAbsNumber) return { ok: false, error: 'NUMBER_TOO_LARGE' };
      return { ok: true, value: raw };
    case 'DATE':
      if (typeof raw !== 'string' || !validDate(raw)) return { ok: false, error: 'DATE_EXPECTED' };
      return { ok: true, value: raw };
    case 'BOOLEAN':
      if (typeof raw !== 'boolean') return { ok: false, error: 'BOOLEAN_EXPECTED' };
      return { ok: true, value: raw };
    case 'SELECT':
      if (typeof raw !== 'string' || !known.has(raw)) return { ok: false, error: 'UNKNOWN_OPTION' };
      if (!live.has(raw) && raw !== current) return { ok: false, error: 'OPTION_ARCHIVED' };
      return { ok: true, value: raw };
    case 'MULTI_SELECT': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) return { ok: false, error: 'LIST_EXPECTED' };
      const picks = [...new Set(raw as string[])];
      if (picks.length > LIMITS.multiPicks) return { ok: false, error: 'TOO_MANY' };
      const had = new Set(Array.isArray(current) ? current : []);
      for (const p of picks) {
        if (!known.has(p)) return { ok: false, error: 'UNKNOWN_OPTION' };
        if (!live.has(p) && !had.has(p)) return { ok: false, error: 'OPTION_ARCHIVED' };
      }
      // Stored in the field's option order, so equal sets compare equal.
      const order = def.options.map((o) => o.id);
      return { ok: true, value: picks.sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
    }
    default:
      return { ok: false, error: 'UNKNOWN_TYPE' };
  }
}

export interface FieldError {
  fieldId: string;
  label: string;
  error: string;
}

/**
 * Checks a whole form. `create`: every active required field must be
 * answered. `update`: only the fields sent are touched, and a required one
 * cannot be emptied. Unknown ids and archived fields are refused.
 * Returns the values to write (null = remove) or the errors.
 */
export function validateForm(
  defs: FieldDef[],
  input: Record<string, unknown> | undefined,
  mode: 'create' | 'update',
  current: Record<string, FieldValue> = {},
): { values: Record<string, FieldValue | null>; errors: FieldError[] } {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const values: Record<string, FieldValue | null> = {};
  const errors: FieldError[] = [];
  for (const [id, raw] of Object.entries(input ?? {})) {
    const def = byId.get(id);
    if (!def) {
      errors.push({ fieldId: id, label: id, error: 'UNKNOWN_FIELD' });
      continue;
    }
    if (def.archivedAt) {
      errors.push({ fieldId: id, label: def.label, error: 'FIELD_ARCHIVED' });
      continue;
    }
    const n = normalizeValue(def, raw, current[id]);
    if (!n.ok) {
      errors.push({ fieldId: id, label: def.label, error: n.error });
      continue;
    }
    if (def.required && isEmptyValue(n.value)) {
      errors.push({ fieldId: id, label: def.label, error: 'REQUIRED' });
      continue;
    }
    values[id] = n.value;
  }
  if (mode === 'create') {
    for (const def of defs) {
      if (def.archivedAt || !def.required) continue;
      if (!(def.id in values) && !errors.some((e) => e.fieldId === def.id)) errors.push({ fieldId: def.id, label: def.label, error: 'REQUIRED' });
    }
  }
  return { values, errors };
}

/** A lead value carried to the mapped student field: same type; options through the explicit map. */
export function mapLeadValue(leadDef: FieldDef & { optionMap?: Record<string, string> | null }, studentDef: FieldDef, value: FieldValue): Normalized {
  if (leadDef.fieldType !== studentDef.fieldType) return { ok: false, error: 'TYPE_MISMATCH' };
  const map = leadDef.optionMap ?? {};
  if (leadDef.fieldType === 'SELECT') {
    const to = typeof value === 'string' ? map[value] : undefined;
    if (!to) return { ok: false, error: 'OPTION_NOT_MAPPED' };
    return normalizeValue(studentDef, to);
  }
  if (leadDef.fieldType === 'MULTI_SELECT') {
    const list = Array.isArray(value) ? value : [];
    const to = list.map((v) => map[v]);
    if (to.some((x) => !x)) return { ok: false, error: 'OPTION_NOT_MAPPED' };
    return normalizeValue(studentDef, to);
  }
  return normalizeValue(studentDef, value);
}

/** A cell value safe for a spreadsheet: text that a spreadsheet would run as a formula gets a leading apostrophe. */
export function spreadsheetSafe(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** A value as text for exports and the cabinet. */
export function displayValue(def: FieldDef, v: FieldValue | null | undefined): string {
  if (v === null || v === undefined) return '';
  const label = (id: string) => def.options.find((o) => o.id === id)?.label ?? id;
  switch (def.fieldType) {
    case 'BOOLEAN':
      return v ? '✓' : '✗';
    case 'SELECT':
      return typeof v === 'string' ? label(v) : '';
    case 'MULTI_SELECT':
      return Array.isArray(v) ? v.map(label).join(', ') : '';
    default:
      return String(v);
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`]/g, "'").replace(/\s+/g, ' ').trim();

/** The field a spreadsheet header names: its label, or "cf:<key>" (a trailing " *" ignored). */
export function fieldForHeader<T extends FieldDef & { key: string }>(defs: T[], header: string): T | undefined {
  const h = norm(header.replace(/\s*\*$/, ''));
  if (!h) return undefined;
  if (h.startsWith('cf:')) return defs.find((d) => d.key === h.slice(3).trim());
  return defs.find((d) => norm(d.label) === h);
}

const YES = new Set(['ha', 'yes', 'true', '1', 'да', '✓', 'x', '+']);
const NO = new Set(["yo'q", 'yoq', 'no', 'false', '0', 'нет', '✗', '-']);

/** A spreadsheet cell's text as a field value (options by label); undefined for an empty cell. */
export function parseCell(def: FieldDef, text: string): { value?: unknown; error?: string } {
  const t = text.trim();
  if (!t) return {};
  switch (def.fieldType) {
    case 'NUMBER': {
      const n = Number(t.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? { value: n } : { error: 'NUMBER_EXPECTED' };
    }
    case 'BOOLEAN': {
      const v = norm(t);
      if (YES.has(v)) return { value: true };
      if (NO.has(v)) return { value: false };
      return { error: 'BOOLEAN_EXPECTED' };
    }
    case 'SELECT': {
      const o = def.options.find((x) => !x.archived && norm(x.label) === norm(t));
      return o ? { value: o.id } : { error: 'UNKNOWN_OPTION' };
    }
    case 'MULTI_SELECT': {
      const ids: string[] = [];
      for (const part of t.split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
        const o = def.options.find((x) => !x.archived && norm(x.label) === norm(part));
        if (!o) return { error: 'UNKNOWN_OPTION' };
        ids.push(o.id);
      }
      return { value: ids };
    }
    default:
      return { value: t };
  }
}
