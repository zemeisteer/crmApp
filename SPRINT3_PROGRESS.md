# Third sprint: checkpoints

Branch `claude/admiring-goldberg-jkri02`. Start: `224e5ade7d2d4ea1e4523a2a302e35fe10e3c8ac`
(pushed). Work is done on the local machine (the user's choice, again), in local commits
only: nothing is pushed, no PR, no merge, no deploy. Cloud preview: BLOCKED (not a cloud
session).

CI for `224e5ad` could not be read from here (`gh` is not signed in). The brief says
backend unit 334/334, backend e2e 422/422, frontend, images and ops-scripts passed, and
browser and recovery were still running.

**Checkpoint 1: task 1 (group form conflict endpoint).** `GET /api/groups/schedule-conflicts`
now takes the viewer: the group asked about must be the center's (404 otherwise), a
teacher asks about their own groups only, an unknown or foreign teacher id answers
nothing, and the conflicts go through `redactConflicts` before the answer is built.
Test: `backend/test/group-conflicts-access.e2e-spec.ts` (3 tests; 2 of them fail on the
code before the fix).

Next: task 2 (attendance per lesson), 3 (make-up credits per lesson), 4 (membership
periods), 5 (linked modules), 6 (browser), 7 (verification, report, patch).
