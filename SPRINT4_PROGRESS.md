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

## Next
 4 pricing race, 5 event dates + page states,
6 calendar feed, 7 make-up booking time, 8 feature checks, 9 final validation and report.

## Resume
`cd /home/user/crmApp-sprint4 && git log --oneline origin/claude/dev-feedback..HEAD` shows the local commits;
`git format-patch origin/claude/dev-feedback` exports them.
