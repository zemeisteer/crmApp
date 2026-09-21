"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import MonthPicker from "@/components/MonthPicker";
import { paymentsApi, studentsApi, exportApi, Payment, Student, ApiError } from "@/lib/api";
import { localMonthStr, localDateStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  PAID: "payment.statusPaid",
  PENDING: "payment.statusPending",
  FAILED: "payment.statusFailed",
};

const METHOD_LABEL_KEYS: Record<string, TranslationKey> = {
  CASH: "payment.methodCash",
  CLICK: "payment.methodClick",
  PAYME: "payment.methodPayme",
  BANK_TRANSFER: "payment.methodBankTransfer",
};

const STATUS_CLASS: Record<string, string> = {
  PAID: "badge-success",
  PENDING: "badge-neutral",
  FAILED: "badge-danger",
};

type Period = "day" | "week" | "month" | "year";

function localDayStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function StudentPicker({ students, value, onSelect }: { students: Student[]; value: string; onSelect: (id: string) => void }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = students.find((s) => s.id === value);

  const matches = query.trim()
    ? students.filter((s) => s.fullName.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : students.slice(0, 8);

  return (
    <div style={{ position: "relative" }}>
      <input
        className="field-input"
        required
        value={open ? query : selected?.fullName || query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onSelect("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t("payments.picker.searchPlaceholder")}
      />
      {selected && !open && (
        <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 6 }}>
          {t("payments.picker.groups")}: {selected.enrollments?.map((e) => `${e.group.name} (${e.group.subject})`).join(", ") || "—"}
        </div>
      )}
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 10, boxShadow: "0 8px 24px rgba(18,19,26,0.12)", zIndex: 20, maxHeight: 220, overflow: "auto" }}>
          {matches.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12.5, color: "#8A8D96" }}>{t("payments.picker.notFound")}</div>
          ) : (
            matches.map((s) => (
              <button
                type="button"
                key={s.id}
                onMouseDown={() => {
                  onSelect(s.id);
                  setQuery("");
                  setOpen(false);
                }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.fullName}</div>
                <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{s.enrollments?.map((e) => e.group.name).join(", ") || t("payments.picker.noGroup")}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PaymentsContent() {
  const { t, lang } = useLanguage();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [period, setPeriod] = useState<Period>("month");
  const [page, setPage] = useState(1);

  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [forMonth, setForMonth] = useState(() => localMonthStr());
  const [paidDate, setPaidDate] = useState(() => localDateStr());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");

  function load() {
    setLoading(true);
    Promise.all([paymentsApi.list(), studentsApi.list()])
      .then(([p, s]) => {
        setPayments(p);
        setStudents(s);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function studentName(id: string) {
    return students.find((s) => s.id === id)?.fullName || id;
  }

  function groupNames(studentIdVal: string) {
    const student = students.find((s) => s.id === studentIdVal);
    return student?.enrollments?.map((e) => e.group.name).join(", ") || "—";
  }

  function resetForm() {
    setStudentId("");
    setAmount("");
    setDiscount("");
    setMethod("CASH");
    setForMonth(localMonthStr());
    setPaidDate(localDateStr());
    setError(null);
  }

  const currentMonth = localMonthStr();
  const monthPaid = payments.filter((p) => p.forMonth === currentMonth && p.status === "PAID").reduce((sum, p) => sum + p.amount, 0);
  const pendingAmount = payments.filter((p) => p.status === "PENDING").reduce((sum, p) => sum + p.amount, 0);
  const failedCount = payments.filter((p) => p.status === "FAILED").length;

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (methodFilter && p.method !== methodFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!studentName(p.studentId).toLowerCase().includes(q) && !p.forMonth.includes(q)) return false;
      }
      return true;
    });
  }, [payments, search, statusFilter, methodFilter, students]);

  useEffect(() => setPage(1), [search, statusFilter, methodFilter]);
  const pageItems = usePagedSlice(filtered, page);

  const chartData = useMemo(() => {
    const paid = payments.filter((p) => p.status === "PAID");
    if (period === "day") {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return localDayStr(d);
      });
      return days.map((d) => ({
        label: d.slice(5),
        value: paid.filter((p) => p.paidAt && localDayStr(new Date(p.paidAt)) === d).reduce((s, p) => s + p.amount, 0),
      }));
    }
    if (period === "week") {
      const now = new Date();
      return Array.from({ length: 6 }, (_, i) => {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - (5 - i) * 7 - now.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        const value = paid
          .filter((p) => p.paidAt && new Date(p.paidAt) >= weekStart && new Date(p.paidAt) < weekEnd)
          .reduce((s, p) => s + p.amount, 0);
        return { label: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`, value };
      });
    }
    if (period === "year") {
      const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - (3 - i));
      return years.map((y) => ({
        label: String(y),
        value: paid.filter((p) => p.forMonth.startsWith(String(y))).reduce((s, p) => s + p.amount, 0),
      }));
    }
    const months = Array.from({ length: 7 }, (_, i) => localMonthStr(new Date(new Date().getFullYear(), new Date().getMonth() - (6 - i), 1)));
    return months.map((m) => ({
      label: new Date(m + "-01").toLocaleDateString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { month: "short" }),
      value: paid.filter((p) => p.forMonth === m).reduce((s, p) => s + p.amount, 0),
    }));
  }, [payments, period, lang]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!studentId) {
      setError(t("payments.selectStudentError"));
      return;
    }
    setSaving(true);
    try {
      await paymentsApi.create({
        studentId,
        amount: Number(amount),
        discount: discount ? Number(discount) : undefined,
        method,
        status: "PAID",
        forMonth,
        paidAt: paidDate,
      });
      setModalOpen(false);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("payments.title")}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => exportApi.paymentsXlsx()}
            style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 9 }}
          >
            {t("payments.exportExcel")}
          </button>
          <button
            className="btn"
            onClick={() => setModalOpen(true)}
            disabled={students.length === 0}
            style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
          >
            {t("payments.newPayment")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("payments.statMonthRevenue")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(monthPaid)} {t("common.sumUnit")}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("payments.statPending")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(pendingAmount)} {t("common.sumUnit")}</div>
          </div>
          <div style={{ background: failedCount > 0 ? "#FDEBEC" : "#fff", border: `1px solid ${failedCount > 0 ? "#F6D2D6" : "#EAE8E2"}`, borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: failedCount > 0 ? "#B23A47" : "#8A8D96" }}>{t("payments.statOverdue")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: failedCount > 0 ? "#B23A47" : "#181A1F" }}>
              {failedCount} {t("payments.countUnit")}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : payments.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {students.length === 0 ? t("payments.addStudentFirst") : t("payments.noPaymentsYet")}
          </div>
        ) : (
          <>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("payments.revenueDynamics")}</div>
                <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 9, padding: 3 }}>
                  {([["day", t("payments.periodDay")], ["week", t("payments.periodWeek")], ["month", t("payments.periodMonth")], ["year", t("payments.periodYear")]] as [Period, string][]).map(([p, l]) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      style={{
                        fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 7, cursor: "pointer", border: "none",
                        background: period === p ? "#fff" : "transparent",
                        color: period === p ? "#181A1F" : "#8A8D96",
                        boxShadow: period === p ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <RevenueBars data={chartData} />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                className="field-input"
                placeholder={t("payments.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ maxWidth: 260 }}
              />
              <Select
                options={[
                  { value: "", label: t("payments.allStatuses") },
                  { value: "PAID", label: t("payment.statusPaid") },
                  { value: "PENDING", label: t("payment.statusPending") },
                  { value: "FAILED", label: t("payment.statusFailed") },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 170 }}
              />
              <Select
                options={[
                  { value: "", label: t("payments.allMethods") },
                  { value: "CASH", label: t("payment.methodCash") },
                  { value: "CLICK", label: t("payment.methodClick") },
                  { value: "PAYME", label: t("payment.methodPayme") },
                  { value: "BANK_TRANSFER", label: t("payment.methodBankTransfer") },
                ]}
                value={methodFilter}
                onChange={setMethodFilter}
                style={{ width: 170 }}
              />
            </div>

            {filtered.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
                {t("payments.noSearchResults")}
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ paddingTop: 16 }}>{t("payments.colDate")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.colStudent")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.colGroup")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.colAmount")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.colMethod")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.colStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((p) => (
                      <tr key={p.id}>
                        <td>{p.paidAt ? new Date(p.paidAt).toLocaleDateString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { day: "numeric", month: "short" }) : "—"}</td>
                        <td style={{ fontWeight: 600 }}>{studentName(p.studentId)}</td>
                        <td>{groupNames(p.studentId)}</td>
                        <td style={{ fontWeight: 700 }}>
                          {formatMoney(p.amount)} {t("common.sumUnit")}
                          {p.discount > 0 && <span style={{ fontSize: 11, color: "#1FA463", fontWeight: 600 }}> (-{formatMoney(p.discount)})</span>}
                        </td>
                        <td>{p.method ? t(METHOD_LABEL_KEYS[p.method] || "payment.methodCash") : "—"}</td>
                        <td>
                          <span className={`badge ${STATUS_CLASS[p.status] || "badge-neutral"}`}>{STATUS_LABEL_KEYS[p.status] ? t(STATUS_LABEL_KEYS[p.status]) : p.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={page} total={filtered.length} onChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); resetForm(); }} title={t("payments.modalTitle")}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label={t("payments.fieldStudent")}>
            <StudentPicker students={students} value={studentId} onSelect={setStudentId} />
          </Field>
          <Field label={t("payments.fieldAmount")}>
            <input className="field-input" type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" />
          </Field>
          <Field label={t("payments.fieldDiscount")}>
            <input className="field-input" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
          </Field>
          <Field label={t("payments.fieldMethod")}>
            <Select
              options={[
                { value: "CASH", label: t("payment.methodCash") },
                { value: "CLICK", label: t("payment.methodClick") },
                { value: "PAYME", label: t("payment.methodPayme") },
                { value: "BANK_TRANSFER", label: t("payment.methodBankTransfer") },
              ]}
              value={method}
              onChange={setMethod}
            />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("payments.fieldMonth")}>
              <MonthPicker value={forMonth} onChange={setForMonth} />
            </Field>
            <Field label={t("payments.fieldPaidDate")}>
              <DatePicker value={paidDate} onChange={setPaidDate} />
            </Field>
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("payments.adding") : t("payments.addPayment")}
          </button>
        </form>
      </Modal>
    </>
  );
}

function RevenueBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 180 }}>
      {data.map((d, i) => {
        const isLast = i === data.length - 1;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: "100%",
                maxWidth: 56,
                height: Math.max(4, (d.value / max) * 130),
                background: isLast ? ACCENT : "#DCEEE6",
                borderRadius: 8,
              }}
            />
            <div style={{ fontSize: 11.5, color: isLast ? "#181A1F" : "#8A8D96", fontWeight: isLast ? 700 : 600 }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <DashboardShell>
      <PaymentsContent />
    </DashboardShell>
  );
}
