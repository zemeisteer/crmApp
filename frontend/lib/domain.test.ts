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

test("a certificate's check link is on the subdomain of the center that issued it", async () => {
  const { certificateVerifyUrl, ROOT_DOMAIN } = await import("./domain.ts");
  assert.equal(certificateVerifyUrl("CERT-2026-AB12", "Ilm"), `https://ilm.${ROOT_DOMAIN}/verify/CERT-2026-AB12`);
  assert.equal(certificateVerifyUrl("a b/c", "ilm"), `https://ilm.${ROOT_DOMAIN}/verify/a%20b%2Fc`);
  // No center, or a label that is never a center: the link stays on this site.
  assert.equal(certificateVerifyUrl("CERT-1", null, "https://example.test"), "https://example.test/verify/CERT-1");
  assert.equal(certificateVerifyUrl("CERT-1", "www", "https://example.test"), "https://example.test/verify/CERT-1");
  assert.equal(certificateVerifyUrl("CERT-1", "bad.label", "https://example.test"), "https://example.test/verify/CERT-1");
});
