-- A day's cash can pass the int4 limit (2,147,483,647 so'm): closing such a
-- day failed with 500. The three amounts of a closing become bigint; the
-- values do not change (int4 -> bigint is exact). Re-running is a no-op.
ALTER TABLE "cash_closings" ALTER COLUMN "expected_cash" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "cash_closings" ALTER COLUMN "counted_cash" SET DATA TYPE bigint;
--> statement-breakpoint
ALTER TABLE "cash_closings" ALTER COLUMN "difference" SET DATA TYPE bigint;
