-- CRMAPP: link payments taken before their month's invoice existed
-- Migration: 0010_link_loose_payments.sql (idempotent, data only)
-- Such payments were never allocated, so paid students showed as debtors.
-- Each unallocated PAID payment goes to the oldest open invoice of the same
-- student and month (only unallocated payments are touched, so re-running
-- is a no-op).
DO $$
DECLARE
  p RECORD;
  inv RECORD;
  amt integer;
BEGIN
  FOR p IN
    SELECT pay.id, pay.tenant_id, pay.student_id, pay.for_month, pay.amount, pay.invoice_id
    FROM "payments" pay
    WHERE pay.status = 'PAID'
      AND NOT EXISTS (SELECT 1 FROM "payment_allocations" a WHERE a.payment_id = pay.id)
    ORDER BY pay.paid_at
  LOOP
    SELECT * INTO inv FROM "invoices" i
    WHERE i.tenant_id = p.tenant_id AND i.student_id = p.student_id AND i.for_month = p.for_month
      AND i.status <> 'CANCELLED' AND i.remaining_amount > 0
    ORDER BY i.created_at
    LIMIT 1;
    IF FOUND THEN
      amt := LEAST(p.amount, inv.remaining_amount);
      INSERT INTO "payment_allocations" ("id", "tenant_id", "payment_id", "invoice_id", "amount")
      VALUES (md5(random()::text || p.id), p.tenant_id, p.id, inv.id, amt);
      UPDATE "invoices" SET
        amount_paid = amount_paid + amt,
        remaining_amount = GREATEST(0, remaining_amount - amt),
        status = (CASE WHEN remaining_amount - amt <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END)::invoice_status,
        paid_at = CASE WHEN remaining_amount - amt <= 0 THEN now() ELSE paid_at END,
        updated_at = now()
      WHERE id = inv.id;
      IF p.invoice_id IS NULL THEN
        UPDATE "payments" SET invoice_id = inv.id WHERE id = p.id;
      END IF;
    END IF;
  END LOOP;
END $$;
