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

test("the limits come from the plan's own numbers, never from the text", () => {
  const starter = { features: "1 filial\n50 tagacha o'quvchi\nAsosiy imkoniyatlar", entitlements: { MAX_BRANCHES: 1, MAX_STUDENTS: 50, MAX_STAFF: 3 } };
  assert.deepEqual(planFeatureLines(starter, "UZ"), ["1 filial", "50 tagacha o'quvchi", "3 tagacha xodim", "Asosiy imkoniyatlar"]);
  // The text says unlimited branches, the plan allows 5: the plan wins.
  const standard = { features: "Cheksiz filial\n500 tagacha o'quvchi\nDavomat, hisobotlar", featuresEn: "Unlimited branches\nAttendance", entitlements: { MAX_BRANCHES: 5, MAX_STUDENTS: 500 } };
  assert.deepEqual(planFeatureLines(standard, "UZ"), ["5 tagacha filial", "500 tagacha o'quvchi", "Cheksiz xodim", "Davomat, hisobotlar"]);
  assert.deepEqual(planFeatureLines(standard, "EN"), ["Up to 5 branches", "Up to 500 students", "Unlimited staff", "Attendance"]);
  // No limits set: unlimited, and the text's own limit lines are dropped.
  assert.deepEqual(planFeatureLines({ features: "Cheksiz o'quvchi\nAI tahlil", entitlements: {} }, "UZ"), ["Cheksiz filial", "Cheksiz o'quvchi", "Cheksiz xodim", "AI tahlil"]);
});

test("a feature line that only mentions students is not taken for a limit", () => {
  const plan = { features: "50 tagacha o'quvchi\nO'quvchilar uchun AI ustoz 24/7\nTelegram xabarnomalar", entitlements: { MAX_STUDENTS: 50 } };
  assert.deepEqual(planFeatureLines(plan, "UZ"), ["Cheksiz filial", "50 tagacha o'quvchi", "Cheksiz xodim", "O'quvchilar uchun AI ustoz 24/7", "Telegram xabarnomalar"]);
});
