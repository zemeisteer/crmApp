// Pure rules for the center's own fields in forms: the draft a form edits,
// what it sends, what the server would refuse. Mirrors
// backend/src/custom-fields/custom-field-values.ts so a form can mark a
// field before the request; the server checks everything again.
// No runtime imports: unit-tested with node --test (custom-fields.test.ts).

import type { CustomFieldDef, CustomFieldPayload, CustomFieldValue } from "./api";

/**
 * A form's value for one field: text, number and date fields hold their
 * input text ("" = empty); yes/no holds true/false or null (unanswered);
 * a choice holds an option id ("" = none); a multi-choice the picked ids.
 */
export type CfDraftValue = string | boolean | null | string[];
export type CfDraft = Record<string, CfDraftValue>;
export type CfErrors = Record<string, string>;

export const CF_TEXT_MAX = 500;
export const CF_LONG_TEXT_MAX = 5000;
export const CF_MAX_ABS_NUMBER = 1e12;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Present but empty: missing, "", or no picks. `false` and `0` are answers. */
export function isEmptyCfValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Active fields in their order (archived ones never appear in forms). */
export function activeDefs(defs: CustomFieldDef[]): CustomFieldDef[] {
  return defs.filter((d) => !d.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

/** A stored value as the form's draft. */
export function toDraft(def: CustomFieldDef, v: CustomFieldValue | null | undefined): CfDraftValue {
  switch (def.fieldType) {
    case "BOOLEAN":
      return typeof v === "boolean" ? v : null;
    case "MULTI_SELECT":
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    case "NUMBER":
      return typeof v === "number" ? String(v) : "";
    default:
      return typeof v === "string" ? v : "";
  }
}

/** The form's drafts for `defs` from a record's stored values. */
export function draftFrom(defs: CustomFieldDef[], values: Record<string, CustomFieldValue> | null | undefined): CfDraft {
  const out: CfDraft = {};
  for (const d of defs) out[d.id] = toDraft(d, values?.[d.id]);
  return out;
}

/** A draft as the API value; undefined = empty; NaN marks a number that does not parse. */
export function fromDraft(def: CustomFieldDef, v: CfDraftValue | undefined): CustomFieldValue | undefined {
  if (v === undefined || v === null) return undefined;
  switch (def.fieldType) {
    case "BOOLEAN":
      return typeof v === "boolean" ? v : undefined;
    case "MULTI_SELECT":
      return Array.isArray(v) && v.length > 0 ? v : undefined;
    case "NUMBER": {
      const s = typeof v === "string" ? v.trim().replace(/\s/g, "").replace(",", ".") : "";
      if (!s) return undefined;
      return Number(s);
    }
    default:
      return typeof v === "string" && v !== "" ? v : undefined;
  }
}

function sameValue(a: CustomFieldValue | undefined, b: CustomFieldValue | undefined) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((x) => set.has(x));
  }
  return a === b;
}

/** The stored value as the comparison baseline ("" counts as empty). */
function storedValue(def: CustomFieldDef, v: CustomFieldValue | undefined) {
  return fromDraft(def, toDraft(def, v));
}

/**
 * What a form sends as `customFields`. `create`: every answered field.
 * `update`: only the fields whose value changed (an emptied one as null).
 * Returns undefined when there is nothing to send.
 */
