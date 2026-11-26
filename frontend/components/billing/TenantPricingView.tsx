"use client";

import type { ReactNode } from "react";
import { PLAN_FEATURES, PLAN_LIMITS, planAllows, type Plan, type PlatformCardView, type Tenant } from "@/lib/api";
import type { Lang, TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { planFeatureLines } from "@/lib/plans";

const DAY = 86_400_000;
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);

const STATUS_KEYS: Record<string, TranslationKey> = {
  TRIAL: "admin.statusTrial",
  ACTIVE: "admin.statusActive",
  PAST_DUE: "admin.statusPastDue",
  SUSPENDED: "admin.statusSuspended",
};

const CSS = `
  .tp{display:flex;flex-direction:column;gap:20px;max-width:1120px}
  .tp-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:24px 26px;border-radius:var(--radius-xl,24px);
    background:linear-gradient(135deg,var(--primary-soft),var(--surface) 70%);border:1px solid var(--primary-border)}
  .tp-hero h2{font-family:var(--font-display);font-size:28px;font-weight:800;letter-spacing:-0.02em;margin:4px 0 0}
  .tp-eyebrow{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)}
  .tp-pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:var(--radius-pill);background:var(--surface);border:1px solid var(--border)}
  .tp-pill.ok{color:var(--success);background:var(--success-soft);border-color:transparent}
  .tp-pill.warn{color:var(--warning);background:var(--warning-soft);border-color:transparent}
  .tp-pill.bad{color:var(--danger);background:var(--danger-soft);border-color:transparent}
  .tp-hero-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px;text-align:right}
  .tp-price{font-family:var(--font-display);font-size:24px;font-weight:800}
  .tp-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--radius-md,14px);font-size:14px;font-weight:700;padding:11px 18px;cursor:pointer;border:none;transition:transform .15s ease,opacity .15s ease}
  .tp-btn:hover{transform:translateY(-1px)}
  .tp-btn.primary{background:var(--primary);color:var(--on-ink)}
  .tp-btn.ghost{background:var(--surface);color:var(--primary);border:1.5px solid var(--primary)}
  .tp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
  .tp-card{position:relative;display:flex;flex-direction:column;gap:16px;padding:24px;border-radius:var(--radius-xl,24px);background:var(--surface);border:1px solid var(--border);transition:box-shadow .2s ease,transform .2s ease}
  .tp-card:hover{box-shadow:0 18px 40px -24px color-mix(in oklab,var(--primary) 45%,transparent);transform:translateY(-2px)}
  .tp-card.popular{border:2px solid var(--primary)}
  .tp-card.current{background:linear-gradient(180deg,var(--primary-soft),var(--surface) 55%)}
  .tp-flag{position:absolute;top:-12px;left:22px;font-size:11px;font-weight:700;padding:4px 12px;border-radius:var(--radius-pill);background:var(--primary);color:var(--on-ink)}
  .tp-name{font-family:var(--font-display);font-size:18px;font-weight:800}
  .tp-amount{font-family:var(--font-display);font-size:32px;font-weight:800;letter-spacing:-0.02em}
  .tp-per{font-size:13px;color:var(--text-muted);margin-left:6px}
  .tp-feat{display:flex;flex-direction:column;gap:9px;margin:0;padding:0;list-style:none;flex:1}
  .tp-feat li{display:flex;align-items:flex-start;gap:9px;font-size:13.5px;color:var(--text-soft);line-height:1.4}
  .tp-feat li.off{color:var(--text-faint);text-decoration:line-through}
  .tp-check{flex:0 0 18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--success-soft);color:var(--success)}
  .tp-x{flex:0 0 18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--surface-muted);color:var(--text-faint)}
  .tp-section{padding:22px 24px;border-radius:var(--radius-xl,24px);background:var(--surface);border:1px solid var(--border)}
  .tp-section h3{font-family:var(--font-display);font-size:17px;font-weight:800;margin:0 0 14px}
  .tp-table-wrap{overflow-x:auto}
  .tp-table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:560px}
  .tp-table th,.tp-table td{padding:11px 12px;border-bottom:1px solid var(--border);text-align:center}
  .tp-table th:first-child,.tp-table td:first-child{text-align:left;color:var(--text-soft)}
  .tp-table thead th{font-weight:800;color:var(--text)}
  .tp-table .cur{background:var(--primary-soft)}
  .tp-yes{color:var(--success);font-weight:800}
  .tp-no{color:var(--text-faint)}
  .tp-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 12px;border-radius:var(--radius-md,14px);background:var(--surface-muted);font-size:13.5px}
  .tp-list{display:flex;flex-direction:column;gap:8px}
  @media (max-width:900px){.tp-grid{grid-template-columns:1fr}.tp-hero{grid-template-columns:1fr}.tp-hero-right{align-items:flex-start;text-align:left}}
`;

