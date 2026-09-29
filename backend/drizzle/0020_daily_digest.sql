-- CRMAPP: evening summary for owners/admins in the Telegram bot
-- Migration: 0020_daily_digest.sql (idempotent)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "daily_digest" boolean DEFAULT true NOT NULL;