export function cfPayload(
  defs: CustomFieldDef[],
  draft: CfDraft,
  mode: "create" | "update",
  original: Record<string, CustomFieldValue> | null | undefined = {},
): CustomFieldPayload | undefined {
  const out: CustomFieldPayload = {};
  for (const def of activeDefs(defs)) {
    const now = fromDraft(def, draft[def.id]);
    if (mode === "create") {
      if (now !== undefined) out[def.id] = now;
      continue;
    }
    const before = storedValue(def, original?.[def.id]);
    if (sameValue(now, before)) continue;
    // A stored "" left empty is unchanged; a value emptied is removed.
    if (now === undefined && before === undefined) continue;
    out[def.id] = now === undefined ? null : now;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The errors the server would answer, found before sending. `create`:
 * every required field must be answered. `update`: a required field that
 * had an answer cannot be emptied (records older than the field stay
 * editable without it).
 */
export function cfValidate(
  defs: CustomFieldDef[],
  draft: CfDraft,
  mode: "create" | "update",
  original: Record<string, CustomFieldValue> | null | undefined = {},
): CfErrors {
  const errors: CfErrors = {};
  for (const def of activeDefs(defs)) {
    const raw = draft[def.id];
    const v = fromDraft(def, raw);
    if (v === undefined) {
      const had = storedValue(def, original?.[def.id]) !== undefined;
      if (def.required && (mode === "create" || had)) errors[def.id] = "REQUIRED";
      continue;
    }
    if (def.fieldType === "NUMBER") {
      if (typeof v !== "number" || !Number.isFinite(v)) errors[def.id] = "NUMBER_EXPECTED";
      else if (Math.abs(v) > CF_MAX_ABS_NUMBER) errors[def.id] = "NUMBER_TOO_LARGE";
    } else if (def.fieldType === "TEXT" && typeof v === "string" && v.length > CF_TEXT_MAX) {
      errors[def.id] = "TOO_LONG";
    } else if (def.fieldType === "LONG_TEXT" && typeof v === "string" && v.length > CF_LONG_TEXT_MAX) {
      errors[def.id] = "TOO_LONG";
    } else if (def.fieldType === "DATE" && (typeof v !== "string" || !DATE_RE.test(v))) {
      errors[def.id] = "DATE_EXPECTED";
    }
  }
  return errors;
}

/** The per-field errors of a 400 CUSTOM_FIELDS_INVALID answer (an ApiError's body), or null. */
export function cfServerErrors(body: unknown): CfErrors | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { code?: unknown; errors?: unknown };
  if (b.code !== "CUSTOM_FIELDS_INVALID" || !Array.isArray(b.errors)) return null;
  const out: CfErrors = {};
  for (const e of b.errors) {
    if (e && typeof e === "object" && typeof (e as { fieldId?: unknown }).fieldId === "string") {
      const fe = e as { fieldId: string; error?: unknown };
      if (!out[fe.fieldId]) out[fe.fieldId] = typeof fe.error === "string" ? fe.error : "INVALID";
    }
  }
  return out;
}

/** "YYYY-MM-DD" as a local date (never shifted by the browser's timezone). */
export function parseCfDate(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/**
 * The student values a lead would carry when converted: each lead field
 * mapped to an active student field of the same type, options through the
 * explicit map. `unmapped` lists student fields whose lead value cannot be
 * carried (an option without a mapping): the server would refuse those
 * unless the form answers the field itself.
 */
export function mappedStudentValues(
  leadDefs: CustomFieldDef[],
  studentDefs: CustomFieldDef[],
  leadValues: Record<string, CustomFieldValue> | null | undefined,
): { values: Record<string, CustomFieldValue>; unmapped: string[] } {
  const values: Record<string, CustomFieldValue> = {};
  const unmapped: string[] = [];
  const students = new Map(studentDefs.map((d) => [d.id, d]));
  for (const leadDef of leadDefs) {
    const value = leadValues?.[leadDef.id];
    if (value === undefined || value === null || !leadDef.studentFieldId) continue;
    const target = students.get(leadDef.studentFieldId);
    if (!target || target.archivedAt || target.fieldType !== leadDef.fieldType) continue;
    const map = leadDef.optionMap ?? {};
    if (leadDef.fieldType === "SELECT") {
      const to = typeof value === "string" ? map[value] : undefined;
      if (to && target.options.some((o) => o.id === to && !o.archived)) values[target.id] = to;
      else unmapped.push(target.id);
    } else if (leadDef.fieldType === "MULTI_SELECT") {
      const list = Array.isArray(value) ? value.map((v) => map[v]) : [];
      if (list.every((x) => x && target.options.some((o) => o.id === x && !o.archived))) values[target.id] = list as string[];
      else unmapped.push(target.id);
    } else {
      values[target.id] = value;
    }
  }
  return { values, unmapped };
}

/**
 * What a lead conversion sends for the student's fields: only what the
 * user changed from the carried value, or answered where nothing is
 * carried. A carried value the user emptied is sent as null, so it is not
 * carried.
 */
export function conversionPayload(
  studentDefs: CustomFieldDef[],
  draft: CfDraft,
  carried: Record<string, CustomFieldValue>,
): CustomFieldPayload | undefined {
  const out: CustomFieldPayload = {};
  for (const def of activeDefs(studentDefs)) {
    const now = fromDraft(def, draft[def.id]);
    const from = carried[def.id];
    if (from !== undefined) {
      if (sameValue(now, from)) continue;
      out[def.id] = now === undefined ? null : now;
    } else if (now !== undefined) {
      out[def.id] = now;
    }
  }
  return Object.keys(out).length ? out : undefined;
}
