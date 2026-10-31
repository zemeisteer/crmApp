"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import BarChart, { DonutChart } from "@/components/BarChart";
import { reportsApi, type DashboardData, type ReportsOverview } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { MONTH_KEYS, MONTH_SHORT_KEYS } from "@/lib/i18n";
import { formatTime } from "@/lib/format-date";
import { buildInsights, type Insight, type Severity } from "@/lib/insights";
import { MessagesReview, SignalsList, chip } from "@/components/signals/SignalsPanels";

const ACCENT = "var(--primary)";
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 };
const cardTitle: React.CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 };

const SEVERITY_STYLE: Record<Severity, { border: string; bg: string; badge: string }> = {
  high: { border: "var(--danger-border)", bg: "var(--danger-soft)", badge: "var(--danger)" },
  medium: { border: "var(--warning-border)", bg: "var(--warning-soft)", badge: "var(--warning)" },
  opportunity: { border: "var(--success-border)", bg: "var(--success-soft)", badge: "var(--success)" },
  watch: { border: "var(--primary-border)", bg: "var(--primary-soft)", badge: ACCENT },
};

const pctColor = (p: number | null) => (p === null ? "var(--text-muted)" : p >= 80 ? "var(--success)" : p >= 60 ? "var(--warning)" : "var(--danger)");

// Center health, 0-100: the average of the rates we actually have
// (attendance, fee collection, seat occupancy).
function healthScore(parts: Array<number | null>) {
  const known = parts.filter((p): p is number => p !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((s, p) => s + Math.min(100, p), 0) / known.length);
}

