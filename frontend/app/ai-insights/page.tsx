"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import BarChart, { DonutChart } from "@/components/BarChart";
import { reportsApi, type DashboardData, type ReportsOverview } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { MONTH_KEYS, MONTH_SHORT_KEYS } from "@/lib/i18n";
import { formatTime } from "@/lib/format-date";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 };
const cardTitle: React.CSSProperties = { fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 };

type Severity = "high" | "medium" | "opportunity" | "watch";

interface Insight {
  id: string;
  severity: Severity;
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

const SEVERITY_STYLE: Record<Severity, { border: string; bg: string; badge: string }> = {
  high: { border: "#F5C2C7", bg: "#FFF5F6", badge: "#B23A47" },
  medium: { border: "#FAD7B5", bg: "#FFF9F2", badge: "#EA7A3A" },
  opportunity: { border: "#BDE8CF", bg: "#F3FBF6", badge: "#1FA463" },
  watch: { border: "#D6D3FA", bg: "#F6F5FF", badge: ACCENT },
};

const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));
const pctColor = (p: number | null) => (p === null ? "#8A8D96" : p >= 80 ? "#1FA463" : p >= 60 ? "#D97706" : "#B23A47");

// Center health, 0-100: the average of the rates we actually have
// (attendance, fee collection, seat occupancy).
function healthScore(parts: Array<number | null>) {
  const known = parts.filter((p): p is number => p !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((s, p) => s + Math.min(100, p), 0) / known.length);
}