const Check = () => (
  <span className="tp-check" aria-hidden="true">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  </span>
);
const Cross = () => (
  <span className="tp-x" aria-hidden="true">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
  </span>
);

/**
 * The center's own plans page: where its subscription stands (plan, status,
 * days left or paid until, the next payment), the plans side by side with
 * what each includes, a comparison table and one history of payments and
 * receipts. Paying itself is the page's dialog (`onPay`).
 */
export default function TenantPricingView({
  tenant,
  plans,
  cardView,
  lang,
  t,
  onPay,
}: {
  tenant: Tenant | null;
  plans: Plan[];
  cardView: PlatformCardView | null;
  lang: Lang;
  t: (k: TranslationKey) => string;
  onPay: (planKey: string) => void;
}) {
  const current = plans.find((p) => p.key.toUpperCase() === tenant?.plan?.toUpperCase()) ?? null;
  const now = Date.now();
  const onTrial = tenant?.status === "TRIAL";
  const trialEnd = tenant?.trial?.endsAt ?? tenant?.trialEndsAt ?? null;
  const trialDays = onTrial && trialEnd ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - now) / DAY)) : null;
  const paidUntil = tenant?.billing?.paidUntil ?? null;
  const paidDays = paidUntil ? Math.ceil((new Date(paidUntil).getTime() - now) / DAY) : null;
  const suspended = tenant?.billing?.suspendedForNonPayment || tenant?.status === "SUSPENDED";

  let state: string;
  let tone: "ok" | "warn" | "bad" = "ok";
  if (suspended) {
    state = t("planCard.suspended");
    tone = "bad";
  } else if (trialDays !== null) {
    state = trialDays > 0 ? t("planCard.trialLeft").replace("{n}", String(trialDays)) : t("planCard.trialEnded");
    tone = trialDays <= 3 ? "bad" : "warn";
  } else if (paidUntil && paidDays !== null) {
    state = paidDays < 0 ? t("planCard.overdue").replace("{date}", formatDate(paidUntil, lang)) : t("planCard.paidUntil").replace("{date}", formatDate(paidUntil, lang)).replace("{n}", String(paidDays));
    tone = paidDays < 0 ? "bad" : paidDays <= 3 ? "warn" : "ok";
  } else if (current?.price === 0) {
    state = t("planCard.free");
  } else {
    state = t("planCard.notPaid");
    tone = "warn";
  }
  const pending = (cardView?.claims ?? []).filter((c) => c.status === "PENDING").length;
  const statusKey = tenant?.status ? STATUS_KEYS[tenant.status] : undefined;

  const limitText = (p: Plan, l: (typeof PLAN_LIMITS)[number]) => {
    const v = p.entitlements?.[l];
    return typeof v === "number" ? money(v) : t("pricing.entUnlimited");
  };
  const featureRows: Array<{ label: string; cell: (p: Plan) => ReactNode }> = [
    { label: t("pricing.compPrice"), cell: (p) => (p.price === 0 ? t("pricing.free") : `${money(p.price)}`) },
    ...PLAN_LIMITS.map((l) => ({ label: t(`pricing.ent.${l}` as TranslationKey), cell: (p: Plan) => limitText(p, l) })),
    ...PLAN_FEATURES.map((f) => ({
      label: t(`pricing.ent.${f}` as TranslationKey),
      cell: (p: Plan) => (planAllows(p.entitlements, f) ? <span className="tp-yes">✓</span> : <span className="tp-no">—</span>),
    })),
    { label: t("pricing.sms"), cell: (p) => (p.smsIncluded ? <span className="tp-yes">✓</span> : <span className="tp-no">—</span>) },
  ];

  const history = [
    ...(cardView?.claims ?? []).map((c) => ({
      id: `c-${c.id}`,
      at: c.createdAt,
      left: `${c.forMonth} · ${plans.find((p) => p.key === c.plan)?.name ?? c.plan} · ${t("pcp.method")}`,
      amount: c.amount,
      status: c.status === "CONFIRMED" ? ("ok" as const) : c.status === "REJECTED" ? ("bad" as const) : ("warn" as const),
      label: `${t(`ct.s.${c.status}` as TranslationKey)}${c.status === "REJECTED" && c.rejectReason ? `: ${c.rejectReason}` : ""}`,
    })),
    ...(cardView?.history ?? []).map((h) => ({
      id: `h-${h.id}`,
      at: h.paidAt ?? "",
      left: `${h.forMonth} · ${plans.find((p) => p.key === h.plan)?.name ?? h.plan} · ${t(`ph.m.${h.method}` as TranslationKey)}`,
      amount: h.amount,
      status: "ok" as const,
      label: h.periodEnd ? t("ph.until").replace("{date}", formatDate(h.periodEnd, lang)) : t("pricing.paid"),
    })),
  ].sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  return (
    <div className="tp" data-testid="tenant-pricing">
      <style>{CSS}</style>

      <section className="tp-hero" aria-labelledby="tp-current">
        <div>
          <div className="tp-eyebrow">{t("planCard.title")}</div>
          <h2 id="tp-current">{current?.name ?? tenant?.plan ?? "—"}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {statusKey && <span className="tp-pill">{t(statusKey)}</span>}
            <span className={`tp-pill ${tone}`} data-testid={paidUntil ? "paid-until" : undefined}>{state}</span>
            {pending > 0 && <span className="tp-pill warn">{t("pricing.receiptPending").replace("{n}", String(pending))}</span>}
          </div>
        </div>
        <div className="tp-hero-right">
          <div>
            <div className="tp-eyebrow">{t("planCard.monthly")}</div>
            <div className="tp-price">{!current ? "—" : current.price === 0 ? t("pricing.free") : `${money(current.price)} ${t("planCard.sum")}`}</div>
          </div>
          {current && current.price > 0 && (
            <button type="button" className="tp-btn primary" onClick={() => onPay(current.key)}>
              {onTrial || !paidUntil ? t("planCard.pay") : t("pcp.renew")}
            </button>
          )}
        </div>
      </section>

      <div className="tp-grid">
        {plans.map((p) => {
          const isCurrent = current?.key === p.key;
          const higher = current ? p.price > current.price : p.price > 0;
          const included = PLAN_FEATURES.filter((f) => planAllows(p.entitlements, f));
          const excluded = PLAN_FEATURES.filter((f) => !planAllows(p.entitlements, f));
          return (
            <div key={p.id} role="group" className={`tp-card${p.popular ? " popular" : ""}${isCurrent ? " current" : ""}`} aria-label={p.name}>
              {p.popular && <span className="tp-flag">{t("pricing.mostPopular")}</span>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="tp-name">{p.name}</span>
                {isCurrent && <span className="tp-pill ok">{t("pricing.currentPlanBadge")}</span>}
              </div>
              <div>
                <span className="tp-amount">{p.price === 0 ? t("pricing.free") : money(p.price)}</span>
                {p.price > 0 && <span className="tp-per">{t("pricing.perMonth")}</span>}
              </div>
              <ul className="tp-feat">
                {planFeatureLines(p, lang).map((f) => (
                  <li key={f}><Check />{f}</li>
                ))}
                {included.map((f) => (
                  <li key={f}><Check />{t(`pricing.ent.${f}` as TranslationKey)}</li>
                ))}
                {excluded.map((f) => (
                  <li key={f} className="off"><Cross />{t(`pricing.ent.${f}` as TranslationKey)}</li>
                ))}
              </ul>
              {isCurrent ? (
                p.price > 0 ? (
                  <button type="button" className="tp-btn ghost" onClick={() => onPay(p.key)}>{t("pcp.renew")}</button>
                ) : (
                  <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("pricing.autoOnSignup")}</span>
                )
              ) : p.price === 0 ? (
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("pricing.autoOnSignup")}</span>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {higher && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)" }}>↑ {t("pricing.upgradeHint")}</span>}
                  <button type="button" className={`tp-btn ${higher ? "primary" : "ghost"}`} onClick={() => onPay(p.key)}>
                    {t("pricing.activate")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plans.length > 1 && (
        <section className="tp-section" aria-labelledby="tp-compare">
          <h3 id="tp-compare">{t("pricing.compareTitle")}</h3>
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th scope="col" />
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className={current?.key === p.key ? "cur" : undefined}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureRows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row" style={{ fontWeight: 500 }}>{r.label}</th>
                    {plans.map((p) => (
                      <td key={p.id} className={current?.key === p.key ? "cur" : undefined}>{r.cell(p)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="tp-section" aria-labelledby="tp-history" data-testid="platform-payment-history">
        <h3 id="tp-history">{t("pricing.historyTitle")}</h3>
        {history.length === 0 ? (
          <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{t("pricing.historyEmpty")}</div>
        ) : (
          <div className="tp-list" data-testid="platform-card-claims">
            {history.map((h) => (
              <div key={h.id} className="tp-row">
                <span>
                  {h.left}
                  {h.at ? <span style={{ color: "var(--text-muted)" }}> · {formatDate(h.at, lang)}</span> : null}
                </span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <b>{money(h.amount)} {t("planCard.sum")}</b>
                  <span className={`tp-pill ${h.status}`}>{h.label}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
