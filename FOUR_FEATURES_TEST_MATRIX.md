# Four features — action-level test matrix (sprint 2026-10-08/09)

Columns: Screen/API | Role | Action | Expected | Actual | Evidence | Status.

Notes:
- "API" rows are exercised over HTTP against the real application on a disposable
  PostgreSQL database (`backend/test/*.e2e-spec.ts`).
- "Browser" rows drive Chromium through the built frontend (`e2e-browser/tests/*.spec.ts`).
- Google Calendar runs against an **in-memory mock**. No row claims a live provider.
- Status values: PASS, FAIL, BLOCKED, NOT TESTED.

## Security fixes

| Screen/API | Role | Action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| webhook delivery | system | URL `http://[::ffff:127.0.0.1]/` | refused | refused (old code: accepted) | outbound-url.spec | PASS |
| webhook delivery | system | DNS rebinding (public then private) | refused, 0 requests | refused, 0 requests | outbound-url.spec | PASS |
| webhook delivery | system | redirect / hung DNS / hung server / self-signed TLS | not followed / timeout / timeout / refused | as expected | outbound-url.spec | PASS |
| GET /uploads/<private> | anonymous | fetch homework file by name | 404 | 404 | file-access.e2e | PASS |
| POST /files/sign | unassigned teacher | sign another group's homework | not included | not included | file-access.e2e | PASS |
| POST /files/sign | other tenant | sign A's files | `{}` | `{}` | file-access.e2e | PASS |
| POST /portal/files/sign | other student's cabinet | sign S1's submission | `{}` | `{}` | file-access.e2e | PASS |
| GET /api/files/... | anyone | tampered / foreign / expired link | 403 | 403 | file-access.e2e | PASS |
| POST /schedule ×3 concurrent | owner | same teacher, same slot | one 201, two 409 | as expected (old code: double booking) | schedule-race.e2e | PASS |
| POST /cash/day/close | owner | close a day with 2.4 bn cash | 201, exact difference | as expected | audit-hardening.e2e | PASS |
| cabinet from parent account | parent | after guardian unlink | 401 | 401 | chat.e2e | PASS |

## F1 Custom fields

| Screen/API | Role | Action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| POST /custom-fields | manager, teacher | create definition | 403 | 403 | custom-fields.e2e | PASS |
| POST /custom-fields | owner | required SELECT on students | 201, option ids `o_…` | as expected | custom-fields.e2e | PASS |
| POST /custom-fields | owner | duplicate key | 409 | 409 | custom-fields.e2e | PASS |
| PATCH /custom-fields/:id | owner | map lead field to text student field (type mismatch) | 400 | 400 | custom-fields.e2e | PASS |
| POST /leads | owner | without required lead field | 400 with `errors[].fieldId` | as expected | custom-fields.e2e | PASS |
| POST /leads/:id/convert | owner | mapped option → student value | translated id | as expected | custom-fields.e2e | PASS |
| POST /leads/:id/convert | owner | unmapped option | 400 OPTION_NOT_MAPPED, lead still QUALIFIED | as expected | custom-fields.e2e | PASS |
| PATCH /students/:id | owner | edit value, reload | persisted | persisted | custom-fields.e2e | PASS |
| PATCH /students/:id | owner | clear a required field | 400 REQUIRED | 400 | custom-fields.e2e | PASS |
| archive definition | owner | archive, then read/write | value kept, write 400 FIELD_ARCHIVED | as expected | custom-fields.e2e | PASS |
| any | other tenant | read/patch definition or value | 404 / `[]` / UNKNOWN_FIELD | as expected | custom-fields.e2e | PASS |
| GET /students/:id | group teacher / unassigned teacher | read values | 200 / 404 | as expected | custom-fields.e2e | PASS |
| PATCH ×2 concurrent | owner + owner | two different fields | both kept | both kept | custom-fields.e2e | PASS |
| values | owner | `false`, `0`, `""` vs missing | kept distinct | distinct | custom-fields.e2e | PASS |
| new required field | owner | edit old record without it | 200 | 200 | custom-fields.e2e | PASS |
| type change | owner | used / unused field | 409 TYPE_LOCKED / 200 | as expected | custom-fields.e2e | PASS |
| option rename/remove | owner | rename keeps id; remove used → archived | as expected | as expected | custom-fields.e2e | PASS |
| limits | owner | 31st field, 501-char text | 400 | 400 | custom-fields.e2e | PASS |
| GET /export/students.xlsx | owner | formula-like name and value | `'=` prefixed, string cell | as expected | custom-fields.e2e | PASS |
| POST /import/students | owner | custom column by label; bad option | preview error; run creates with values | as expected | custom-fields.e2e | PASS |
| GET /portal/custom-fields | cabinet | portalVisible only | only the marked field | as expected | custom-fields.e2e | PASS |
| Settings → Custom fields | owner | create required select (UI) | listed | listed | custom-fields.spec (browser) | PASS |
| Add student modal | owner | fill field, save, open detail, edit, reload | persisted | persisted | custom-fields.spec (browser) | PASS |
| Add student modal | owner | leave required empty | inline error | shown | custom-fields.spec (browser) | PASS |
| Settings | owner | archive field → field gone from form | gone | gone | custom-fields.spec (browser) | PASS |
| Lead page + convert wizard | owner | edit lead value, convert → student value | carried | carried | custom-fields.spec (browser) | PASS |
| Mobile 390px | owner | settings/student/lead screens | no horizontal scroll | none | custom-fields.spec (browser) | PASS |

