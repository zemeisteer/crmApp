"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";
import { plansApi, type Plan } from "@/lib/api";
import Card from "@/components/ui/Card";

const DAY = 86_400_000;

/**
 * The center's own subscription at a glance, for the people who pay for it:
 * which plan, the trial's days left or the date it is paid until, and what
 * the next month costs. "Pay" opens the plans page with Click/Payme/card.
 */
export default function PlanCard({ index = 0 }: { index?: number }) {
  const { t, lang } = useLanguage();
  const { user, tenant } = useAuth();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const pays = user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN" || user?.role === "ACCOUNTANT";

  useEffect(() => {
    if (!pays) return;
    let alive = true;
    plansApi
      .listPublic()
      .then((list) => alive && setPlans(list))
      .catch(() => alive && setPlans([]));
    return () => {
      alive = false;
    };
  }, [pays]);

  if (!pays || !tenant) return null;
  const plan = plans?.find((p) => p.key.toUpperCase() === tenant.plan?.toUpperCase());
  const now = Date.now();
  const onTrial = tenant.status === "TRIAL";
  const trialEnd = tenant.trial?.endsAt ?? tenant.trialEndsAt;
  const trialDays = onTrial && trialEnd ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - now) / DAY)) : null;
  const paidUntil = tenant.billing?.paidUntil ?? null;
  const paidDays = paidUntil ? Math.ceil((new Date(paidUntil).getTime() - now) / DAY) : null;
  const price = plan?.price ?? null;
  const money = (n: number) => `${new Intl.NumberFormat("ru-RU").format(n).replace(/ /g, " ")} ${t("planCard.sum")}`;
  const urgent = (trialDays !== null && trialDays <= 3) || (paidDays !== null && paidDays <= 3) || tenant.billing?.suspendedForNonPayment;

  let state: string;
  if (tenant.billing?.suspendedForNonPayment) state = t("planCard.suspended");
  else if (trialDays !== null) state = trialDays > 0 ? t("planCard.trialLeft").replace("{n}", String(trialDays)) : t("planCard.trialEnded");
  else if (paidUntil) state = paidDays !== null && paidDays < 0 ? t("planCard.overdue").replace("{date}", formatDate(paidUntil, lang)) : t("planCard.paidUntil").replace("{date}", formatDate(paidUntil, lang)).replace("{n}", String(Math.max(0, paidDays ?? 0)));
  else if (price === 0) state = t("planCard.free");
  else state = t("planCard.notPaid");

  return (
    <Card index={index} padding="16px 20px">
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }} data-testid="plan-card">
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("planCard.title")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{plan?.name ?? tenant.plan}</span>
            {onTrial && <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--primary-soft)", color: "var(--primary)" }}>{t("planCard.trialBadge")}</span>}
          </div>
          <div style={{ fontSize: 13.5, marginTop: 4, fontWeight: 600, color: urgent ? "var(--danger)" : "var(--text-soft)" }}>{state}</div>
        </div>
        <div style={{ flex: "0 1 200px" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("planCard.monthly")}</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{price === null ? "—" : price === 0 ? t("planCard.freePrice") : money(price)}</div>
          {onTrial && trialEnd && price !== null && price > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{t("planCard.firstPayment").replace("{date}", formatDate(trialEnd, lang))}</div>
          )}
        </div>
        <Link href="/pricing" className="btn btn-primary" style={{ whiteSpace: "nowrap" }}>
          {price !== null && price > 0 ? t("planCard.pay") : t("planCard.change")}
        </Link>
      </div>
    </Card>
  );
}
