import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, daysBetween, googleReturn, googleSubscribeUrl, localDate, makeupErrorCode, rangeProblem, validTimeRange, webcalUrl, weekdayIndex,
} from "./makeups.ts";

test("date arithmetic works on calendar dates, across months and DST", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-11-01", 30), "2026-12-01");
  assert.equal(daysBetween("2026-10-09", "2027-02-06"), 120);
  assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
});

test("a date string formats as that day in any browser timezone", () => {
  const d = localDate("2026-10-09")!;
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 9, 9]);
  assert.equal(localDate("9.10.2026"), null);
  assert.equal(weekdayIndex("2026-10-12"), 0); // Monday
  assert.equal(weekdayIndex("2026-10-11"), 6); // Sunday
});

test("ranges longer than the server accepts are refused before the request", () => {
  assert.equal(rangeProblem("2026-10-01", "2026-10-31"), null);
  assert.equal(rangeProblem("2026-10-01", "2027-01-29"), null);
  assert.equal(rangeProblem("2026-10-01", "2027-01-30"), "TOO_LONG");
  assert.equal(rangeProblem("2026-10-31", "2026-10-01"), "INVALID");
  assert.equal(rangeProblem("", "2026-10-01"), "INVALID");
});

test("only known server codes are translated", () => {
  assert.equal(makeupErrorCode({ body: { code: "LESSON_FULL", message: "x" } }), "LESSON_FULL");
  assert.equal(makeupErrorCode({ body: { code: "SOMETHING_ELSE" } }), null);
  assert.equal(makeupErrorCode({ body: null }), null);
  assert.equal(makeupErrorCode(new Error("x")), null);
  assert.equal(makeupErrorCode(null), null);
});

test("session times must be HH:MM with the end after the start", () => {
  assert.ok(validTimeRange("14:00", "15:30"));
  assert.ok(!validTimeRange("15:30", "15:30"));
  assert.ok(!validTimeRange("16:00", "15:30"));
  assert.ok(!validTimeRange("9:00", "10:00"));
});

test("subscription links for calendar apps", () => {
  const url = "https://api.example.uz/api/calendar/feed/abc_DEF-123.ics";
  assert.equal(webcalUrl(url), "webcal://api.example.uz/api/calendar/feed/abc_DEF-123.ics");
  assert.equal(webcalUrl("http://localhost:4000/api/calendar/feed/x.ics"), "webcal://localhost:4000/api/calendar/feed/x.ics");
  assert.equal(
    googleSubscribeUrl(url),
    "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fapi.example.uz%2Fapi%2Fcalendar%2Ffeed%2Fabc_DEF-123.ics",
  );
});

test("the outcome of Google's consent screen is read from the address", () => {
  assert.equal(googleReturn("?google=connected"), "connected");
  assert.equal(googleReturn("?x=1&google=denied"), "denied");
  assert.equal(googleReturn("?google=hacked"), null);
  assert.equal(googleReturn(""), null);
});
