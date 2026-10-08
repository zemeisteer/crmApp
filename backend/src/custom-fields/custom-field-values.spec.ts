import { describe, expect, it } from 'vitest';
import { displayValue, fieldForHeader, isEmptyValue, mapLeadValue, normalizeValue, parseCell, spreadsheetSafe, validateForm, type FieldDef } from './custom-field-values';

const def = (over: Partial<FieldDef> & { fieldType: string }): FieldDef => ({ id: 'f1', label: 'Field', required: false, options: [], ...over });
const select = def({ id: 'sel', label: 'Level', fieldType: 'SELECT', options: [{ id: 'a', label: 'A1' }, { id: 'b', label: 'B1' }, { id: 'old', label: 'Old', archived: true }] });
const multi = def({ id: 'mul', label: 'Days', fieldType: 'MULTI_SELECT', options: [{ id: 'mo', label: 'Mon' }, { id: 'tu', label: 'Tue' }, { id: 'we', label: 'Wed' }, { id: 'x', label: 'X', archived: true }] });

describe('normalizeValue', () => {
  it('keeps empty, false and zero distinct from missing (null clears)', () => {
    expect(normalizeValue(def({ fieldType: 'TEXT' }), '')).toEqual({ ok: true, value: '' });
    expect(normalizeValue(def({ fieldType: 'BOOLEAN' }), false)).toEqual({ ok: true, value: false });
    expect(normalizeValue(def({ fieldType: 'NUMBER' }), 0)).toEqual({ ok: true, value: 0 });
    expect(normalizeValue(def({ fieldType: 'NUMBER' }), null)).toEqual({ ok: true, value: null });
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
  });

  it('enforces each type', () => {
    expect(normalizeValue(def({ fieldType: 'NUMBER' }), '5')).toMatchObject({ ok: false });
    expect(normalizeValue(def({ fieldType: 'NUMBER' }), Number.NaN)).toMatchObject({ ok: false });
    expect(normalizeValue(def({ fieldType: 'NUMBER' }), 1e13)).toMatchObject({ ok: false, error: 'NUMBER_TOO_LARGE' });
    expect(normalizeValue(def({ fieldType: 'DATE' }), '2026-02-30')).toMatchObject({ ok: false });
    expect(normalizeValue(def({ fieldType: 'DATE' }), '2026-02-28')).toEqual({ ok: true, value: '2026-02-28' });
    expect(normalizeValue(def({ fieldType: 'BOOLEAN' }), 'true')).toMatchObject({ ok: false });
    expect(normalizeValue(def({ fieldType: 'TEXT' }), 'x'.repeat(501))).toMatchObject({ ok: false, error: 'TOO_LONG' });
    expect(normalizeValue(def({ fieldType: 'LONG_TEXT' }), 'x'.repeat(5000))).toMatchObject({ ok: true });
    expect(normalizeValue(def({ fieldType: 'TEXT' }), 'a\nb\u0000c')).toEqual({ ok: true, value: 'a b c' });
    expect(normalizeValue(def({ fieldType: 'LONG_TEXT' }), 'a\nb')).toEqual({ ok: true, value: 'a\nb' });
  });

  it('selects by stable option id; archived options only stay when already chosen', () => {
    expect(normalizeValue(select, 'a')).toEqual({ ok: true, value: 'a' });
    expect(normalizeValue(select, 'A1')).toMatchObject({ ok: false, error: 'UNKNOWN_OPTION' });
    expect(normalizeValue(select, 'old')).toMatchObject({ ok: false, error: 'OPTION_ARCHIVED' });
    expect(normalizeValue(select, 'old', 'old')).toEqual({ ok: true, value: 'old' });
    expect(normalizeValue(multi, ['we', 'mo', 'mo'])).toEqual({ ok: true, value: ['mo', 'we'] });
    expect(normalizeValue(multi, ['x'])).toMatchObject({ ok: false, error: 'OPTION_ARCHIVED' });
    expect(normalizeValue(multi, ['x', 'tu'], ['x'])).toEqual({ ok: true, value: ['tu', 'x'] });
    expect(normalizeValue(multi, 'mo')).toMatchObject({ ok: false });
  });
});

