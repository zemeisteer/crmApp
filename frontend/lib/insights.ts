import type { ReportsOverview } from "./api";
import type { TranslationKey } from "./i18n";

// Rule-based recommendations from the reports overview: students at risk
// of leaving, weak groups, debts, follow-ups. Shown on the AI insights page
// and summarised in the dashboard banner.

export type Severity = "high" | "medium" | "opportunity" | "watch";

export interface Insight {
  id: string;
  severity: Severity;
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

export function buildInsights(report: ReportsOverview, t: (key: TranslationKey) => string): Insight[] {
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
}