function AiInsightsContent() {
  const { user } = useAuth();
  // The center-wide report is finance data; others see their own groups.
  const seesReport = can(user, "reports.finance");
  const { t, lang } = useLanguage();
  const [report, setReport] = useState<ReportsOverview | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [updatedAt] = useState(() => new Date());
  // The rule signals and the classifier's trial review sit beside the analysis.
  const seesSignals = can(user, "signals.manage");
  const seesMessages = user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const [tab, setTab] = useState<"insights" | "signals" | "messages">("insights");
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("tab");
    if (want === "signals" && seesSignals) setTab("signals");
    if (want === "messages" && seesMessages) setTab("messages");
  }, [seesSignals, seesMessages]);

  useEffect(() => {
    // Teachers may not read the full report; they still get their groups.
    Promise.all([seesReport ? reportsApi.overview().catch(() => null) : Promise.resolve(null), reportsApi.dashboard().catch(() => null)])
      .then(([r, d]) => {
        setReport(r);
        setDash(d);
      })
      .finally(() => setLoading(false));
  }, [seesReport]);

  const SEVERITY_LABEL: Record<Severity, string> = {
    high: t("aiInsights.sevHigh"),
    medium: t("aiInsights.sevMedium"),
    opportunity: t("aiInsights.sevOpportunity"),
    watch: t("aiInsights.sevWatch"),
  };

  const insights = useMemo<Insight[]>(() => {
    if (!report) return [];
    return buildInsights(report, t);
  }, [report, t]);

  const collection = report?.finance?.collectionRate ?? null;
  const attendanceRate = report?.attendance.rate ?? dash?.attendance.rates.month ?? null;
  const occupancy = report?.groups.averageOccupancy ?? null;
  const health = healthScore([attendanceRate, collection, occupancy]);
  const shown = filter === "all" ? insights : insights.filter((i) => i.severity === filter);
  const count = (s: Severity) => insights.filter((i) => i.severity === s).length;

  const trend = useMemo(
    () =>
      (dash?.attendance.months ?? []).map((m) => {
        const i = Number(m.month.slice(5)) - 1;
        return { label: t(MONTH_SHORT_KEYS[i]), title: t(MONTH_KEYS[i]), value: m.marks, isCurrent: m.month === dash?.today.slice(0, 7) };
      }),
    [dash, t],
  );

  const groupsByAttendance = useMemo(
    () => [...(report?.groups.items ?? [])].filter((g) => g.attendanceRate !== null).sort((a, b) => (a.attendanceRate ?? 0) - (b.attendanceRate ?? 0)).slice(0, 5),
    [report],
  );

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
          {t("aiInsights.title")}
          <span style={{ fontSize: 11, fontWeight: 800, background: "linear-gradient(135deg,var(--violet),var(--primary))", color: "var(--on-ink)", padding: "4px 10px", borderRadius: "var(--radius-pill)" }}>
            {t("aiInsights.autoBadge")}
          </span>
        </h1>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {t("aiInsights.lastUpdated")} {formatTime(updatedAt, lang)}
        </div>
        {seesSignals && (
          <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
            <button type="button" role="tab" aria-selected={tab === "insights"} className="btn" onClick={() => setTab("insights")} style={chip(tab === "insights")}>📊 {t("sig.tabInsights")}</button>
            <button type="button" role="tab" aria-selected={tab === "signals"} className="btn" onClick={() => setTab("signals")} style={chip(tab === "signals")}>⚠️ {t("sig.tabSignals")}</button>
            {seesMessages && (
              <button type="button" role="tab" aria-selected={tab === "messages"} className="btn" onClick={() => setTab("messages")} style={chip(tab === "messages")}>🧪 {t("sig.tabMessages")}</button>
            )}
          </div>
        )}
      </div>

      {tab !== "insights" && (
        <div style={{ flex: 1, minHeight: 0, padding: "20px 32px", overflow: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, maxWidth: 760 }}>{t("sig.subtitle")}</div>
          {tab === "signals" ? <SignalsList /> : <MessagesReview />}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box", display: tab === "insights" ? "flex" : "none", flexDirection: "column", gap: 18 }}>
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <>
            {/* Health overview */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
              <div style={{ borderRadius: "var(--radius-lg)", padding: 22, color: "var(--on-ink)", background: "linear-gradient(135deg, var(--primary) 0%, var(--violet) 60%, var(--violet) 100%)", display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ position: "relative", width: 104, height: 104, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" width="104" height="104">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3.2" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface)" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${health ?? 0} 100`} transform="rotate(-90 18 18)" />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26 }}>
                    {health ?? "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600, letterSpacing: 0.3 }}>{t("ai2.healthLabel")}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>
                    {health === null ? t("ai2.healthUnknown") : health >= 80 ? t("ai2.healthGood") : health >= 60 ? t("ai2.healthOk") : t("ai2.healthBad")}
                  </div>
                  <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>{t("ai2.healthHint")}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                {[
                  { label: t("ai2.kpiAttendance"), value: attendanceRate === null ? "—" : `${attendanceRate}%`, color: pctColor(attendanceRate) },
                  { label: t("ai2.kpiCollection"), value: collection === null ? "—" : `${collection}%`, color: pctColor(collection) },
                  { label: t("ai2.kpiOccupancy"), value: occupancy === null ? "—" : `${occupancy}%`, color: pctColor(occupancy) },
                  { label: t("ai2.kpiNew"), value: String(report?.students.newThisMonth ?? "—"), color: "var(--text)" },
                ].map((k) => (
                  <div key={k.label} style={{ ...card, padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{k.label}</div>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26, color: k.color, marginTop: 8 }}>{k.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Filter chips */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(["all", "high", "medium", "opportunity", "watch"] as const).map((k) => {
                const active = filter === k;
                const n = k === "all" ? insights.length : count(k);
                const color = k === "all" ? "var(--text)" : SEVERITY_STYLE[k].badge;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    style={{ border: `1px solid ${active ? color : "var(--border)"}`, background: active ? color : "var(--on-ink)", color: active ? "var(--on-ink)" : "var(--text-soft)", fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: "var(--radius-pill)", cursor: "pointer" }}
                  >
                    {k === "all" ? t("aiInsights.statTotal") : SEVERITY_LABEL[k]} · {n}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)", gap: 16, alignItems: "start" }}>
              {/* Insight cards, two per row */}
              {shown.length === 0 ? (
                <div style={{ ...card, color: "var(--text-muted)", fontSize: 14, textAlign: "center", padding: 32 }}>
                  {report ? t("aiInsights.allGood") : t("ai2.limited")}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {shown.map((i) => {
                    const st = SEVERITY_STYLE[i.severity];
                    return (
                      <div key={i.id} style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: "var(--radius-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 20 }} aria-hidden>{i.icon}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 800, background: st.badge, color: "var(--on-ink)", padding: "3px 9px", borderRadius: "var(--radius-pill)" }}>{SEVERITY_LABEL[i.severity]}</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-display)", lineHeight: 1.35 }}>{i.title}</div>
                        {i.description && <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.55 }}>{i.description}</div>}
                        <Link href={i.actionHref} style={{ marginTop: "auto", alignSelf: "flex-start", fontSize: 12.5, fontWeight: 700, color: st.badge, textDecoration: "none" }}>
                          {i.actionLabel} →
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Side column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={card}>
                  <div style={{ ...cardTitle, marginBottom: 12 }}>{t("ai2.atRiskTitle")}</div>
                  {(report?.atRisk.length ?? 0) === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("ai2.noRisk")}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {report!.atRisk.slice(0, 6).map((s) => (
                        <Link key={s.studentId} href={`/students/${s.studentId}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textDecoration: "none", color: "var(--text)", padding: "8px 10px", borderRadius: "var(--radius-sm)", background: "var(--surface-muted)" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.fullName}</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: s.risk === "HIGH" ? "var(--danger)" : "var(--warning)" }}>
                            {s.attendanceRate !== null ? `${s.attendanceRate}%` : "—"}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div style={card}>
                  <div style={{ ...cardTitle, marginBottom: 12 }}>{t("ai2.weakGroups")}</div>
                  {groupsByAttendance.length === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("chart.noData")}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {groupsByAttendance.map((g) => (
                        <div key={g.id}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                            <span style={{ color: pctColor(g.attendanceRate) }}>{g.attendanceRate}%</span>
                          </div>
                          <div style={{ height: 8, background: "var(--surface-muted)", borderRadius: 5, overflow: "hidden" }}>
                            <div style={{ width: `${g.attendanceRate}%`, height: "100%", background: pctColor(g.attendanceRate), borderRadius: 5 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Trends */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)", gap: 16 }}>
              <div style={card}>
                <div style={{ ...cardTitle, marginBottom: 6 }}>{t("ai2.attendanceTrend")}</div>
                <BarChart data={trend} unit={t("dashboard.marksUnit")} emptyText={t("dashboard.noMarksYet")} />
              </div>
              <div style={{ ...card, display: "flex", flexDirection: "column" }}>
                <div style={{ ...cardTitle, marginBottom: 6 }}>{t("ai2.studentsByStatus")}</div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <DonutChart
                    value={report?.students.byStatus.ACTIVE ?? dash?.counts.activeStudents ?? 0}
                    max={Math.max(1, Object.values(report?.students.byStatus ?? {}).reduce((s, n) => s + n, 0) || dash?.counts.activeStudents || 1)}
                    color="var(--success)"
                    label={t("ai2.activeShare")}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function AiInsightsPage() {
  return (
    <DashboardShell>
      <AiInsightsContent />
    </DashboardShell>
  );
}
