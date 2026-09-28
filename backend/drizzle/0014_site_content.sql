-- CRMAPP: what a center writes about itself for its public site (JSON)
-- Migration: 0014_site_content.sql (idempotent)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "site_content" text;
