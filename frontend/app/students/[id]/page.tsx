"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import StudentPortalPin from "@/components/students/StudentPortalPin";
import StudentStatusModal, { STATUS_STYLE } from "@/components/students/StudentStatusModal";
import ParentBotLink from "@/components/students/ParentBotLink";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import GroupPicker from "@/components/students/GroupPicker";
import MonthPicker from "@/components/MonthPicker";
import { studentsApi, groupsApi, paymentsApi, retryKey, attendanceApi, billingApi, telegramApi, exportApi, reportsApi, Student, Group, Payment, AttendanceRecord, ApiError } from "@/lib/api";
import { useCenterClock } from "@/lib/use-center-clock";
import { useLanguage } from "@/lib/i18n-context";
import { MONTH_KEYS, type TranslationKey } from "@/lib/i18n";
import { formatDate as fmtDate } from "@/lib/format-date";
import { ROOT_DOMAIN } from "@/lib/domain";

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
  const clock = useCenterClock();

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
  const [forMonth, setForMonth] = useState(() => clock.month());
  // Sending the same form again (double click, lost answer) is one payment.
  const paymentKey = useRef<{ sig: string; key: string } | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const [botUsername, setBotUsername] = useState<string | null>(null);

  const [billingOpen, setBillingOpen] = useState(false);
  const [billingProvider, setBillingProvider] = useState<"CLICK" | "PAYME">("CLICK");
  const [billingAmount, setBillingAmount] = useState("");
  const [billingMonth, setBillingMonth] = useState(() => clock.month());
  const [billingResult, setBillingResult] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingSaving, setBillingSaving] = useState(false);
  const [qrCardOpen, setQrCardOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

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
      alert(t("msg.linkCreateError"));
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

  const [payState, setPayState] = useState<"PAID" | "DEBT" | "PENDING" | "NONE" | null>(null);

  function load() {
    setLoading(true);
    reportsApi
      .studentsSummary()
      .then((r) => setPayState(r.withPayments ? r.items.find((i) => i.studentId === id)?.payment ?? null : null))
      .catch(() => setPayState(null));
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
    return <div style={{ padding: 32, color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>;
  }

  if (notFound || !student) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "#686B75", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
          {t("studentDetail.notFound")}{" "}
          <Link href="/students" style={{ color: ACCENT, fontWeight: 600 }}>
            {t("studentDetail.back")}
          </Link>
        </div>
      </div>
    );
  }

  // Current (active/paused) groups first, then past ones (completed or
  // removed), newest first — the demo's "previous and current groups".
  const allEnrollments = student.enrollments || [];
  const isCurrent = (st?: string) => !st || st === "ACTIVE" || st === "PAUSED";
  const enrollments = allEnrollments.filter((e) => isCurrent(e.status));
  const history = [...allEnrollments].sort(
    (a, b) => Number(isCurrent(b.status)) - Number(isCurrent(a.status)) || (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""),
  );
  const payments = (student.payments || []).slice().sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || ""));
  const enrolledGroupIds = new Set(enrollments.map((e) => e.groupId));
  const monthYear = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return `${t(MONTH_KEYS[d.getMonth()])} ${d.getFullYear()}`;
  };
  // Time studying: from the first group join (or the start date) until now.
  const since = [student.startDate, ...allEnrollments.map((e) => e.joinedAt)].filter(Boolean).sort()[0] as string | undefined;
  const studyTime = (() => {
    if (!since) return "—";
    const from = new Date(since);
    const now = new Date();
    const months = Math.max(0, (now.getFullYear() - from.getFullYear()) * 12 + now.getMonth() - from.getMonth());
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (y === 0 && m === 0) return t("stu.lessThanMonth");
    return [y ? t("stu.years").replace("{n}", String(y)) : "", m ? t("stu.months").replace("{n}", String(m)) : ""].filter(Boolean).join(" ");
  })();
  // All open groups the student is not in yet, in every direction.
  const availableGroups = groups.filter((g) => !enrolledGroupIds.has(g.id) && g.status !== "ARCHIVED" && g.status !== "COMPLETED");
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
      const body = { studentId: id, amount: Number(amount), method, status: "PAID" as const, forMonth };
      await paymentsApi.create(body, retryKey(paymentKey, body));
      paymentKey.current = null;
      setPaymentOpen(false);
      setAmount("");
      setForMonth(clock.month());
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
        <Link href="/students" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#686B75", marginBottom: 10 }}>
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
              <h1 style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {student.fullName}
                {payState && payState !== "NONE" && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: 100,
                      fontFamily: "'Inter', sans-serif",
                      ...(payState === "PAID"
                        ? { color: "#167A48", background: "#E9F8EF" }
                        : payState === "PENDING"
                          ? { color: "#B45309", background: "#FEF3C7" }
                          : { color: "#B23A47", background: "#FDEBEC" }),
                    }}
                  >
                    {payState === "PAID" ? t("stu.payPaid") : payState === "PENDING" ? t("stu.payPending") : t("stu.payDebt")}
                  </span>
                )}
              </h1>
              <div style={{ fontSize: 13, color: "#686B75", marginTop: 2 }}>
                {student.phone || t("studentDetail.phoneMissing")} · {t("studentDetail.registeredOn")}: {formatDate(student.startDate)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() => setStatusOpen(true)}
              title={t("stStatus.title")}
              style={{ ...STATUS_STYLE[student.status ?? "ACTIVE"], border: "none", fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 9 }}
            >
              {t(`stStatus.${student.status ?? "ACTIVE"}` as TranslationKey)} ▾
            </button>
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
            <div style={{ fontSize: 12, color: "#686B75" }}>{enrollments.length > 1 ? t("stu.currentGroups") : t("stu.currentGroup")}</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={enrollments.map((e) => e.group.name).join(", ")}>
              {enrollments.map((e) => e.group.name).join(", ") || "—"}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#686B75" }}>{t("studentDetail.statTotalAttendance")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
              {attendancePercent === null ? "—" : `${attendancePercent}%`}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#686B75" }}>{t("studentDetail.statTotalPaid")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(totalPaid)} {t("common.sumUnit")}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#686B75" }}>{t("stu.studyTime")}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{studyTime}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("stu.groupHistory")}</div>
              <button
                className="btn"
                onClick={() => setEnrollOpen(true)}
                disabled={availableGroups.length === 0}
                style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
              >
                {t("studentDetail.addToGroup")}
              </button>
            </div>
            {history.length === 0 ? (
              <div style={{ color: "#686B75", fontSize: 13.5 }}>{t("studentDetail.noGroupsYet")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {history.map((e) => {
                  const current = isCurrent(e.status);
                  const badge =
                    e.status === "PAUSED"
                      ? { text: t("stu.enrPaused"), color: "#B45309", bg: "#FEF3C7" }
                      : current
                        ? { text: t("stu.enrCurrent"), color: ACCENT, bg: "#EEF0FF" }
                        : e.status === "COMPLETED"
                          ? { text: t("stu.enrCompleted"), color: "#167A48", bg: "#E9F8EF" }
                          : { text: t("stu.enrLeft"), color: "#686B75", bg: "#F2F1EC" };
                  const period = `${monthYear(e.joinedAt)} — ${current ? t("stu.untilNow") : monthYear(e.leftAt) || "—"}`;
                  return (
                    <div
                      key={e.id}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #EAE8E2", borderRadius: 12, padding: "12px 14px", opacity: current ? 1 : 0.85 }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/groups/${e.group.id}`} style={{ fontSize: 13.5, fontWeight: 600, color: current ? ACCENT : "#181A1F" }}>
                          {e.group.name}
                        </Link>
                        <div style={{ fontSize: 12, color: "#686B75", marginTop: 2 }}>
                          {[period, e.group.teacher?.fullName].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: badge.color, background: badge.bg, padding: "4px 10px", borderRadius: 100 }}>{badge.text}</span>
                        {current && (
                          <button
                            className="btn"
                            onClick={() => onUnenroll(e.group.id)}
                            style={{ background: "transparent", color: "#B23A47", fontSize: 12, fontWeight: 600, padding: "6px 8px", borderRadius: 8 }}
                          >
                            {t("studentDetail.remove")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
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
              <InfoField label={t("stu.foundUs")} value={student.origin ? t(`adm.source.${student.origin.source}` as TranslationKey) : "—"} />
              {student.notes && <InfoField label={t("stu.notes")} value={student.notes} />}
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #EAE8E2" }}>
              <div style={{ fontSize: 11.5, color: "#686B75", marginBottom: 6 }}>{t("studentDetail.telegramNotifications")}</div>
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
                      <div style={{ fontSize: 11, color: "#686B75", marginTop: 6 }}>
                        {t("std.linkExpiry")}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, color: "#686B75", fontSize: 12 }}>
                      {t("std.linkHint")}
                    </div>
                  )}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: "#686B75" }}>{t("studentDetail.telegramNotConfigured")}</span>
              )}
              {botUsername && <ParentBotLink studentId={student.id} />}
            </div>
          </div>
        </div>

        <StudentPortalPin studentId={student.id} hasPhone={Boolean(student.phone || student.parentPhone)} />

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
            <div style={{ color: "#686B75", fontSize: 14, padding: "24px 20px" }}>{t("studentDetail.noPaymentsYet")}</div>
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
                    <td>{/^\d{4}-\d{2}$/.test(p.forMonth ?? "") ? `${t(MONTH_KEYS[Number(p.forMonth!.slice(5)) - 1])} ${p.forMonth!.slice(0, 4)}` : p.forMonth || "—"}</td>
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
            <GroupPicker groups={availableGroups} value={enrollGroupId} onChange={setEnrollGroupId} />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving || !enrollGroupId}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6, opacity: enrollGroupId ? 1 : 0.6 }}
          >
            {saving ? t("common.saving") : t("common.add")}
          </button>
        </form>
      </Modal>

      <Modal open={paymentOpen} onClose={() => { setPaymentOpen(false); setAmount(""); setForMonth(clock.month()); setPaymentError(null); }} title={t("studentDetail.modalNewPayment")}>
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
            <div style={{ background: "#E9F8EF", color: "#167A48", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
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
            <div style={{ fontSize: 12, color: "#686B75", lineHeight: 1.5 }}>
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
      <StudentStatusModal student={student} open={statusOpen} onClose={() => setStatusOpen(false)} onSaved={(s) => { setStudent((prev) => (prev ? { ...prev, ...s } : prev)); load(); }} />
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
                  <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.5px", textTransform: "uppercase" }}>TalimCRM Education</div>
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
              <span>{ROOT_DOMAIN}</span>
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
      <div style={{ fontSize: 11.5, color: "#686B75" }}>{label}</div>
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
