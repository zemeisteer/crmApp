import { test } from "node:test";
import assert from "node:assert/strict";
import { openedFromParentAccount } from "./portal-token.ts";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: unknown) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.sig`;

test("a cabinet opened from a parent's account is told apart from a PIN sign-in", () => {
  assert.equal(openedFromParentAccount(jwt({ studentId: "s1", viewer: "parent", parentUserId: "u1", fullName: "Oʻgʻiloy Ünal" })), true);
  // Phone and PIN: a parent's number, but no account behind it.
  assert.equal(openedFromParentAccount(jwt({ studentId: "s1", viewer: "parent" })), false);
  // The student's own cabinet.
  assert.equal(openedFromParentAccount(jwt({ studentId: "s1", viewer: "student" })), false);
  assert.equal(openedFromParentAccount(jwt({ studentId: "s1", viewer: "student", parentUserId: "u1" })), false);
  assert.equal(openedFromParentAccount(jwt({ studentId: "s1", viewer: "parent", parentUserId: "" })), false);
});

test("anything that is not a readable token is not a parent account", () => {
  for (const t of [null, undefined, "", "abc", "a.b.c", "a..c", `x.${b64url("[1,2]")}.y`, `x.${b64url("null")}.y`]) {
    assert.equal(openedFromParentAccount(t), false, String(t));
  }
});
