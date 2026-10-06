"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import MonthPicker from "@/components/MonthPicker";
import DirectorReport from "@/components/reports/DirectorReport";
import LoadError from "@/components/LoadError";
import PayrollReconciliationPanel from "@/components/reports/PayrollReconciliation";
import {
  ApiError,
  exportApi,
  reportsApi,
  salaryApi,
  notificationsApi,
  retryKey,
  PayrollCalculationResponse,
  SalaryPayment,
  TeacherPayrollItem,
  type ReportsOverview as ReportsOverviewData,
} from "@/lib/api";
import ReportsOverviewView from "@/components/reports/ReportsOverview";
import { centerToday, centerTimeZone } from "@/lib/center-time";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

type ReportsTab = "director" | "overview" | "payroll" | "retention";
const TABS: ReportsTab[] = ["director", "overview", "payroll", "retention"];
type SmsTarget = { id: string; fullName: string; phone: string | null };

function ReportsContent() {
  const { t } = useLanguage();
  const salaryTypeLabel = (type: string | null | undefined) =>
    type === "PERCENTAGE" ? t("rep3.typePercent") : type === "PER_LESSON" ? t("rep3.typePerLesson") : t("rep3.typeFixed");
  // A link can open a tab directly (/reports?tab=payroll from a teacher's page).
  const tabParam = useSearchParams().get("tab");
  const [activeTab, setActiveTab] = useState<ReportsTab>(() => (TABS.includes(tabParam as ReportsTab) ? (tabParam as ReportsTab) : "director"));

  // Server-computed monthly report (replaces downloading every student,
  // payment and attendance row and aggregating in the browser).
  // Months start on the center's clock (the server reports in its timezone),
  // not the browser's: near midnight on the 1st they differ.
  const { tenant } = useAuth();
  const [reportMonth, setReportMonth] = useState(() => centerToday(centerTimeZone(tenant?.timezone)).slice(0, 7));
  const [report, setReport] = useState<ReportsOverviewData | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

  // Payroll states (Spec §25)
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(reportMonth);
  const [payrollData, setPayrollData] = useState<PayrollCalculationResponse | null>(null);
  const [loadingPayroll, setLoadingPayroll] = useState(false);
  const [payrollError, setPayrollError] = useState<string | null>(null);
  const [disburseModalOpen, setDisburseModalOpen] = useState(false);
  const [disburseTeacher, setDisburseTeacher] = useState<TeacherPayrollItem | null>(null);
  const [disburseMonth, setDisburseMonth] = useState(selectedPayrollMonth);
  const [disburseAmount, setDisburseAmount] = useState("");
  const [disburseMethod, setDisburseMethod] = useState<"CASH" | "CLICK" | "PAYME" | "BANK_TRANSFER">("CASH");
  const [disburseNotes, setDisburseNotes] = useState("");
  const [disburseError, setDisburseError] = useState<string | null>(null);
  const [disbursing, setDisbursing] = useState(false);
  const [monthPayouts, setMonthPayouts] = useState<SalaryPayment[] | null>(null);
  // Reversing one payout of the month (inline, with a reason).
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
  // One Idempotency-Key per payout form contents (see retryKey).
  const disburseKey = useRef<{ sig: string; key: string } | null>(null);
  // Only the answer for the month on screen is shown: switching months
  // quickly must not let a slower, older answer overwrite a newer one.
  const payrollSeq = useRef(0);

  // SMS quick action state for at-risk students
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [smsStudent, setSmsStudent] = useState<SmsTarget | null>(null);
  const [smsText, setSmsText] = useState("");
  const [sendingSms, setSendingSms] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    reportsApi
      .overview(reportMonth)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((err) => { if (!cancelled) setReportError(err instanceof ApiError ? err.message : t("adm.loadError")); })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [reportMonth, t]);

  const loadPayroll = useCallback((month: string) => {
    const seq = ++payrollSeq.current;
    setLoadingPayroll(true);
    setPayrollError(null);
    salaryApi
      .calculate(month)
      .then((res) => {
        if (seq !== payrollSeq.current) return;
        setPayrollData(res);
        // The open payout form shows the same teacher's fresh numbers.
        setDisburseTeacher((prev) => (prev ? res.teachers.find((x) => x.teacherId === prev.teacherId) ?? prev : prev));
      })
      .catch((err) => {
        if (seq !== payrollSeq.current) return;
        setPayrollData(null);
        setPayrollError(err instanceof ApiError ? err.message : t("rep2.payrollLoadError"));
      })
      .finally(() => {
        if (seq === payrollSeq.current) setLoadingPayroll(false);
      });
  }, [t]);

  useEffect(() => {
    if (activeTab === "payroll") {
      loadPayroll(selectedPayrollMonth);
    }
  }, [activeTab, selectedPayrollMonth, loadPayroll]);

  function openDisburseModal(item: TeacherPayrollItem) {
    setDisburseTeacher(item);
    setDisburseMonth(selectedPayrollMonth);
    setDisburseAmount(String(item.netPayable));
    setDisburseMethod("CASH");
    setDisburseNotes("");
    setDisburseError(null);
    disburseKey.current = null;
    setMonthPayouts(null);
    setReversingId(null);
    setDisburseModalOpen(true);
    loadMonthPayouts(item.teacherId, selectedPayrollMonth);
  }

  // Payouts of this month (reversed ones too), shown in the form.
  function loadMonthPayouts(teacherId: string, month: string) {
    salaryApi
      .list(teacherId, month)
      .then((rows) => setMonthPayouts(rows))
      .catch(() => setMonthPayouts([]));
  }

  async function confirmReverse(payoutId: string, amount: number) {
    if (!disburseTeacher || reverseReason.trim().length < 3) {
      setDisburseError(t("rep2.reverseReasonShort"));
      return;
    }
    setReverseBusy(true);
    setDisburseError(null);
    try {
      await salaryApi.reverse(payoutId, reverseReason.trim());
      setReversingId(null);
      setReverseReason("");
      // The reversed amount is owed again: offer it in the form.
      setDisburseAmount(String(disburseTeacher.netPayable + amount));
      disburseKey.current = null;
      loadMonthPayouts(disburseTeacher.teacherId, disburseMonth);
      loadPayroll(selectedPayrollMonth);
    } catch (err) {
      setDisburseError(err instanceof Error ? err.message : t("rep2.salaryError"));
    } finally {
      setReverseBusy(false);
    }
  }

  async function handleDisburseSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!disburseTeacher || !disburseAmount) return;
    const amount = Number(disburseAmount);
    if (!Number.isInteger(amount) || amount < 1 || amount > disburseTeacher.netPayable) {
      setDisburseError(t("rep2.amountRange").replace("{max}", formatMoney(disburseTeacher.netPayable)));
      return;
    }
    const body = {
      teacherId: disburseTeacher.teacherId,
      amount,
      forMonth: disburseMonth,
      paymentMethod: disburseMethod,
      notes: disburseNotes.trim() || undefined,
    };
    setDisbursing(true);
    setDisburseError(null);
    try {
      await salaryApi.disburse(body, retryKey(disburseKey, body));
      disburseKey.current = null;
      setDisburseModalOpen(false);
      if (disburseMonth === selectedPayrollMonth) loadPayroll(selectedPayrollMonth);
    } catch (err) {
      // The key is kept: sending the same form again is a retry, not a second payout.
      setDisburseError(err instanceof Error ? err.message : t("rep2.salaryError"));
    } finally {
      setDisbursing(false);
    }
  }

  function openSmsToStudent(student: SmsTarget) {
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

  // Overview and retention render the server-computed monthly report.
  function reportBody(view: "overview" | "retention") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <MonthPicker value={reportMonth} onChange={setReportMonth} style={{ width: 200 }} />
          {reportLoading && <span style={{ fontSize: 12, color: "#8A8D96" }}>{t("common.loading")}</span>}
        </div>
        {reportError ? (
          <div style={{ background: "#FEE2E2", color: "#B91C1C", fontWeight: 600, fontSize: 13, padding: "12px 16px", borderRadius: 12 }}>{reportError}</div>
        ) : report ? (
          <ReportsOverviewView report={report} view={view} onSms={openSmsToStudent} />
        ) : null}
      </div>
    );
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
            {t("rep3.subtitle")}
          </p>
        </div>

        {/* Tab switchers */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 9, padding: 3, gap: 2, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setActiveTab("director")}
              style={{
                border: "none",
                background: activeTab === "director" ? "#fff" : "transparent",
                color: activeTab === "director" ? "#181A1F" : "#8A8D96",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
                boxShadow: activeTab === "director" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              👔 {t("dir.tab")}
            </button>
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
              📊 {t("rep3.tabOverview")}
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
              💼 {t("rep3.tabPayroll")}
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
              🛡️ {t("rep3.tabRetention")} ({report?.atRisk.length ?? 0})
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
        {activeTab === "director" && <DirectorReport month={reportMonth} onMonth={setReportMonth} onSms={openSmsToStudent} />}
        {activeTab === "overview" && reportBody("overview")}

        {/* ========================================================================= */}
        {/* TAB 2: TEACHER PAYROLL ENGINE (Spec §25)                                   */}
        {/* ========================================================================= */}
        {activeTab === "payroll" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                  {t("rep3.payrollTitle")}
                </h2>
                <p style={{ fontSize: 12, color: "#8A8D96", margin: "2px 0 0" }}>
                  {t("rep3.payrollHint")}
                </p>
              </div>
              <div style={{ width: 220 }}>
                <MonthPicker value={selectedPayrollMonth} onChange={setSelectedPayrollMonth} />
              </div>
            </div>

            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <StatCard label={t("rep3.totalCalculated")} value={`${formatMoney(payrollData?.totalCalculated || 0)} ${t("common.sumUnit")}`} />
              <StatCard label={t("rep2.paidSalary")} value={`${formatMoney(payrollData?.totalPaid || 0)} ${t("common.sumUnit")}`} delta={payrollData?.totalPaid ? t("rep2.paidDelta") : undefined} />
              <StatCard label={t("rep3.pendingTotal")} value={`${formatMoney(payrollData?.totalPending || 0)} ${t("common.sumUnit")}`} danger={(payrollData?.totalPending || 0) > 0} />
              <StatCard label={t("rep2.activeTeachers")} value={String(payrollData?.teacherCount || 0)} />
            </div>

            {/* Payroll Table */}
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #EAE8E2", fontSize: 14, fontWeight: 700 }}>
                {t("rep3.sheetTitle").replace("{m}", selectedPayrollMonth)}
              </div>
              {payrollError ? (
                <div style={{ padding: 16 }}>
                  <LoadError message={payrollError} onRetry={() => loadPayroll(selectedPayrollMonth)} />
                </div>
              ) : loadingPayroll ? (
                <div style={{ padding: 32, textAlign: "center", color: "#8A8D96" }}>{t("rep3.calculating")}</div>
              ) : !payrollData || payrollData.teachers.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "#8A8D96" }}>{t("rep2.noTeachers")}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th style={{ paddingTop: 16 }}>{t("rep3.colTeacher")}</th>
                      <th style={{ paddingTop: 16 }}>{t("rep3.colModel")}</th>
                      <th style={{ paddingTop: 16 }}>{t("rep3.colDetail")}</th>
                      <th style={{ paddingTop: 16 }}>{t("rep2.calculated")}</th>
                      <th style={{ paddingTop: 16 }}>{t("rep3.colPaid")}</th>
                      <th style={{ paddingTop: 16 }}>{t("rep2.toPay")}</th>
                      <th style={{ paddingTop: 16 }}>{t("rep3.colStatus")}</th>
                      <th style={{ paddingTop: 16, textAlign: "right" }}>{t("rep3.colAction")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollData.teachers.map((item) => (
                      <tr key={item.teacherId}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{item.teacherName}</div>
                          <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{item.subject || t("rep2.noSubject")} • {item.phone || "—"}</div>
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
                            {salaryTypeLabel(item.salaryType)}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: "#4A4E58" }}>
                          {item.salaryType === "FIXED" && t("rep3.detailFixed").replace("{x}", `${formatMoney(item.salaryValue)} ${t("common.sumUnit")}`)}
                          {item.salaryType === "PER_LESSON" && t("rep3.detailPerLesson").replace("{n}", String(item.details.lessonCount || 0)).replace("{x}", `${formatMoney(item.salaryValue)} ${t("common.sumUnit")}`)}
                          {item.salaryType === "PERCENTAGE" && t("rep3.detailPercent").replace("{x}", formatMoney(item.details.groupRevenue || 0)).replace("{p}", String(item.salaryValue))}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {formatMoney(item.calculatedSalary)} {t("common.sumUnit")}
                          {(item.details.absentLessons ?? 0) > 0 && (
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#B23A47" }}>
                              −{formatMoney(item.details.deduction ?? 0)} · {item.details.absentLessons}/{item.details.plannedLessons} {t("tatt.missed")}
                            </div>
                          )}
                          {(item.details.substitutedLessons ?? 0) > 0 && (
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#1FA463" }}>+{item.details.substitutedLessons} {t("tatt.covered")}</div>
                          )}
                        </td>
                        <td style={{ fontWeight: 600, color: item.paidAmount > 0 ? "#10B981" : "#8A8D96" }}>
                          {formatMoney(item.paidAmount)} {t("common.sumUnit")}
                          {item.installments > 1 && (
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#8A8D96" }}>
                              {t("rep2.installments").replace("{n}", String(item.installments))}
                            </div>
                          )}
                        </td>
                        <td style={{ fontWeight: 800, color: item.netPayable > 0 ? "#DC2626" : "#10B981" }}>
                          {formatMoney(item.netPayable)} {t("common.sumUnit")}
                        </td>
                        <td>
                          {item.calculatedSalary <= 0 && !item.isPaid ? (
                            <span style={{ color: "#8A8D96" }}>—</span>
                          ) : item.isPaid ? (
                            <span className="badge badge-success">✓ {t("rep3.statusPaid")}</span>
                          ) : item.paidAmount > 0 ? (
                            <span className="badge badge-warning">{t("rep2.partPaid")}</span>
                          ) : (
                            <span className="badge badge-danger">{t("rep3.statusPending")}</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {/* Only when something is actually owed. */}
                          {item.netPayable > 0 && <button
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
                            {item.paidAmount > 0 ? t("rep2.payRest") : t("rep2.pay")}
                          </button>}
                          {item.netPayable <= 0 && item.installments > 0 && (
                            <button
                              type="button"
                              onClick={() => openDisburseModal(item)}
                              style={{ background: "#F2F1EC", color: "#181A1F", border: "none", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              {t("rep2.payouts")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <PayrollReconciliationPanel month={selectedPayrollMonth} onChanged={() => loadPayroll(selectedPayrollMonth)} />
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: RETENTION & CHURN PREDICTION ENGINE (Spec §38)                     */}
        {/* ========================================================================= */}
        {activeTab === "retention" && reportBody("retention")}
      </div>

      {/* Disburse Salary Modal */}
      <Modal
        open={disburseModalOpen}
        onClose={() => setDisburseModalOpen(false)}
        title={t("rep2.disburseTitle")}
      >
        <form onSubmit={handleDisburseSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#F8F8F6", borderRadius: 10, padding: 12, border: "1px solid #EAE8E2" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#181A1F" }}>{disburseTeacher?.teacherName}</div>
            <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2 }}>
              {t("rep2.subject")}: {disburseTeacher?.subject || t("rep2.notSet")} • {t("rep3.colModel")}: {disburseTeacher ? salaryTypeLabel(disburseTeacher.salaryType) : ""}
            </div>
            <div style={{ fontSize: 12.5, color: "#4A4E58", marginTop: 6 }}>
              {disburseMonth} · {t("rep2.calculated")}: {formatMoney(disburseTeacher?.calculatedSalary || 0)} · {t("rep2.paidSalary")}: {formatMoney(disburseTeacher?.paidAmount || 0)}
            </div>
            <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, marginTop: 4 }}>
              {t("rep2.remaining")}: {formatMoney(disburseTeacher?.netPayable || 0)} {t("common.sumUnit")}
            </div>
            {monthPayouts && monthPayouts.length > 0 && (
              <div style={{ marginTop: 8, borderTop: "1px solid #EAE8E2", paddingTop: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A8D96", marginBottom: 4 }}>{t("rep2.earlierPayouts")}</div>
                {monthPayouts.map((p) => (
                  <div key={p.id} style={{ padding: "3px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: p.reversedAt ? "#8A8D96" : "#4A4E58" }}>
                      <span style={{ textDecoration: p.reversedAt ? "line-through" : undefined }}>
                        {p.paidAt.slice(0, 10)}{p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, textDecoration: p.reversedAt ? "line-through" : undefined }}>{formatMoney(p.amount)}</span>
                        {p.reversedAt ? (
                          <span className="badge badge-neutral" title={p.reversalReason ?? undefined}>{t("rep2.reversed")}</span>
                        ) : p.expenseId && reversingId !== p.id ? (
                          <button type="button" onClick={() => { setReversingId(p.id); setReverseReason(""); setDisburseError(null); }} style={{ background: "none", border: "none", color: "#B23A47", fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                            {t("rep2.reverse")}
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {reversingId === p.id && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <input
                          className="field-input"
                          autoFocus
                          aria-label={t("rep2.reverseReason")}
                          placeholder={t("rep2.reverseReason")}
                          value={reverseReason}
                          onChange={(e) => setReverseReason(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void confirmReverse(p.id, p.amount); } }}
                          maxLength={500}
                          style={{ flex: 1, fontSize: 12.5, padding: "6px 10px" }}
                        />
                        <button type="button" className="btn" disabled={reverseBusy} onClick={() => void confirmReverse(p.id, p.amount)} style={{ background: "#B23A47", color: "#fff", border: "none", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 8 }}>
                          {reverseBusy ? t("common.saving") : t("rep2.reverseConfirm")}
                        </button>
                        <button type="button" className="btn" disabled={reverseBusy} onClick={() => setReversingId(null)} style={{ background: "#fff", color: "#181A1F", border: "1px solid #EAE8E2", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 8 }}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {disburseError && (
            <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{disburseError}</div>
          )}

          {(disburseTeacher?.netPayable ?? 0) <= 0 ? (
            <div style={{ fontSize: 13, color: "#1FA463", fontWeight: 700 }}>{t("rep2.monthPaid")}</div>
          ) : (
          <>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("rep3.amountLabel")}</div>
            <input
              type="number"
              className="field-input"
              value={disburseAmount}
              onChange={(e) => setDisburseAmount(e.target.value)}
              min={1}
              max={disburseTeacher?.netPayable || undefined}
              step={1}
              required
            />
            <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 4 }}>{t("rep2.installmentHint")}</div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("rep3.methodLabel")}</div>
            <Select
              options={[
                { value: "CASH", label: t("rep3.methodCash") },
                { value: "BANK_TRANSFER", label: t("rep2.bankTransfer") },
                { value: "CLICK", label: t("rep3.methodClick") },
                { value: "PAYME", label: t("rep3.methodPayme") },
              ]}
              value={disburseMethod}
              onChange={(v) => setDisburseMethod(v as "CASH" | "CLICK" | "PAYME" | "BANK_TRANSFER")}
            />
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("rep3.note")}</div>
            <input
              className="field-input"
              value={disburseNotes}
              onChange={(e) => setDisburseNotes(e.target.value)}
              placeholder={t("rep2.notePh")}
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
            {disbursing ? t("common.saving") : t("rep2.confirmSalary")}
          </button>
          </>
          )}
        </form>
      </Modal>

      {/* SMS Modal to Student */}
      <Modal
        open={smsModalOpen}
        onClose={() => setSmsModalOpen(false)}
        title={t("rep2.smsTitle")}
      >
        <form onSubmit={handleSendSmsToStudent} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#F8F8F6", borderRadius: 10, padding: 12, border: "1px solid #EAE8E2" }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{smsStudent?.fullName}</div>
            <div style={{ fontSize: 12.5, color: ACCENT, fontWeight: 600, marginTop: 2 }}>📞 {smsStudent?.phone}</div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("rep3.smsText")}</div>
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
            {sendingSms ? t("pay.sending") : t("rep2.sendSms")}
          </button>
        </form>
      </Modal>
    </>
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
      <Suspense fallback={null}>
        <ReportsContent />
      </Suspense>
    </DashboardShell>
  );
}
