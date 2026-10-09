import { test } from "node:test";
import assert from "node:assert/strict";
import { planFeatureLines } from "./plans.ts";

const plan = { features: "Bir\r\n Ikki \n\n", featuresRu: "Один\nДва", featuresEn: "" };

test("each language shows its own list", () => {
  assert.deepEqual(planFeatureLines(plan, "UZ"), ["Bir", "Ikki"]);
  assert.deepEqual(planFeatureLines(plan, "RU"), ["Один", "Два"]);
});

test("a language without its own list falls back to Uzbek", () => {
  assert.deepEqual(planFeatureLines(plan, "EN"), ["Bir", "Ikki"]);
  assert.deepEqual(planFeatureLines({ features: "Bir", featuresEn: " \n " }, "EN"), ["Bir"]);
  assert.deepEqual(planFeatureLines({ features: "Bir" }, "RU"), ["Bir"]);
});
