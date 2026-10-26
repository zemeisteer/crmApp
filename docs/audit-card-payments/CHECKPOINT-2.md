# Card payments audit, round 2 — checkpoint

Start: `claude/platform-card-pay` @ `50319dffecdcd9be26f76297d1af24c32f166e7e` (confirmed, clean tree).
Run in the cloud container (PostgreSQL 16 local, synthetic data, `_e2e` databases only).
No push, no PR, no merge, no deploy.

## Status

| # | Task | State |
|---|------|-------|
| 1 | Student card receipt: payment + allocations + claim + audit + messages in one transaction | done |
| 2 | Platform receipt idempotency (request hash, file content hash) | done (API 16/16; browser spec written, run in stage 6) |
| 3 | Payment notification outbox (worker, retry, failed list) | done (`notice-outbox.e2e-spec.ts` 7/7) |
| 4 | Click/Payme callback vs invoice change race | done (`platform-billing-race.e2e-spec.ts` 7/7, 4 failed before the fix) |
| 5 | Four features deep check | todo |
| 6 | Run the site in the cloud, browser checklist | todo |
| 7 | Final checks, REPORT-2.md, patch | todo |

## Stage 1 evidence

- Reproduced on PostgreSQL before the fix (test `REPRO`, output kept in the session):
  after an injected failure on the claim update the payment stayed `PAID/150000`, the claim `PENDING`;
  a reject then returned 201 → claim `REJECTED` beside a `PAID` payment.
- Fix: `PaymentsService.createInTx` (payment, allocations, audit in the caller's transaction),
  `CardPaymentsService.confirm/reject/submit` one transaction each; messages via `notice_outbox`
  (migration 0077). Legacy PENDING-with-payment receipts: confirm links that payment, reject → 409 `PAYMENT_EXISTS`.
- `test/card-payments.e2e-spec.ts`: 12/12 (confirm vs reject, two admins, 5 parallel confirms,
  failure after the payment, reject after an interruption, retry with another amount, audit failure,
  stop after commit → outbox, legacy receipt, read-only check).
- `scripts/check-platform-billing.ts`: 7 new read-only checks (student receipts, allocations, failed messages).

## Stage 4 evidence

- Before the fix (same test file, deterministic: the test holds the invoice row lock until a backend waits on it, changes plan/amount, commits):
  Click complete activated PREMIUM for the STANDARD amount; Payme CreateTransaction opened a transaction for the old amount;
  parallel Payme CreateTransaction with one id answered -31051 to retries; Click prepare/complete went through on an invoice with an open Payme transaction (overwriting Payme's id).
- Fix: `lockInvoiceForCallback` (center payment lock, then invoice row) + checks and writes in one transaction for Click prepare/complete and Payme create/perform/cancel;
  Payme lookups only by Payme ids; a provider id already on another invoice is refused; `applyPayment` records the provider.
