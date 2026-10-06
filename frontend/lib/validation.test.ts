import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUzPhone, isCompleteUzPhone } from "./validation.ts";

test("typed digit by digit after the shown +998", () => {
  assert.equal(formatUzPhone("+998 9"), "+998 9");
  assert.equal(formatUzPhone("+998 99"), "+998 99");
  assert.equal(formatUzPhone("+998 99 812 34 56"), "+998 99 812 34 56");
});

test("pasted with or without the country code", () => {
  assert.equal(formatUzPhone("901234567"), "+998 90 123 45 67");
  assert.equal(formatUzPhone("+998901234567"), "+998 90 123 45 67");
  assert.equal(formatUzPhone("998901234567"), "+998 90 123 45 67");
  assert.equal(formatUzPhone("+998 (90) 123-45-67"), "+998 90 123 45 67");
});

test("a full number pasted after the +998 the field already shows", () => {
  assert.equal(formatUzPhone("+998 +998901234567"), "+998 90 123 45 67");
  assert.equal(formatUzPhone("+998 +998 90 123 45 67"), "+998 90 123 45 67");
  assert.equal(formatUzPhone("+998 998901234567"), "+998 90 123 45 67");
  // A local number that itself starts with 998 is kept.
  assert.equal(formatUzPhone("+998 +998998123456"), "+998 99 812 34 56");
  assert.ok(isCompleteUzPhone(formatUzPhone("+998 +998901234567")));
});
