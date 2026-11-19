"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { ApiError, authApi } from "@/lib/api";

// The signed-in person's own account: name and password. The e-mail and phone
// identify the person elsewhere and are shown, not edited here.
function ProfileContent() {
  const { t } = useLanguage();
  const { user, tenant, refreshMe } = useAuth();
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  useEffect(() => {
    setFullName(user?.fullName ?? "");
  }, [user?.fullName]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(null);
    setError(null);
    try {
      await authApi.updateProfile({ fullName: fullName.trim() });
      await refreshMe();
      setSaved(t("common.saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setPwError(null);
    if (next !== repeat) {
      setPwError(t("profile.pwMismatch"));
      return;
    }
    setPwBusy(true);
    try {
      const res = await authApi.changePassword({ currentPassword: current, newPassword: next, code: code.trim() || undefined });
      setPwMsg(res.message);
      setCurrent("");
      setNext("");
      setRepeat("");
      setCode("");
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setPwBusy(false);
    }
  }

  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 22, maxWidth: 640, width: "100%", boxSizing: "border-box" } as const;
  const label = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-soft)", margin: "0 0 6px" } as const;
  const row = { marginBottom: 14 } as const;
  const initials =
    (user?.fullName ?? "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";
  const roleKey = user?.role ? (`profile.role.${user.role}` as TranslationKey) : null;

  return (
    <>
      <div style={{ padding: "var(--page-head-pad)" }}>
        <h1 className="page-title">{t("profile.title")}</h1>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("profile.subtitle")}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "var(--page-pad)", display: "flex", flexDirection: "column", gap: 16, overflow: "auto", boxSizing: "border-box" }}>
        <section style={card} aria-labelledby="pf-me">
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <div className="app-avatar" aria-hidden="true">
              <span>{initials}</span>
            </div>
            <div>
              <h2 id="pf-me" style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{user?.fullName}</h2>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {roleKey ? t(roleKey) : ""}
                {tenant?.name ? ` · ${tenant.name}` : ""}
              </div>
            </div>
          </div>
          <form onSubmit={onSave}>
            <div style={row}>
              <label style={label} htmlFor="pf-name">{t("profile.fullName")}</label>
              <input id="pf-name" className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
            </div>
            {user?.phone && (
              <div style={row}>
                <label style={label} htmlFor="pf-phone">{t("profile.phone")}</label>
                <input id="pf-phone" className="field-input" value={user.phone} readOnly disabled />
              </div>
            )}
            <div style={row}>
              <label style={label} htmlFor="pf-email">{t("profile.email")}</label>
              <input id="pf-email" className="field-input" value={user?.email ?? ""} readOnly disabled />
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t("profile.emailNote")}</div>
            </div>
            {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
            {saved && <div role="status" style={{ color: "var(--success)", fontSize: 13, marginBottom: 10 }}>{saved}</div>}
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "…" : t("common.save")}</button>
          </form>
        </section>

        <section style={card} aria-labelledby="pf-pw">
          <h2 id="pf-pw" style={{ fontSize: 17, fontWeight: 800, margin: "0 0 14px" }}>{t("profile.pwTitle")}</h2>
          <form onSubmit={onChangePassword}>
            <div style={row}>
              <label style={label} htmlFor="pf-cur">{t("profile.pwCurrent")}</label>
              <input id="pf-cur" className="field-input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            </div>
            <div style={row}>
              <label style={label} htmlFor="pf-new">{t("profile.pwNew")}</label>
              <input id="pf-new" className="field-input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} autoComplete="new-password" />
            </div>
            <div style={row}>
              <label style={label} htmlFor="pf-rep">{t("profile.pwRepeat")}</label>
              <input id="pf-rep" className="field-input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={6} autoComplete="new-password" />
            </div>
            {user?.twoFactorEnabled && (
              <div style={row}>
                <label style={label} htmlFor="pf-code">{t("profile.pwCode")}</label>
                <input id="pf-code" className="field-input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
              </div>
            )}
            {pwError && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{pwError}</div>}
            {pwMsg && <div role="status" style={{ color: "var(--success)", fontSize: 13, marginBottom: 10 }}>{pwMsg}</div>}
            <button type="submit" className="btn btn-primary" disabled={pwBusy}>{pwBusy ? "…" : t("profile.pwSubmit")}</button>
          </form>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 14 }}>
            {t("profile.securityHint")}{" "}
            <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600 }}>
              {t("nav.settings")} → {t("settings.tabSecurity")}
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

export default function ProfilePage() {
  return (
    <DashboardShell>
      <ProfileContent />
    </DashboardShell>
  );
}
