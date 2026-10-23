import { test } from "node:test";
import assert from "node:assert/strict";
import { customHost } from "./domain.ts";

test("a center's own domain is recognised, with a port or a trailing dot", () => {
  assert.equal(customHost("Academy.UZ", "talimcrm.uz"), "academy.uz");
  assert.equal(customHost("www.academy.uz:443", "talimcrm.uz"), "www.academy.uz");
  assert.equal(customHost("academy.uz.", "talimcrm.uz"), "academy.uz");
});

test("the platform's own hosts, localhost and addresses are not", () => {
  for (const h of ["talimcrm.uz", "www.talimcrm.uz", "ilm.talimcrm.uz", "localhost:3000", "ilm.localhost:3100", "10.0.0.5:3000", "[::1]:3000", "intranet", "", null]) {
    assert.equal(customHost(h, "talimcrm.uz"), null, String(h));
  }
});