## F2 Make-up lessons

| Screen/API | Role | Action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| POST /attendance | teacher | status EXCUSED | 400 (was 500) | 400 | makeups.e2e | PASS |
| POST /makeups/credits | teacher | issue | 403 | 403 | makeups.e2e | PASS |
| POST /makeups/credits | receptionist | issue for a real absence | 201 ISSUED | as expected | makeups.e2e | PASS |
| POST /makeups/credits | receptionist | no absence / bad date / other tenant | 400 / 400 / 404 | as expected | makeups.e2e | PASS |
| POST /makeups/credits | manager | duplicate; 3 concurrent | 409; one 201 + two 409 | as expected | makeups.e2e | PASS |
| POST …/book GROUP_LESSON | receptionist | no lesson that day / own group / other tenant / teacher | 400 / 400 / 404 / 403 | as expected | makeups.e2e | PASS |
| POST …/book ×2 concurrent | receptionist | last seat | one 201, one 409 LESSON_FULL | as expected | makeups.e2e | PASS |
| POST …/book ×3 concurrent | receptionist | same credit | one 201 | one 201 | makeups.e2e | PASS |
| GET /makeups/roster | target teacher / others | see booking | name only / empty | as expected | makeups.e2e | PASS |
| POST /bookings/:id/cancel | receptionist | cancel, rebook | credit ISSUED, rebook 201 | as expected | makeups.e2e | PASS |
| POST /bookings/:id/attendance ×3 | target teacher | concurrent ATTENDED | one 201, credit USED once | as expected | makeups.e2e | PASS |
| original attendance | – | after make-up | still ABSENT | ABSENT | makeups.e2e | PASS |
| payroll | – | before/after make-up | identical | identical | makeups.e2e | PASS |
| SESSION booking | receptionist | teacher busy / student busy / room busy | 409 SLOT_TAKEN / STUDENT_BUSY / SLOT_TAKEN | as expected | makeups.e2e | PASS |
| MISSED → reinstate | session teacher / manager | forfeit, reinstate | FORFEITED; teacher 403, manager 201 | as expected | makeups.e2e | PASS |
| POST /lessons/cancellations | receptionist / manager | cancel lesson | 403 / 201; eligible list shows students | as expected | makeups.e2e | PASS |
| lesson cancel with booking | manager | cancel target lesson | booking cancelled, credit ISSUED | as expected | makeups.e2e | PASS |
| DELETE cancellation | manager | with credits / after void | 409 / 200 | as expected | makeups.e2e | PASS |
| GET /portal/makeups | cabinet | own vs other student | own only | own only | makeups.e2e | PASS |
| expiry | owner | policy 30 days; expired credit | expiresAt set; book 409 CREDIT_EXPIRED | as expected | makeups.e2e | PASS |
| Settings → make-up policy | owner | set 30 days, reload | saved, kept | kept | makeups.spec (browser) | PASS |
| Make-ups → Missed lessons | owner | issue credit with note | listed "Open"; API ISSUED, expires in 30 days | as expected | makeups.spec (browser) | PASS |
| Make-ups → Credits → Book | owner | book a seat in another group's lesson | own group not offered; only lesson days; BOOKED | as expected | makeups.spec (browser) | PASS |
| Make-ups → Roster | owner | mark attended | "Attended", buttons gone; credit USED after reload | as expected | makeups.spec (browser) | PASS |
| Schedule page | owner | this week's make-up on its day | card with time, group, date | as expected | makeups.spec (browser) | PASS |
| Group page → lesson cancellations | owner | cancel one date with reason, restore | listed; API cancelled; restored | as expected | makeups.spec (browser) | PASS |
| Cabinet → make-ups | student cabinet | see own credits and bookings | shown | shown | calendar.spec (browser) | PASS |
| Make-ups → separate SESSION booking, void, reinstate, cancel booking | owner | UI | – | – | API rows above only | NOT TESTED (browser) |
| Mobile 390px | owner | /makeups | no horizontal scroll | none | mobile.spec (browser) | PASS |

