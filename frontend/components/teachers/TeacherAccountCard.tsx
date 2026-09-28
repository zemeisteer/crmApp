"use client";

import { useState } from "react";
import { ApiError, teachersApi, type Teacher } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

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
    <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>🔑 {t("tacc.title")}</div>
      {teacher.userId ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13.5, color: "#4A4E58" }}>
            <span className="badge badge-success" style={{ marginRight: 8 }}>{t("tacc.active")}</span>
            {teacher.user?.email ?? done}
            {done && <div style={{ fontSize: 12.5, color: "#1FA463", marginTop: 6 }}>{t("tacc.shareHint")}</div>}
          </div>
          {canManage && (
            <button type="button" className="btn" disabled={busy} onClick={remove} style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
              {t("tacc.remove")}
            </button>
          )}
        </div>
      ) : canManage ? (
        <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: "#8A8D96", lineHeight: 1.5 }}>{t("tacc.hint")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input className="field-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ustoz@markaz.uz" autoComplete="off" />
            <input className="field-input" type="text" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("tacc.passwordPh")} autoComplete="new-password" />
          </div>
          {error && <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 8 }}>{error}</div>}
          <button type="submit" className="btn" disabled={busy} style={{ alignSelf: "flex-start", background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}>
            {busy ? t("common.saving") : t("tacc.create")}
          </button>
        </form>
      ) : (
        <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("tacc.none")}</div>
      )}
    </div>
  );
}
