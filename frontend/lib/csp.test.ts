import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, newNonce } from "./csp.ts";

test("scripts need this page's nonce; nothing inline is allowed without it", () => {
  const policy = contentSecurityPolicy("abc123", "https://api.example.uz/api");
  const script = policy.split("; ").find((d) => d.startsWith("script-src"))!;
  assert.equal(script, "script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  assert.ok(!script.includes("unsafe-inline"));
  assert.ok(policy.includes("connect-src 'self' https://api.example.uz"));
  assert.ok(policy.includes("object-src 'none'"));
});

test("a relative API address adds no origin", () => {
  assert.ok(contentSecurityPolicy("n", "/api").includes("connect-src 'self';"));
});

test("each nonce is new and long enough", () => {
  const a = newNonce();
  assert.notEqual(a, newNonce());
  assert.ok(Buffer.from(a, "base64").length === 16);
});
