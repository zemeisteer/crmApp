import { test } from "node:test";
import assert from "node:assert/strict";
import type { CustomFieldDef } from "./api.ts";
import { cfPayload, cfServerErrors, cfValidate, conversionPayload, draftFrom, mappedStudentValues, parseCfDate } from "./custom-fields.ts";

let n = 0;
function def(over: Partial<CustomFieldDef>): CustomFieldDef {
  n++;
  return {
    id: `f${n}`, tenantId: "t", entityType: "STUDENT", key: `k${n}`, label: `Field ${n}`, fieldType: "TEXT", required: false,
    sortOrder: n, options: [], portalVisible: false, studentFieldId: null, optionMap: null, archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  };
}

test("create sends every answered field; false and 0 are answers", () => {
  const text = def({ fieldType: "TEXT" });
  const num = def({ fieldType: "NUMBER" });
  const yes = def({ fieldType: "BOOLEAN" });
  const multi = def({ fieldType: "MULTI_SELECT", options: [{ id: "a", label: "A" }] });
  const empty = def({ fieldType: "TEXT" });
  const archived = def({ fieldType: "TEXT", archivedAt: "2026-02-01T00:00:00Z" });
  const draft = { [text.id]: "hi", [num.id]: "0", [yes.id]: false, [multi.id]: [], [empty.id]: "", [archived.id]: "x" };
  assert.deepEqual(cfPayload([text, num, yes, multi, empty, archived], draft, "create"), { [text.id]: "hi", [num.id]: 0, [yes.id]: false });
  assert.equal(cfPayload([empty], { [empty.id]: "" }, "create"), undefined);
});

test("update sends only changed fields; an emptied one as null", () => {
  const a = def({ fieldType: "TEXT" });
  const b = def({ fieldType: "SELECT", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] });
  const c = def({ fieldType: "MULTI_SELECT", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] });
  const d = def({ fieldType: "NUMBER" });
  const original = { [a.id]: "same", [b.id]: "x", [c.id]: ["x", "y"], [d.id]: 5 };
  const draft = draftFrom([a, b, c, d], original);
  assert.equal(cfPayload([a, b, c, d], draft, "update", original), undefined);
  draft[b.id] = "y";
  draft[c.id] = ["y", "x"]; // same set, other order: unchanged
  draft[d.id] = "";
  assert.deepEqual(cfPayload([a, b, c, d], draft, "update", original), { [b.id]: "y", [d.id]: null });
});

test("required: create needs an answer, update may not empty an answered field", () => {
  const r = def({ fieldType: "TEXT", required: true });
  const rb = def({ fieldType: "BOOLEAN", required: true });
  assert.deepEqual(cfValidate([r, rb], { [r.id]: "", [rb.id]: null }, "create"), { [r.id]: "REQUIRED", [rb.id]: "REQUIRED" });
  assert.deepEqual(cfValidate([r, rb], { [r.id]: "a", [rb.id]: false }, "create"), {});
  // An older record without the field stays editable.
  assert.deepEqual(cfValidate([r], { [r.id]: "" }, "update", {}), {});
  assert.deepEqual(cfValidate([r], { [r.id]: "" }, "update", { [r.id]: "was" }), { [r.id]: "REQUIRED" });
});

test("numbers and dates are checked before sending", () => {
  const num = def({ fieldType: "NUMBER" });
  const date = def({ fieldType: "DATE" });
  assert.deepEqual(cfValidate([num, date], { [num.id]: "12a", [date.id]: "2026-02-30" }, "create"), { [num.id]: "NUMBER_EXPECTED" });
  assert.deepEqual(cfValidate([num], { [num.id]: "1e13" }, "create"), { [num.id]: "NUMBER_TOO_LARGE" });
  assert.deepEqual(cfPayload([num], { [num.id]: "1 500,5" }, "create"), { [num.id]: 1500.5 });
});

test("a date is the calendar day, whatever the browser's timezone", () => {
  const d = parseCfDate("2026-03-01");
  assert.ok(d);
  assert.equal(d.getDate(), 1);
  assert.equal(d.getMonth(), 2);
  assert.equal(parseCfDate("2026-02-30"), null);
  assert.equal(parseCfDate("01.03.2026"), null);
});

test("server field errors are read from the 400 body", () => {
  assert.deepEqual(cfServerErrors({ code: "CUSTOM_FIELDS_INVALID", errors: [{ fieldId: "a", label: "A", error: "REQUIRED" }] }), { a: "REQUIRED" });
  assert.equal(cfServerErrors({ code: "OTHER" }), null);
  assert.equal(cfServerErrors(null), null);
});

test("lead values carried to student fields, options through the map", () => {
  const sSel = def({ fieldType: "SELECT", options: [{ id: "s1", label: "One" }, { id: "s2", label: "Two", archived: true }] });
  const sText = def({ fieldType: "TEXT" });
  const sArch = def({ fieldType: "TEXT", archivedAt: "2026-02-01T00:00:00Z" });
  const lSel = def({ entityType: "LEAD", fieldType: "SELECT", studentFieldId: sSel.id, optionMap: { l1: "s1", l2: "s2" } });
  const lText = def({ entityType: "LEAD", fieldType: "TEXT", studentFieldId: sText.id });
  const lArch = def({ entityType: "LEAD", fieldType: "TEXT", studentFieldId: sArch.id });
  const lNoMap = def({ entityType: "LEAD", fieldType: "TEXT" });
  const r = mappedStudentValues([lSel, lText, lArch, lNoMap], [sSel, sText, sArch], { [lSel.id]: "l1", [lText.id]: "hello", [lArch.id]: "x", [lNoMap.id]: "y" });
  assert.deepEqual(r.values, { [sSel.id]: "s1", [sText.id]: "hello" });
  assert.deepEqual(r.unmapped, []);
  // An option mapped to an archived one, or not mapped at all, cannot be carried.
  assert.deepEqual(mappedStudentValues([lSel], [sSel], { [lSel.id]: "l2" }).unmapped, [sSel.id]);
  assert.deepEqual(mappedStudentValues([lSel], [sSel], { [lSel.id]: "l9" }).unmapped, [sSel.id]);
});

test("conversion sends only what differs from the carried values", () => {
  const a = def({ fieldType: "TEXT" });
  const b = def({ fieldType: "TEXT" });
  const c = def({ fieldType: "BOOLEAN" });
  const carried = { [a.id]: "carried", [b.id]: "keep" };
  assert.equal(conversionPayload([a, b, c], { [a.id]: "carried", [b.id]: "keep", [c.id]: null }, carried), undefined);
  assert.deepEqual(conversionPayload([a, b, c], { [a.id]: "changed", [b.id]: "", [c.id]: false }, carried), { [a.id]: "changed", [b.id]: null, [c.id]: false });
});