## F3 Calendar

| Screen/API | Role | Action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| POST /calendar/feed | teacher | create link | URL on PUBLIC_API_URL host, 43-char key | as expected | calendar.e2e | PASS |
| GET feed | anyone with link | teacher's lessons | own groups only, UTC times, stable UID, no money/students | as expected | calendar.e2e | PASS |
| lesson cancelled | – | feed | same UID, STATUS:CANCELLED | as expected | calendar.e2e | PASS |
| group time edit | – | feed | same UIDs, new times | as expected | calendar.e2e | PASS |
| rotate / revoke | teacher | old link | 404 | 404 | calendar.e2e | PASS |
| make-up session | session teacher, student | feeds | event once in each; cancelled → CANCELLED | as expected | calendar.e2e | PASS |
| PIN re-issue | cabinet | old cabinet link | 404 | 404 | calendar.e2e | PASS |
| guardian unlink | parent | feed | child's lessons gone | gone | calendar.e2e | PASS |
| staff removed | receptionist | center link | 404 | 404 | calendar.e2e | PASS |
| other tenant | owner B | feed | no A events | none | calendar.e2e | PASS |
| OAuth | teacher | forged state / bad code / reuse state | expired / error / expired | as expected | calendar.e2e (mock) | PASS |
| tokens at rest | – | DB row | encrypted | encrypted | calendar.e2e | PASS |
| sync | – | first sync, second sync | events once; second writes nothing | as expected | calendar.e2e (mock) | PASS |
| lost insert answer | – | retry | no duplicate (409 → patch) | as expected | calendar.e2e (mock) | PASS |
| 429 / 503 | – | backoff | attempts 1 → 2, ~2 min wait | as expected | calendar.e2e (mock) | PASS |
| restart | – | second app instance | pending sync done | done | calendar.e2e (mock) | PASS |
| choose calendar | teacher | move events | old empty, new full, user's own event kept | as expected | calendar.e2e (mock) | PASS |
| invalid_grant | – | sync | NEEDS_RECONNECT, sync now 409 | as expected | calendar.e2e (mock) | PASS |
| disconnect | teacher | – | only our events deleted, grant revoked | as expected | calendar.e2e (mock) | PASS |
| live Google | – | real OAuth + API | – | – | no credentials, network policy | BLOCKED |
| Calendar page → subscription link | staff | create, copy, fetch with a calendar client | ICS served | as expected | calendar.spec (browser) | PASS |
| Calendar page | staff | make a new link; turn off | old link 404; new link 404 after off | as expected | calendar.spec (browser) | PASS |
| Calendar page → Google | staff | Google not configured on the test server | "not set up" shown, no connect button | as expected | calendar.spec (browser) | PASS |
| Cabinet → calendar link | student cabinet | create own link | ICS of the child's lessons | as expected | calendar.spec (browser) | PASS |
| Calendar page → Google connected states | staff | connect / choose calendar / sync / disconnect UI | – | – | API rows above (mock) only | NOT TESTED (browser) |
| Mobile 390px | staff | /calendar | no horizontal scroll | none | mobile.spec (browser) | PASS |

## F4 Chat

