# Sprint 4 — checkpoint

Base: `claude/dev-feedback` @ `47b4447618b0964d77824468025f99ec0b9dae10` (no newer commits on the branch at start).
Working copy: `/home/user/crmApp-sprint4`, local branch `sprint4-local`. Nothing is pushed.

## Done

### 1. Events and room bookings
- `schedule.service.ts` `findConflicts` now also reports center events in the room (`type: 'EVENT'`), so every caller
  (timetable create/update, group form, lesson move, make-up sessions, trial lessons) sees them.
  Weekly lessons: events on that weekday from the day the lesson is first held; dated: that date; a lesson
  called off that day holds nothing.
- `center-events.service.ts`: create/update/delete run in one transaction, `lockTimetable` first, then the room's
  advisory lock (`trial:r:<tenant>:<room>`, same key as trials and make-up sessions); check against lessons,
  make-up sessions and other events (`excludeEventId` for itself). 409 `ROOM_TAKEN` with `conflicts`.
- Online events and events at an outside place hold no room. An event in a room must give an end time
  (400 `END_TIME_REQUIRED`); an older one without an end holds the room at its start minute only.
- Adjacent slots (10-11 / 11-12) do not clash (strict overlap).
- Someone without `schedule.view` is told only "room taken: lesson/event/make-up (time)".
- Trial-lesson conflicts map EVENT to ROOM.
- Frontend form: shows the conflict lines; asks for the end time when a room is chosen.
- Tests: `test/center-events-rooms.e2e-spec.ts` (8 tests, incl. 4 parallel bookings -> 1x201 + 3x409, and an event
  and a lesson at once -> exactly one saved). Neighbouring suites: 63/63.

### 2. Teacher attendance per lesson, and the payroll
- `teacher_attendance` gets `schedule_id` + `start_time` (migration 0058): partial unique indexes like 0053/0055.
  Backfill binds an old mark only when exactly one live timetable row gives a lesson that day; the rest stay
  day-level and are listed by `npm run db:report-teacher-attendance-links` (read-only).
- `day()` / `mark()` / `monthStats()` use `lessons/occurrences.ts`: one entry per lesson, the row's teacher (else the
  group's), cancelled lessons listed but not markable, a batch is one transaction under `lockTimetable`,
  `LESSON_AMBIGUOUS` when a two-lesson day is marked without naming the lesson.
- Payroll: planned/absent/late/substituted all count lessons; marks of lessons called off or moved are `unmatchedMarks`
  (not counted); an old day-level mark counts once. Salary payments are never rewritten (the payroll is computed live).
- Frontend modal: one row per lesson, sends `scheduleId`, shows cancelled and old day marks.
- Tests: `test/teacher-attendance-per-lesson.e2e-spec.ts` (5); upgrade from a 0057 database with old marks checked by
  hand (bound/left/report/no drift). Unit 340/340 (schedule spec mock now answers the event query of item 1).

### 3. Custom values saved with the record
- `students.service.ts update()` and `leads.service.ts update()` wrote custom values with `this.db` after the commit;
  both now write them with the transaction's executor (`CustomFieldsService.write(tx, ...)`). Student create, lead
  create and lead -> student conversion already did. The audit entry is written only after the commit.
- Test: `test/custom-fields-atomic.e2e-spec.ts` - the real write runs inside the transaction and then throws:
  profile, status, stays (enrollment_periods), values and audit unchanged; the same for lead update, lead create and
  conversion. Fails without the fix (checked), passes with it.

