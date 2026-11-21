import { test } from "node:test";
import assert from "node:assert/strict";
import { qrPath } from "./qr.ts";

test("a QR code has the three corner squares every scanner looks for", () => {
  const { d, size } = qrPath("CRMAPP:STUDENT:k79agkgyd9lq0abc");
  // Version 1-4 for a short text: 21-33 modules a side.
  assert.ok(size >= 21 && size <= 33 && (size - 21) % 4 === 0, `size ${size}`);
  // The first row starts with the top-left finder (7 dark modules) and holds the top-right one.
  assert.ok(d.startsWith("M0 0h7v1h-7z"));
  assert.ok(d.includes(`M${size - 7} 0h7v1h-7z`));
  // Bottom-left finder: its first row is at size - 7, starting in column 0.
  assert.ok(d.includes(`M0 ${size - 7}h7v1h-7z`));
});

test("the same text always gives the same code, another text another one", () => {
  assert.equal(qrPath("CRMAPP:STUDENT:a").d, qrPath("CRMAPP:STUDENT:a").d);
  assert.notEqual(qrPath("CRMAPP:STUDENT:a").d, qrPath("CRMAPP:STUDENT:b").d);
});

test("a longer text grows the code, and unicode text is accepted", () => {
  assert.ok(qrPath("x".repeat(120)).size > qrPath("x").size);
  assert.ok(qrPath("O'quvchi Aziz — 🎓").size >= 21);
});

test("the drawn squares are exactly the library's dark modules (no cell lost or added)", async () => {
  const { default: qrcode } = await import("qrcode-generator");
  for (const text of ["CRMAPP:STUDENT:k79agkgyd9lqmw3p840m5ovp", "x", "O'quvchi Aziz — 🎓".repeat(4)]) {
    const { d, size } = qrPath(text);
    const drawn = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [col, row, run] = [Number(m[1]), Number(m[2]), Number(m[3])];
      for (let c = col; c < col + run; c++) drawn[row][c] = true;
    }
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    assert.equal(qr.getModuleCount(), size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) assert.equal(drawn[r][c], qr.isDark(r, c), `${text}: ${r},${c}`);
  }
});
