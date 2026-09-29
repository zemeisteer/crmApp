"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { ApiError, studentsApi, type Student } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { LEFT_REASONS } from "@/components/reports/DirectorReport";

type Status = NonNullable<Student["status"]>;
const STATUSES: Array<{ id: Status; icon: string }> = [
  { id: "ACTIVE", icon: "✅" },
  { id: "PAUSED", icon: "⏸️" },
  { id: "GRADUATED", icon: "🎓" },
  { id: "LEFT", icon: "🚪" },
];

export const STATUS_STYLE: Record<Status, { color: string; background: string }> = {
  ACTIVE: { color: "#1FA463", background: "#E9F8EF" },
  PAUSED: { color: "#B45309", background: "#FEF3C7" },
  GRADUATED: { color: "#4F46E5", background: "#EEF0FF" },
  LEFT: { color: "#6B6E78", background: "#F2F1EC" },
};

// Student status: studying, paused, finished, or left (with why) - leaving
// is recorded instead of deleting, so history and reports keep them.
export default function StudentStatusModal({ student, open, onClose, onSaved }: { student: Student; open: boolean; onClose: () => void; onSaved: (s: Student) => void }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>(student.status ?? "ACTIVE");
  const [reason, setReason] = useState<string>(student.leftReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(student.status ?? "ACTIVE");
    setReason(student.leftReason ?? "");
    setError(null);
  }, [open, student]);

  async function save() {
    if (status === "LEFT" && !reason) {
      setError(t("stStatus.reasonRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await studentsApi.update(student.id, { status, ...(status === "LEFT" ? { leftReason: reason } : {}) });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("stStatus.title")}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          {STATUSES.map((s) => {
            const on = status === s.id;
            return (
              <button key={s.id} type="button" onClick={() => setStatus(s.id)} aria-pressed={on} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px", borderRadius: 12, border: `1.5px solid ${on ? "#4F46E5" : "#EAE8E2"}`, background: on ? "#EEF0FF" : "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#181A1F", textAlign: "left" }}>
                <span aria-hidden>{s.icon}</span>
                {t(`stStatus.${s.id}` as TranslationKey)}
              </button>
            );
          })}
        </div>

        {status === "LEFT" && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#4A4E58", marginBottom: 8 }}>{t("stStatus.why")} *</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LEFT_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} style={{ padding: "8px 12px", borderRadius: 100, border: `1.5px solid ${reason === r ? "#4F46E5" : "#EAE8E2"}`, background: reason === r ? "#4F46E5" : "#fff", color: reason === r ? "#fff" : "#181A1F", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  {t(`left.${r}` as TranslationKey)}
                </button>
              ))}
            </div>
          </div>
        )}

        {(status === "LEFT" || status === "GRADUATED") && (
          <div style={{ fontSize: 12.5, color: "#6B6E78", background: "#F7F6F2", borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>{t("stStatus.leaveHint")}</div>
        )}
        {error && <div role="alert" style={{ fontSize: 13, color: "#B91C1C", background: "#FEE2E2", borderRadius: 10, padding: "8px 12px" }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} style={{ background: "#F2F1EC", color: "#4A4E58", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 10 }}>{t("common.cancel")}</button>
          <button type="button" className="btn" onClick={save} disabled={busy} style={{ background: "#4F46E5", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 18px", borderRadius: 10, opacity: busy ? 0.7 : 1 }}>{t("common.save")}</button>
        </div>
      </div>
    </Modal>
  );
}
