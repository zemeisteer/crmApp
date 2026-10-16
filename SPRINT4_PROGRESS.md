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

## Next
2 teacher attendance per lesson, 3 custom fields in the transaction, 4 pricing race, 5 event dates + page states,
6 calendar feed, 7 make-up booking time, 8 feature checks, 9 final validation and report.

## Resume
`cd /home/user/crmApp-sprint4 && git log --oneline origin/claude/dev-feedback..HEAD` shows the local commits;
`git format-patch origin/claude/dev-feedback` exports them.
