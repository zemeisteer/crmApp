import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPage, fill, pageCount, pageQuery, pageRange, parsePageParam, slicePage } from "./list-paging.ts";

test("page count: at least one page, a partial last page counts", () => {
  assert.equal(pageCount(0, 20), 1);
  assert.equal(pageCount(20, 20), 1);
  assert.equal(pageCount(21, 20), 2);
  assert.equal(pageCount(45, 20), 3);
});

test("a page past the end (last row deleted) falls back to the last page", () => {
  assert.equal(clampPage(3, 41, 20), 3);
  assert.equal(clampPage(3, 40, 20), 2);
  assert.equal(clampPage(2, 0, 20), 1);
  assert.equal(clampPage(0, 100, 20), 1);
  assert.equal(clampPage(Number.NaN, 100, 20), 1);
});

test("the range of rows shown: x–y of N", () => {
  assert.deepEqual(pageRange(1, 20, 45, 20), { from: 1, to: 20 });
  assert.deepEqual(pageRange(3, 20, 45, 5), { from: 41, to: 45 });
  assert.deepEqual(pageRange(1, 20, 0, 0), { from: 0, to: 0 });
});

test("page numbers from the address bar", () => {
  assert.equal(parsePageParam("2"), 2);
  assert.equal(parsePageParam(null), 1);
  assert.equal(parsePageParam("0"), 1);
  assert.equal(parsePageParam("-3"), 1);
  assert.equal(parsePageParam("2.5"), 1);
  assert.equal(parsePageParam("abc"), 1);
});

test("query strings leave out empty filters and encode the rest", () => {
  assert.equal(pageQuery({ search: "", page: 1, pageSize: 20, status: undefined }), "?page=1&pageSize=20");
  assert.equal(pageQuery({ search: "Ali & Vali" }), "?search=Ali+%26+Vali");
  assert.equal(pageQuery({ method: null }), "");
});

test("a list in memory pages like the server does", () => {
  const rows = Array.from({ length: 45 }, (_, i) => i + 1);
  const p3 = slicePage(rows, 3, 20);
  assert.deepEqual(p3, { items: [41, 42, 43, 44, 45], total: 45, page: 3, pageSize: 20 });
  assert.equal(slicePage(rows, 4, 20).items.length, 0);
});

test("placeholders are filled, unknown ones kept", () => {
  assert.equal(fill("{from}–{to} of {total}", { from: 21, to: 25, total: 25 }), "21–25 of 25");
  assert.equal(fill("{a} {b}", { a: 1 }), "1 {b}");
});
