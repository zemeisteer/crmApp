"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import { studentsApi, groupsApi, paymentsApi, attendanceApi, Student, Group, Payment, AttendanceRecord, ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

const STATUS_LABEL: Record<string, string> = {
  PAID: "To'landi",
  PENDING: "Kutilmoqda",
  FAILED: "Muvaffaqiyatsiz",
};

const STATUS_CLASS: Record<string, string> = {
  PAID: "badge-success",
  PENDING: "badge-neutral",
  FAILED: "badge-danger",
};

const METHOD_LABEL: Record<string, string> = {
  CASH: "Naqd",
  CLICK: "Click",
  PAYME: "Payme",
  BANK_TRANSFER: "Bank o'tkazmasi",
};

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("uz-UZ", { day: "numeric", month: "long", year: "numeric" });
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
  const [forMonth, setForMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

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
    return <div style={{ padding: 32, color: "#8A8D96", fontSize: 14 }}>Yuklanmoqda...</div>;
  }

  if (notFound || !student) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
          O&apos;quvchi topilmadi.{" "}
          <Link href="/students" style={{ color: ACCENT, fontWeight: 600 }}>
            O&apos;quvchilarga qaytish
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
      setEnrollError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function onUnenroll(groupId: string) {
    if (!confirm("O'quvchini bu guruhdan chiqarishni tasdiqlaysizmi?")) return;
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
      setForMonth(new Date().toISOString().slice(0, 7));
      load();
    } catch (err) {
      setPaymentError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteStudent() {
    if (!confirm("O'quvchini butunlay o'chirishni tasdiqlaysizmi?")) return;
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
          O&apos;quvchilarga qaytish
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
                {student.phone || "Telefon kiritilmagan"} · Ro&apos;yxatdan o&apos;tgan: {formatDate(student.startDate)}
              </div>
            </div>
          </div>
          <button
            className="btn"
            onClick={onDeleteStudent}
            style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}
          >
            O&apos;quvchini o&apos;chirish
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>Faol guruhlar</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{enrollments.length}</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>Umumiy davomat</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
              {attendancePercent === null ? "—" : `${attendancePercent}%`}
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>Jami to&apos;lagan</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(totalPaid)} so&apos;m</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
            <div style={{ fontSize: 12, color: "#8A8D96" }}>Jami to&apos;lovlar soni</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{payments.length}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>Guruhlar</div>
              <button
                className="btn"
                onClick={() => setEnrollOpen(true)}
                disabled={availableGroups.length === 0}
                style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
              >
                + Guruhga qo&apos;shish
              </button>
            </div>
            {enrollments.length === 0 ? (
              <div style={{ color: "#8A8D96", fontSize: 13.5 }}>Hali guruhga qo&apos;shilmagan.</div>
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
                      <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2 }}>{e.group.schedule || "Jadval kiritilmagan"}</div>
                    </div>
                    <button
                      className="btn"
                      onClick={() => onUnenroll(e.group.id)}
                      style={{ background: "transparent", color: "#B23A47", fontSize: 12, fontWeight: 600, padding: "6px 8px", borderRadius: 8 }}
                    >
                      Chiqarish
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>O&apos;quvchi haqida</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "18px 16px" }}>
              <InfoField label="Tug'ilgan sana" value={formatDate(student.birthDate)} />
              <InfoField label="Telegram" value={student.telegramUsername ? `@${student.telegramUsername}` : "—"} />
              <InfoField label="Ota-ona telefoni" value={student.parentPhone || "—"} />
              <InfoField label="Manzil" value={student.address || "—"} />
            </div>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>To&apos;lovlar tarixi</div>
            <button
              className="btn"
              onClick={() => setPaymentOpen(true)}
              style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
            >
              + To&apos;lov qo&apos;shish
            </button>
          </div>
          {payments.length === 0 ? (
            <div style={{ color: "#8A8D96", fontSize: 14, padding: "24px 20px" }}>Hali to&apos;lov yo&apos;q.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 14 }}>Sana</th>
                  <th style={{ paddingTop: 14 }}>Oy</th>
                  <th style={{ paddingTop: 14 }}>Summa</th>
                  <th style={{ paddingTop: 14 }}>Usul</th>
                  <th style={{ paddingTop: 14 }}>Holat</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.paidAt)}</td>
                    <td>{p.forMonth}</td>
                    <td style={{ fontWeight: 700 }}>{formatMoney(p.amount)} so&apos;m</td>
                    <td>{p.method ? METHOD_LABEL[p.method] || p.method : "—"}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[p.status] || "badge-neutral"}`}>{STATUS_LABEL[p.status] || p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={enrollOpen} onClose={() => setEnrollOpen(false)} title="Guruhga qo'shish">
        <form onSubmit={onEnroll} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {enrollError && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{enrollError}</div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Guruh</div>
            <select className="field-input" required value={enrollGroupId} onChange={(e) => setEnrollGroupId(e.target.value)}>
              <option value="">— Tanlang —</option>
              {availableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? "Saqlanmoqda..." : "Qo'shish"}
          </button>
        </form>
      </Modal>

      <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Yangi to'lov">
        <form onSubmit={onAddPayment} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {paymentError && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{paymentError}</div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Summa (so&apos;m)</div>
            <input className="field-input" type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>To&apos;lov usuli</div>
            <select className="field-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Naqd</option>
              <option value="CLICK">Click</option>
              <option value="PAYME">Payme</option>
              <option value="BANK_TRANSFER">Bank o&apos;tkazmasi</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Oy</div>
            <input className="field-input" type="month" required value={forMonth} onChange={(e) => setForMonth(e.target.value)} />
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? "Saqlanmoqda..." : "To'lovni qo'shish"}
          </button>
        </form>
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