function AiInsightsContent() {
  const { t, lang } = useLanguage();
  const [report, setReport] = useState<ReportsOverview | null>(null);
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [updatedAt] = useState(() => new Date());

  useEffect(() => {
    // Teachers may not read the full report; they still get their groups.
    Promise.all([reportsApi.overview().catch(() => null), reportsApi.dashboard().catch(() => null)])
      .then(([r, d]) => {
        setReport(r);
        setDash(d);
      })
      .finally(() => setLoading(false));
  }, []);

  const SEVERITY_LABEL: Record<Severity, string> = {
    high: t("aiInsights.sevHigh"),
    medium: t("aiInsights.sevMedium"),
    opportunity: t("aiInsights.sevOpportunity"),
    watch: t("aiInsights.sevWatch"),
  };

  const insights = useMemo<Insight[]>(() => {
    if (!report) return [];
    const out: Insight[] = [];

    for (const s of report.atRisk.slice(0, 6)) {
      out.push({
        id: `risk-${s.studentId}`,
        severity: s.risk === "HIGH" ? "high" : "medium",
        icon: "⚠️",
        title: `${s.fullName} ${t("aiInsights.churnTitle")}`,
        description: [
          s.attendanceRate !== null ? `${t("aiInsights.churnDesc1")}: ${s.attendanceRate}%` : null,
          s.overdueAmount > 0 ? `${t("ai2.debt")}: ${money(s.overdueAmount)} ${t("common.sumUnit")}` : null,
        ].filter(Boolean).join(" · "),
        actionLabel: t("aiInsights.viewProfile"),
        actionHref: `/students/${s.studentId}`,
      });
    }

    for (const g of report.groups.items) {
      if (g.occupancy !== null && g.occupancy < 60 && g.students > 0) {
        out.push({
          id: `fill-${g.id}`,
          severity: "medium",
          icon: "📉",
          title: `"${g.name}" ${t("aiInsights.underfilledTitle1")}`,
          description: `${g.students} / ${g.maxStudents} (${g.occupancy}%). ${t("ai2.fillHint")}`,
          actionLabel: t("aiInsights.viewGroup"),
          actionHref: `/groups/${g.id}`,
        });
      }
      if (g.attendanceRate !== null && g.attendanceRate < 70) {
        out.push({
          id: `att-${g.id}`,
          severity: g.attendanceRate < 50 ? "high" : "medium",
          icon: "🕒",
          title: `"${g.name}" — ${t("ai2.lowAttendance")}`,
          description: `${t("aiInsights.churnDesc1")}: ${g.attendanceRate}%. ${t("ai2.lowAttendanceHint")}`,
          actionLabel: t("aiInsights.viewGroup"),
          actionHref: `/groups/${g.id}`,
        });
      }
      if (g.maxStudents > 0 && g.students >= g.maxStudents) {
        out.push({
          id: `full-${g.id}`,
          severity: "opportunity",
          icon: "🚀",
          title: `"${g.name}" ${t("ai2.fullTitle")}`,
          description: t("ai2.fullHint"),
          actionLabel: t("aiInsights.createGroup"),
          actionHref: "/groups",
        });
      }
    }

    if (report.finance && report.finance.debtorCount > 0) {
      out.push({
        id: "debtors",
        severity: "medium",
        icon: "💳",
        title: `${report.finance.debtorCount} ${t("aiInsights.debtorsTitle1")}`,
        description: `${t("ai2.debt")}: ${money(report.finance.outstandingDebt)} ${t("common.sumUnit")} — ${t("aiInsights.debtorsDesc2")}`,
        actionLabel: t("aiInsights.viewPayments"),
        actionHref: "/payments",
      });
    }
    if (report.finance?.yearToDate.growth != null && report.finance.yearToDate.growth > 0) {
      out.push({
        id: "growth",
        severity: "opportunity",
        icon: "📈",
        title: `${t("ai2.growthTitle")} +${report.finance.yearToDate.growth}%`,
        description: t("ai2.growthHint"),
        actionLabel: t("ai2.openReports"),
        actionHref: "/reports",
      });
    }

    const fu = report.admissions?.followUps;
    if (fu && fu.overdue > 0) {
      out.push({
        id: "followups",
        severity: "high",
        icon: "📞",
        title: `${fu.overdue} ${t("ai2.overdueCalls")}`,
        description: t("ai2.overdueCallsHint"),
        actionLabel: t("ai2.openLeads"),
        actionHref: "/leads",
      });
    }
    const conv = report.admissions?.cohort.rates.conversion;
    if (conv && conv.rate !== null && conv.denominator >= 5) {
      out.push({
        id: "conversion",
        severity: conv.rate < 20 ? "watch" : "opportunity",
        icon: "🎯",
        title: `${t("ai2.conversion")}: ${conv.rate}%`,
        description: conv.rate < 20 ? t("ai2.conversionLow") : t("ai2.conversionGood"),
        actionLabel: t("ai2.openLeads"),
        actionHref: "/leads",
      });
    }

    const order: Severity[] = ["high", "medium", "opportunity", "watch"];
    return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
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
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
          {t("aiInsights.title")}
          <span style={{ fontSize: 11, fontWeight: 800, background: "linear-gradient(135deg,#8B7CF6,#4F46E5)", color: "#fff", padding: "4px 10px", borderRadius: 100 }}>
            {t("aiInsights.autoBadge")}
          </span>
        </h1>
        <div style={{ fontSize: 12.5, color: "#8A8D96" }}>
          {t("aiInsights.lastUpdated")} {formatTime(updatedAt, lang)}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18 }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <>
            {/* Health overview */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
              <div style={{ borderRadius: 18, padding: 22, color: "#fff", background: "linear-gradient(135deg, #4338CA 0%, #6D28D9 60%, #8B5CF6 100%)", display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ position: "relative", width: 104, height: 104, flexShrink: 0 }}>
                  <svg viewBox="0 0 36 36" width="104" height="104">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3.2" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${health ?? 0} 100`} transform="rotate(-90 18 18)" />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 26 }}>
                    {health ?? "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600, letterSpacing: 0.3 }}>{t("ai2.healthLabel")}</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20, marginTop: 4 }}>
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
                  { label: t("ai2.kpiNew"), value: String(report?.students.newThisMonth ?? "—"), color: "#181A1F" },
                ].map((k) => (
                  <div key={k.label} style={{ ...card, padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 12, color: "#8A8D96", fontWeight: 600 }}>{k.label}</div>
                    <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 26, color: k.color, marginTop: 8 }}>{k.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Filter chips */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {(["all", "high", "medium", "opportunity", "watch"] as const).map((k) => {
                const active = filter === k;
                const n = k === "all" ? insights.length : count(k);
                const color = k === "all" ? "#181A1F" : SEVERITY_STYLE[k].badge;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    style={{ border: `1px solid ${active ? color : "#EAE8E2"}`, background: active ? color : "#fff", color: active ? "#fff" : "#4A4E58", fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 999, cursor: "pointer" }}
                  >
                    {k === "all" ? t("aiInsights.statTotal") : SEVERITY_LABEL[k]} · {n}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)", gap: 16, alignItems: "start" }}>
              {/* Insight cards, two per row */}
              {shown.length === 0 ? (
                <div style={{ ...card, color: "#8A8D96", fontSize: 14, textAlign: "center", padding: 32 }}>
                  {report ? t("aiInsights.allGood") : t("ai2.limited")}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {shown.map((i) => {
                    const st = SEVERITY_STYLE[i.severity];
                    return (
                      <div key={i.id} style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 20 }} aria-hidden>{i.icon}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 800, background: st.badge, color: "#fff", padding: "3px 9px", borderRadius: 100 }}>{SEVERITY_LABEL[i.severity]}</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Manrope', sans-serif", lineHeight: 1.35 }}>{i.title}</div>
                        {i.description && <div style={{ fontSize: 12.5, color: "#4A4E58", lineHeight: 1.55 }}>{i.description}</div>}
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
                    <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("ai2.noRisk")}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {report!.atRisk.slice(0, 6).map((s) => (
                        <Link key={s.studentId} href={`/students/${s.studentId}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textDecoration: "none", color: "#181A1F", padding: "8px 10px", borderRadius: 10, background: "#F7F6F2" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.fullName}</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: s.risk === "HIGH" ? "#B23A47" : "#D97706" }}>
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
                    <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("chart.noData")}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {groupsByAttendance.map((g) => (
                        <div key={g.id}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                            <span style={{ color: pctColor(g.attendanceRate) }}>{g.attendanceRate}%</span>
                          </div>
                          <div style={{ height: 8, background: "#F2F1EC", borderRadius: 5, overflow: "hidden" }}>
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
                    color="#1FA463"
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
