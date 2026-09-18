"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import { studentsApi, groupsApi, Student, Group, ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

function StudentsContent() {
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [groupId, setGroupId] = useState("");

  function load() {
    setLoading(true);
    Promise.all([studentsApi.list(), groupsApi.list()])
      .then(([s, g]) => {
        setStudents(s);
        setGroups(g);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setFullName("");
    setPhone("");
    setParentPhone("");
    setGroupId("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await studentsApi.create({
        fullName,
        phone: phone || undefined,
        parentPhone: parentPhone || undefined,
        groupId: groupId || undefined,
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
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>O&apos;quvchilar</h1>
        <button
          className="btn"
          onClick={() => setModalOpen(true)}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          + Yangi o&apos;quvchi
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>Yuklanmoqda...</div>
        ) : students.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            Hali o&apos;quvchi yo&apos;q.
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>O&apos;quvchi</th>
                  <th style={{ paddingTop: 16 }}>Guruh(lar)</th>
                  <th style={{ paddingTop: 16 }}>Telefon</th>
                  <th style={{ paddingTop: 16 }}>Ota-ona telefoni</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>
                      <Link href={`/students/${s.id}`} style={{ color: ACCENT }}>
                        {s.fullName}
                      </Link>
                    </td>
                    <td>{s.enrollments?.map((e) => e.group.name).join(", ") || "—"}</td>
                    <td>{s.phone || "—"}</td>
                    <td>{s.parentPhone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yangi o'quvchi">
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label="To'liq ism">
            <input className="field-input" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Madina Yusupova" />
          </Field>
          <Field label="Telefon">
            <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" />
          </Field>
          <Field label="Ota-ona telefoni">
            <input className="field-input" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="+998 90 123 45 67" />
          </Field>
          <Field label="Guruh">
            <select className="field-input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">— Tanlanmagan —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? "Saqlanmoqda..." : "O'quvchini qo'shish"}
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

export default function StudentsPage() {
  return (
    <DashboardShell>
      <StudentsContent />
    </DashboardShell>
  );
}
