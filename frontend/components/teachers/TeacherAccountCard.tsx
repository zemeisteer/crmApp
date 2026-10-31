"use client";

import { useState } from "react";
import { ApiError, teachersApi, type Teacher } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";

// Login for a teacher: the admin sets an email and a first password; the
// teacher then signs in and sees only their own groups, lessons and pay.
export default function TeacherAccountCard({ teacher, onChanged, canManage }: { teacher: Teacher; onChanged: (t: Teacher) => void; canManage: boolean }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState(teacher.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await teachersApi.createAccount(teacher.id, { email: email.trim(), password });
      setDone(email.trim());
      setPassword("");
      onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t("tacc.confirmRemove"))) return;
    setBusy(true);
    try {
      onChanged(await teachersApi.removeAccount(teacher.id));
      setDone(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>🔑 {t("tacc.title")}</div>
      {teacher.userId ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5, color: "var(--text-soft)" }}>
            <span className="badge badge-success" style={{ marginRight: 8 }}>{t("tacc.active")}</span>
            {teacher.user?.email ?? done}
            {done && <div style={{ fontSize: 12.5, color: "var(--success)", marginTop: 6 }}>{t("tacc.shareHint")}</div>}
          </div>
          {canManage && (
            <button type="button" className="btn" disabled={busy} onClick={remove} style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-xs)" }}>
              {t("tacc.remove")}
            </button>
          )}
        </div>
      ) : canManage ? (
        <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{t("tacc.hint")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input className="field-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ustoz@markaz.uz" autoComplete="off" />
            <input className="field-input" type="text" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("tacc.passwordPh")} autoComplete="new-password" />
          </div>
          {error && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: "var(--radius-xs)" }}>{error}</div>}
          <button type="submit" className="btn" disabled={busy} style={{ alignSelf: "flex-start", background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}>
            {busy ? t("common.saving") : t("tacc.create")}
          </button>
        </form>
      ) : (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("tacc.none")}</div>
      )}
    </div>
  );
}
