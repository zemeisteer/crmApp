"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { groupsApi, studentsApi, paymentsApi, attendanceApi, exportApi, Group, Student, Payment, AttendanceRecord } from "@/lib/api";
import { localMonthStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function lastMonths(n: number) {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.unshift(localMonthStr(new Date(d.getFullYear(), d.getMonth() - i, 1)));
  }
  return out;
}

const METHOD_LABEL_KEYS: Record<string, TranslationKey> = {
  CLICK: "payment.methodClick",
  PAYME: "payment.methodPayme",
  CASH: "payment.methodCash",
  BANK_TRANSFER: "payment.methodBankTransfer",
};
const METHOD_COLOR: Record<string, string> = {
  CLICK: ACCENT,
  PAYME: "#1FA463",
  CASH: "#EA7A3A",
  BANK_TRANSFER: "#8A8D96",
};

function ReportsContent() {
  const { t } = useLanguage();
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

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

  const months = lastMonths(6);
  const currentMonth = months[months.length - 1];
  const currentYear = String(new Date().getFullYear());
  const lastYear = String(new Date().getFullYear() - 1);

  if (loading) {
    return <div style={{ padding: 32, color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  const yearRevenue = payments.filter((p) => p.status === "PAID" && p.forMonth.startsWith(currentYear)).reduce((s, p) => s + p.amount, 0);
  const lastYearRevenue = payments.filter((p) => p.status === "PAID" && p.forMonth.startsWith(lastYear)).reduce((s, p) => s + p.amount, 0);
  const yearGrowthPct = lastYearRevenue > 0 ? Math.round(((yearRevenue - lastYearRevenue) / lastYearRevenue) * 100) : null;

  const newThisMonth = students.filter((s) => s.createdAt.slice(0, 7) === currentMonth).length;

  const overallAttendance = attendance.length ? Math.round((attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length / attendance.length) * 100) : null;

  // Churn proxy: students in a priced group with no PAID payment in the last 2 months.
  const churnCount = students.filter((s) => {
    const enrolled = s.enrollments || [];
    const priced = enrolled.some((e) => (e.group?.monthlyPrice || 0) > 0);
    if (!priced) return false;
    const recentMonths = months.slice(-2);
    return !payments.some((p) => p.studentId === s.id && recentMonths.includes(p.forMonth) && p.status === "PAID");
  }).length;
  const churnPct = students.length ? Math.round((churnCount / students.length) * 100) : 0;

  // Debtors: enrolled in a priced group, no PAID payment this month.
  const debtors = students.filter((s) => {
    const enrolled = s.enrollments || [];
    if (enrolled.length === 0) return false;
    const hasPricedGroup = enrolled.some((e) => (e.group?.monthlyPrice || 0) > 0);
    if (!hasPricedGroup) return false;
    const paid = payments.some((p) => p.studentId === s.id && p.forMonth === currentMonth && p.status === "PAID");
    return !paid;
  });

  // Cumulative student-growth curve over the last 6 months.
  const growthCurve = months.map((m) => ({
    label: m.slice(5),
    value: students.filter((s) => s.createdAt.slice(0, 7) <= m).length,
  }));

  // Payment-method mix, by share of PAID amount.
  const methodTotals: Record<string, number> = {};
  let methodSum = 0;
  for (const p of payments) {
    if (p.status !== "PAID") continue;
    const key = p.method || "CASH";
    methodTotals[key] = (methodTotals[key] || 0) + p.amount;
    methodSum += p.amount;
  }
  const methodBreakdown = Object.entries(methodTotals)
    .map(([key, amount]) => ({ key, pct: methodSum > 0 ? Math.round((amount / methodSum) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct);

  // Top groups by this month's revenue (best-effort: sums this month's PAID payments
  // from each group's enrolled students; a student in several groups counts toward each).
  const topGroups = groups
    .map((g) => {
      const enrolledStudents = students.filter((s) => (s.enrollments || []).some((e) => e.groupId === g.id));
      const revenue = enrolledStudents.reduce(
        (sum, s) => sum + payments.filter((p) => p.studentId === s.id && p.forMonth === currentMonth && p.status === "PAID").reduce((a, p) => a + p.amount, 0),
        0,
      );
      const groupAttendance = attendance.filter((a) => a.groupId === g.id);
      const attendancePct = groupAttendance.length
        ? Math.round((groupAttendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length / groupAttendance.length) * 100)
        : null;
      return { group: g, studentCount: enrolledStudents.length, revenue, attendancePct };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("reports.title")}</h1>
        <button
          className="btn"
          onClick={() => exportApi.paymentsXlsx()}
          style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
        >
          {t("reports.exportExcel")}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
          <StatCard label={t("reports.statYearRevenue")} value={`${formatMoney(yearRevenue)} ${t("common.sumUnit")}`} delta={yearGrowthPct != null ? `↑ ${yearGrowthPct}% ${t("reports.statVsLastYear")}` : undefined} />
          <StatCard label={t("reports.statActiveStudents")} value={String(students.length)} delta={newThisMonth > 0 ? `↑ ${newThisMonth} ${t("reports.statThisMonth")}` : t("reports.noChange")} />
          <StatCard label={t("reports.statAvgAttendance")} value={overallAttendance != null ? `${overallAttendance}%` : "—"} delta={t("reports.noChange")} />
          <StatCard label={t("reports.statChurn")} value={`${churnPct}%`} danger />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 20 }}>{t("reports.studentGrowthTitle")}</div>
            <LineChart data={growthCurve} />
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 20 }}>{t("reports.paymentMethodsTitle")}</div>
            {methodBreakdown.length === 0 ? (
              <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("reports.noData")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {methodBreakdown.map((m) => (
                  <div key={m.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
                      <span>{METHOD_LABEL_KEYS[m.key] ? t(METHOD_LABEL_KEYS[m.key]) : m.key}</span>
                      <span>{m.pct}%</span>
                    </div>
                    <div style={{ height: 7, background: "#F1F0EC", borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ width: `${m.pct}%`, height: "100%", background: METHOD_COLOR[m.key] || ACCENT, borderRadius: 5 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 20px 4px", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("reports.topGroupsByRevenue")}</div>
          {topGroups.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 13.5, padding: "16px 20px 20px" }}>{t("reports.noGroups")}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("reports.colGroup")}</th>
                  <th style={{ paddingTop: 16 }}>{t("reports.colTeacher")}</th>
                  <th style={{ paddingTop: 16 }}>{t("reports.colStudents")}</th>
                  <th style={{ paddingTop: 16 }}>{t("reports.colMonthRevenue")}</th>
                  <th style={{ paddingTop: 16 }}>{t("reports.colAvgAttendance")}</th>
                </tr>
              </thead>
              <tbody>
                {topGroups.map(({ group, studentCount, revenue, attendancePct }) => (
                  <tr key={group.id}>
                    <td style={{ fontWeight: 600 }}>{group.name}</td>
                    <td>{group.teacher?.fullName || "—"}</td>
                    <td>{studentCount}</td>
                    <td style={{ fontWeight: 700 }}>{formatMoney(revenue)} {t("common.sumUnit")}</td>
                    <td>{attendancePct != null ? `${attendancePct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 20px 4px", fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>
            {t("reports.monthDebtorsTitle")} ({debtors.length})
          </div>
          {debtors.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 13.5, padding: "16px 20px 20px" }}>{t("reports.noDebtors")}</div>
          ) : (
            <div style={{ padding: "10px 20px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {debtors.map((s) => {
                const owed = (s.enrollments || []).reduce((sum, e) => sum + (e.group.monthlyPrice || 0), 0);
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #F1F0EC", borderRadius: 12, padding: "10px 14px" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#FDEBEC", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#B23A47", fontSize: 12, flexShrink: 0 }}>
                      {s.fullName.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700 }}>{s.fullName}</div>
                      <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{s.enrollments?.map((e) => e.group.name).join(", ")}</div>
                    </div>
                    {owed > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#B23A47", background: "#FDEBEC", padding: "5px 10px", borderRadius: 100, whiteSpace: "nowrap" }}>
                        {formatMoney(owed)} {t("common.sumUnit")}
                      </span>
                    )}
                    <Link
                      href={`/students/${s.id}`}
                      className="btn"
                      style={{ display: "inline-block", background: "#F2F1EC", color: "#181A1F", fontSize: 11.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8, whiteSpace: "nowrap" }}
                    >
                      {t("common.viewProfile")}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LineChart({ data }: { data: { label: string; value: number }[] }) {
  const width = 560;
  const height = 160;
  const padding = 20;
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const range = Math.max(1, max - min);
  const points = data.map((d, i) => {
    const x = padding + (i / Math.max(1, data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((d.value - min) / range) * (height - padding * 2);
    return { x, y, ...d };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg width="100%" height={height + 24} viewBox={`0 0 ${width} ${height + 24}`} preserveAspectRatio="xMidYMid meet">
      <path d={path} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={ACCENT} />
      ))}
      {points.map((p, i) => (
        <text key={i} x={p.x} y={height + 18} textAnchor="middle" fontSize={11} fill="#8A8D96">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

function StatCard({ label, value, delta, danger }: { label: string; value: string; delta?: string; danger?: boolean }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
      <div style={{ fontSize: 12, color: "#8A8D96" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: danger ? "#B23A47" : "#181A1F" }}>{value}</div>
      {delta && <div style={{ fontSize: 11.5, color: danger ? "#B23A47" : delta.startsWith("↑") ? "#1FA463" : "#8A8D96", marginTop: 4, fontWeight: 600 }}>{delta}</div>}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <DashboardShell>
      <ReportsContent />
    </DashboardShell>
  );
}
