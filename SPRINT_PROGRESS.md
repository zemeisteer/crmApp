# Sprint progress — four features + security (started 2026-10-08)

Boundaries: no push, no PR, no merge, no deploy; disposable databases only;
synthetic data; external providers mocked; no tunnel.

## Starting point

| | |
|---|---|
| Remote `dev` | `fc4149b1d31186e93c63dbbd0fbbed6dc82e5d00` (not advanced since the review; CI run 95 green) |
| Local branch | `claude/admiring-goldberg-jkri02` @ `fc4149b`, tracking origin, clean tree |
| Pre-existing user changes | none (only ignored files: `backend/.env`, `frontend/.env.local`, build output, `backend/uploads/*`) |
| Container | restarted since the previous session: PostgreSQL 16 had to be started (`service postgresql start`); Redis not running (not required) |
| Databases (disposable) | `talimcrm_e2e` (backend e2e), `talimcrm_browser_e2e` (browser), `crmapp_audit` (manual runs), `talimcrm_test` |

## Baseline at `fc4149b` (run in this container, 2026-10-08, before any edit)

| Check | Command | Result |
|---|---|---|
| backend typecheck | `npx tsc --noEmit` | PASS |
| backend lint | `npm run lint` | PASS |
| migration journal | `npm run db:check-migrations` | PASS |
| backend unit | `npm run test` | **289/290 — 1 FAIL**: `outbound-url.spec.ts > accepts a public https URL` resolves `example.com` through real DNS, which this container cannot do. Environment limitation, not a code defect; the rewritten test injects a resolver. |
| backend e2e | `npm run test:e2e` | PASS 40 files, 250/250 |
| backend build | `npm run build` | PASS |
| frontend typecheck | `npx tsc --noEmit` | PASS |
| frontend lint | `npm run lint` | PASS (0 errors, 71 warnings) |
| frontend unit | `TZ=America/Los_Angeles npm test` | PASS 9/9 |
| browser | `NODE_ENV=production npm run build:frontend && npm test` | (running) |

Logs: scratchpad `sprint/baseline/*.log` (not part of the repo).

## Workstream checklist

| # | Workstream | Status |
|---|---|---|
| S1 | Outbound webhook validation + pinned transport | in progress |
| S2 | Private attachment authorization | pending |
| F1 | Custom fields | pending |
| F2 | Make-up lessons + credits | pending |
| F3 | Calendar: ICS + Google outbound | pending |
| F4 | Two-way chat | pending |
| X | Cross-feature verification, extra gaps, reports, bundle | pending |

Acceptance criteria per workstream: `FOUR_FEATURES_SPEC.md`.

## Checkpoints

(appended per workstream)
