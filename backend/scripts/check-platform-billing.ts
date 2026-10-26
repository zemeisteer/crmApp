// Read-only consistency check of platform billing (centers paying the
// platform: card receipts, Click, Payme, payments by hand) and of students'
// card receipts at their centers (receipt <-> payment). It only reads
// and reports; it never changes a row - money records are fixed by a
// person who has looked at them, not by a guess.
//
//   npx tsx scripts/check-platform-billing.ts          (exit 1 when anything is found)
//   npx tsx scripts/check-platform-billing.ts --json
import * as dotenv from 'dotenv';
dotenv.config();
import { Client } from 'pg';

type Check = { name: string; why: string; sql: string };

export const CHECKS: Check[] = [
  {
    name: 'confirmed_receipt_without_payment',
    why: 'A card receipt is CONFIRMED but points at no PAID invoice (a half-confirmed state).',
    sql: `select c.id, c.tenant_id, c.for_month, c.subscription_id, s.status as invoice_status
            from platform_payment_claims c left join platform_subscriptions s on s.id = c.subscription_id
           where c.status = 'CONFIRMED' and (s.id is null or s.status <> 'PAID')`,
  },
  {
    name: 'receipt_decided_without_reviewer',
    why: 'A receipt was decided with no reviewer or time recorded.',
    sql: `select id, tenant_id, status from platform_payment_claims
           where status in ('CONFIRMED','REJECTED') and (reviewed_by_user_id is null and reviewed_at is null)`,
  },
  {
    name: 'two_pending_receipts_for_a_month',
    why: 'More than one receipt waiting for one center and month.',
    sql: `select tenant_id, for_month, count(*)::int as n from platform_payment_claims
           where status = 'PENDING' group by tenant_id, for_month having count(*) > 1`,
  },
  {
    name: 'two_live_invoices_for_a_month',
    why: 'More than one live (not cancelled) invoice for one center and month.',
    sql: `select tenant_id, for_month, count(*)::int as n from platform_subscriptions
           where status <> 'CANCELLED' group by tenant_id, for_month having count(*) > 1`,
  },
  {
    name: 'paid_invoice_without_period',
    why: 'A PAID invoice without the period it bought (paid_at / period_start / period_end).',
    sql: `select id, tenant_id, for_month from platform_subscriptions
           where status = 'PAID' and (paid_at is null or period_start is null or period_end is null)`,
  },
  {
    name: 'paid_until_behind_payments',
    why: "A center's paid time ends before the end of its latest paid period (a payment did not extend it).",
    sql: `select t.id as tenant_id, t.paid_until, max(s.period_end) as last_period_end
            from tenants t join platform_subscriptions s on s.tenant_id = t.id and s.status = 'PAID'
           group by t.id, t.paid_until
          having t.paid_until is null or t.paid_until < max(s.period_end)`,
  },
  {
    name: 'provider_transaction_stuck',
    why: 'A provider (Payme) transaction still PENDING 12+ hours after it was opened.',
    sql: `select id, tenant_id, for_month, provider, provider_tx_id, provider_created_at from platform_subscriptions
           where status = 'PENDING' and coalesce(provider_created_at, created_at) < now() - interval '12 hours'`,
  },
  {
    name: 'provider_transaction_id_reused',
    why: 'One provider transaction id on more than one invoice.',
    sql: `select provider, provider_tx_id, count(*)::int as n from platform_subscriptions
           where provider_tx_id is not null group by provider, provider_tx_id having count(*) > 1`,
  },
  // ---- students' card receipts at their center (payment_claims) ----
  {
    name: 'student_receipt_rejected_with_payment',
    why: "A student's card receipt is REJECTED but a payment was recorded for it (money counted as received for a refused receipt).",
    sql: `select c.id as claim_id, c.tenant_id, c.student_id, p.id as payment_id, p.status as payment_status, p.amount
            from payment_claims c join payments p on p.tenant_id = c.tenant_id and p.idempotency_key = 'card-claim:' || c.id
           where c.status = 'REJECTED'`,
  },
  {
    name: 'student_receipt_pending_with_payment',
    why: "A student's card receipt still waits, but a payment was already recorded for it (a confirm stopped half way, before the fix). Confirming it links that payment.",
    sql: `select c.id as claim_id, c.tenant_id, c.student_id, p.id as payment_id, p.amount
            from payment_claims c join payments p on p.tenant_id = c.tenant_id and p.idempotency_key = 'card-claim:' || c.id
           where c.status = 'PENDING'`,
  },
  {
    name: 'student_receipt_confirmed_without_payment',
    why: "A student's card receipt is CONFIRMED but has no PAID payment of its own.",
    sql: `select c.id as claim_id, c.tenant_id, c.student_id, c.payment_id, p.status as payment_status
            from payment_claims c left join payments p on p.id = c.payment_id
           where c.status = 'CONFIRMED' and (p.id is null or p.status <> 'PAID')`,
  },
  {
    name: 'student_receipt_payment_mismatch',
    why: "A confirmed receipt and its payment disagree: amount, student, center, or the payment is not the receipt's own.",
    sql: `select c.id as claim_id, c.tenant_id, c.amount as claim_amount, p.amount as payment_amount, p.student_id, c.student_id as claim_student, p.idempotency_key
            from payment_claims c join payments p on p.id = c.payment_id
           where c.status = 'CONFIRMED'
             and (p.amount <> c.amount or p.student_id <> c.student_id or p.tenant_id <> c.tenant_id
                  or p.idempotency_key is distinct from 'card-claim:' || c.id)`,
  },
  {
    name: 'student_receipt_two_payments',
    why: 'More than one payment points at one receipt.',
    sql: `select payment_id, count(*)::int as n from payment_claims where payment_id is not null group by payment_id having count(*) > 1`,
  },
  {
    name: 'payment_allocated_beyond_amount',
    why: 'A payment is spread over invoices for more than its own amount.',
    sql: `select p.id as payment_id, p.tenant_id, p.amount, sum(a.amount)::int as allocated
            from payments p join payment_allocations a on a.payment_id = p.id
           group by p.id, p.tenant_id, p.amount having sum(a.amount) > p.amount`,
  },
  {
    name: 'payment_messages_failed',
    why: 'Payment messages (receipt sent / confirmed / rejected) that the outbox gave up on: see GET /api/platform/notice-outbox?status=FAILED.',
    sql: `select kind, channel, count(*)::int as n, max(last_error) as an_error from notice_outbox where status = 'FAILED' group by kind, channel`,
  },
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let found = 0;
  const report: Record<string, unknown[]> = {};
  try {
    await client.query('begin read only');
    for (const c of CHECKS) {
      const { rows } = await client.query(c.sql);
      report[c.name] = rows;
      found += rows.length;
    }
    await client.query('rollback');
  } finally {
    await client.end();
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const c of CHECKS) {
      const rows = report[c.name];
      console.log(`${rows.length ? '✗' : '✓'} ${c.name}: ${rows.length}`);
      if (rows.length) {
        console.log(`  ${c.why}`);
        for (const r of rows.slice(0, 20)) console.log(`  ${JSON.stringify(r)}`);
      }
    }
    console.log(found ? `\n${found} row(s) need a person to look at them. Nothing was changed.` : '\nAll consistent. Nothing was changed.');
  }
  process.exit(found ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
