"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import MonthPicker from "@/components/MonthPicker";
import {
  groupsApi,
  studentsApi,
  paymentsApi,
  attendanceApi,
  exportApi,
  salaryApi,
  notificationsApi,
  Group,
  Student,
  Payment,
  AttendanceRecord,
  PayrollCalculationResponse,
  TeacherPayrollItem,
} from "@/lib/api";
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

type ReportsTab = "overview" | "payroll" | "retention";

function ReportsContent() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<ReportsTab>("overview");

  // Core data states
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Payroll states (Spec §25)
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(localMonthStr());
  const [payrollData, setPayrollData] = useState<PayrollCalculationResponse | null>(null);
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [disburseModalOpen, setDisburseModalOpen] = useState(false);
  const [disburseTeacher, setDisburseTeacher] = useState<TeacherPayrollItem | null>(null);
  const [disburseAmount, setDisburseAmount] = useState("");
  const [disburseMethod, setDisburseMethod] = useState<"CASH" | "CLICK" | "PAYME" | "BANK_TRANSFER">("CASH");
  const [disburseNotes, setDisburseNotes] = useState("");
  const [disbursing, setDisbursing] = useState(false);

  // SMS quick action state for at-risk students
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [smsStudent, setSmsStudent] = useState<Student | null>(null);
  const [smsText, setSmsText] = useState("");
  const [sendingSms, setSendingSms] = useState(false);

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

  function loadPayroll(month = selectedPayrollMonth) {
    setLoadingPayroll(true);
    salaryApi
      .calculate(month)
      .then((res) => setPayrollData(res))
      .catch((err) => console.error(err))
      .finally(() => setLoadingPayroll(false));
  }

  useEffect(() => {
    if (activeTab === "payroll") {
      loadPayroll(selectedPayrollMonth);
    }
  }, [activeTab, selectedPayrollMonth]);

  function openDisburseModal(item: TeacherPayrollItem) {
    setDisburseTeacher(item);
    setDisburseAmount(String(item.netPayable || item.calculatedSalary));
    setDisburseMethod("CASH");
    setDisburseNotes(`Oylik maosh: ${item.teacherName} (${selectedPayrollMonth})`);
    setDisburseModalOpen(true);
  }

  async function handleDisburseSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!disburseTeacher || !disburseAmount) return;
    setDisbursing(true);
    try {
      await salaryApi.disburse({
        teacherId: disburseTeacher.teacherId,
        amount: Number(disburseAmount),
        forMonth: selectedPayrollMonth,
        paymentMethod: disburseMethod,
        notes: disburseNotes.trim() || undefined,
      });
      alert("Maosh muvaffaqiyatli to'landi va Xarajatlar (SALARY) ro'yxatiga biriktirildi!");
      setDisburseModalOpen(false);
      loadPayroll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Maosh to'lashda xatolik yuz berdi");
    } finally {
      setDisbursing(false);
    }
  }

  function openSmsToStudent(student: Student) {
    setSmsStudent(student);
    setSmsText(`Assalomu alaykum, ${student.fullName}! Markazimizdagi darslaringiz bo'yicha siz bilan bog'lanmoqchi edik. Qachon gaplashsak qulay bo'ladi?`);
    setSmsModalOpen(true);
  }

  async function handleSendSmsToStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!smsStudent || !smsStudent.phone || !smsText.trim()) return;
    setSendingSms(true);
    try {
      await notificationsApi.sendTest({
        recipient: smsStudent.phone,
        channel: "SMS",
        content: smsText.trim(),
        title: "Eslatma",
      });
      alert("SMS xabar muvaffaqiyatli yuborildi!");
      setSmsModalOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "SMS yuborishda xatolik yuz berdi");
    } finally {
      setSendingSms(false);
    }
  }

  const months = lastMonths(6);
  const currentMonth = months[months.length - 1];
  const currentYear = String(new Date().getFullYear());
  const lastYear = String(new Date().getFullYear() - 1);

  // Overview computations
  const yearRevenue = useMemo(() => {
    return payments.filter((p) => p.status === "PAID" && p.forMonth.startsWith(currentYear)).reduce((s, p) => s + p.amount, 0);
  }, [payments, currentYear]);

  const lastYearRevenue = useMemo(() => {
    return payments.filter((p) => p.status === "PAID" && p.forMonth.startsWith(lastYear)).reduce((s, p) => s + p.amount, 0);
  }, [payments, lastYear]);

  const yearGrowthPct = lastYearRevenue > 0 ? Math.round(((yearRevenue - lastYearRevenue) / lastYearRevenue) * 100) : null;
  const newThisMonth = students.filter((s) => s.createdAt.slice(0, 7) === currentMonth).length;
  const overallAttendance = attendance.length ? Math.round((attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length / attendance.length) * 100) : null;

  // Churn proxy
  const churnCount = useMemo(() => {
    return students.filter((s) => {
      const enrolled = s.enrollments || [];
      const priced = enrolled.some((e) => (e.group?.monthlyPrice || 0) > 0);
      if (!priced) return false;
      const recentMonths = months.slice(-2);
      return !payments.some((p) => p.studentId === s.id && recentMonths.includes(p.forMonth) && p.status === "PAID");
    }).length;
  }, [students, payments, months]);

  const churnPct = students.length ? Math.round((churnCount / students.length) * 100) : 0;

  // Debtors
  const debtors = useMemo(() => {
    return students.filter((s) => {
      const enrolled = s.enrollments || [];
      if (enrolled.length === 0) return false;
      const hasPricedGroup = enrolled.some((e) => (e.group?.monthlyPrice || 0) > 0);
      if (!hasPricedGroup) return false;
      const paid = payments.some((p) => p.studentId === s.id && p.forMonth === currentMonth && p.status === "PAID");
      return !paid;
    });
  }, [students, payments, currentMonth]);

  // Growth curve
  const growthCurve = useMemo(() => {
    return months.map((m) => ({
      label: m.slice(5),
      value: students.filter((s) => s.createdAt.slice(0, 7) <= m).length,
    }));
  }, [months, students]);

  // Payment methods
  const methodBreakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    let sum = 0;
    for (const p of payments) {
      if (p.status !== "PAID") continue;
      const key = p.method || "CASH";
      totals[key] = (totals[key] || 0) + p.amount;
      sum += p.amount;
    }
    return Object.entries(totals)
      .map(([key, amount]) => ({ key, pct: sum > 0 ? Math.round((amount / sum) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [payments]);

  // Top groups
  const topGroups = useMemo(() => {
    return groups
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
  }, [groups, students, payments, attendance, currentMonth]);

  // Deep Analytics & Churn Prediction (Spec §38)
  const churnAnalysis = useMemo(() => {
    const recentMonths = months.slice(-2);
    const atRiskList = students.map((s) => {
      const studentAtt = attendance.filter((a) => a.studentId === s.id);
      const totalLessons = studentAtt.length;
      const attendedLessons = studentAtt.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
      const attRate = totalLessons > 0 ? Math.round((attendedLessons / totalLessons) * 100) : null;

      const hasPaidRecently = payments.some(
        (p) => p.studentId === s.id && recentMonths.includes(p.forMonth) && p.status === "PAID",
      );

      const enrolledGroups = s.enrollments || [];
      const hasDebt = enrolledGroups.some((e) => (e.group?.monthlyPrice || 0) > 0) && !hasPaidRecently;

      let riskTier: "HIGH" | "MEDIUM" | "LOW" = "LOW";
      if (attRate !== null && attRate < 45 && hasDebt) {
        riskTier = "HIGH";
      } else if ((attRate !== null && attRate < 55) || hasDebt) {
        riskTier = "MEDIUM";
      }

      const lastAtt = studentAtt.sort((a, b) => b.date.localeCompare(a.date))[0]?.date || null;

      return {
        student: s,
        attendanceRate: attRate,
        totalLessons,
        hasDebt,
        riskTier,
        lastAttendedDate: lastAtt,
        enrolledCount: enrolledGroups.length,
      };
    }).filter((item) => item.riskTier !== "LOW");

    atRiskList.sort((a, b) => {
      if (a.riskTier === "HIGH" && b.riskTier !== "HIGH") return -1;
      if (b.riskTier === "HIGH" && a.riskTier !== "HIGH") return 1;
      return 0;
    });

    // Group Occupancy analysis
    const groupOccupancy = groups.map((g) => {
      const enrolled = students.filter((s) => (s.enrollments || []).some((e) => e.groupId === g.id)).length;
      const cap = g.maxStudents || 20;
      const occPct = Math.round((enrolled / cap) * 100);
      return {
        group: g,
        enrolled,
        capacity: cap,
        occupancyRate: occPct,
        status: occPct >= 85 ? "OPTIMAL" : occPct < 40 ? "UNDER_ENROLLED" : "NORMAL",
      };
    }).sort((a, b) => b.occupancyRate - a.occupancyRate);

    // Revenue forecasting
    const nextMonthForecast = groups.reduce((sum, g) => {
      const enrolled = students.filter((s) => (s.enrollments || []).some((e) => e.groupId === g.id)).length;
      return sum + (enrolled * (g.monthlyPrice || 0));
    }, 0);

    return {
      atRiskStudents: atRiskList,
      groupOccupancy,
      nextMonthForecast,
    };
  }, [students, attendance, payments, months, groups]);

  if (loading) {
    return <div style={{ padding: 32, color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  return (
    <>
      {/* Header */}
      <div
        style={{
          padding: "22px 32px",
          borderBottom: "1px solid #EAE8E2",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("reports.title")}</h1>
          <p style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 2 }}>
            Moliya, o&apos;qituvchilar maoshi va mijozlarni saqlash tahlili
          </p>
        </div>

        {/* Tab switchers */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 9, padding: 3, gap: 2 }}>
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              style={{
                border: "none",
                background: activeTab === "overview" ? "#fff" : "transparent",
                color: activeTab === "overview" ? "#181A1F" : "#8A8D96",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
                boxShadow: activeTab === "overview" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              📊 Umumiy & Moliya
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("payroll")}
              style={{
                border: "none",
                background: activeTab === "payroll" ? "#fff" : "transparent",
                color: activeTab === "payroll" ? "#181A1F" : "#8A8D96",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
                boxShadow: activeTab === "payroll" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              💼 Oylik Maosh (Payroll)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("retention")}
              style={{
                border: "none",
                background: activeTab === "retention" ? "#fff" : "transparent",
                color: activeTab === "retention" ? "#181A1F" : "#8A8D96",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
                boxShadow: activeTab === "retention" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              🛡️ Saqlash & Churn ({churnAnalysis.atRiskStudents.length})
            </button>
          </div>

          <button
            className="btn"
            onClick={() => exportApi.paymentsXlsx()}
            style={{
              background: "#F2F1EC",
              color: "#181A1F",
              border: "none",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 16px",
              borderRadius: 9,
            }}
          >
            {t("reports.exportExcel")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        
        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW & GENERAL FINANCE                                         */}
        {/* ========================================================================= */}
        {activeTab === "overview" && (
          <>
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
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: TEACHER PAYROLL ENGINE (Spec §25)                                   */}
        {/* ========================================================================= */}
        {activeTab === "payroll" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                  O&apos;qituvchilar maoshi hisob-kitobi (Auditable Payroll)
                </h2>
                <p style={{ fontSize: 12, color: "#8A8D96", margin: "2px 0 0" }}>
                  Oylik stavka, darsbay yoki guruh tushumidan ulush hisobida to&apos;lov
                </p>
              </div>
              <div style={{ width: 220 }}>
                <MonthPicker value={selectedPayrollMonth} onChange={setSelectedPayrollMonth} />
              </div>
            </div>

            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <StatCard label="Hisoblangan jami maosh" value={`${formatMoney(payrollData?.totalCalculated || 0)} so'm`} />
              <StatCard label="To'langan maosh" value={`${formatMoney(payrollData?.totalPaid || 0)} so'm`} delta={payrollData?.totalPaid ? "To'lov qilingan" : undefined} />
              <StatCard label="Kutilayotgan qarzdorlik" value={`${formatMoney(payrollData?.totalPending || 0)} so'm`} danger={(payrollData?.totalPending || 0) > 0} />
              <StatCard label="Faol o'qituvchilar" value={String(payrollData?.teacherCount || 0)} />
            </div>

            {/* Payroll Table */}
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #EAE8E2", fontSize: 14, fontWeight: 700 }}>
                {selectedPayrollMonth} oyi uchun maosh vedomosti
              </div>
              {loadingPayroll ? (
                <div style={{ padding: 32, textAlign: "center", color: "#8A8D96" }}>Hisoblanmoqda...</div>
              ) : !payrollData || payrollData.teachers.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "#8A8D96" }}>O&apos;qituvchilar topilmadi</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th style={{ paddingTop: 16 }}>O&apos;qituvchi</th>
                      <th style={{ paddingTop: 16 }}>Model</th>
                      <th style={{ paddingTop: 16 }}>Hisob tafsiloti</th>
                      <th style={{ paddingTop: 16 }}>Hisoblangan summa</th>
                      <th style={{ paddingTop: 16 }}>To&apos;langan</th>
                      <th style={{ paddingTop: 16 }}>To&apos;lanishi kerak</th>
                      <th style={{ paddingTop: 16 }}>Holat</th>
                      <th style={{ paddingTop: 16, textAlign: "right" }}>Amal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollData.teachers.map((item) => (
                      <tr key={item.teacherId}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{item.teacherName}</div>
                          <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{item.subject || "Fan ko'rsatilmagan"} • {item.phone || "—"}</div>
                        </td>
                        <td>
                          <span
                            style={{
                              background: item.salaryType === "PERCENTAGE" ? "#FEF3C7" : item.salaryType === "PER_LESSON" ? "#E0F2FE" : "#F3F4F6",
                              color: item.salaryType === "PERCENTAGE" ? "#B45309" : item.salaryType === "PER_LESSON" ? "#0284C7" : "#4B5563",
                              padding: "3px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {item.salaryType === "PERCENTAGE" ? "Foiz (%)" : item.salaryType === "PER_LESSON" ? "Darsbay" : "Oylik (Fixed)"}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: "#4A4E58" }}>
                          {item.salaryType === "FIXED" && `Belgilangan stavka: ${formatMoney(item.salaryValue)} so'm`}
                          {item.salaryType === "PER_LESSON" && `${item.details.lessonCount || 0} ta dars × ${formatMoney(item.salaryValue)} so'm`}
                          {item.salaryType === "PERCENTAGE" && `Guruh tushumi: ${formatMoney(item.details.groupRevenue || 0)} × ${item.salaryValue}%`}
                        </td>
                        <td style={{ fontWeight: 700 }}>{formatMoney(item.calculatedSalary)} so&apos;m</td>
                        <td style={{ fontWeight: 600, color: item.paidAmount > 0 ? "#10B981" : "#8A8D96" }}>
                          {formatMoney(item.paidAmount)} so&apos;m
                        </td>
                        <td style={{ fontWeight: 800, color: item.netPayable > 0 ? "#DC2626" : "#10B981" }}>
                          {formatMoney(item.netPayable)} so&apos;m
                        </td>
                        <td>
                          {item.isPaid ? (
                            <span className="badge badge-success">✓ To&apos;langan</span>
                          ) : (
                            <span className="badge badge-danger">Kutilmoqda</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => openDisburseModal(item)}
                            style={{
                              background: item.netPayable > 0 ? ACCENT : "#F2F1EC",
                              color: item.netPayable > 0 ? "#fff" : "#181A1F",
                              border: "none",
                              padding: "6px 12px",
                              borderRadius: 7,
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {item.isPaid ? "Qayta to'lash" : "To'lov qilish"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: RETENTION & CHURN PREDICTION ENGINE (Spec §38)                     */}
        {/* ========================================================================= */}
        {activeTab === "retention" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                Mijozlarni Saqlash va Churn Xavfi Tahlili (Retention Engine)
              </h2>
              <p style={{ fontSize: 12, color: "#8A8D96", margin: "2px 0 0" }}>
                Davomat pasayishi va to&apos;lov kechikishi asosida o&apos;quvchilarni erta saqlab qolish
              </p>
            </div>

            {/* Churn KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <StatCard label="Xavf ostidagi o'quvchilar" value={`${churnAnalysis.atRiskStudents.length} nafar`} danger={churnAnalysis.atRiskStudents.length > 0} />
              <StatCard label="Umumiy Churn ulushi" value={`${churnPct}%`} danger={churnPct > 15} />
              <StatCard label="Keyingi oy kutilayotgan tushum" value={`${formatMoney(churnAnalysis.nextMonthForecast)} so'm`} delta="Faol guruhlar prognozi" />
              <StatCard label="Markaz o'rtacha davomati" value={overallAttendance ? `${overallAttendance}%` : "—"} />
            </div>

            {/* At-Risk Students Table */}
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #EAE8E2", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  🚨 Yo&apos;qotish (Churn) xavfi yuqori bo&apos;lgan o&apos;quvchilar ro&apos;yxati
                </span>
                <span style={{ fontSize: 12, color: "#8A8D96" }}>{churnAnalysis.atRiskStudents.length} ta o&apos;quvchi aniqlandi</span>
              </div>

              {churnAnalysis.atRiskStudents.length === 0 ? (
                <div style={{ padding: 36, textAlign: "center", color: "#10B981", background: "#F0FDF4" }}>
                  🎉 Ajoyib! Hozirda jiddiy churn xavfi ostida bo&apos;lgan o&apos;quvchilar mavjud emas.
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th style={{ paddingTop: 16 }}>O&apos;quvchi</th>
                      <th style={{ paddingTop: 16 }}>Xavf darajasi</th>
                      <th style={{ paddingTop: 16 }}>Davomat ko&apos;rsatkichi</th>
                      <th style={{ paddingTop: 16 }}>To&apos;lov holati</th>
                      <th style={{ paddingTop: 16 }}>Oxirgi dars</th>
                      <th style={{ paddingTop: 16, textAlign: "right" }}>Tezkor chora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {churnAnalysis.atRiskStudents.map((item) => (
                      <tr key={item.student.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{item.student.fullName}</div>
                          <div style={{ fontSize: 11.5, color: "#8A8D96" }}>📞 {item.student.phone || "—"}</div>
                        </td>
                        <td>
                          <span
                            style={{
                              background: item.riskTier === "HIGH" ? "#FEE2E2" : "#FEF3C7",
                              color: item.riskTier === "HIGH" ? "#DC2626" : "#B45309",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 800,
                            }}
                          >
                            {item.riskTier === "HIGH" ? "⚠️ YUQORI XAVF" : "⚡ O'RTA XAVF"}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700, color: (item.attendanceRate || 0) < 50 ? "#DC2626" : "#181A1F" }}>
                            {item.attendanceRate !== null ? `${item.attendanceRate}%` : "—"}
                          </span>
                          <span style={{ fontSize: 11, color: "#8A8D96", marginLeft: 4 }}>
                            ({item.totalLessons} ta darsdan)
                          </span>
                        </td>
                        <td>
                          {item.hasDebt ? (
                            <span style={{ color: "#DC2626", fontWeight: 700, fontSize: 12 }}>Qarzdorlik bor</span>
                          ) : (
                            <span style={{ color: "#10B981", fontWeight: 600, fontSize: 12 }}>To&apos;langan</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: "#4A4E58" }}>
                          {item.lastAttendedDate ? item.lastAttendedDate : "Qatnashmagan"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => openSmsToStudent(item.student)}
                              style={{
                                background: "#EEF0FF",
                                color: ACCENT,
                                border: "1px solid #C7D2FE",
                                padding: "6px 10px",
                                borderRadius: 7,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              💬 SMS yuborish
                            </button>
                            <Link
                              href={`/students/${item.student.id}`}
                              className="btn"
                              style={{
                                background: "#F2F1EC",
                                color: "#181A1F",
                                padding: "6px 10px",
                                borderRadius: 7,
                                fontSize: 12,
                                fontWeight: 700,
                                textDecoration: "none",
                              }}
                            >
                              Profil
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Group Capacity & Occupancy Rates */}
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #EAE8E2", fontSize: 14, fontWeight: 700 }}>
                🏢 Guruhlar sig&apos;imi va to&apos;ldirilganlik darajasi (Capacity & Occupancy)
              </div>
              <table>
                <thead>
                  <tr>
                    <th style={{ paddingTop: 16 }}>Guruh</th>
                    <th style={{ paddingTop: 16 }}>Fan & O&apos;qituvchi</th>
                    <th style={{ paddingTop: 16 }}>O&apos;quvchilar soni / Sig&apos;im</th>
                    <th style={{ paddingTop: 16 }}>To&apos;ldirilganlik (%)</th>
                    <th style={{ paddingTop: 16 }}>Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {churnAnalysis.groupOccupancy.map(({ group, enrolled, capacity, occupancyRate, status }) => (
                    <tr key={group.id}>
                      <td style={{ fontWeight: 700 }}>{group.name}</td>
                      <td>
                        <div>{group.subject}</div>
                        <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{group.teacher?.fullName || "—"}</div>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {enrolled} / {capacity} talaba
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 100, height: 7, background: "#F1F0EC", borderRadius: 4, overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${Math.min(100, occupancyRate)}%`,
                                height: "100%",
                                background: occupancyRate >= 80 ? "#10B981" : occupancyRate < 40 ? "#F59E0B" : ACCENT,
                                borderRadius: 4,
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{occupancyRate}%</span>
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            background: status === "OPTIMAL" ? "#DCFCE7" : status === "UNDER_ENROLLED" ? "#FEF3C7" : "#F3F4F6",
                            color: status === "OPTIMAL" ? "#15803D" : status === "UNDER_ENROLLED" ? "#B45309" : "#4B5563",
                            padding: "3px 8px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {status === "OPTIMAL" ? "To'liq guruh" : status === "UNDER_ENROLLED" ? "Bo'sh joylar ko'p" : "Normal"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Disburse Salary Modal */}
      <Modal
        open={disburseModalOpen}
        onClose={() => setDisburseModalOpen(false)}
        title="O'qituvchi maoshini to'lash (Disbursement)"
      >
        <form onSubmit={handleDisburseSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#F8F8F6", borderRadius: 10, padding: 12, border: "1px solid #EAE8E2" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#181A1F" }}>{disburseTeacher?.teacherName}</div>
            <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2 }}>
              Fan: {disburseTeacher?.subject || "Ko'rsatilmagan"} • Model: {disburseTeacher?.salaryType}
            </div>
            <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, marginTop: 4 }}>
              Kutilayotgan summa: {formatMoney(disburseTeacher?.netPayable || 0)} so&apos;m
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>To&apos;lov summasi (so&apos;m)</div>
            <input
              type="number"
              className="field-input"
              value={disburseAmount}
              onChange={(e) => setDisburseAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>To&apos;lov usuli</div>
            <Select
              options={[
                { value: "CASH", label: "Naqd pul (CASH)" },
                { value: "BANK_TRANSFER", label: "Bank o'tkazmasi (BANK_TRANSFER)" },
                { value: "CLICK", label: "Click orqali" },
                { value: "PAYME", label: "Payme orqali" },
              ]}
              value={disburseMethod}
              onChange={(v) => setDisburseMethod(v as "CASH" | "CLICK" | "PAYME" | "BANK_TRANSFER")}
            />
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Izoh</div>
            <input
              className="field-input"
              value={disburseNotes}
              onChange={(e) => setDisburseNotes(e.target.value)}
              placeholder="Qo'shimcha izoh..."
            />
          </div>

          <button
            className="btn"
            type="submit"
            disabled={disbursing}
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: 12,
              borderRadius: 10,
              marginTop: 4,
            }}
          >
            {disbursing ? "Saqlanmoqda..." : "Maoshni tasdiqlash va Xarajatlarga yozish"}
          </button>
        </form>
      </Modal>

      {/* SMS Modal to Student */}
      <Modal
        open={smsModalOpen}
        onClose={() => setSmsModalOpen(false)}
        title="O'quvchiga SMS eslatma yuborish"
      >
        <form onSubmit={handleSendSmsToStudent} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#F8F8F6", borderRadius: 10, padding: 12, border: "1px solid #EAE8E2" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{smsStudent?.fullName}</div>
            <div style={{ fontSize: 12.5, color: ACCENT, fontWeight: 600, marginTop: 2 }}>📞 {smsStudent?.phone}</div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>SMS matni</div>
            <textarea
              className="field-input"
              rows={4}
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              required
            />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={sendingSms}
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: 12,
              borderRadius: 10,
            }}
          >
            {sendingSms ? "Yuborilmoqda..." : "SMS yuborish"}
          </button>
        </form>
      </Modal>
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
