"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import MonthPicker from "@/components/MonthPicker";
import LoadError from "@/components/LoadError";
import PayrollReconciliationPanel from "@/components/reports/PayrollReconciliation";
import { ApiError, salaryApi, retryKey, PayrollCalculationResponse, SalaryPayment, TeacherPayrollItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

/**
 * Teachers' pay for a month (Payments -> Payroll): what each earned, what was
 * paid out (in installments, one expense each), and the payout form.
 */
export default function PayrollPanel({ initialMonth }: { initialMonth: string }) {
  const { t } = useLanguage();
  const salaryTypeLabel = (type: string | null | undefined) =>
    type === "PERCENTAGE" ? t("rep3.typePercent") : type === "PER_LESSON" ? t("rep3.typePerLesson") : t("rep3.typeFixed");
  // Payroll states (Spec §25)
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(initialMonth);
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

  useEffect(() => {
    loadPayroll(selectedPayrollMonth);
  }, [selectedPayrollMonth, loadPayroll]);

  return (
    <>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0, maxWidth: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                  {t("rep3.payrollTitle")}
                </h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "2px 0 0" }}>
                  {t("rep3.payrollHint")}
                </p>
              </div>
              <div style={{ width: 220 }}>
                <MonthPicker value={selectedPayrollMonth} onChange={setSelectedPayrollMonth} />
              </div>
            </div>

            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 16 }}>
              <StatCard label={t("rep3.totalCalculated")} value={`${formatMoney(payrollData?.totalCalculated || 0)} ${t("common.sumUnit")}`} />
              <StatCard label={t("rep2.paidSalary")} value={`${formatMoney(payrollData?.totalPaid || 0)} ${t("common.sumUnit")}`} delta={payrollData?.totalPaid ? t("rep2.paidDelta") : undefined} />
              <StatCard label={t("rep3.pendingTotal")} value={`${formatMoney(payrollData?.totalPending || 0)} ${t("common.sumUnit")}`} danger={(payrollData?.totalPending || 0) > 0} />
              <StatCard label={t("rep2.activeTeachers")} value={String(payrollData?.teacherCount || 0)} />
            </div>

            {/* Payroll Table */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflowX: "auto", minWidth: 0 }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700 }}>
                {t("rep3.sheetTitle").replace("{m}", selectedPayrollMonth)}
              </div>
              {payrollError ? (
                <div style={{ padding: 16 }}>
                  <LoadError message={payrollError} onRetry={() => loadPayroll(selectedPayrollMonth)} />
                </div>
              ) : loadingPayroll ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>{t("rep3.calculating")}</div>
              ) : !payrollData || payrollData.teachers.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>{t("rep2.noTeachers")}</div>
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
                          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{item.subject || t("rep2.noSubject")} • {item.phone || "—"}</div>
                        </td>
                        <td>
                          <span
                            style={{
                              background: item.salaryType === "PERCENTAGE" ? "var(--warning-soft)" : item.salaryType === "PER_LESSON" ? "var(--info-soft)" : "var(--surface-muted)",
                              color: item.salaryType === "PERCENTAGE" ? "var(--warning)" : item.salaryType === "PER_LESSON" ? "var(--info)" : "var(--text-soft)",
                              padding: "3px 8px",
                              borderRadius: "var(--radius-xs)",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {salaryTypeLabel(item.salaryType)}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: "var(--text-soft)" }}>
                          {item.salaryType === "FIXED" && t("rep3.detailFixed").replace("{x}", `${formatMoney(item.salaryValue)} ${t("common.sumUnit")}`)}
                          {item.salaryType === "PER_LESSON" && t("rep3.detailPerLesson").replace("{n}", String(item.details.lessonCount || 0)).replace("{x}", `${formatMoney(item.salaryValue)} ${t("common.sumUnit")}`)}
                          {item.salaryType === "PERCENTAGE" && t("rep3.detailPercent").replace("{x}", formatMoney(item.details.groupRevenue || 0)).replace("{p}", String(item.salaryValue))}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {formatMoney(item.calculatedSalary)} {t("common.sumUnit")}
                          {(item.details.absentLessons ?? 0) > 0 && (
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--danger)" }}>
                              −{formatMoney(item.details.deduction ?? 0)} · {item.details.absentLessons}/{item.details.plannedLessons} {t("tatt.missed")}
                            </div>
                          )}
                          {(item.details.substitutedLessons ?? 0) > 0 && (
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--success)" }}>+{item.details.substitutedLessons} {t("tatt.covered")}</div>
                          )}
                        </td>
                        <td style={{ fontWeight: 600, color: item.paidAmount > 0 ? "var(--success)" : "var(--text-muted)" }}>
                          {formatMoney(item.paidAmount)} {t("common.sumUnit")}
                          {item.installments > 1 && (
                            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>
                              {t("rep2.installments").replace("{n}", String(item.installments))}
                            </div>
                          )}
                        </td>
                        <td style={{ fontWeight: 800, color: item.netPayable > 0 ? "var(--danger)" : "var(--success)" }}>
                          {formatMoney(item.netPayable)} {t("common.sumUnit")}
                        </td>
                        <td>
                          {item.calculatedSalary <= 0 && !item.isPaid ? (
                            <span style={{ color: "var(--text-muted)" }}>—</span>
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
                              background: item.netPayable > 0 ? ACCENT : "var(--surface-muted)",
                              color: item.netPayable > 0 ? "var(--on-ink)" : "var(--text)",
                              border: "none",
                              padding: "6px 12px",
                              borderRadius: "var(--radius-xs)",
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
                              style={{ background: "var(--surface-muted)", color: "var(--text)", border: "none", padding: "6px 12px", borderRadius: "var(--radius-xs)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
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
      {/* Disburse Salary Modal */}
      <Modal
        open={disburseModalOpen}
        onClose={() => setDisburseModalOpen(false)}
        title={t("rep2.disburseTitle")}
      >
        <form onSubmit={handleDisburseSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: 12, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{disburseTeacher?.teacherName}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {t("rep2.subject")}: {disburseTeacher?.subject || t("rep2.notSet")} • {t("rep3.colModel")}: {disburseTeacher ? salaryTypeLabel(disburseTeacher.salaryType) : ""}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-soft)", marginTop: 6 }}>
              {disburseMonth} · {t("rep2.calculated")}: {formatMoney(disburseTeacher?.calculatedSalary || 0)} · {t("rep2.paidSalary")}: {formatMoney(disburseTeacher?.paidAmount || 0)}
            </div>
            <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, marginTop: 4 }}>
              {t("rep2.remaining")}: {formatMoney(disburseTeacher?.netPayable || 0)} {t("common.sumUnit")}
            </div>
            {monthPayouts && monthPayouts.length > 0 && (
              <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>{t("rep2.earlierPayouts")}</div>
                {monthPayouts.map((p) => (
                  <div key={p.id} style={{ padding: "3px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: p.reversedAt ? "var(--text-muted)" : "var(--text-soft)" }}>
                      <span style={{ textDecoration: p.reversedAt ? "line-through" : undefined }}>
                        {p.paidAt.slice(0, 10)}{p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700, textDecoration: p.reversedAt ? "line-through" : undefined }}>{formatMoney(p.amount)}</span>
                        {p.reversedAt ? (
                          <span className="badge badge-neutral" title={p.reversalReason ?? undefined}>{t("rep2.reversed")}</span>
                        ) : p.expenseId && reversingId !== p.id ? (
                          <button type="button" onClick={() => { setReversingId(p.id); setReverseReason(""); setDisburseError(null); }} style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
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
                        <button type="button" className="btn" disabled={reverseBusy} onClick={() => void confirmReverse(p.id, p.amount)} style={{ background: "var(--danger)", color: "var(--on-ink)", border: "none", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: "var(--radius-xs)" }}>
                          {reverseBusy ? t("common.saving") : t("rep2.reverseConfirm")}
                        </button>
                        <button type="button" className="btn" disabled={reverseBusy} onClick={() => setReversingId(null)} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: "var(--radius-xs)" }}>
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
            <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{disburseError}</div>
          )}

          {(disburseTeacher?.netPayable ?? 0) <= 0 ? (
            <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 700 }}>{t("rep2.monthPaid")}</div>
          ) : (
          <>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>{t("rep3.amountLabel")}</div>
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
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>{t("rep2.installmentHint")}</div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>{t("rep3.methodLabel")}</div>
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
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>{t("rep3.note")}</div>
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
              color: "var(--on-ink)",
              fontSize: 14,
              fontWeight: 700,
              padding: 12,
              borderRadius: "var(--radius-sm)",
              marginTop: 4,
            }}
          >
            {disbursing ? t("common.saving") : t("rep2.confirmSalary")}
          </button>
          </>
          )}
        </form>
      </Modal>
    </>
  );
}

function StatCard({ label, value, delta, danger }: { label: string; value: string; delta?: string; danger?: boolean }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-display)", marginTop: 4, color: danger ? "var(--danger)" : "var(--text)" }}>{value}</div>
      {delta && <div style={{ fontSize: 11.5, color: danger ? "var(--danger)" : delta.startsWith("↑") ? "var(--success)" : "var(--text-muted)", marginTop: 4, fontWeight: 600 }}>{delta}</div>}
    </div>
  );
}
