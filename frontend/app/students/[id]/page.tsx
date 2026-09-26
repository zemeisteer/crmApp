"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import MonthPicker from "@/components/MonthPicker";
import { studentsApi, groupsApi, paymentsApi, attendanceApi, billingApi, telegramApi, exportApi, Student, Group, Payment, AttendanceRecord, ApiError } from "@/lib/api";
import { localMonthStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDate as fmtDate } from "@/lib/format-date";

const ACCENT = "#4F46E5";

const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  PAID: "payment.statusPaid",
  PENDING: "payment.statusPending",
  FAILED: "payment.statusFailed",
};

const STATUS_CLASS: Record<string, string> = {
  PAID: "badge-success",
  PENDING: "badge-neutral",
  FAILED: "badge-danger",
};

const METHOD_LABEL_KEYS: Record<string, TranslationKey> = {
  CASH: "payment.methodCash",
  CLICK: "payment.methodClick",
  PAYME: "payment.methodPayme",
  BANK_TRANSFER: "payment.methodBankTransfer",
};

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function StudentDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const { t, lang } = useLanguage();

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return fmtDate(iso, lang, "long");
  }

  const [student, setStudent] = useState<(Student & { payments?: Payment[] }) | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollGroupId, setEnrollGroupId] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [forMonth, setForMonth] = useState(() => localMonthStr());
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const [botUsername, setBotUsername] = useState<string | null>(null);

  const [billingOpen, setBillingOpen] = useState(false);
  const [billingProvider, setBillingProvider] = useState<"CLICK" | "PAYME">("CLICK");
  const [billingAmount, setBillingAmount] = useState("");
  const [billingMonth, setBillingMonth] = useState(() => localMonthStr());
  const [billingResult, setBillingResult] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingSaving, setBillingSaving] = useState(false);
  const [qrCardOpen, setQrCardOpen] = useState(false);

  useEffect(() => {
    telegramApi.status().then((s) => setBotUsername(s.botUsername)).catch(() => setBotUsername(null));
  }, []);

  const [linkTokenData, setLinkTokenData] = useState<{ linkUrl: string | null; token: string; expiresAt: string } | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  async function onGenerateLink() {
    if (!student) return;
    setGeneratingLink(true);
    try {
      const res = await telegramApi.generateLinkToken(student.id);
      setLinkTokenData(res);
      setCopiedLink(false);
    } catch {
      alert("Havola yaratishda xatolik yuz berdi");
    } finally {
      setGeneratingLink(false);
    }
  }

  function onCopyLink() {
    if (!linkTokenData?.linkUrl) return;
    navigator.clipboard.writeText(linkTokenData.linkUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  }

  function load() {
    setLoading(true);
    Promise.all([studentsApi.get(id), groupsApi.list(), attendanceApi.list({ studentId: id })])
      .then(([s, g, a]) => {
        setStudent(s as any);
        setGroups(g);
        setAttendance(a);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  if (loading) {
    return <div style={{ padding: 32, color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  if (notFound || !student) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
          {t("studentDetail.notFound")}{" "}
          <Link href="/students" style={{ color: ACCENT, fontWeight: 600 }}>
            {t("studentDetail.back")}
          </Link>
        </div>
      </div>
    );
  }

  const enrollments = student.enrollments || [];
  const payments = (student.payments || []).slice().sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || ""));
  const enrolledGroupIds = new Set(enrollments.map((e) => e.groupId));
  const availableGroups = groups.filter((g) => !enrolledGroupIds.has(g.id));
  const totalPaid = payments.reduce((sum, p) => (p.status === "PAID" ? sum + p.amount : sum), 0);
  const attendancePercent =
    attendance.length === 0
      ? null
      : Math.round((attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length / attendance.length) * 100);

  async function onEnroll(e: React.FormEvent) {
    e.preventDefault();
    setEnrollError(null);
    setSaving(true);
    try {
      await studentsApi.enroll(id, enrollGroupId);
      setEnrollOpen(false);
      setEnrollGroupId("");
      load();
    } catch (err) {
      setEnrollError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function onUnenroll(groupId: string) {
    if (!confirm(t("studentDetail.confirmUnenroll"))) return;
    await studentsApi.unenroll(id, groupId);
    load();
  }

  async function onAddPayment(e: React.FormEvent) {
    e.preventDefault();
    setPaymentError(null);
    setSaving(true);
    try {
      await paymentsApi.create({
        studentId: id,
        amount: Number(amount),
        method,
        status: "PAID",
        forMonth,
      });
      setPaymentOpen(false);
      setAmount("");
      setForMonth(localMonthStr());
      load();
    } catch (err) {
      setPaymentError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  function openBilling() {
    setBillingResult(null);
    setBillingError(null);
    setBillingOpen(true);
  }

  async function onGenerateBillingLink(e: React.FormEvent) {
    e.preventDefault();
    setBillingError(null);
    setBillingResult(null);
    setBillingSaving(true);
    try {
      const api = billingProvider === "CLICK" ? billingApi.clickLink : billingApi.paymeLink;
      const res = await api({ studentId: id, amount: Number(billingAmount), forMonth: billingMonth });
      setBillingResult(res.url);
    } catch (err) {
      setBillingError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBillingSaving(false);
    }
  }

  async function onDeleteStudent() {
    if (!confirm(t("studentDetail.confirmDelete"))) return;
    await studentsApi.remove(id);
    router.push("/students");
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <Link href="/students" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8A8D96", marginBottom: 10 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("studentDetail.back")}
        </Link>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                background: ACCENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {initials(student.fullName)}
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800 }}>{student.fullName}</h1>
              <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
                {student.phone || t("studentDetail.phoneMissing")} · {t("studentDetail.registeredOn")}: {formatDate(student.startDate)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setQrCardOpen(true)}
              style={{ background: "#EEF2FF", color: ACCENT, border: "1px solid #C7D2FE", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
            >
              {t("std.qrCard")}
            </button>
            <button
              className="btn"
              onClick={onDeleteStudent}
              style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
            >
              {t("studentDetail.deleteStudent")}
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("studentDetail.statActiveGroups")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{enrollments.length}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("studentDetail.statTotalAttendance")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
              {attendancePercent === null ? "—" : `${attendancePercent}%`}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("studentDetail.statTotalPaid")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(totalPaid)} {t("common.sumUnit")}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("studentDetail.statPaymentsCount")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{payments.length}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("studentDetail.groupsTitle")}</div>
              <button
                className="btn"
                onClick={() => setEnrollOpen(true)}
                disabled={availableGroups.length === 0}
                style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
              >
                {t("studentDetail.addToGroup")}
              </button>
            </div>
            {enrollments.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 13.5 }}>{t("studentDetail.noGroupsYet")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {enrollments.map((e) => (
                  <div
                    key={e.id}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #EAE8E2", borderRadius: 12, padding: "12px 14px" }}
                  >
                    <div>
                      <Link href={`/groups/${e.group.id}`} style={{ fontSize: 13.5, fontWeight: 600, color: ACCENT }}>
                        {e.group.name}
                      </Link>
                      <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2 }}>{e.group.schedule || t("studentDetail.scheduleMissing")}</div>
                    </div>
                    <button
                      className="btn"
                      onClick={() => onUnenroll(e.group.id)}
                      style={{ background: "transparent", color: "#B23A47", fontSize: 12, fontWeight: 600, padding: "6px 8px", borderRadius: 8 }}
                    >
                      {t("studentDetail.remove")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("studentDetail.aboutStudent")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "18px 16px" }}>
              <InfoField label={t("studentDetail.birthDate")} value={formatDate(student.birthDate)} />
              <InfoField label={t("studentDetail.telegram")} value={student.telegramUsername ? `@${student.telegramUsername}` : "—"} />
              <InfoField label={t("studentDetail.parentPhone")} value={student.parentPhone || "—"} />
              <InfoField label={t("studentDetail.address")} value={student.address || "—"} />
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #EAE8E2" }}>
              <div style={{ fontSize: 11.5, color: "#8A8D96", marginBottom: 6 }}>{t("studentDetail.telegramNotifications")}</div>
              {student.telegramChatId ? (
                <span className="badge badge-success">{t("studentDetail.telegramLinked")}</span>
              ) : botUsername ? (
                <div style={{ fontSize: 12.5 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span className="badge badge-neutral">{t("studentDetail.telegramNotLinked")}</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={onGenerateLink}
                      disabled={generatingLink}
                      style={{
                        background: "#EEF0FF",
                        color: ACCENT,
                        border: "1px solid rgba(79, 70, 229, 0.25)",
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "6px 12px",
                        borderRadius: 8,
                      }}
                    >
                      {generatingLink ? t("std.creating") : t("std.secureLink")}
                    </button>
                  </div>
                  {linkTokenData?.linkUrl ? (
                    <div style={{ marginTop: 10, background: "#F7F6FF", border: "1px solid #D7D3F8", borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 12, color: "#4A4E58", marginBottom: 6, fontWeight: 600 }}>
                        {t("std.linkIntro")}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, background: "#fff", padding: "8px 10px", borderRadius: 8, fontSize: 11.5, wordBreak: "break-all", border: "1px solid #EAE8E2" }}>
                          {linkTokenData.linkUrl}
                        </code>
                        <button
                          type="button"
                          className="btn"
                          onClick={onCopyLink}
                          style={{
                            background: copiedLink ? "#1FA463" : ACCENT,
                            color: "#fff",
                            border: "none",
                            fontSize: 12,
                            fontWeight: 700,
                            padding: "8px 14px",
                            borderRadius: 8,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {copiedLink ? "✓ Nusxalandi" : "Nusxalash"}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: "#8A8D96", marginTop: 6 }}>
                        {t("std.linkExpiry")}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, color: "#8A8D96", fontSize: 12 }}>
                      {t("std.linkHint")}
                    </div>
                  )}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: "#8A8D96" }}>{t("studentDetail.telegramNotConfigured")}</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("studentDetail.paymentHistory")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={openBilling}
                style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
              >
                {t("studentDetail.paymentLink")}
              </button>
              <button
                className="btn"
                onClick={() => setPaymentOpen(true)}
                style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
              >
                {t("studentDetail.addPayment")}
              </button>
            </div>
          </div>
          {payments.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 14, padding: "24px 20px" }}>{t("studentDetail.noPaymentsYet")}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 14 }}>{t("studentDetail.colDate")}</th>
                  <th style={{ paddingTop: 14 }}>{t("studentDetail.colMonth")}</th>
                  <th style={{ paddingTop: 14 }}>{t("studentDetail.colAmount")}</th>
                  <th style={{ paddingTop: 14 }}>{t("studentDetail.colMethod")}</th>
                  <th style={{ paddingTop: 14 }}>{t("studentDetail.colStatus")}</th>
                  <th style={{ paddingTop: 14 }}></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.paidAt)}</td>
                    <td>{p.forMonth}</td>
                    <td style={{ fontWeight: 700 }}>{formatMoney(p.amount)} {t("common.sumUnit")}</td>
                    <td>{p.method ? t(METHOD_LABEL_KEYS[p.method] || "payment.methodCash") : "—"}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[p.status] || "badge-neutral"}`}>{STATUS_LABEL_KEYS[p.status] ? t(STATUS_LABEL_KEYS[p.status]) : p.status}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {p.status === "PAID" && (
                        <button
                          className="btn"
                          onClick={() => exportApi.receiptPdf(p.id)}
                          style={{ background: "transparent", color: ACCENT, fontSize: 12, fontWeight: 600, padding: "4px 8px", borderRadius: 8 }}
                        >
                          {t("studentDetail.receipt")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={enrollOpen} onClose={() => { setEnrollOpen(false); setEnrollGroupId(""); setEnrollError(null); }} title={t("studentDetail.modalAddToGroup")}>
        <form onSubmit={onEnroll} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {enrollError && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{enrollError}</div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("studentDetail.groupField")}</div>
            <Select
              options={[{ value: "", label: t("groups.selectPlaceholder") }, ...availableGroups.map((g) => ({ value: g.id, label: g.name }))]}
              value={enrollGroupId}
              onChange={setEnrollGroupId}
            />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("common.saving") : t("common.add")}
          </button>
        </form>
      </Modal>

      <Modal open={paymentOpen} onClose={() => { setPaymentOpen(false); setAmount(""); setForMonth(localMonthStr()); setPaymentError(null); }} title={t("studentDetail.modalNewPayment")}>
        <form onSubmit={onAddPayment} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {paymentError && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{paymentError}</div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("studentDetail.amountSum")}</div>
            <input className="field-input" type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("studentDetail.paymentMethodField")}</div>
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
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("studentDetail.monthField")}</div>
            <MonthPicker value={forMonth} onChange={setForMonth} />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("common.saving") : t("studentDetail.addPaymentBtn")}
          </button>
        </form>
      </Modal>
      <Modal open={billingOpen} onClose={() => setBillingOpen(false)} title={t("studentDetail.modalCreateLink")}>
        {billingResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#E9F8EF", color: "#1FA463", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
              {t("studentDetail.linkCreated")}
            </div>
            <code style={{ display: "block", background: "#F7F7F5", padding: "10px 12px", borderRadius: 8, fontSize: 12, wordBreak: "break-all" }}>
              {billingResult}
            </code>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(billingResult);
              }}
              style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 13, fontWeight: 700, padding: 10, borderRadius: 9 }}
            >
              {t("studentDetail.copy")}
            </button>
          </div>
        ) : (
          <form onSubmit={onGenerateBillingLink} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {billingError && (
              <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{billingError}</div>
            )}
            <div style={{ fontSize: 12, color: "#8A8D96", lineHeight: 1.5 }}>
              {t("studentDetail.billingHint")}
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("studentDetail.providerField")}</div>
              <Select
                options={[{ value: "CLICK", label: t("payment.methodClick") }, { value: "PAYME", label: t("payment.methodPayme") }]}
                value={billingProvider}
                onChange={(v) => setBillingProvider(v as "CLICK" | "PAYME")}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("studentDetail.amountSum")}</div>
              <input className="field-input" type="number" min={1000} required value={billingAmount} onChange={(e) => setBillingAmount(e.target.value)} placeholder="500000" />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("studentDetail.monthField")}</div>
              <MonthPicker value={billingMonth} onChange={setBillingMonth} />
            </div>
            <button
              className="btn"
              type="submit"
              disabled={billingSaving}
              style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
            >
              {billingSaving ? t("studentDetail.creatingLink") : t("studentDetail.createLink")}
            </button>
          </form>
        )}
      </Modal>

      {/* Student QR ID Card Modal */}
      <Modal open={qrCardOpen} onClose={() => setQrCardOpen(false)} title={t("std.idCardTitle")}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "10px 0" }}>
          <div
            id="printable-student-card"
            style={{
              width: "100%",
              maxWidth: 360,
              background: "linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%)",
              color: "#fff",
              borderRadius: 20,
              padding: 24,
              boxShadow: "0 10px 25px -5px rgba(49, 46, 129, 0.4)",
              position: "relative",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.15)", paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>🎓</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.5px", textTransform: "uppercase" }}>CRMAPP Education</div>
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{t("std.idCard")}</div>
                </div>
              </div>
              <span style={{ fontSize: 11, background: "rgba(255,255,255,0.2)", padding: "3px 8px", borderRadius: 6, fontWeight: 700 }}>STUDENT</span>
            </div>

            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{student.fullName}</div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4, fontFamily: "monospace" }}>ID: {student.id.slice(0, 12)}...</div>
                <div style={{ marginTop: 10, fontSize: 11 }}>
                  <div style={{ opacity: 0.7 }}>{t("std.groups")}</div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>
                    {enrollments.length > 0 ? enrollments.map(e => e.group.name).join(", ") : "Guruh yo'q"}
                  </div>
                </div>
              </div>

              <div style={{ background: "#fff", padding: 6, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=2&data=${encodeURIComponent(`CRMAPP:STUDENT:${student.id}`)}`}
                  alt="Student QR Code"
                  width={110}
                  height={110}
                  style={{ display: "block", borderRadius: 6 }}
                />
              </div>
            </div>

            <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, opacity: 0.8 }}>
              <span>{t("std.scanHint")}</span>
              <span>crmapp.com</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => window.print()}
              style={{ flex: 1, background: ACCENT, color: "#fff", border: "none", padding: 12, borderRadius: 10, fontWeight: 700, fontSize: 13 }}
            >
              {t("std.print")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setQrCardOpen(false)}
              style={{ background: "#F2F1EC", color: "#181A1F", border: "none", padding: "12px 18px", borderRadius: 10, fontWeight: 600, fontSize: 13 }}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </Modal>

    </>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{value}</div>
    </div>
  );
}

export default function StudentDetailPage() {
  return (
    <DashboardShell>
      <StudentDetailContent />
    </DashboardShell>
  );
}
