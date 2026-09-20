"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { groupsApi, studentsApi, paymentsApi, attendanceApi, Group, Student, Payment, AttendanceRecord } from "@/lib/api";
import { localMonthStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

type Severity = "high" | "medium" | "opportunity" | "watch";

interface Insight {
  id: string;
  severity: Severity;
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

const SEVERITY_BG: Record<Severity, { bg: string; badgeBg: string; badgeText: string }> = {
  high: { bg: "#FDEBEC", badgeBg: "#B23A47", badgeText: "#fff" },
  medium: { bg: "#FEF3E2", badgeBg: "#EA7A3A", badgeText: "#fff" },
  opportunity: { bg: "#E9F8EF", badgeBg: "#1FA463", badgeText: "#fff" },
  watch: { bg: "#ECEBFB", badgeBg: ACCENT, badgeText: "#fff" },
};

const WarningIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B23A47" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);
const TrendIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EA7A3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
  </svg>
);
const ClockIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EA7A3A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);
const PulseIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1FA463" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const BulbIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.75c.6.47 1 1.2 1 2.02V17h6v-.23c0-.82.4-1.55 1-2.02A7 7 0 0 0 12 2Z" />
  </svg>
);

function AiInsightsContent() {
  const { t, lang } = useLanguage();
  const SEVERITY_LABEL: Record<Severity, string> = {
    high: t("aiInsights.sevHigh"),
    medium: t("aiInsights.sevMedium"),
    opportunity: t("aiInsights.sevOpportunity"),
    watch: t("aiInsights.sevWatch"),
  };
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt] = useState(() => new Date());

  useEffect(() => {
    Promise.all([groupsApi.list(), studentsApi.list(), paymentsApi.list(), attendanceApi.list()])
      .then(([g, s, p, a]) => {
        setGroups(g);
        setStudents(s);
        setPayments(p);
        setAttendance(a);
      })
      .finally(() => setLoading(false));
  }, []);

  const currentMonth = localMonthStr();

  const insights = useMemo<Insight[]>(() => {
    if (loading) return [];
    const out: Insight[] = [];

    // 1. Students at risk of churning: attendance dropped and payment overdue.
    for (const s of students) {
      const records = attendance.filter((a) => a.studentId === s.id);
      if (records.length < 3) continue;
      const attended = records.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
      const pct = Math.round((attended / records.length) * 100);
      const enrolled = s.enrollments || [];
      const priced = enrolled.some((e) => (e.group?.monthlyPrice || 0) > 0);
      const paidThisMonth = payments.some((p) => p.studentId === s.id && p.forMonth === currentMonth && p.status === "PAID");
      if (pct < 70 && priced && !paidThisMonth) {
        out.push({
          id: `churn-${s.id}`,
          severity: "high",
          icon: WarningIcon,
          title: `${s.fullName} ${t("aiInsights.churnTitle")}`,
          description: `${t("aiInsights.churnDesc1")} ${pct}% ${t("aiInsights.churnDesc2")}`,
          actionLabel: t("aiInsights.viewProfile"),
          actionHref: `/students/${s.id}`,
        });
      }
    }

    // 2. Underfilled groups losing money potential.
    for (const g of groups) {
      const enrolledCount = students.filter((s) => (s.enrollments || []).some((e) => e.groupId === g.id)).length;
      const fillRate = g.maxStudents > 0 ? enrolledCount / g.maxStudents : 1;
      if (g.maxStudents > 0 && fillRate < 0.6 && enrolledCount > 0) {
        out.push({
          id: `underfilled-${g.id}`,
          severity: "high",
          icon: TrendIcon,
          title: `"${g.name}" ${t("aiInsights.underfilledTitle1")}`,
          description: `${g.maxStudents} ${t("aiInsights.underfilledDesc1")} ${enrolledCount} ${t("aiInsights.underfilledDesc2")} (${Math.round(fillRate * 100)}%). ${t("aiInsights.underfilledDesc3")}`,
          actionLabel: t("aiInsights.viewGroup"),
          actionHref: `/groups/${g.id}`,
        });
      }
    }

    // 3. Debtors this month — payment reminder due.
    const debtors = students.filter((s) => {
      const enrolled = s.enrollments || [];
      const priced = enrolled.some((e) => (e.group?.monthlyPrice || 0) > 0);
      if (!priced) return false;
      return !payments.some((p) => p.studentId === s.id && p.forMonth === currentMonth && p.status === "PAID");
    });
    if (debtors.length > 0) {
      out.push({
        id: "debtors",
        severity: "medium",
        icon: ClockIcon,
        title: `${debtors.length} ${t("aiInsights.debtorsTitle1")}`,
        description: `${debtors
          .slice(0, 3)
          .map((s) => s.fullName)
          .join(", ")}${debtors.length > 3 ? ` ${t("aiInsights.andOthers")}` : ""} — ${t("aiInsights.debtorsDesc2")}`,
        actionLabel: t("aiInsights.viewPayments"),
        actionHref: "/payments",
      });
    }

    // 4. High-demand direction: a full group with more students than seats elsewhere in the same subject.
    const bySubject: Record<string, Group[]> = {};
    for (const g of groups) {
      bySubject[g.subject] = bySubject[g.subject] || [];
      bySubject[g.subject].push(g);
    }
    for (const [subject, subjectGroups] of Object.entries(bySubject)) {
      const full = subjectGroups.filter((g) => {
        const enrolledCount = students.filter((s) => (s.enrollments || []).some((e) => e.groupId === g.id)).length;
        return g.maxStudents > 0 && enrolledCount >= g.maxStudents;
      });
      if (full.length > 0 && full.length === subjectGroups.length) {
        out.push({
          id: `demand-${subject}`,
          severity: "opportunity",
          icon: PulseIcon,
          title: `"${subject}" ${t("aiInsights.demandTitle1")}`,
          description: `${t("aiInsights.demandDesc1")} ${subjectGroups.length} ${t("aiInsights.demandDesc2")}`,
          actionLabel: t("aiInsights.createGroup"),
          actionHref: "/groups",
        });
      }
    }

    // 5. Payment method speed comparison (watch-only, informational).
    const byMethodDays: Record<string, number[]> = {};
    for (const p of payments) {
      if (p.status !== "PAID" || !p.paidAt || !p.method) continue;
      const days = Math.max(0, (new Date(p.paidAt).getTime() - new Date(p.createdAt).getTime()) / 86400000);
      byMethodDays[p.method] = byMethodDays[p.method] || [];
      byMethodDays[p.method].push(days);
    }
    const avgDays = Object.entries(byMethodDays)
      .filter(([, arr]) => arr.length >= 2)
      .map(([method, arr]) => ({ method, avg: arr.reduce((a, b) => a + b, 0) / arr.length }))
      .sort((a, b) => a.avg - b.avg);
    if (avgDays.length >= 2) {
      const [fastest, slowest] = [avgDays[0], avgDays[avgDays.length - 1]];
      out.push({
        id: "method-speed",
        severity: "watch",
        icon: BulbIcon,
        title: `${fastest.method} ${t("aiInsights.methodSpeedTitle1")} ${slowest.method} ${t("aiInsights.methodSpeedTitle2")}`,
        description: `${fastest.method}: ${t("aiInsights.methodSpeedDesc1")} ${fastest.avg.toFixed(1)} ${t("aiInsights.methodSpeedDesc2")} ${slowest.method}: ${t("aiInsights.methodSpeedDesc1")} ${slowest.avg.toFixed(1)} ${t("aiInsights.methodSpeedDesc2")} ${fastest.method} ${t("aiInsights.methodSpeedDesc3")}`,
        actionLabel: t("aiInsights.viewPayments"),
        actionHref: "/payments",
      });
    }

    const order: Severity[] = ["high", "medium", "opportunity", "watch"];
    return out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  }, [loading, students, groups, payments, attendance, currentMonth, t]);

  const highCount = insights.filter((i) => i.severity === "high").length;
  const opportunityCount = insights.filter((i) => i.severity === "opportunity").length;

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
          {t("aiInsights.lastUpdated")} {updatedAt.toLocaleTimeString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, marginBottom: 20 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("aiInsights.statRisks")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#B23A47" }}>{highCount}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("aiInsights.statOpportunities")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#1FA463" }}>{opportunityCount}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("aiInsights.statTotal")}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{insights.length}</div>
              </div>
            </div>

            {insights.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
                {t("aiInsights.allGood")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {insights.map((insight) => {
                  const style = SEVERITY_BG[insight.severity];
                  return (
                    <div key={insight.id} style={{ background: style.bg, borderRadius: 16, padding: 20, display: "flex", gap: 16, alignItems: "flex-start" }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {insight.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Manrope', sans-serif" }}>{insight.title}</div>
                          <span style={{ fontSize: 10.5, fontWeight: 800, background: style.badgeBg, color: style.badgeText, padding: "3px 10px", borderRadius: 100 }}>
                            {SEVERITY_LABEL[insight.severity]}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: "#4A4E58", marginTop: 6, lineHeight: 1.6 }}>{insight.description}</div>
                        <Link
                          href={insight.actionHref}
                          className="btn"
                          style={{ display: "inline-block", marginTop: 12, background: ACCENT, color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
                        >
                          {insight.actionLabel}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
