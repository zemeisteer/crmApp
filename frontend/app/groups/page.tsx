"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import { groupsApi, Group, ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

function GroupsContent() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [schedule, setSchedule] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");

  function load() {
    setLoading(true);
    groupsApi
      .list()
      .then(setGroups)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setName("");
    setSubject("");
    setSchedule("");
    setMonthlyPrice("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await groupsApi.create({
        name,
        subject,
        schedule: schedule || undefined,
        monthlyPrice: monthlyPrice ? Number(monthlyPrice) : undefined,
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
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Guruhlar</h1>
        <button
          className="btn"
          onClick={() => setModalOpen(true)}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          + Yangi guruh
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>Yuklanmoqda...</div>
        ) : groups.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            Hali guruh yo&apos;q. Birinchi guruhingizni yarating.
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>Guruh</th>
                  <th style={{ paddingTop: 16 }}>Fan</th>
                  <th style={{ paddingTop: 16 }}>Jadval</th>
                  <th style={{ paddingTop: 16 }}>Oylik narx</th>
                  <th style={{ paddingTop: 16 }}>Max o&apos;rin</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td style={{ fontWeight: 600 }}>{g.name}</td>
                    <td>{g.subject}</td>
                    <td>{g.schedule || "—"}</td>
                    <td>{g.monthlyPrice ? `${new Intl.NumberFormat("uz-UZ").format(g.monthlyPrice)} so'm` : "—"}</td>
                    <td>{g.maxStudents}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yangi guruh">
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
          )}
          <Field label="Guruh nomi">
            <input className="field-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="IELTS Speaking — B2" />
          </Field>
          <Field label="Fan">
            <input className="field-input" required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ingliz tili" />
          </Field>
          <Field label="Jadval">
            <input className="field-input" value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="Du/Chor/Juma, 14:00" />
          </Field>
          <Field label="Oylik narx (so'm)">
            <input className="field-input" type="number" min={0} value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} placeholder="500000" />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? "Saqlanmoqda..." : "Guruhni yaratish"}
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

export default function GroupsPage() {
  return (
    <DashboardShell>
      <GroupsContent />
    </DashboardShell>
  );
}
