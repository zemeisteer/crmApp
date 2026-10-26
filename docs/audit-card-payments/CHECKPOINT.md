# Card payments audit — checkpoint

Start: branch `claude/platform-card-pay` @ `5d4aa371a07c220747d13f043d0a7894694c838e` (dev `b5c12e6`).
Work branch: `claude/card-pay-audit` (local only: no push, no PR, no merge, no deploy).
Run locally (the user's standing choice for pasted "cloud" briefs).

## Status

| # | Task | State |
|---|------|-------|
| 1 | Atomic card confirm (one transaction, lock order, idempotent, confirm/reject race, fault injection) | in progress |
| 2 | Duplicate receipts (DB constraint + idempotency key), server-side billing period | todo |
| 3 | Card vs Click/Payme clashes | todo |
| 4 | Admin/customer UI (auth/refresh, states, pagination) | todo |
| 5 | trial-purge-outbox audit flake | cause found: `AuditService.log` is not awaited and runs outside the deleting transaction |
| 6 | Security + four features regression | todo |
| 7 | Browser E2E for the card flow, competitor backlog | todo |

## Findings (confirmed in code)

- `PlatformCardService.confirm`: claim CONFIRMED, invoice paid, paidUntil, subscriptionId written in separate steps; a crash between them leaves a half-confirmed state; audit is fire-and-forget.
- `submit`: check-then-insert, no DB constraint: two parallel uploads make two PENDING claims.
- `platform_subscriptions` has one row per (tenant, month); `openInvoice` / manual payment overwrite a CANCELLED or timed-out row, losing a Payme transaction id that Payme may still query (CheckTransaction).
- The month label comes from the browser (`clock.month()` for Click/Payme, `paidUntil` month for card); `forMonth` is checked only as `YYYY-MM` (00 and 13 pass).
- `trial-purge-outbox` flake: `deleteIfStillDue` calls `AuditService.log` (not awaited, separate connection) inside the transaction: the test can count before the insert lands, and a rolled-back deletion would still leave its audit row.

## Next steps

See the table; each finished step is committed locally on `claude/card-pay-audit`.
