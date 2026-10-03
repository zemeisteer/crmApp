"use client";

import { useEffect, useState } from "react";
import { ApiError, studentsApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";
import { useAuth } from "@/lib/auth-context";
import { centerPortalUrl } from "@/lib/domain";

const ACCENT = "#4F46E5";

// Issues the PIN a student/parent uses (with their phone) to sign in to the
// portal. The PIN is shown once; issuing again replaces it.
export default function StudentPortalPin({ studentId, hasPhone }: { studentId: string; hasPhone: boolean }) {
  const { t, lang } = useLanguage();
  const { tenant } = useAuth();
  const portalUrl = tenant?.subdomain ? centerPortalUrl(tenant.subdomain) : null;
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ hasPin: boolean; updatedAt: string | null } | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    studentsApi.portalPinStatus(studentId).then(setStatus).catch(() => setStatus(null));
  }, [studentId]);

  async function issue() {
    if (status?.hasPin && !window.confirm(t("spin.reissueWarn"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await studentsApi.issuePortalPin(studentId);
      setPin(res.pin);
      setStatus({ hasPin: true, updatedAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("spin.title")}</div>
        {status && (
          <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: status.hasPin ? "#E8F7EF" : "#F2F1EC", color: status.hasPin ? "#1FA463" : "#8A8D96" }}>
            {status.hasPin ? `✓ ${t("spin.has")}${status.updatedAt ? ` · ${formatDateTime(status.updatedAt, lang)}` : ""}` : t("spin.none")}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "#4A4E58", margin: "8px 0 12px", lineHeight: 1.5 }}>{t("spin.intro")}</div>
      {portalUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 10px", borderRadius: 10, background: "#F7F6F2", fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ color: "#8A8D96" }}>{t("spin.portalLink")}:</span>
          <a href={portalUrl} target="_blank" rel="noreferrer" style={{ color: ACCENT, fontWeight: 700, wordBreak: "break-all" }}>{portalUrl.replace(/^https?:\/\//, "")}</a>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(portalUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined)}
            style={{ marginLeft: "auto", background: "none", border: "1px solid #EAE8E2", borderRadius: 7, padding: "3px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            {copied ? "✓" : t("placement.copyLink")}
          </button>
        </div>
      )}
      {!hasPhone && <div style={{ fontSize: 12.5, color: "#B45309", background: "#FFFBEB", padding: "8px 10px", borderRadius: 8, marginBottom: 10 }}>{t("spin.noPhone")}</div>}
      {pin && (
        <div style={{ marginBottom: 12, padding: 14, borderRadius: 12, background: "#EEF0FF", border: "1px solid #D7D3F8" }}>
          <div style={{ fontSize: 12.5, color: "#4A4E58", marginBottom: 6 }}>{t("spin.newPin")}</div>
          <div style={{ fontFamily: "'Manrope', monospace", fontWeight: 800, fontSize: 30, letterSpacing: 8, color: ACCENT }}>{pin}</div>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "#B23A47", marginBottom: 10 }}>{error}</div>}
      <button
        type="button"
        onClick={issue}
        disabled={busy}
        className="btn"
        style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9, cursor: "pointer", opacity: busy ? 0.7 : 1 }}
      >
        🔐 {status?.hasPin ? t("spin.reissue") : t("spin.issue")}
      </button>
    </div>
  );
}