describe('validateForm', () => {
  const req = def({ id: 'req', label: 'Source', fieldType: 'SELECT', required: true, options: [{ id: 's1', label: 'Ad' }] });
  const flag = def({ id: 'flag', label: 'Consent', fieldType: 'BOOLEAN', required: true });
  const gone = def({ id: 'gone', label: 'Old field', fieldType: 'TEXT', archivedAt: new Date() });

  it('create: every active required field must be answered (false is an answer)', () => {
    expect(validateForm([req, flag, gone], {}, 'create').errors.map((e) => e.fieldId).sort()).toEqual(['flag', 'req']);
    const ok = validateForm([req, flag, gone], { req: 's1', flag: false }, 'create');
    expect(ok.errors).toEqual([]);
    expect(ok.values).toEqual({ req: 's1', flag: false });
  });

  it('update: only the fields sent; a required field cannot be emptied; archived/unknown refused', () => {
    expect(validateForm([req, flag], {}, 'update').errors).toEqual([]);
    expect(validateForm([req, flag], { req: null }, 'update').errors[0]).toMatchObject({ fieldId: 'req', error: 'REQUIRED' });
    expect(validateForm([req, gone], { gone: 'x' }, 'update').errors[0]).toMatchObject({ error: 'FIELD_ARCHIVED' });
    expect(validateForm([req], { nope: 'x' }, 'update').errors[0]).toMatchObject({ error: 'UNKNOWN_FIELD' });
  });
});

describe('mapLeadValue', () => {
  const leadSel = { ...def({ id: 'ls', fieldType: 'SELECT', options: [{ id: 'l1', label: 'IELTS' }, { id: 'l2', label: 'SAT' }] }), optionMap: { l1: 'a' } };
  it('carries through the explicit option map only', () => {
    expect(mapLeadValue(leadSel, select, 'l1')).toEqual({ ok: true, value: 'a' });
    expect(mapLeadValue(leadSel, select, 'l2')).toMatchObject({ ok: false, error: 'OPTION_NOT_MAPPED' });
    expect(mapLeadValue({ ...def({ fieldType: 'NUMBER' }) }, select, 5)).toMatchObject({ ok: false, error: 'TYPE_MISMATCH' });
    expect(mapLeadValue(def({ fieldType: 'DATE' }), def({ fieldType: 'DATE' }), '2026-01-02')).toEqual({ ok: true, value: '2026-01-02' });
  });
});

describe('spreadsheets', () => {
  it('neutralises formulas in text cells', () => {
    for (const v of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x', '\r=x']) expect(spreadsheetSafe(v)).toBe(`'${v}`);
    expect(spreadsheetSafe('Ali')).toBe('Ali');
    expect(spreadsheetSafe(-5)).toBe(-5);
  });

  it('reads cells by type and options by label', () => {
    expect(parseCell(select, 'b1')).toEqual({ value: 'b' });
    expect(parseCell(select, 'Old')).toEqual({ error: 'UNKNOWN_OPTION' });
    expect(parseCell(multi, 'Mon; Wed')).toEqual({ value: ['mo', 'we'] });
    expect(parseCell(def({ fieldType: 'BOOLEAN' }), 'ha')).toEqual({ value: true });
    expect(parseCell(def({ fieldType: 'BOOLEAN' }), "yo'q")).toEqual({ value: false });
    expect(parseCell(def({ fieldType: 'NUMBER' }), '12,5')).toEqual({ value: 12.5 });
    expect(parseCell(def({ fieldType: 'TEXT' }), '  ')).toEqual({});
  });

  it('finds a field by its label or cf:key', () => {
    const defs = [{ ...select, key: 'level' }];
    expect(fieldForHeader(defs, 'Levels')?.id).toBeUndefined();
    expect(fieldForHeader(defs, 'cf:levels')?.id).toBeUndefined();
    expect(fieldForHeader(defs, 'Level *')?.id).toBe('sel');
    expect(fieldForHeader(defs, 'cf:level')?.id).toBe('sel');
  });

  it('shows values as text', () => {
    expect(displayValue(select, 'b')).toBe('B1');
    expect(displayValue(multi, ['mo', 'tu'])).toBe('Mon, Tue');
    expect(displayValue(def({ fieldType: 'BOOLEAN' }), false)).toBe('✗');
  });
});
