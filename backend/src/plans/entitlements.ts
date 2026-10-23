import { ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { plans, tenants } from '../db/schema';

/**
 * What a plan includes, as data (plans.entitlements), never as checks on a
 * plan's name. A key that is missing means "included / no limit", so a plan
 * nobody has configured behaves as before.
 *
 * Features (true/false):
 *   AI_TOOLS      staff AI pages (@UsesAi) and AI marking of students' work
 *   AI_TUTOR      the students' AI tutor (cabinet and Telegram)
 *   MOCK_EXAMS    mock exams and practice sets
 *   CERTIFICATES  certificates
 *   CUSTOM_DOMAIN the center's public site on its own domain
 * Limits (a number, or null for none):
 *   MAX_STUDENTS, MAX_STAFF, MAX_BRANCHES
 *
 * SMS stays with plans.smsIncluded (notifications.service.ts smsRoute).
 */
export const FEATURES = ['AI_TOOLS', 'AI_TUTOR', 'MOCK_EXAMS', 'CERTIFICATES', 'CUSTOM_DOMAIN'] as const;
export const LIMITS = ['MAX_STUDENTS', 'MAX_STAFF', 'MAX_BRANCHES'] as const;
export type Feature = (typeof FEATURES)[number];
export type Limit = (typeof LIMITS)[number];
export type Entitlements = Partial<Record<Feature, boolean> & Record<Limit, number | null>>;

export const allows = (e: Entitlements | null | undefined, f: Feature) => e?.[f] !== false;
export const limitOf = (e: Entitlements | null | undefined, l: Limit): number | null => {
  const v = e?.[l];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
};

/** The center's plan and what it includes (a plan the platform no longer lists includes everything). */
export async function entitlementsOf(db: Pick<Database, 'select'>, tenantId: string): Promise<Entitlements> {
  const [row] = await db
    .select({ entitlements: plans.entitlements })
    .from(tenants)
    .leftJoin(plans, eq(plans.key, tenants.plan))
    .where(eq(tenants.id, tenantId));
  return (row?.entitlements as Entitlements | null) ?? {};
}

const LABELS: Record<Feature, string> = {
  AI_TOOLS: 'AI vositalari',
  AI_TUTOR: "O'quvchilar uchun AI ustoz",
  MOCK_EXAMS: 'Mock imtihonlar',
  CERTIFICATES: 'Sertifikatlar',
  CUSTOM_DOMAIN: "O'z domeni",
};

export const notInPlan = (f: Feature) =>
  new ForbiddenException({ code: 'PLAN_FEATURE', feature: f, message: `"${LABELS[f]}" tarifingizga kiritilmagan. Tarifni yangilang.` });

export const planLimitReached = (what: string, max: number) =>
  new ForbiddenException({ code: 'PLAN_LIMIT', message: `Tarifingizda ${max} tagacha ${what} mumkin. Ko'proq kerak bo'lsa, tarifni yangilang.` });