| Screen/API | Role | Action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| POST /portal/chat/conversations | cabinet | open center conversation (twice) | same id; own student only | as expected | chat.e2e | PASS |
| GET /chat/conversations | receptionist (inbox) | list | conversation with unread 1 | as expected | chat.e2e | PASS |
| messages paging | receptionist | latest 2, then before cursor | ordered, no gaps | as expected | chat.e2e | PASS |
| sender identity | – | – | from session (cabinet student / staff) | as expected | chat.e2e | PASS |
| teacher on center conversation | teacher | read | 404 | 404 | chat.e2e | PASS |
| unread / read | cabinet | mark read; mark backwards | 0; never back | as expected | chat.e2e | PASS |
| idempotent send | receptionist | same client id twice; 4 concurrent | one message | one | chat.e2e | PASS |
| bad input | – | empty / 2001 chars / short id / bad cursor | 400 | 400 | chat.e2e | PASS |
| teacher conversation | teacher T1 / T2 / owner / receptionist | open, read, write | T1 ok; T2 404; owner read-only (403 write); receptionist 404 | as expected | chat.e2e | PASS |
| contacts | cabinet / teachers / inbox / other tenant | discovery | only own teachers / own students / 2+ letters / none | as expected | chat.e2e | PASS |
| other tenant | owner B | read, send, read-mark, open | 404 | 404 | chat.e2e | PASS |
| parent account | parent | send; after unlink | named sender; 401 | as expected | chat.e2e | PASS |
| SSE | cabinet S2, teacher | events | S2 gets group message, not S1's center; teacher gets reply | as expected | chat.e2e | PASS |
| reconnect | cabinet | `after=seq` | missed message returned | as expected | chat.e2e | PASS |
| revoke (unenroll) | teacher / cabinet | read, send, events | 404/404, no event; cabinet read-only | as expected | chat.e2e | PASS |
| revoke (staff removed) | receptionist | stream | `revoked` event, stream closed, API 401 | as expected | chat.e2e | PASS |
| revoke (new PIN) | cabinet | stream | closed | closed | chat.e2e | PASS |
| audit | owner | audit log | `chat.open`, no bodies | as expected | chat.e2e | PASS |
| /messages + cabinet (two browser contexts) | fresh teacher (A), student cabinet via phone+PIN (B) | B sends | A sees it live in the list; menu badge 1 (API agrees) | as expected | chat.spec (browser) | PASS |
| /messages | teacher | open conversation | badge clears; API unread 0 | as expected | chat.spec (browser) | PASS |
| composer | teacher | Shift+Enter newline, counter, send | B sees reply live | as expected | chat.spec (browser) | PASS |
| composer | cabinet | double-click Send; two clicks at once | exactly one stored message each | one | chat.spec (browser) | PASS |
| composer | cabinet | reply lost after server stored it → Retry | "not sent" + Retry; retry reuses id; one stored message | as expected | chat.spec (browser) | PASS |
| cabinet contacts | cabinet | new conversation | center + own teacher only | as expected | chat.spec (browser) | PASS |
| /messages?c=<id> | second teacher of same center | open by id | "conversation not found"; API 404 read and send | as expected | chat.spec (browser) | PASS |
| /messages?c=<id> | owner of another center | open by id | 404, not in list | as expected | chat.spec (browser) | PASS |
| /messages at 390px | owner (center inbox) | cabinet writes; owner replies | live both ways; list/thread are two screens; no horizontal scroll | as expected | chat.spec, mobile.spec (browser) | PASS |
| stream client | – | parser, backoff, 401 refresh once, revoked stops, abort on unmount, token only in header | as specified | as expected | chat-stream.test (13 unit) | PASS |
| merge/pending | – | merge by seq, pending by client id, body rules | as specified | as expected | chat.test (7 unit) | PASS |
| GROUP conversations UI | – | – | – | – | API rows above only | NOT TESTED (browser) |

## L-02 / contrast

| Screen/API | Role | Action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| POST/PATCH /plans | superadmin | RU/EN feature lists; clear EN | stored; public list carries them | as expected | plan-languages.e2e | PASS |
| PATCH /plans/:id | center owner | edit translations | 403 | 403 | plan-languages.e2e | PASS |
| migration 0046 | – | shipped tiers / edited tier | translated / left alone | as expected | verify-migrations scenario 9 | PASS |
| main site tariffs | visitor | UZ / RU / EN | the language's list, Uzbek fallback | as expected | landing-plans.spec (browser, 3) | PASS |

## Cross-cutting

| Screen/API | Role | Action | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|---|
| list pages | owner / teacher / other tenant | students, payments, attendance pages | totals right, no overlap, scope kept | as expected | list-pagination.e2e | PASS |
| access catalog | configurable roles | every new route in catalog or deliberately fixed; templates = guards | staff-access.e2e | PASS | staff-access.e2e | PASS |
| full browser suite | all | 20 earlier + 11 new (custom fields 3, make-ups 1, calendar 2, landing 3, chat 2) | pass | 31/31 (Chromium, 4.6 min) | e2e-browser full run | PASS |
| full backend e2e | all | 48 files | pass | 319/319 | `npm run test:e2e` | PASS |
| backend unit | – | 50 files | pass | 320/320 | `npm test` | PASS |
| frontend unit | – | node --test | pass | 46/46 | `npm test` | PASS |
