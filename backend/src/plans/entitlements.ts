import { ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { plans, tenants } from '../db/schema';
import { flagOn } from '../feature-flags/flags';

/**
 * What a plan includes, as data (plans.entitlements), never as checks on a
 * plan's name. A key that is missing means "included / no limit", so a plan
 * nobody has configured behaves as before - except an OPT_IN feature, which
 * is included only where it is ticked: it costs the platform money per use.
 *
 * Features (true/false):
 *   AI_TOOLS      staff AI pages (@UsesAi) and AI marking of students' work
 *   AI_TUTOR      the students' AI tutor (cabinet and Telegram)
 *   MOCK_EXAMS    mock exams and practice sets
 *   CERTIFICATES  certificates
 *   CUSTOM_DOMAIN the center's public site on its own domain
 *   TELEPHONY     IP telephony: the center's own provider account, the call log.
 *                 Opt-in: the plan ticks it, or the platform admin turns the
 *                 "telephony" switch on for the center (feature-flags/flags.ts).
 * Limits (a number, or null for none):
 *   MAX_STUDENTS, MAX_STAFF, MAX_BRANCHES
 *
 * SMS stays with plans.smsIncluded (notifications.service.ts smsRoute).
 */
export const FEATURES = ['AI_TOOLS', 'AI_TUTOR', 'MOCK_EXAMS', 'CERTIFICATES', 'CUSTOM_DOMAIN', 'TELEPHONY'] as const;
export const LIMITS = ['MAX_STUDENTS', 'MAX_STAFF', 'MAX_BRANCHES'] as const;
export type Feature = (typeof FEATURES)[number];
export type Limit = (typeof LIMITS)[number];
export type Entitlements = Partial<Record<Feature, boolean> & Record<Limit, number | null>>;

export const OPT_IN: readonly Feature[] = ['TELEPHONY'];
export const allows = (e: Entitlements | null | undefined, f: Feature) => (OPT_IN.includes(f) ? e?.[f] === true : e?.[f] !== false);
export const limitOf = (e: Entitlements | null | undefined, l: Limit): number | null => {
  const v = e?.[l];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
};

/**
 * The center's plan and what it includes (a plan the platform no longer lists
 * includes everything but the opt-in features), with the platform admin's
 * own grant of telephony for this center added.
 */
export async function entitlementsOf(db: Pick<Database, 'select'>, tenantId: string): Promise<Entitlements> {
  const [row] = await db
    .select({ entitlements: plans.entitlements })
    .from(tenants)
    .leftJoin(plans, eq(plans.key, tenants.plan))
    .where(eq(tenants.id, tenantId));
  const e = (row?.entitlements as Entitlements | null) ?? {};
  if (e.TELEPHONY !== true && (await flagOn(db, 'telephony', tenantId))) return { ...e, TELEPHONY: true };
  return e;
}

const LABELS: Record<Feature, string> = {
  AI_TOOLS: 'AI vositalari',
  AI_TUTOR: "O'quvchilar uchun AI ustoz",
  MOCK_EXAMS: 'Mock imtihonlar',
  CERTIFICATES: 'Sertifikatlar',
  CUSTOM_DOMAIN: "O'z domeni",
  TELEPHONY: 'IP telefoniya',
};

export const notInPlan = (f: Feature) =>
  new ForbiddenException({ code: 'PLAN_FEATURE', feature: f, message: `"${LABELS[f]}" tarifingizga kiritilmagan. Tarifni yangilang.` });

export const planLimitReached = (what: string, max: number) =>
  new ForbiddenException({ code: 'PLAN_LIMIT', message: `Tarifingizda ${max} tagacha ${what} mumkin. Ko'proq kerak bo'lsa, tarifni yangilang.` });
