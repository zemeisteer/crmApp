// node --test (Node 22 strips the types); no test framework needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { centerTimeToIso, centerTimeZone, centerToday, centerWallClock, isoToCenterParts } from "./center-time.ts";

test("a time typed for a Tashkent center is Tashkent time, whatever the browser's zone", () => {
  // UTC+5 all year.
  assert.equal(centerTimeToIso("2026-10-05", "14:30", "Asia/Tashkent"), "2026-10-05T09:30:00.000Z");
  assert.equal(centerTimeToIso("2026-01-01", "00:15", "Asia/Tashkent"), "2025-12-31T19:15:00.000Z");
  assert.deepEqual(isoToCenterParts("2026-10-05T09:30:00.000Z", "Asia/Tashkent"), { date: "2026-10-05", time: "14:30" });
  // Near midnight the center's date differs from the UTC date.
  assert.deepEqual(isoToCenterParts("2026-10-05T20:00:00.000Z", "Asia/Tashkent"), { date: "2026-10-06", time: "01:00" });
});

test("zones with daylight saving time use the offset of that date", () => {
  assert.equal(centerTimeToIso("2026-07-01", "10:00", "Europe/Berlin"), "2026-07-01T08:00:00.000Z");
  assert.equal(centerTimeToIso("2026-12-01", "10:00", "Europe/Berlin"), "2026-12-01T09:00:00.000Z");
  // 02:30 does not exist on 2026-03-29 in Berlin: it moves forward to 03:30.
  assert.deepEqual(isoToCenterParts(centerTimeToIso("2026-03-29", "02:30", "Europe/Berlin"), "Europe/Berlin"), { date: "2026-03-29", time: "03:30" });
});

test("round trip: what is typed is what is shown back", () => {
  for (const tz of ["Asia/Tashkent", "Asia/Almaty", "Europe/Moscow", "America/New_York"]) {
    for (const [date, time] of [["2026-02-28", "23:59"], ["2026-11-01", "01:30"], ["2026-06-15", "09:00"]]) {
      assert.deepEqual(isoToCenterParts(centerTimeToIso(date, time, tz), tz), { date, time }, `${tz} ${date} ${time}`);
    }
  }
});

test("empty, malformed and unknown values", () => {
  assert.equal(centerTimeToIso("", "10:00", "Asia/Tashkent"), "");
  assert.equal(centerTimeToIso("2026-10-05", "", "Asia/Tashkent"), "");
  assert.equal(centerTimeToIso("05.10.2026", "10:00", "Asia/Tashkent"), "");
  assert.equal(centerTimeToIso("2026-13-01", "10:00", "Asia/Tashkent"), "");
  assert.equal(centerTimeToIso("2026-10-05", "24:00", "Asia/Tashkent"), "");
  assert.equal(isoToCenterParts("not a date", "Asia/Tashkent"), null);
  // An unset or unknown zone is the default, Asia/Tashkent.
  assert.equal(centerTimeZone(undefined), "Asia/Tashkent");
  assert.equal(centerTimeZone("Mars/Base"), "Asia/Tashkent");
  assert.equal(centerTimeToIso("2026-10-05", "14:30", "Mars/Base"), "2026-10-05T09:30:00.000Z");
});

test("today is the center's date", () => {
  const now = new Date("2026-10-05T20:00:00.000Z"); // 01:00 on the 6th in Tashkent
  assert.equal(centerToday("Asia/Tashkent", now), "2026-10-06");
  assert.equal(centerToday("America/New_York", now), "2026-10-05");
});

test("the center's wall clock as local Date fields", () => {
  const d = centerWallClock("2026-10-05T20:00:00.000Z", "Asia/Tashkent")!;
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 6, 1, 0]);
  assert.equal(centerWallClock("nope", "Asia/Tashkent"), null);
});
