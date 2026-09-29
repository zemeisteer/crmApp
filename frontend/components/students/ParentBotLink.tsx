"use client";

import { useState } from "react";
import { ApiError, telegramApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

// A one-time link for a parent's Telegram: the parent gets the child's
// schedule, attendance, payments and grades, and absence / payment notices.
// The child's own link is not affected; a parent can link several children.
export default function ParentBotLink({ studentId }: { studentId: string }) {
  const { t } = useLanguage();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await telegramApi.generateLinkToken(studentId, "PARENT");
      setLink(res.linkUrl);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "#4A4E58" }}>👨‍👩‍👧 {t("pbot.title")}</span>
        <button type="button" className="btn" onClick={create} disabled={busy} style={{ background: "#FDF2F8", color: "#9D174D", border: "1px solid #FBCFE8", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}>
          {busy ? t("std.creating") : t("pbot.create")}
        </button>
      </div>
      {link && (
        <div style={{ marginTop: 8, background: "#FFF7FB", border: "1px solid #FBCFE8", borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 12, color: "#4A4E58", marginBottom: 6 }}>{t("pbot.intro")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ flex: 1, background: "#fff", padding: "8px 10px", borderRadius: 8, fontSize: 11.5, wordBreak: "break-all", border: "1px solid #EAE8E2" }}>{link}</code>
            <button
              type="button"
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }}
              style={{ background: copied ? "#1FA463" : ACCENT, color: "#fff", border: "none", fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 8, whiteSpace: "nowrap" }}
            >
              {copied ? `✓ ${t("pbot.copied")}` : t("pbot.copy")}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#8A8D96", marginTop: 6 }}>{t("std.linkExpiry")}</div>
        </div>
      )}
      {error && <div role="alert" style={{ marginTop: 6, fontSize: 12, color: "#B91C1C" }}>{error}</div>}
    </div>
  );
}
