"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import BarChart from "@/components/BarChart";
import DatePicker from "@/components/DatePicker";
import MonthPicker from "@/components/MonthPicker";
import {
  paymentsApi,
  studentsApi,
  branchesApi,
  expensesApi,
  exportApi,
  notificationsApi,
  billingApi,
  invoicesApi,
  Invoice,
  Payment,
  Student,
  Branch,
  Expense,
  ExpenseCategory,
  DebtorsResponse,
  DebtorItem,
  FinanceSummary,
  ApiError,
} from "@/lib/api";
import { localMonthStr, localDateStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import { MONTH_KEYS, MONTH_SHORT_KEYS, type TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

export function numberToUzbekWords(num: number): string {
  if (num === 0) return "nol so'm";
  const ones = ["", "bir", "ikki", "uch", "to'rt", "besh", "olti", "yetti", "sakkiz", "to'qqiz"];
  const tens = ["", "o'n", "yigirma", "o'ttiz", "qirq", "ellik", "oltmish", "yetmish", "sakson", "to'qson"];

  function chunkToWords(n: number): string {
    let str = "";
    const h = Math.floor(n / 100);
    const remainder = n % 100;
    const t = Math.floor(remainder / 10);
    const o = remainder % 10;

    if (h > 0) {
      str += (h === 1 ? "bir yuz" : `${ones[h]} yuz`) + " ";
    }
    if (t > 0) {
      str += tens[t] + " ";
    }
    if (o > 0) {
      str += ones[o] + " ";
    }
    return str.trim();
  }

  const chunks: string[] = [];
  const billions = Math.floor(num / 1_000_000_000);
  const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const units = num % 1_000;

  if (billions > 0) chunks.push(`${chunkToWords(billions)} milliard`);
  if (millions > 0) chunks.push(`${chunkToWords(millions)} million`);
  if (thousands > 0) chunks.push(`${chunkToWords(thousands)} ming`);
  if (units > 0) chunks.push(chunkToWords(units));

  const words = chunks.join(" ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) + " so'm" : "Nol so'm";
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

const EXPENSE_CATEGORIES: { value: ExpenseCategory; labelKey: TranslationKey; color: string }[] = [
  { value: "RENT", labelKey: "payments.expenses.catRent", color: "#6366F1" },
  { value: "UTILITIES", labelKey: "payments.expenses.catUtilities", color: "#0EA5E9" },
  { value: "SALARY", labelKey: "payments.expenses.catSalary", color: "#10B981" },
  { value: "MARKETING", labelKey: "payments.expenses.catMarketing", color: "#F59E0B" },
  { value: "SUPPLIES", labelKey: "payments.expenses.catSupplies", color: "#8B5CF6" },
  { value: "TAX", labelKey: "payments.expenses.catTax", color: "#EC4899" },
  { value: "OTHER", labelKey: "payments.expenses.catOther", color: "#64748B" },
];

type TabType = "history" | "debtors" | "invoices" | "expenses";
type Period = "day" | "week" | "month" | "year";

function localDayStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function StudentPicker({
  students,
  value,
  onSelect,
}: {
  students: Student[];
  value: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = students.find((s) => s.id === value);

  const matches = query.trim()
    ? students
        .filter((s) => s.fullName.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 8)
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
          {t("payments.picker.groups")}:{" "}
          {selected.enrollments?.map((e) => `${e.group.name} (${e.group.subject})`).join(", ") || "—"}
        </div>
      )}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #EAE8E2",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(18,19,26,0.12)",
            zIndex: 20,
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12.5, color: "#8A8D96" }}>
              {t("payments.picker.notFound")}
            </div>
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
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.fullName}</div>
                <div style={{ fontSize: 11.5, color: "#8A8D96" }}>
                  {s.enrollments?.map((e) => e.group.name).join(", ") || t("payments.picker.noGroup")}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PaymentReceiptModal({
  payment,
  onClose,
  tenantName,
  tenantAddress,
  tenantPhone,
  cashierName,
}: {
  payment: Payment | null;
  onClose: () => void;
  tenantName?: string;
  tenantAddress?: string | null;
  tenantPhone?: string | null;
  cashierName?: string;
}) {
  const { t, lang } = useLanguage();
  if (!payment) return null;

  const receiptNumber = `REC-${payment.id.slice(0, 8).toUpperCase()}`;
  const amountWords = numberToUzbekWords(payment.amount);
  const student = payment.student;
  const groupsList = student?.enrollments?.map((e) => e.group?.name).filter(Boolean).join(", ") || "—";
  const dateFormatted = payment.paidAt
    ? formatDate(payment.paidAt, lang, "long")
    : "—";

  function handlePrint() {
    window.print();
  }

  return (
    <Modal open={true} onClose={onClose} title={t("payments.receipt.title")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Printable Area */}
        <div
          id="printable-receipt"
          style={{
            background: "#FAFAF9",
            border: "1px dashed #CBD5E1",
            borderRadius: 12,
            padding: 24,
            fontFamily: "'Inter', sans-serif",
            color: "#1E293B",
          }}
        >
          {/* Header */}
          <div
            style={{
              textAlign: "center",
              borderBottom: "2px solid #E2E8F0",
              paddingBottom: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: ACCENT }}>
              {tenantName || t("pay.centerFallback")}
            </div>
            {(tenantAddress || tenantPhone) && (
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                {tenantAddress ? `${tenantAddress}` : ""}
                {tenantAddress && tenantPhone ? " | " : ""}
                {tenantPhone ? `Tel: ${tenantPhone}` : ""}
              </div>
            )}
            <div
              style={{
                display: "inline-block",
                background: "#EEF2FF",
                color: ACCENT,
                fontSize: 12,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 6,
                marginTop: 8,
              }}
            >
              {t("payments.receipt.number")}: {receiptNumber}
            </div>
          </div>

          {/* Details Table */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748B" }}>{t("payments.receipt.payer")}:</span>
              <span style={{ fontWeight: 700 }}>{student?.fullName || payment.studentId}</span>
            </div>
            {student?.phone && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748B" }}>{t("pay.phone")}</span>
                <span>{student.phone}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748B" }}>{t("payments.receipt.groups")}:</span>
              <span style={{ fontWeight: 600 }}>{groupsList}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748B" }}>{t("payments.receipt.forMonth")}:</span>
              <span style={{ fontWeight: 700 }}>{payment.forMonth}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748B" }}>{t("payments.receipt.date")}:</span>
              <span>{dateFormatted}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748B" }}>{t("payments.receipt.method")}:</span>
              <span style={{ fontWeight: 600 }}>
                {payment.method ? t(METHOD_LABEL_KEYS[payment.method] || "payment.methodCash") : "—"}
              </span>
            </div>

            <div
              style={{
                borderTop: "1px dashed #CBD5E1",
                paddingTop: 12,
                marginTop: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>{t("payments.receipt.amount")}:</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: "#10B981" }}>
                {formatMoney(payment.amount)} {t("common.sumUnit")}
              </span>
            </div>

            <div style={{ fontSize: 12, fontStyle: "italic", color: "#475569", marginTop: -2 }}>
              <span style={{ fontWeight: 600 }}>{t("payments.receipt.amountWords")}:</span> {amountWords}
            </div>

            {payment.discount > 0 && (
              <div style={{ fontSize: 12, color: "#10B981", fontWeight: 600 }}>
                Chegirma berildi: {formatMoney(payment.discount)} {t("common.sumUnit")}
              </div>
            )}
          </div>

          {/* Footer & Signature lines */}
          <div
            style={{
              borderTop: "1px solid #E2E8F0",
              marginTop: 20,
              paddingTop: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: "#64748B" }}>{t("payments.receipt.cashier")}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                {cashierName || "Administrator"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#64748B" }}>{t("payments.receipt.signature")}</div>
              <div
                style={{
                  width: 130,
                  borderBottom: "1px solid #94A3B8",
                  marginTop: 18,
                  marginBottom: 2,
                }}
              />
              <div style={{ fontSize: 10, color: "#94A3B8" }}>{t("pay.stampSign")}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              textAlign: "center",
              fontSize: 11,
              color: "#94A3B8",
            }}
          >
            {t("payments.receipt.thankYou")}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            style={{
              background: "#F1F5F9",
              color: "#475569",
              fontSize: 13.5,
              fontWeight: 600,
              padding: "10px 18px",
              borderRadius: 9,
            }}
          >
            {t("common.close")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handlePrint}
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 700,
              padding: "10px 20px",
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>🖨️</span>
            <span>{t("payments.receipt.print")}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentsContent() {
  const { t, lang } = useLanguage();
  const { tenant, user } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>("history");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null);

  // Forms
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [period, setPeriod] = useState<Period>("month");
  const [page, setPage] = useState(1);

  // Month selector for Debtors & Expenses
  const [selectedMonth, setSelectedMonth] = useState(() => localMonthStr());

  // Debtors data state
  const [debtorsData, setDebtorsData] = useState<DebtorsResponse | null>(null);
  const [debtorSearch, setDebtorSearch] = useState("");
  const [debtorStatusFilter, setDebtorStatusFilter] = useState<string>("ALL");

  // Invoices state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("ALL");
  const [generatingInvoices, setGeneratingInvoices] = useState(false);

  // Expenses & P&L state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null);
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>("");

  // Payment form state
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [forMonth, setForMonth] = useState(() => localMonthStr());
  const [paidDate, setPaidDate] = useState(() => localDateStr());

  // Expense form state
  const [expenseTitle, setExpenseTitle] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>("OTHER");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("CASH");
  const [expenseDate, setExpenseDate] = useState(() => localDateStr());
  const [expenseBranchId, setExpenseBranchId] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");

  // History filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [sendingReminders, setSendingReminders] = useState(false);

  async function handleSendReminders() {
    const debtorCount = debtorsData?.debtorCount || 0;
    if (debtorCount === 0) {
      alert(t("pay.noDebtors"));
      return;
    }
    if (!window.confirm(`${debtorCount} ta qarzdor o'quvchiga SMS va Telegram eslatma yuborilsinmi?`)) return;
    setSendingReminders(true);
    try {
      const res = await notificationsApi.sendDebtorReminders({ forMonth: selectedMonth });
      alert(`Muvaffaqiyatli: ${res.processedDebtors} ta qarzdorga xabarnoma yuborildi!`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSendingReminders(false);
    }
  }

  function loadAll() {
    setLoading(true);
    Promise.all([
      paymentsApi.list(),
      studentsApi.list(),
      branchesApi.list().catch(() => [] as Branch[]),
      paymentsApi.debtors({ forMonth: selectedMonth }),
      paymentsApi.financeSummary(selectedMonth),
      expensesApi.list({ forMonth: selectedMonth }),
      invoicesApi.list({ forMonth: selectedMonth }).catch(() => [] as Invoice[]),
    ])
      .then(([p, s, b, d, fs, exp, invs]) => {
        setPayments(p);
        setStudents(s);
        setBranches(b);
        setDebtorsData(d);
        setFinanceSummary(fs);
        setExpenses(exp);
        setInvoices(invs);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  function studentName(id: string) {
    return students.find((s) => s.id === id)?.fullName || id;
  }

  function groupNames(studentIdVal: string) {
    const student = students.find((s) => s.id === studentIdVal);
    return student?.enrollments?.map((e) => e.group.name).join(", ") || "—";
  }

  function resetPaymentForm() {
    setStudentId("");
    setAmount("");
    setDiscount("");
    setMethod("CASH");
    setForMonth(selectedMonth);
    setPaidDate(localDateStr());
    setError(null);
  }

  function resetExpenseForm() {
    setExpenseTitle("");
    setExpenseCategory("OTHER");
    setExpenseAmount("");
    setExpensePaymentMethod("CASH");
    setExpenseDate(localDateStr());
    setExpenseBranchId("");
    setExpenseNotes("");
    setError(null);
  }

  function handleOpenPayForDebtor(debtor: {
    studentId: string;
    debtAmount: number;
    expectedAmount: number;
  }) {
    setStudentId(debtor.studentId);
    setAmount(String(debtor.debtAmount || debtor.expectedAmount));
    setDiscount("");
    setMethod("CASH");
    setForMonth(selectedMonth);
    setPaidDate(localDateStr());
    setModalOpen(true);
  }

  // Online Payment Link Modal states
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkDebtor, setLinkDebtor] = useState<DebtorItem | null>(null);
  const [generatedLink, setGeneratedLink] = useState<{ provider: "CLICK" | "PAYME"; url: string } | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [sendingLinkSms, setSendingLinkSms] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  function openLinkModal(debtor: DebtorItem) {
    setLinkDebtor(debtor);
    setGeneratedLink(null);
    setCopySuccess(false);
    setLinkModalOpen(true);
  }

  async function handleGenerateLink(provider: "CLICK" | "PAYME") {
    if (!linkDebtor) return;
    setGeneratingLink(true);
    try {
      const fn = provider === "CLICK" ? billingApi.generateClickLink : billingApi.generatePaymeLink;
      const res = await fn({
        studentId: linkDebtor.studentId,
        amount: linkDebtor.debtAmount,
        forMonth: debtorsData?.forMonth || localMonthStr(new Date()),
      });
      setGeneratedLink({ provider, url: res.url });
    } catch (err) {
      alert(err instanceof Error ? err.message : t("pay.linkError"));
    } finally {
      setGeneratingLink(false);
    }
  }

  async function handleSendLinkViaSms() {
    if (!linkDebtor || !generatedLink || !linkDebtor.phone) return;
    setSendingLinkSms(true);
    try {
      const text = `Assalomu alaykum ${linkDebtor.studentName}! ${debtorsData?.forMonth || ""} oyi to'lovi (${formatMoney(linkDebtor.debtAmount)} so'm) uchun online to'lov havolasi: ${generatedLink.url}`;
      await notificationsApi.sendTest({
        recipient: linkDebtor.phone,
        channel: "SMS",
        content: text,
        title: t("pay.link"),
      });
      alert(t("pay.linkSmsSent"));
    } catch (err) {
      alert(err instanceof Error ? err.message : t("pay.smsError"));
    } finally {
      setSendingLinkSms(false);
    }
  }

  const currentMonth = localMonthStr();
  const monthPaid = payments
    .filter((p) => p.forMonth === currentMonth && p.status === "PAID")
    .reduce((sum, p) => sum + p.amount, 0);
  const pendingAmount = payments
    .filter((p) => p.status === "PENDING")
    .reduce((sum, p) => sum + p.amount, 0);
  const failedCount = payments.filter((p) => p.status === "FAILED").length;

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (methodFilter && p.method !== methodFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!studentName(p.studentId).toLowerCase().includes(q) && !p.forMonth.includes(q))
          return false;
      }
      return true;
    });
  }, [payments, search, statusFilter, methodFilter, students]);

  useEffect(() => setPage(1), [search, statusFilter, methodFilter, activeTab]);
  const pageItems = usePagedSlice(filteredPayments, page);

  // Filtered debtors
  const filteredDebtors = useMemo(() => {
    if (!debtorsData) return [];
    return debtorsData.debtors.filter((d) => {
      if (debtorStatusFilter !== "ALL" && d.status !== debtorStatusFilter) return false;
      if (debtorSearch) {
        const q = debtorSearch.toLowerCase();
        const matchesName = d.studentName.toLowerCase().includes(q);
        const matchesPhone = d.phone?.includes(q) || d.parentPhone?.includes(q);
        if (!matchesName && !matchesPhone) return false;
      }
      return true;
    });
  }, [debtorsData, debtorStatusFilter, debtorSearch]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (invoiceStatusFilter !== "ALL" && inv.status !== invoiceStatusFilter) return false;
      if (invoiceSearch) {
        const q = invoiceSearch.toLowerCase();
        const sName = studentName(inv.studentId).toLowerCase();
        if (!sName.includes(q) && !(inv.forMonth || "").includes(q)) return false;
      }
      return true;
    });
  }, [invoices, invoiceStatusFilter, invoiceSearch, students]);

  // Filtered expenses
  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (expenseCategoryFilter && e.category !== expenseCategoryFilter) return false;
      return true;
    });
  }, [expenses, expenseCategoryFilter]);

  const chartData = useMemo(() => {
    const paid = payments.filter((p) => p.status === "PAID");
    if (period === "day") {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return localDayStr(d);
      });
      return days.map((d) => ({
        label: String(Number(d.slice(8))),
        title: `${Number(d.slice(8))} ${t(MONTH_KEYS[Number(d.slice(5, 7)) - 1])}`,
        isCurrent: d === localDayStr(new Date()),
        value: paid
          .filter((p) => p.paidAt && localDayStr(new Date(p.paidAt)) === d)
          .reduce((s, p) => s + p.amount, 0),
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
    // January to December of the current year.
    const year = new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    return months.map((m, i) => ({
      label: t(MONTH_SHORT_KEYS[i]),
      title: t(MONTH_KEYS[i]),
      isCurrent: m === localMonthStr(),
      value: paid.filter((p) => p.forMonth === m).reduce((s, p) => s + p.amount, 0),
    }));
  }, [payments, period, t]);

  async function onPaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!studentId) {
      setError(t("payments.selectStudentError"));
      return;
    }
    setSaving(true);
    try {
      const created = await paymentsApi.create({
        studentId,
        amount: Number(amount),
        discount: discount ? Number(discount) : undefined,
        method,
        status: "PAID",
        forMonth,
        paidAt: paidDate,
      });
      setModalOpen(false);
      resetPaymentForm();
      loadAll();
      // Optionally open receipt voucher right after payment
      setReceiptPayment(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function onExpenseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!expenseTitle.trim()) {
      setError(t("pay.expenseNameRequired"));
      return;
    }
    if (!expenseAmount || Number(expenseAmount) <= 0) {
      setError(t("pay.amountInvalid"));
      return;
    }
    setSaving(true);
    try {
      await expensesApi.create({
        title: expenseTitle.trim(),
        category: expenseCategory,
        amount: Number(expenseAmount),
        paymentMethod: expensePaymentMethod,
        date: expenseDate,
        branchId: expenseBranchId || null,
        notes: expenseNotes.trim() || null,
      });
      setExpenseModalOpen(false);
      resetExpenseForm();
      loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteExpense(id: string) {
    if (!window.confirm(t("pay.confirmDeleteExpense"))) return;
    try {
      await expensesApi.delete(id);
      loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("pay.deleteError"));
    }
  }

  return (
    <>
      {/* Top Header */}
      <div
        style={{
          padding: "20px 32px",
          borderBottom: "1px solid #EAE8E2",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{t("payments.title")}</h1>

          {/* 3 Tabs */}
          <div
            style={{
              display: "flex",
              background: "#F2F1EC",
              borderRadius: 10,
              padding: 3,
            }}
          >
            <button
              onClick={() => setActiveTab("history")}
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: "7px 16px",
                borderRadius: 8,
                cursor: "pointer",
                border: "none",
                background: activeTab === "history" ? "#fff" : "transparent",
                color: activeTab === "history" ? "#181A1F" : "#71737C",
                boxShadow: activeTab === "history" ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              {t("payments.tabPayments")}
            </button>
            <button
              onClick={() => setActiveTab("debtors")}
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: "7px 16px",
                borderRadius: 8,
                cursor: "pointer",
                border: "none",
                background: activeTab === "debtors" ? "#fff" : "transparent",
                color: activeTab === "debtors" ? "#181A1F" : "#71737C",
                boxShadow: activeTab === "debtors" ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
            >
              <span>{t("payments.tabDebtors")}</span>
              {debtorsData && debtorsData.debtorCount > 0 && (
                <span
                  style={{
                    background: "#EF4444",
                    color: "#fff",
                    fontSize: 10.5,
                    fontWeight: 800,
                    padding: "1px 6px",
                    borderRadius: 999,
                  }}
                >
                  {debtorsData.debtorCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("invoices")}
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: "7px 16px",
                borderRadius: 8,
                cursor: "pointer",
                border: "none",
                background: activeTab === "invoices" ? "#fff" : "transparent",
                color: activeTab === "invoices" ? "#181A1F" : "#71737C",
                boxShadow: activeTab === "invoices" ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              {t("pay.tabInvoices")}
            </button>
            <button
              onClick={() => setActiveTab("expenses")}
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: "7px 16px",
                borderRadius: 8,
                cursor: "pointer",
                border: "none",
                background: activeTab === "expenses" ? "#fff" : "transparent",
                color: activeTab === "expenses" ? "#181A1F" : "#71737C",
                boxShadow: activeTab === "expenses" ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              {t("payments.tabExpenses")}
            </button>
          </div>
        </div>

        {/* Header Right Actions */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {(activeTab === "debtors" || activeTab === "expenses" || activeTab === "invoices") && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#8A8D96", fontWeight: 600 }}>{t("pay.month")}</span>
              <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
            </div>
          )}

          {activeTab === "invoices" && (
            <button
              className="btn"
              onClick={async () => {
                if (!confirm(`${selectedMonth} oyi uchun barcha o'quvchilarga hisob-fakturalar shakllantirilsinmi?`)) return;
                setGeneratingInvoices(true);
                try {
                  const res = await invoicesApi.generateMonthly(selectedMonth);
                  alert(`${res.generatedCount} ta hisob-faktura shakllantirildi!`);
                  loadAll();
                } catch (err) {
                  alert(err instanceof ApiError ? err.message : "Xatolik");
                } finally {
                  setGeneratingInvoices(false);
                }
              }}
              disabled={generatingInvoices}
              style={{
                background: ACCENT,
                color: "#fff",
                border: "none",
                fontSize: 13,
                fontWeight: 700,
                padding: "8px 16px",
                borderRadius: 9,
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <span>⚡</span>
              <span>{generatingInvoices ? t("pay.generating") : t("pay.monthlyInvoices")}</span>
            </button>
          )}

          {activeTab === "history" && (
            <>
              <button
                className="btn"
                onClick={() => exportApi.paymentsXlsx()}
                style={{
                  background: "#F2F1EC",
                  color: "#181A1F",
                  border: "none",
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "9px 16px",
                  borderRadius: 9,
                }}
              >
                {t("payments.exportExcel")}
              </button>
              <button
                className="btn"
                onClick={() => {
                  resetPaymentForm();
                  setModalOpen(true);
                }}
                disabled={students.length === 0}
                style={{
                  background: ACCENT,
                  color: "#fff",
                  border: "none",
                  fontSize: 13.5,
                  fontWeight: 700,
                  padding: "9px 18px",
                  borderRadius: 9,
                }}
              >
                {t("payments.newPayment")}
              </button>
            </>
          )}

          {activeTab === "expenses" && (
            <button
              className="btn"
              onClick={() => {
                resetExpenseForm();
                setExpenseModalOpen(true);
              }}
              style={{
                background: ACCENT,
                color: "#fff",
                border: "none",
                fontSize: 13.5,
                fontWeight: 700,
                padding: "9px 18px",
                borderRadius: 9,
              }}
            >
              {t("payments.expenses.newExpense")}
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: "24px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          overflow: "auto",
          boxSizing: "border-box",
        }}
      >
        {/* ========================================================================= */}
        {/* TAB 1: HISTORY                                                            */}
        {/* ========================================================================= */}
        {activeTab === "history" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }}>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("payments.statMonthRevenue")}</div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                  }}
                >
                  {formatMoney(monthPaid)} {t("common.sumUnit")}
                </div>
              </div>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("payments.statPending")}</div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                  }}
                >
                  {formatMoney(pendingAmount)} {t("common.sumUnit")}
                </div>
              </div>
              <div
                style={{
                  background: failedCount > 0 ? "#FDEBEC" : "#fff",
                  border: `1px solid ${failedCount > 0 ? "#F6D2D6" : "#EAE8E2"}`,
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: failedCount > 0 ? "#B23A47" : "#8A8D96" }}>
                  {t("payments.statOverdue")}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: failedCount > 0 ? "#B23A47" : "#181A1F",
                  }}
                >
                  {failedCount} {t("payments.countUnit")}
                </div>
              </div>
            </div>

            {loading ? (
              <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
            ) : payments.length === 0 ? (
              <div
                style={{
                  color: "#8A8D96",
                  fontSize: 14,
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 16,
                  padding: 32,
                  textAlign: "center",
                }}
              >
                {students.length === 0 ? t("payments.addStudentFirst") : t("payments.noPaymentsYet")}
              </div>
            ) : (
              <>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #EAE8E2",
                    borderRadius: 16,
                    padding: 20,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 18,
                      flexWrap: "wrap",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Manrope', sans-serif",
                        fontWeight: 700,
                        fontSize: 15,
                      }}
                    >
                      {t("payments.revenueDynamics")}
                    </div>
                    <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 9, padding: 3 }}>
                      {(
                        [
                          ["day", t("payments.periodDay")],
                          ["week", t("payments.periodWeek")],
                          ["month", t("payments.periodMonth")],
                          ["year", t("payments.periodYear")],
                        ] as [Period, string][]
                      ).map(([p, l]) => (
                        <button
                          key={p}
                          onClick={() => setPeriod(p)}
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "6px 12px",
                            borderRadius: 7,
                            cursor: "pointer",
                            border: "none",
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
                  <BarChart data={chartData} color={ACCENT} height={190} defaultActiveIdx={chartData.length - 1} formatValue={(v) => new Intl.NumberFormat("uz-UZ").format(v)} unit={t("common.sumUnit")} />
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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

                {filteredPayments.length === 0 ? (
                  <div
                    style={{
                      color: "#8A8D96",
                      fontSize: 14,
                      background: "#fff",
                      border: "1px solid #EAE8E2",
                      borderRadius: 16,
                      padding: 32,
                      textAlign: "center",
                    }}
                  >
                    {t("payments.noSearchResults")}
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #EAE8E2",
                      borderRadius: 16,
                      overflow: "hidden",
                    }}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th style={{ paddingTop: 16 }}>{t("payments.colDate")}</th>
                          <th style={{ paddingTop: 16 }}>{t("payments.colStudent")}</th>
                          <th style={{ paddingTop: 16 }}>{t("payments.colGroup")}</th>
                          <th style={{ paddingTop: 16 }}>{t("payments.colAmount")}</th>
                          <th style={{ paddingTop: 16 }}>{t("payments.colMethod")}</th>
                          <th style={{ paddingTop: 16 }}>{t("payments.colStatus")}</th>
                          <th style={{ paddingTop: 16, textAlign: "right" }}>{t("pay.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems.map((p) => (
                          <tr key={p.id}>
                            <td>
                              {p.paidAt
                                ? formatDate(p.paidAt, lang, "dayMonth")
                                : "—"}
                            </td>
                            <td style={{ fontWeight: 600 }}>{studentName(p.studentId)}</td>
                            <td>{groupNames(p.studentId)}</td>
                            <td style={{ fontWeight: 700 }}>
                              {formatMoney(p.amount)} {t("common.sumUnit")}
                              {p.discount > 0 && (
                                <span style={{ fontSize: 11, color: "#1FA463", fontWeight: 600 }}>
                                  {" "}
                                  (-{formatMoney(p.discount)})
                                </span>
                              )}
                            </td>
                            <td>
                              {p.method ? t(METHOD_LABEL_KEYS[p.method] || "payment.methodCash") : "—"}
                            </td>
                            <td>
                              <span className={`badge ${STATUS_CLASS[p.status] || "badge-neutral"}`}>
                                {STATUS_LABEL_KEYS[p.status]
                                  ? t(STATUS_LABEL_KEYS[p.status])
                                  : p.status}
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                type="button"
                                onClick={() => setReceiptPayment(p)}
                                style={{
                                  background: "#EEF2FF",
                                  color: ACCENT,
                                  border: "none",
                                  padding: "6px 12px",
                                  borderRadius: 7,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                🧾 {t("payments.receipt.title")}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Pagination page={page} total={filteredPayments.length} onChange={setPage} />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: DEBTORS (Master Spec Section 24)                                   */}
        {/* ========================================================================= */}
        {activeTab === "debtors" && (
          <>
            {/* Top Debtors Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>
                  {t("payments.debtors.totalExpected")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                  }}
                >
                  {formatMoney(debtorsData?.totalExpected || 0)} {t("common.sumUnit")}
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>
                  {t("payments.debtors.totalPaid")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: "#10B981",
                  }}
                >
                  {formatMoney(debtorsData?.totalPaid || 0)} {t("common.sumUnit")}
                </div>
              </div>

              <div
                style={{
                  background: (debtorsData?.totalDebt || 0) > 0 ? "#FEF2F2" : "#fff",
                  border: `1px solid ${(debtorsData?.totalDebt || 0) > 0 ? "#FCA5A5" : "#EAE8E2"}`,
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: (debtorsData?.totalDebt || 0) > 0 ? "#B91C1C" : "#8A8D96",
                  }}
                >
                  {t("payments.debtors.totalDebt")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: (debtorsData?.totalDebt || 0) > 0 ? "#DC2626" : "#181A1F",
                  }}
                >
                  {formatMoney(debtorsData?.totalDebt || 0)} {t("common.sumUnit")}
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>
                  {t("payments.debtors.debtorCount")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: (debtorsData?.debtorCount || 0) > 0 ? "#DC2626" : "#10B981",
                  }}
                >
                  {debtorsData?.debtorCount || 0} {t("payments.countUnit")}
                </div>
              </div>
            </div>

            {/* Filters */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="field-input"
                placeholder={t("pay.debtorSearch")}
                value={debtorSearch}
                onChange={(e) => setDebtorSearch(e.target.value)}
                style={{ maxWidth: 280 }}
              />
              <Select
                options={[
                  { value: "ALL", label: t("common.all") },
                  { value: "UNPAID", label: t("payments.debtors.statusUnpaid") },
                  { value: "PARTIAL", label: t("payments.debtors.statusPartial") },
                  { value: "PAID", label: t("payments.debtors.statusPaid") },
                ]}
                value={debtorStatusFilter}
                onChange={setDebtorStatusFilter}
                style={{ width: 190 }}
              />
              <button
                type="button"
                className="btn"
                disabled={sendingReminders || (debtorsData?.debtorCount || 0) === 0}
                onClick={handleSendReminders}
                style={{
                  marginLeft: "auto",
                  background: "#FEE2E2",
                  color: "#B91C1C",
                  border: "1px solid #FCA5A5",
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "8px 16px",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: (debtorsData?.debtorCount || 0) === 0 ? "not-allowed" : "pointer",
                }}
              >
                <span>📢</span>
                <span>{sendingReminders ? t("pay.sending") : t("pay.smsDebtors")}</span>
              </button>
            </div>

            {/* Debtors List Table */}
            {loading ? (
              <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
            ) : filteredDebtors.length === 0 ? (
              <div
                style={{
                  color: "#10B981",
                  fontSize: 14,
                  fontWeight: 600,
                  background: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  borderRadius: 16,
                  padding: 36,
                  textAlign: "center",
                }}
              >
                {t("payments.debtors.noDebtors")}
              </div>
            ) : (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                <table>
                  <thead>
                    <tr>
                      <th style={{ paddingTop: 16 }}>{t("pay.student")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.groups")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.debtors.expected")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.debtors.paid")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.debtors.debt")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.status")}</th>
                      <th style={{ paddingTop: 16, textAlign: "right" }}>{t("pay.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDebtors.map((d) => (
                      <tr key={d.studentId}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{d.studentName}</div>
                          {d.phone && (
                            <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{d.phone}</div>
                          )}
                        </td>
                        <td>
                          {d.groups.length === 0 ? (
                            <span style={{ color: "#8A8D96", fontSize: 12 }}>—</span>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                              {d.groups.map((g) => (
                                <span
                                  key={g.id}
                                  style={{
                                    background: "#F1F5F9",
                                    color: "#334155",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                  }}
                                >
                                  {g.name} ({formatMoney(g.monthlyPrice)})
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {formatMoney(d.expectedAmount)} {t("common.sumUnit")}
                        </td>
                        <td style={{ fontWeight: 600, color: d.paidAmount > 0 ? "#10B981" : "#8A8D96" }}>
                          {formatMoney(d.paidAmount)} {t("common.sumUnit")}
                        </td>
                        <td style={{ fontWeight: 800 }}>
                          {d.debtAmount > 0 ? (
                            <span style={{ color: "#DC2626" }}>
                              {formatMoney(d.debtAmount)} {t("common.sumUnit")}
                            </span>
                          ) : (
                            <span style={{ color: "#10B981" }}>0 {t("common.sumUnit")}</span>
                          )}
                        </td>
                        <td>
                          {d.status === "PAID" && (
                            <span className="badge badge-success">
                              {t("payments.debtors.statusPaid")}
                            </span>
                          )}
                          {d.status === "PARTIAL" && (
                            <span
                              style={{
                                background: "#FEF3C7",
                                color: "#B45309",
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "3px 8px",
                                borderRadius: 6,
                              }}
                            >
                              {t("payments.debtors.statusPartial")}
                            </span>
                          )}
                          {d.status === "UNPAID" && (
                            <span className="badge badge-danger">
                              {t("payments.debtors.statusUnpaid")}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {d.debtAmount > 0 && (
                            <div style={{ display: "inline-flex", gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => openLinkModal(d)}
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
                                title={t("pay.getLinkTitle")}
                              >
                                🔗 Havola
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenPayForDebtor(d)}
                                style={{
                                  background: "#10B981",
                                  color: "#fff",
                                  border: "none",
                                  padding: "6px 12px",
                                  borderRadius: 7,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                + {t("payments.debtors.payAction")}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: INVOICES (Billing & Tuition Ledger)                                */}
        {/* ========================================================================= */}
        {activeTab === "invoices" && (
          <>
            {/* Top Invoices Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("pay.invTotal")}</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
                  {formatMoney(invoices.reduce((s, inv) => s + inv.amount, 0))} {t("common.sumUnit")}
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("pay.invPaid")}</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#10B981" }}>
                  {formatMoney(invoices.reduce((s, inv) => s + inv.amountPaid, 0))} {t("common.sumUnit")}
                </div>
              </div>
              <div style={{ background: invoices.some((i) => i.remainingAmount > 0) ? "#FEF2F2" : "#fff", border: `1px solid ${invoices.some((i) => i.remainingAmount > 0) ? "#FCA5A5" : "#EAE8E2"}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: invoices.some((i) => i.remainingAmount > 0) ? "#B91C1C" : "#8A8D96" }}>{t("pay.invRemaining")}</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#DC2626" }}>
                  {formatMoney(invoices.reduce((s, inv) => s + (inv.status !== "CANCELLED" ? inv.remainingAmount : 0), 0))} {t("common.sumUnit")}
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("pay.invOverdue")}</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#F59E0B" }}>
                  {invoices.filter((i) => i.status === "OVERDUE").length} ta
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 20, marginBottom: 16 }}>
              <input
                type="text"
                placeholder={t("pay.invSearch")}
                className="field-input"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                style={{ maxWidth: 300 }}
              />
              <Select
                options={[
                  { value: "ALL", label: t("pay.allStatuses") },
                  { value: "OPEN", label: t("pay.stPending") },
                  { value: "PARTIALLY_PAID", label: t("pay.stPartial") },
                  { value: "PAID", label: t("pay.stPaid") },
                  { value: "OVERDUE", label: t("pay.stOverdue") },
                  { value: "CANCELLED", label: t("pay.stCancelled") },
                ]}
                value={invoiceStatusFilter}
                onChange={setInvoiceStatusFilter}
                style={{ width: 190 }}
              />
            </div>

            {/* Invoices Table */}
            {filteredInvoices.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
                {t("pay.noInvoices")}
              </div>
            ) : (
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ paddingTop: 16 }}>{t("pay.student")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.groupDesc")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.monthCol")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.totalAmount")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.paid")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.remaining")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.due")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.status")}</th>
                      <th style={{ paddingTop: 16, textAlign: "right" }}>{t("pay.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 700 }}>{studentName(inv.studentId)}</td>
                        <td>{inv.enrollment?.group?.name || inv.description || "—"}</td>
                        <td>{inv.forMonth}</td>
                        <td style={{ fontWeight: 700 }}>{formatMoney(inv.amount)} {t("common.sumUnit")}</td>
                        <td style={{ fontWeight: 600, color: inv.amountPaid > 0 ? "#10B981" : "#8A8D96" }}>
                          {formatMoney(inv.amountPaid)} {t("common.sumUnit")}
                        </td>
                        <td style={{ fontWeight: 800, color: inv.remainingAmount > 0 ? "#DC2626" : "#8A8D96" }}>
                          {formatMoney(inv.remainingAmount)} {t("common.sumUnit")}
                        </td>
                        <td>{formatDate(inv.dueDate, lang, "dayMonth")}</td>
                        <td>
                          <span className={`badge ${inv.status === "PAID" ? "badge-success" : inv.status === "OVERDUE" ? "badge-danger" : inv.status === "PARTIALLY_PAID" ? "badge-warning" : "badge-neutral"}`}>
                            {inv.status === "PAID" ? t("pay.stPaid") : inv.status === "PARTIALLY_PAID" ? t("pay.stPartial") : inv.status === "OVERDUE" ? t("pay.stOverdue") : inv.status === "CANCELLED" ? t("pay.stCancelled") : t("pay.stOpen")}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {inv.status !== "PAID" && inv.status !== "CANCELLED" && (
                            <button
                              type="button"
                              onClick={() => {
                                setStudentId(inv.studentId);
                                setAmount(String(inv.remainingAmount));
                                setForMonth(inv.forMonth);
                                setModalOpen(true);
                              }}
                              style={{ background: "#10B981", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              {t("pay.pay")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: EXPENSES & CASH FLOW (P&L) (Master Spec Section 24)                 */}
        {/* ========================================================================= */}
        {activeTab === "expenses" && (
          <>
            {/* Finance P&L Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>
                  {t("payments.expenses.totalRevenue")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: "#10B981",
                  }}
                >
                  +{formatMoney(financeSummary?.totalRevenue || 0)} {t("common.sumUnit")}
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>
                  {t("payments.expenses.totalExpenses")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: "#EF4444",
                  }}
                >
                  -{formatMoney(financeSummary?.totalExpenses || 0)} {t("common.sumUnit")}
                </div>
                <div style={{ fontSize: 11, color: "#8A8D96", marginTop: 4 }}>
                  Markaz: {formatMoney(financeSummary?.totalCenterExpenses || 0)} | Oylik:{" "}
                  {formatMoney(financeSummary?.totalSalaries || 0)}
                </div>
              </div>

              <div
                style={{
                  background:
                    (financeSummary?.netProfit || 0) >= 0 ? "#F0FDF4" : "#FEF2F2",
                  border: `1px solid ${(financeSummary?.netProfit || 0) >= 0 ? "#BBF7D0" : "#FCA5A5"}`,
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: (financeSummary?.netProfit || 0) >= 0 ? "#166534" : "#991B1B",
                    fontWeight: 700,
                  }}
                >
                  {t("payments.expenses.netProfit")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 900,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: (financeSummary?.netProfit || 0) >= 0 ? "#15803D" : "#DC2626",
                  }}
                >
                  {(financeSummary?.netProfit || 0) >= 0 ? "+" : ""}
                  {formatMoney(financeSummary?.netProfit || 0)} {t("common.sumUnit")}
                </div>
              </div>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: 18,
                }}
              >
                <div style={{ fontSize: 12, color: "#8A8D96" }}>
                  {t("payments.debtors.collectionRate")}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    marginTop: 4,
                    color: ACCENT,
                  }}
                >
                  {financeSummary?.collectionRate ?? 100}%
                </div>
                <div style={{ fontSize: 11, color: "#8A8D96", marginTop: 4 }}>
                  Qarz: {formatMoney(financeSummary?.totalOutstandingDebt || 0)}
                </div>
              </div>
            </div>

            {/* Category Pill Summary */}
            {financeSummary && Object.keys(financeSummary.expensesByCategory).length > 0 && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 14,
                  padding: "14px 18px",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  {t("pay.expenseSplit")}
                </span>
                {EXPENSE_CATEGORIES.map((cat) => {
                  const amt = financeSummary.expensesByCategory[cat.value] || 0;
                  if (amt === 0) return null;
                  return (
                    <span
                      key={cat.value}
                      style={{
                        background: `${cat.color}15`,
                        color: cat.color,
                        border: `1px solid ${cat.color}30`,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "3px 10px",
                        borderRadius: 8,
                      }}
                    >
                      {t(cat.labelKey)}: {formatMoney(amt)} {t("common.sumUnit")}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Category Filter */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Select
                options={[
                  { value: "", label: t("pay.allCategories") },
                  ...EXPENSE_CATEGORIES.map((c) => ({
                    value: c.value,
                    label: t(c.labelKey),
                  })),
                ]}
                value={expenseCategoryFilter}
                onChange={setExpenseCategoryFilter}
                style={{ width: 220 }}
              />
            </div>

            {/* Expenses Table */}
            {loading ? (
              <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
            ) : filteredExpenses.length === 0 ? (
              <div
                style={{
                  color: "#8A8D96",
                  fontSize: 14,
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 16,
                  padding: 36,
                  textAlign: "center",
                }}
              >
                {t("payments.expenses.noExpenses")}
              </div>
            ) : (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #EAE8E2",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                <table>
                  <thead>
                    <tr>
                      <th style={{ paddingTop: 16 }}>{t("payments.expenses.fieldDate")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.expenses.fieldTitle")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.expenses.fieldCategory")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.expenses.fieldBranch")}</th>
                      <th style={{ paddingTop: 16 }}>{t("payments.expenses.fieldAmount")}</th>
                      <th style={{ paddingTop: 16 }}>{t("pay.responsible")}</th>
                      <th style={{ paddingTop: 16, textAlign: "right" }}>{t("pay.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.map((exp) => {
                      const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === exp.category);
                      return (
                        <tr key={exp.id}>
                          <td>{exp.date}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{exp.title}</div>
                            {exp.notes && (
                              <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{exp.notes}</div>
                            )}
                          </td>
                          <td>
                            <span
                              style={{
                                background: `${catInfo?.color || "#64748B"}15`,
                                color: catInfo?.color || "#64748B",
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "3px 8px",
                                borderRadius: 6,
                              }}
                            >
                              {catInfo ? t(catInfo.labelKey) : exp.category}
                            </span>
                          </td>
                          <td>{exp.branch?.name || "—"}</td>
                          <td style={{ fontWeight: 800, color: "#DC2626" }}>
                            -{formatMoney(exp.amount)} {t("common.sumUnit")}
                          </td>
                          <td style={{ fontSize: 12, color: "#64748B" }}>
                            {exp.recordedBy?.fullName || "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteExpense(exp.id)}
                              style={{
                                background: "#FEE2E2",
                                color: "#DC2626",
                                border: "none",
                                padding: "5px 10px",
                                borderRadius: 6,
                                fontSize: 11.5,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {t("common.delete")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: NEW PAYMENT                                                        */}
      {/* ========================================================================= */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          resetPaymentForm();
        }}
        title={t("payments.modalTitle")}
      >
        <form onSubmit={onPaymentSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div
              style={{
                background: "#FDEBEC",
                color: "#B23A47",
                fontSize: 13,
                fontWeight: 600,
                padding: "10px 14px",
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
          <Field label={t("payments.fieldStudent")}>
            <StudentPicker students={students} value={studentId} onSelect={setStudentId} />
          </Field>
          <Field label={t("payments.fieldAmount")}>
            <input
              className="field-input"
              type="number"
              min={0}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500000"
            />
          </Field>
          <Field label={t("payments.fieldDiscount")}>
            <input
              className="field-input"
              type="number"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0"
            />
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
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: 12,
              borderRadius: 10,
              marginTop: 6,
            }}
          >
            {saving ? t("payments.adding") : t("payments.addPayment")}
          </button>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: NEW EXPENSE                                                        */}
      {/* ========================================================================= */}
      <Modal
        open={expenseModalOpen}
        onClose={() => {
          setExpenseModalOpen(false);
          resetExpenseForm();
        }}
        title={t("payments.expenses.newExpense")}
      >
        <form onSubmit={onExpenseSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div
              style={{
                background: "#FDEBEC",
                color: "#B23A47",
                fontSize: 13,
                fontWeight: 600,
                padding: "10px 14px",
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}
          <Field label={t("payments.expenses.fieldTitle")}>
            <input
              className="field-input"
              required
              value={expenseTitle}
              onChange={(e) => setExpenseTitle(e.target.value)}
              placeholder={t("pay.expensePlaceholder")}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("payments.expenses.fieldCategory")}>
              <Select
                options={EXPENSE_CATEGORIES.map((c) => ({
                  value: c.value,
                  label: t(c.labelKey),
                }))}
                value={expenseCategory}
                onChange={(val) => setExpenseCategory(val as ExpenseCategory)}
              />
            </Field>
            <Field label={t("payments.expenses.fieldAmount")}>
              <input
                className="field-input"
                type="number"
                min={1}
                required
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
                placeholder="1000000"
              />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("payments.fieldMethod")}>
              <Select
                options={[
                  { value: "CASH", label: t("payment.methodCash") },
                  { value: "CLICK", label: t("payment.methodClick") },
                  { value: "PAYME", label: t("payment.methodPayme") },
                  { value: "BANK_TRANSFER", label: t("payment.methodBankTransfer") },
                ]}
                value={expensePaymentMethod}
                onChange={setExpensePaymentMethod}
              />
            </Field>
            <Field label={t("payments.expenses.fieldDate")}>
              <DatePicker value={expenseDate} onChange={setExpenseDate} />
            </Field>
          </div>

          {branches.length > 0 && (
            <Field label={t("payments.expenses.fieldBranch")}>
              <Select
                options={[
                  { value: "", label: "Bosh ofis (Umumiy)" },
                  ...branches.map((b) => ({ value: b.id, label: b.name })),
                ]}
                value={expenseBranchId}
                onChange={setExpenseBranchId}
              />
            </Field>
          )}

          <Field label={t("payments.expenses.fieldNotes")}>
            <textarea
              className="field-input"
              rows={2}
              value={expenseNotes}
              onChange={(e) => setExpenseNotes(e.target.value)}
              placeholder={t("pay.notePlaceholder")}
            />
          </Field>

          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: 12,
              borderRadius: 10,
              marginTop: 6,
            }}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: OFFICIAL PAYMENT RECEIPT VOUCHER                                    */}
      {/* ========================================================================= */}
      <PaymentReceiptModal
        payment={receiptPayment}
        onClose={() => setReceiptPayment(null)}
        tenantName={tenant?.name}
        tenantAddress={tenant?.address}
        tenantPhone={tenant?.phone}
        cashierName={user?.fullName}
      />

      {/* ========================================================================= */}
      {/* MODAL: ONLINE PAYMENT CHECKOUT LINK (Click & Payme)                       */}
      {/* ========================================================================= */}
      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title={t("pay.onlineLinkTitle")}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#F8F8F6", borderRadius: 10, padding: 12, border: "1px solid #EAE8E2" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#181A1F" }}>{linkDebtor?.studentName}</div>
            <div style={{ fontSize: 13, color: "#DC2626", fontWeight: 700, marginTop: 2 }}>
              Qarzdorlik: {formatMoney(linkDebtor?.debtAmount || 0)} so'm ({debtorsData?.forMonth})
            </div>
            {linkDebtor?.phone && (
              <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2 }}>Telefon: {linkDebtor.phone}</div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn"
              disabled={generatingLink}
              onClick={() => handleGenerateLink("CLICK")}
              style={{
                flex: 1,
                background: "#0073FF",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                padding: "10px 14px",
                borderRadius: 8,
                border: "none",
              }}
            >
              {generatingLink ? "Yuklanmoqda..." : "🔵 Click Havolasi"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={generatingLink}
              onClick={() => handleGenerateLink("PAYME")}
              style={{
                flex: 1,
                background: "#18AC98",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                padding: "10px 14px",
                borderRadius: 8,
                border: "none",
              }}
            >
              {generatingLink ? "Yuklanmoqda..." : "🟢 Payme Havolasi"}
            </button>
          </div>

          {generatedLink && (
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 10,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#15803D" }}>
                ✅ {generatedLink.provider} to&apos;lov havolasi tayyor:
              </div>
              <input
                className="field-input"
                readOnly
                value={generatedLink.url}
                style={{ fontSize: 12, background: "#fff" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedLink.url);
                    setCopySuccess(true);
                    setTimeout(() => setCopySuccess(false), 2000);
                  }}
                  style={{
                    flex: 1,
                    background: copySuccess ? "#15803D" : "#fff",
                    color: copySuccess ? "#fff" : "#181A1F",
                    border: "1px solid #CBD5E1",
                    padding: "8px 12px",
                    borderRadius: 7,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {copySuccess ? "✓ Nusxalandi" : "📋 Nusxalash"}
                </button>
                {linkDebtor?.phone && (
                  <button
                    type="button"
                    disabled={sendingLinkSms}
                    onClick={handleSendLinkViaSms}
                    style={{
                      flex: 1,
                      background: ACCENT,
                      color: "#fff",
                      border: "none",
                      padding: "8px 12px",
                      borderRadius: 7,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {sendingLinkSms ? t("pay.sending") : t("pay.sendSms")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
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
