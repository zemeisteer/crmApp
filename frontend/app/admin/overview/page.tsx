"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import BarChart from "@/components/BarChart";
import LoadError from "@/components/LoadError";
import { ApiError, platformApi, type PlatformDashboard, type TenantStatus } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { monthLabel, money, STATUS_COLORS, STATUS_LABEL_KEYS } from "@/lib/platform";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 };
const cardTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#686B75", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 };

function Row({ href, title, sub, right, tone }: { href: string; title: string; sub?: string; right: string; tone?: "danger" | "warn" }) {
  return (
    <Link href={href} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 12px", borderRadius: 10, background: "#FAF9F6", textDecoration: "none", color: "inherit" }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "#181A1F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        {sub && <span style={{ display: "block", fontSize: 11.5, color: "#686B75" }}>{sub}</span>}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", color: tone === "danger" ? "#B23A47" : tone === "warn" ? "#8A5A00" : "#181A1F" }}>{right}</span>
    </Link>
  );
}

function OverviewContent() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<PlatformDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    platformApi.dashboard().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : ""));
  }
  useEffect(load, []);

  const n = (key: TranslationKey, value: number | string) => t(key).replace("{n}", String(value));
  const sum = (value: number) => `${money(value)} ${t("common.sumUnit")}`;
  const subLink = (search: string) => `/admin/subscriptions?search=${encodeURIComponent(search)}`;

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("pf.dash.title")}</h1>
          <div style={{ fontSize: 13, color: "#686B75", marginTop: 2 }}>{t("pf.dash.subtitle")}{data ? ` · ${monthLabel(data.month, lang)}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/admin" className="btn" style={{ background: "#fff", color: "#181A1F", border: "1px solid #EAE8E2", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: 9, textDecoration: "none" }}>{t("nav.centers")}</Link>
          <Link href="/admin/subscriptions" className="btn" style={{ background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: 9, textDecoration: "none" }}>{t("nav.subscriptions")}</Link>
        </div>
      </div>

      <div style={{ padding: "26px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error !== null ? (
          <LoadError message={error || t("adm.loadError")} onRetry={load} />
        ) : !data ? (
          <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <>
            <div className="adm-stats">
              {[
                { label: t("pf.dash.centers"), value: money(data.centers.total), sub: n("pf.dash.newThisMonth", data.centers.newThisMonth) },
                { label: t("pf.dash.activePaid"), value: money(data.centers.byStatus.ACTIVE), sub: n("pf.dash.onTrial", money(data.centers.byStatus.TRIAL)) },
                { label: t("pf.dash.mrr"), value: sum(data.mrr), sub: t("pf.dash.mrrHint") },
                { label: t("pf.dash.paidThisMonth"), value: sum(data.paidThisMonth), sub: n("pf.dash.payments", data.paymentsThisMonth), accent: true },
              ].map((c) => (
                <div key={c.label} style={{ ...card, padding: 18, background: c.accent ? "#EEF0FF" : "#fff", borderColor: c.accent ? "#D9DBFA" : "#EAE8E2" }}>
                  <div style={{ fontSize: 12, color: "#686B75" }}>{c.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: c.accent ? ACCENT : "#181A1F" }}>{c.value}</div>
                  <div style={{ fontSize: 11.5, color: "#686B75", marginTop: 2 }}>{c.sub}</div>
                </div>
              ))}
            </div>

            <div className="adm-grid2" style={{ gap: 16 }}>
              <div style={card}>
                <div style={cardTitle}>{t("pf.dash.signups")}</div>
                <BarChart data={data.signups.map((s) => ({ label: monthLabel(s.month, lang, "short"), title: monthLabel(s.month, lang), value: s.count, isCurrent: s.month === data.month }))} color={ACCENT} />
              </div>
              <div style={card}>
                <div style={cardTitle}>{t("pf.dash.revenue")}</div>
                <BarChart
                  data={data.revenue.map((s) => ({ label: monthLabel(s.month, lang, "short"), title: monthLabel(s.month, lang), value: s.amount, isCurrent: s.month === data.month }))}
                  color="#16794A"
                  formatValue={(v) => sum(v)}
                  emptyText={t("pf.dash.noRevenue")}
                />
              </div>
            </div>

            <div className="adm-grid2" style={{ gap: 16 }}>
              <div style={card}>
                <div style={cardTitle}>{t("pf.dash.byPlan")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.plans.map((p) => {
                    const share = data.centers.total ? Math.round((p.centers / data.centers.total) * 100) : 0;
                    return (
                      <Link key={p.key} href={`/admin/subscriptions?plan=${encodeURIComponent(p.key)}`} style={{ textDecoration: "none", color: "inherit" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                          <span style={{ fontWeight: 700 }}>{p.name} <span style={{ fontWeight: 500, color: "#686B75" }}>· {p.price > 0 ? sum(p.price) : t("pf.dash.free")}</span></span>
                          <span style={{ color: "#686B75" }}>{n("pf.dash.planCenters", money(p.centers))} · {n("pf.dash.planActive", money(p.activeCenters))}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 100, background: "#F2F1EC", marginTop: 6 }}>
                          <div style={{ height: 6, borderRadius: 100, background: ACCENT, width: `${Math.max(share, p.centers > 0 ? 2 : 0)}%` }} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
              <div style={card}>
                <div style={cardTitle}>{t("pf.dash.byStatus")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  {(Object.keys(STATUS_LABEL_KEYS) as TenantStatus[]).map((s) => (
                    <Link key={s} href={`/admin/subscriptions?status=${s}`} style={{ textDecoration: "none", borderRadius: 12, padding: "12px 14px", background: STATUS_COLORS[s].bg, color: STATUS_COLORS[s].fg }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{t(STATUS_LABEL_KEYS[s])}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{money(data.centers.byStatus[s] ?? 0)}</div>
                    </Link>
                  ))}
                </div>
                <div style={{ fontSize: 12.5, color: "#686B75", marginTop: 12 }}>
                  {t("pf.dash.students")}: <b style={{ color: "#181A1F" }}>{money(data.students)}</b> · {n("pf.dash.users", money(data.users))}
                </div>
              </div>
            </div>

            <div className="adm-grid2" style={{ gap: 16 }}>
              <div style={card}>
                <div style={{ ...cardTitle, display: "flex", justifyContent: "space-between" }}>
                  <span>{t("pf.dash.trialsEnding")}</span>
                  <span style={{ color: data.trialsEnding.count ? "#8A5A00" : "#686B75" }}>{money(data.trialsEnding.count)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.trialsEnding.items.length === 0 && <div style={{ fontSize: 13, color: "#686B75" }}>{t("pf.dash.none")}</div>}
                  {data.trialsEnding.items.map((x) => (
                    <Row key={x.id} href={subLink(x.subdomain)} title={x.name} sub={x.subdomain} right={x.daysLeft === 0 ? t("pf.dash.today") : n("pf.dash.daysLeft", x.daysLeft)} tone="warn" />
                  ))}
                </div>
              </div>
              <div style={card}>
                <div style={{ ...cardTitle, display: "flex", justifyContent: "space-between" }}>
                  <span>{t("pf.dash.unpaid")}</span>
                  <span style={{ color: data.unpaid.count ? "#B23A47" : "#686B75" }}>{money(data.unpaid.count)}{data.unpaid.count ? ` · ${t("pf.dash.unpaidSum").replace("{sum}", sum(data.unpaid.amount))}` : ""}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.unpaid.items.length === 0 && <div style={{ fontSize: 13, color: "#686B75" }}>{t("pf.dash.none")}</div>}
                  {data.unpaid.items.map((x) => (
                    <Row key={x.id} href={subLink(x.subdomain)} title={x.name} sub={x.lastPaidMonth ? t("pf.dash.lastPaid").replace("{month}", monthLabel(x.lastPaidMonth, lang)) : t("pf.dash.neverPaid")} right={sum(x.price)} tone="danger" />
                  ))}
                </div>
              </div>
            </div>

            <div className="adm-grid2" style={{ gap: 16 }}>
              <div style={card}>
                <div style={cardTitle}>{t("pf.dash.recent")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.recentPayments.length === 0 && <div style={{ fontSize: 13, color: "#686B75" }}>{t("pf.dash.noRevenue")}</div>}
                  {data.recentPayments.map((x) => (
                    <Row key={x.id} href={subLink(x.name)} title={x.name} sub={`${monthLabel(x.forMonth, lang)} · ${x.plan} · ${x.provider ?? t("pf.dash.manual")}`} right={sum(x.amount)} />
                  ))}
                </div>
              </div>
              <div style={card}>
                <div style={{ ...cardTitle, display: "flex", justifyContent: "space-between" }}>
                  <span>{t("pf.dash.trialsExpired")}</span>
                  <Link href="/admin/subscriptions?status=TRIAL" style={{ color: ACCENT, textTransform: "none", letterSpacing: 0 }}>{t("pf.dash.all")} ({money(data.trialsExpired.count)})</Link>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.trialsExpired.items.length === 0 && <div style={{ fontSize: 13, color: "#686B75" }}>{t("pf.dash.none")}</div>}
                  {data.trialsExpired.items.map((x) => (
                    <Row key={x.id} href={subLink(x.subdomain)} title={x.name} sub={x.subdomain} right={n("pf.dash.daysAgo", -x.daysLeft)} tone="danger" />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function PlatformOverviewPage() {
  return (
    <DashboardShell>
      <OverviewContent />
    </DashboardShell>
  );
}
