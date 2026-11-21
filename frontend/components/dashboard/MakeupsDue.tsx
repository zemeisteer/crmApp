"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { makeupsApi, type MakeupCredit } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const SOON_DAYS = 3;

/**
 * Make-up credits not used yet: how many, and the ones whose time runs out
 * within three days first, so the front desk books them before they lapse.
 */
export default function MakeupsDue() {
  const { t } = useLanguage();
  const [credits, setCredits] = useState<MakeupCredit[] | null>(null);

  useEffect(() => {
    let alive = true;
    makeupsApi.credits({ status: "ISSUED" }).then((list) => alive && setCredits(list.filter((c) => !c.expired))).catch(() => alive && setCredits([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!credits || credits.length === 0) return null;
  const now = Date.now();
  const soon = credits
    .filter((c) => c.expiresAt && new Date(c.expiresAt).getTime() - now < SOON_DAYS * 86_400_000)
    .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime());
  return (
    <div data-testid="dash-makeups" style={{ background: "var(--surface)", border: `1px solid ${soon.length ? "var(--warning)" : "var(--border)"}`, borderRadius: "var(--radius-lg)", padding: "14px 18px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <b style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>🔁 {t("mk.dueTitle").replace("{n}", String(credits.length))}</b>
        <Link href="/makeups" style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>{t("mk.dueOpen")} →</Link>
      </div>
      {soon.length > 0 && (
        <div style={{ fontSize: 13, color: "var(--warning)", fontWeight: 600 }}>
          ⏳ {t("mk.dueSoon")}: {soon.slice(0, 5).map((c) => `${c.student?.fullName ?? ""} (${c.expiresAt!.slice(0, 10)})`).join(", ")}
        </div>
      )}
    </div>
  );
}
