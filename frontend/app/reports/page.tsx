"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import MonthPicker from "@/components/MonthPicker";
import {
  ApiError,
  exportApi,
  reportsApi,
  salaryApi,
  notificationsApi,
  PayrollCalculationResponse,
  TeacherPayrollItem,
  type ReportsOverview as ReportsOverviewData,
} from "@/lib/api";
import ReportsOverviewView from "@/components/reports/ReportsOverview";
import { localMonthStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

type ReportsTab = "overview" | "payroll" | "retention";
type SmsTarget = { id: string; fullName: string; phone: string | null };

function ReportsContent() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<ReportsTab>("overview");

  // Server-computed monthly report (replaces downloading every student,
  // payment and attendance row and aggregating in the browser).
  const [reportMonth, setReportMonth] = useState(localMonthStr());
  const [report, setReport] = useState<ReportsOverviewData | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);

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
              🛡️ Saqlash & Churn ({report?.atRisk.length ?? 0})
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
        {activeTab === "overview" && reportBody("overview")}

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
        {activeTab === "retention" && reportBody("retention")}
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