### 4. Tariff translation answers
- `frontend/app/pricing/page.tsx`: an answer is applied only if the edit window (a number bumped on open/close) and
  the Uzbek text are still the ones it was asked for, and only to lists not typed into since (refs read when the
  answer arrives, not the request's stale state). Clearing the Uzbek text, closing the window or opening another
  tariff drops answers on their way. Save sends one version: a list translated from an older Uzbek text is
  translated again for this one; a hand-typed list is saved as typed. The Uzbek list now has a real label.
- Test: `e2e-browser/tests/pricing-translation.spec.ts` - every translation request is held and answered by the test,
  late and in reverse order; typing meanwhile, cleared text, closed window, save at once. Passes twice; with the old
  page it fails at "typed meanwhile" (checked).

### 5. Event dates and the timetable's event states
- Server: create, update and list check dates with the strict `isDate` (lessons/occurrences.ts, round trip, no
  Date.UTC normalisation). 2026-02-30, 2026-13-01, 2026-00-10, 2026-04-31, 2027-02-29 and 2026-1-05 refused;
  2028-02-29 accepted (test added to `center-events-rooms.e2e-spec.ts`).
- Page: `events` is null until loaded; a failed load shows an error with "Qayta urinish" (never "no events"); a failed
  refresh keeps the earlier list and says it may be out of date. Browser test
  `e2e-browser/tests/schedule-events-states.spec.ts` (load fails -> retry -> save + failed refresh -> retry -> empty).

### 6. Center events in the calendars
- `calendar-events.service.ts` adds center events to the one list ICS and Google use: UID `cev-<id>` (stable through
  edits), start/end from the center's zone, location = room + place, or the link when online; description + link.
  Audience on the server: STAFF -> office + teachers; STUDENTS -> students + parents (+ office); ALL -> everyone.
  No end time: end = start (zero-length; RFC 5545 meaning of a missing DTEND; Google accepts it).
- Deleted events leave the list, so the sync deletes them from Google; the sync's deterministic Google ids keep a
  retry from making a copy. `CalendarTouch` on the events controller marks calendars due after each write.
- Test: `test/calendar-center-events.e2e-spec.ts` (audience per scope; ICS times/UID/location/zero-length; Google:
  lost answer + retry = one event, edit patches in place, delete removes). Calendar suites 52/52.
- BLOCKED: a check against the real Google (no credentials / consent in this environment).

### 7. Make-up booking time
- Server (`makeups.service.ts book()`): an ordinary booking is for a lesson that has not begun - checked inside the
  transaction at the moment of saving, in the center's zone, for GROUP_LESSON and SESSION alike (409 `LESSON_STARTED`).
- A correction afterwards: `historical: true` + `reason` (>= 5 chars), access key `makeups.correct` (template: manager;
  owner/admin always), 30 days back at most, never for a lesson still to come (`NOT_HISTORICAL`); audited as
  `makeup.book_historical` with the reason. Expiry, seats, teacher/room/student clashes and the locks are unchanged.
- Form: re-checks the picked lesson's start on Save.
- Tests: `test/makeups-booking-time.e2e-spec.ts` (begun refused in both modes; lesson begins while the form is open -
  server clock moved; correction: 403 / 400 / 400 / 201 + audit). Two existing tests booked past lessons: now explicit
  corrections (`attendance-per-lesson`, `lesson-identity` - reception 403, owner 201). Browser `calendar.spec.ts`
  booked today's 15:00 lesson (fails after 15:00): now tomorrow's. `calendar.e2e-spec.ts` "no money" check now looks for
  the price (777 000), not any "777" (could appear in a random id).

### 8. The new features as used
- Leads' other directions: the list filter (`desiredSubjectId`) now matches the main one or any other
  (`= ANY(extra_subject_ids)`), and the CSV export has an `otherSubjects` column. The form no longer wipes the
  others when the main one is cleared (it sent `[]`), keeps the section shown while any are chosen, and shows an
  archived one (marked) so it can be seen and taken off. The direction picker has an accessible name.
- Group form: the teacher list already keeps the chosen teacher of another direction (checked, no change).
- Debtor -> payment: student and remaining debt were right; the month is now the debtor list's own month (not the
  month picker's, which may be loading another).
- Landing on a phone (390px): the header was 429px wide - the menu button was half off-screen and the page scrolled
  sideways. Below 440px "Bepul boshlash" leaves the header (it is in the hero and now in the menu).
- Tests: lead directions e2e added to `center-events-and-lead-subjects.e2e-spec.ts`; browser
  `e2e-browser/tests/new-features.spec.ts` (debtor payment, lead directions, group form + keyboard, landing menu).
- Chat regression: the existing `chat.spec.ts` / `timetable-and-access.spec.ts` (two accounts, live delivery,
  reconnect, unread badge, permission withdrawn) run in the final browser pass.

### 9. Final validation (all on this branch's last commit)
- Backend: tsc clean, oxlint clean, unit 340/340, e2e 482/482 (61+5 suites), build OK.
- Frontend: tsc clean, eslint 0 errors / 76 warnings (the same 76 as the base commit), unit 55/55, production build OK.
- Browser (Playwright, production builds, disposable DB): 53/53; Google (local fake Google): 1/1.
- Migrations: 59 in journal and files; verify-migrations chain OK; fresh install -> no drift; re-run -> nothing to do;
  upgrade from a 0057 database with old teacher marks -> bound/left as described, report lists the rest, no drift.
- Fixed on the way: the new access key had no name on the staff screen (catalog unit test); a sign-in in
  timetable-and-access bypassed the pacer (tuition suites hit the 8/min limit); the make-up journey booked today's
  15:00 lesson (now a 23:00 lesson).
- BLOCKED: real Google Calendar (no credentials). NOT TESTED in a browser: the teacher attendance modal, the event
  form's conflict lines, the make-up form's own submit-time check (all covered by API tests).
- No cloud preview: this container has no public address.

## Resume
`cd /home/user/crmApp-sprint4 && git log --oneline origin/claude/dev-feedback..HEAD` shows the local commits;
`git format-patch origin/claude/dev-feedback` exports them.
