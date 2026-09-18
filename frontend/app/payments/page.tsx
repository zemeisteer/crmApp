"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import { paymentsApi, studentsApi, Payment, Student, PaymentsSummary, ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

const STATUS_LABEL: Record<string, string> = {
  PAID: "To'langan",
  PENDING: "Kutilmoqda",
  FAILED: "Muvaffaqiyatsiz",
};

const STATUS_CLASS: Record<string, string> = {
  PAID: "badge-success",
  PENDING: "badge-neutral",
  FAILED: "badge-danger",
};

function PaymentsContent() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [forMonth, setForMonth] = useState(() => new Date().toISOString().slice(0, 7));

  function load() {
    setLoading(true);
    Promise.all([paymentsApi.list(), studentsApi.list(), paymentsApi.summary()])
      .then(([p, s, sum]) => {
        setPayments(p);
        setStudents(s);
        setSummary(sum);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function studentName(id: string) {
    return students.find((s) => s.id === id)?.fullName || id;
  }

  function resetForm() {
    setStudentId("");
    setAmount("");
    setMethod("CASH");
    setForMonth(new Date().toISOString().slice(0, 7));
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await paymentsApi.create({
        studentId,
        amount: Number(amount),
        method,
        status: "PAID",
        forMonth,
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
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>To&apos;lovlar</h1>
        <button
          className="btn"
          onClick={() => setModalOpen(true)}
          disabled={students.length === 0}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          + Yangi to&apos;lov
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        {summary && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }}>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 12, color: "#8A8D96" }}>Jami to&apos;langan</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{formatMoney(summary.totalPaid)} so&apos;m</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 12, color: "#8A8D96" }}>Kutilayotgan</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{summary.pendingCount}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 12, color: "#8A8D96" }}>Jami to&apos;lovlar soni</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>{summary.count}</div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>Yuklanmoqda...</div>
        ) : payments.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {students.length === 0 ? "To'lov qo'shishdan oldin avval o'quvchi qo'shing." : "Hali to'lov yo'q."}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>O&apos;quvchi</th>
                  <th style={{ paddingTop: 16 }}>Oy</th>
                  <th style={{ paddingTop: 16 }}>Summa</th>
                  <th style={{ paddingTop: 16 }}>Usul</th>
                  <th style={{ paddingTop: 16 }}>Holat</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{studentName(p.studentId)}</td>
                    <td>{p.forMonth}</td>
                    <td style={{ fontWeight: 700 }}>{formatMoney(p.amount)} so&apos;m</td>
                    <td>{p.method || "—"}</td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[p.status] || "badge-neutral"}`}>{STATUS_LABEL[p.status] || p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yangi to'lov">
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label="O'quvchi">
            <select className="field-input" required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">— Tanlang —</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Summa (so'm)">
            <input className="field-input" type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" />
          </Field>
          <Field label="To'lov usuli">
            <select className="field-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Naqd</option>
              <option value="CLICK">Click</option>
              <option value="PAYME">Payme</option>
              <option value="BANK_TRANSFER">Bank o'tkazmasi</option>
            </select>
          </Field>
          <Field label="Oy">
            <input className="field-input" type="month" required value={forMonth} onChange={(e) => setForMonth(e.target.value)} />
          </Field>
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
