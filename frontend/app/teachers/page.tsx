"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import { teachersApi, Teacher, ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

function TeachersContent() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [subject, setSubject] = useState("");
  const [phone, setPhone] = useState("");
  const [salaryValue, setSalaryValue] = useState("");

  function load() {
    setLoading(true);
    teachersApi
      .list()
      .then(setTeachers)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setFullName("");
    setSubject("");
    setPhone("");
    setSalaryValue("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await teachersApi.create({
        fullName,
        subject: subject || undefined,
        phone: phone || undefined,
        salaryValue: salaryValue ? Number(salaryValue) : undefined,
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
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>O&apos;qituvchilar</h1>
        <button
          className="btn"
          onClick={() => setModalOpen(true)}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          + Yangi o&apos;qituvchi
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>Yuklanmoqda...</div>
        ) : teachers.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            Hali o&apos;qituvchi yo&apos;q.
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>O&apos;qituvchi</th>
                  <th style={{ paddingTop: 16 }}>Yo&apos;nalish</th>
                  <th style={{ paddingTop: 16 }}>Telefon</th>
                  <th style={{ paddingTop: 16 }}>Oylik maosh</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => (
                  <tr key={t.id}>
                    <td style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: "50%",
                          background: "#ECEBFB",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          color: ACCENT,
                          fontSize: 12,
                        }}
                      >
                        {t.fullName.slice(0, 2).toUpperCase()}
                      </div>
                      {t.fullName}
                    </td>
                    <td>{t.subject || "—"}</td>
                    <td>{t.phone || "—"}</td>
                    <td style={{ fontWeight: 700 }}>{t.salaryValue ? `${new Intl.NumberFormat("uz-UZ").format(t.salaryValue)} so'm` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yangi o'qituvchi">
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label="To'liq ism">
            <input className="field-input" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Dilnoza Rahimova" />
          </Field>
          <Field label="Yo'nalish">
            <input className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="IELTS / Speaking" />
          </Field>
          <Field label="Telefon">
            <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" />
          </Field>
          <Field label="Oylik maosh (so'm)">
            <input className="field-input" type="number" min={0} value={salaryValue} onChange={(e) => setSalaryValue(e.target.value)} placeholder="2000000" />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? "Saqlanmoqda..." : "O'qituvchini qo'shish"}
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

export default function TeachersPage() {
  return (
    <DashboardShell>
      <TeachersContent />
    </DashboardShell>
  );
}
