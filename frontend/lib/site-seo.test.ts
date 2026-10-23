import { test } from "node:test";
import assert from "node:assert/strict";
import { siteDescription, siteJsonLd, siteUrl } from "./site-seo.ts";

const base = {
  tenant: { id: "t", name: "Ilm Markazi", subdomain: "ilm", category: "LANGUAGE", accentColor: "#000", phone: "+998901234567", address: "Toshkent", telegramUsername: "@ilm", logoUrl: "/files/logo.png" },
  site: { heroSubtitle: null, about: null, socials: { instagram: "https://instagram.com/ilm", telegram: null, youtube: "not a link", facebook: null, tiktok: null } },
  subjects: [{ subject: "Ingliz tili", courses: [], groupCount: 2 }, { subject: "Matematika", courses: [], groupCount: 1 }],
  branches: [{ id: "b", name: "Chilonzor", address: "Chilonzor 5" }],
} as never;

test("the address is the center's own verified domain, else its subdomain", () => {
  assert.equal(siteUrl({ subdomain: "ilm", customDomain: null }, "talimcrm.uz"), "https://ilm.talimcrm.uz/");
  assert.equal(siteUrl({ subdomain: "ilm", customDomain: "ilm.uz" }, "talimcrm.uz"), "https://ilm.uz/");
});

test("the description is what the center wrote (cut at 160), else what it teaches", () => {
  assert.equal(siteDescription(base), "Ilm Markazi: Ingliz tili, Matematika. Toshkent. Ariza qoldiring.");
  const long = { ...(base as object), site: { heroSubtitle: "a ".repeat(200), about: null } } as never;
  assert.ok(siteDescription(long).length <= 160);
});

test("structured data: the organisation with real links only", () => {
  const ld = siteJsonLd(base, "talimcrm.uz") as Record<string, unknown>;
  assert.equal(ld["@type"], "EducationalOrganization");
  assert.equal(ld.url, "https://ilm.talimcrm.uz/");
  assert.equal(ld.logo, "https://ilm.talimcrm.uz/files/logo.png");
  assert.deepEqual(ld.sameAs, ["https://instagram.com/ilm", "https://t.me/ilm"]);
  assert.deepEqual(ld.knowsAbout, ["Ingliz tili", "Matematika"]);
});
