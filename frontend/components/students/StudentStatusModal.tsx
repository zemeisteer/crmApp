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
  ACTIVE: { color: "var(--success)", background: "var(--success-soft)" },
  PAUSED: { color: "var(--warning)", background: "var(--warning-soft)" },
  GRADUATED: { color: "var(--primary)", background: "var(--primary-soft)" },
  LEFT: { color: "var(--text-muted)", background: "var(--surface-muted)" },
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
              <button key={s.id} type="button" onClick={() => setStatus(s.id)} aria-pressed={on} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px", borderRadius: "var(--radius-md)", border: `1.5px solid ${on ? "var(--primary)" : "var(--border)"}`, background: on ? "var(--primary-soft)" : "var(--surface)", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "var(--text)", textAlign: "left" }}>
                <span aria-hidden>{s.icon}</span>
                {t(`stStatus.${s.id}` as TranslationKey)}
              </button>
            );
          })}
        </div>

        {status === "LEFT" && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 8 }}>{t("stStatus.why")} *</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LEFT_REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r} style={{ padding: "8px 12px", borderRadius: "var(--radius-pill)", border: `1.5px solid ${reason === r ? "var(--primary)" : "var(--border)"}`, background: reason === r ? "var(--primary)" : "var(--surface)", color: reason === r ? "var(--on-ink)" : "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  {t(`left.${r}` as TranslationKey)}
                </button>
              ))}
            </div>
          </div>
        )}

        {(status === "LEFT" || status === "GRADUATED") && (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "10px 12px", lineHeight: 1.5 }}>{t("stStatus.leaveHint")}</div>
        )}
        {error && <div role="alert" style={{ fontSize: 13, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={onClose} style={{ background: "var(--surface-muted)", color: "var(--text-soft)", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: "var(--radius-sm)" }}>{t("common.cancel")}</button>
          <button type="button" className="btn" onClick={save} disabled={busy} style={{ background: "var(--primary)", color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 18px", borderRadius: "var(--radius-sm)", opacity: busy ? 0.7 : 1 }}>{t("common.save")}</button>
        </div>
      </div>
    </Modal>
  );
}
