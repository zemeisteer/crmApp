"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { plansApi, type Plan, PLAN_FEATURES, PLAN_LIMITS, planAllows } from "@/lib/api";
import { planFeatureLines } from "@/lib/plans";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n).replace(/,/g, " ");

/**
 * One plan explained before signing up: its price, who it suits, what it
 * includes (the platform admin's list and the features it turns on), its
 * limits, and how it compares with the other plans.
 */
export default function PlanPage() {
  const { key } = useParams<{ key: string }>();
  const { t, lang, setLang } = useLanguage();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    plansApi.listPublic().then(setPlans).catch(() => setFailed(true));
  }, []);

  const plan = plans?.find((p) => p.key.toLowerCase() === String(key).toLowerCase()) ?? null;
  const limit = (p: Plan, l: (typeof PLAN_LIMITS)[number]) => {
    const v = p.entitlements?.[l];
    return v === null || v === undefined ? t("planPage.unlimited") : String(v);
  };
  const price = (p: Plan) => (p.price > 0 ? `${money(p.price)} ${t("planPage.perMonth")}` : t("planPage.free"));
  const whoFor = (p: Plan) => {
    const students = p.entitlements?.MAX_STUDENTS;
    if (p.price === 0) return t("planPage.forFree");
    if (students && students <= 200) return t("planPage.forSmall");
    return p.popular ? t("planPage.forGrowing") : t("planPage.forLarge");
  };

  const wrap: React.CSSProperties = { maxWidth: 980, margin: "0 auto", padding: "0 20px" };
  const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24 };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <header style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "20px 20px" }}>
        <Link href="/#pricing" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-soft)", textDecoration: "none" }}>← {t("planPage.allPlans")}</Link>
        <div role="group" aria-label={t("nav.language")} style={{ display: "flex", gap: 4 }}>
          {(["UZ", "RU", "EN"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} style={{ border: "1px solid var(--border)", background: lang === l ? "var(--ink)" : "var(--surface)", color: lang === l ? "var(--on-ink)" : "var(--text-soft)", fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: "var(--radius-pill)", cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </header>

      <main style={{ ...wrap, display: "flex", flexDirection: "column", gap: 20, paddingBottom: 60 }}>
        {failed ? (
          <div style={card}>{t("common.errorGeneric")}</div>
        ) : plans === null ? (
          <div style={{ ...card, color: "var(--text-muted)" }}>{t("common.loading")}</div>
        ) : !plan ? (
          <div style={card}>
            {t("planPage.notFound")} <Link href="/#pricing" style={{ color: ACCENT, fontWeight: 700 }}>{t("planPage.allPlans")}</Link>
          </div>
        ) : (
          <>
            {/* The plan in one look */}
            <section style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 24, alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {plan.popular && <span style={{ alignSelf: "flex-start", background: ACCENT, color: "var(--on-ink)", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: "var(--radius-pill)" }}>{t("planPage.popular")}</span>}
                <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>{plan.name}</h1>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 800 }}>{price(plan)}</div>
                <p style={{ fontSize: 15, color: "var(--text-soft)", lineHeight: 1.6, margin: 0 }}>{whoFor(plan)}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Link href={`/register?plan=${encodeURIComponent(plan.key)}`} data-testid="plan-start" style={{ background: ACCENT, color: "var(--on-ink)", textAlign: "center", fontSize: 15.5, fontWeight: 700, padding: "14px 20px", borderRadius: "var(--radius-sm)", textDecoration: "none" }}>
                  {plan.price > 0 ? t("planPage.startTrial") : t("planPage.startFree")}
                </Link>
                <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.5 }}>{plan.price > 0 ? t("planPage.trialNote") : t("planPage.freeNote")}</div>
              </div>
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 20, alignItems: "start" }}>
              {/* What it includes */}
              <section style={card}>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 14px" }}>{t("planPage.includes")}</h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {planFeatureLines(plan, lang).map((line) => (
                    <li key={line} style={{ display: "flex", gap: 10, fontSize: 14.5 }}><span style={{ color: "var(--success)", fontWeight: 800 }}>✓</span>{line}</li>
                  ))}
                  {PLAN_FEATURES.filter((f) => planAllows(plan.entitlements, f)).map((f) => (
                    <li key={f} style={{ display: "flex", gap: 10, fontSize: 14.5 }}><span style={{ color: "var(--success)", fontWeight: 800 }}>✓</span>{t(`pricing.ent.${f}` as TranslationKey)}</li>
                  ))}
                  {plan.smsIncluded && <li style={{ display: "flex", gap: 10, fontSize: 14.5 }}><span style={{ color: "var(--success)", fontWeight: 800 }}>✓</span>{t("planPage.sms")}</li>}
                </ul>
                {PLAN_FEATURES.some((f) => !planAllows(plan.entitlements, f)) && (
                  <>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-muted)", margin: "18px 0 10px" }}>{t("planPage.notIncluded")}</h3>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                      {PLAN_FEATURES.filter((f) => !planAllows(plan.entitlements, f)).map((f) => (
                        <li key={f} style={{ display: "flex", gap: 10, fontSize: 14, color: "var(--text-muted)" }}><span>—</span>{t(`pricing.ent.${f}` as TranslationKey)}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              {/* Limits */}
              <section style={card}>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 14px" }}>{t("planPage.limits")}</h2>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "10px 16px", fontSize: 14.5 }}>
                  {PLAN_LIMITS.map((l) => (
                    <div key={l} style={{ display: "contents" }}>
                      <dt style={{ color: "var(--text-soft)" }}>{t(`pricing.ent.${l}` as TranslationKey)}</dt>
                      <dd style={{ margin: 0, fontWeight: 800 }}>{limit(plan, l)}</dd>
                    </div>
                  ))}
                </dl>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "16px 0 0" }}>{t("planPage.changeAnytime")}</p>
              </section>
            </div>

            {/* All plans side by side */}
            {plans.length > 1 && (
              <section style={{ ...card, padding: 0, overflowX: "auto" }}>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0, padding: "20px 24px 12px" }}>{t("planPage.compare")}</h2>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "10px 24px", color: "var(--text-muted)", fontWeight: 600 }} />
                      {plans.map((p) => (
                        <th key={p.key} style={{ textAlign: "center", padding: "10px 12px", background: p.key === plan.key ? "var(--primary-soft)" : undefined }}>
                          {p.key === plan.key ? p.name : <Link href={`/plans/${encodeURIComponent(p.key.toLowerCase())}`} style={{ color: ACCENT }}>{p.name}</Link>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 24px", color: "var(--text-soft)" }}>{t("planPage.price")}</td>
                      {plans.map((p) => <td key={p.key} style={{ textAlign: "center", fontWeight: 700, background: p.key === plan.key ? "var(--primary-soft)" : undefined }}>{price(p)}</td>)}
                    </tr>
                    {PLAN_LIMITS.map((l) => (
                      <tr key={l} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px 24px", color: "var(--text-soft)" }}>{t(`pricing.ent.${l}` as TranslationKey)}</td>
                        {plans.map((p) => <td key={p.key} style={{ textAlign: "center", background: p.key === plan.key ? "var(--primary-soft)" : undefined }}>{limit(p, l)}</td>)}
                      </tr>
                    ))}
                    {PLAN_FEATURES.map((f) => (
                      <tr key={f} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px 24px", color: "var(--text-soft)" }}>{t(`pricing.ent.${f}` as TranslationKey)}</td>
                        {plans.map((p) => (
                          <td key={p.key} style={{ textAlign: "center", fontWeight: 800, color: planAllows(p.entitlements, f) ? "var(--success)" : "var(--text-faint)", background: p.key === plan.key ? "var(--primary-soft)" : undefined }}>
                            {planAllows(p.entitlements, f) ? "✓" : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
