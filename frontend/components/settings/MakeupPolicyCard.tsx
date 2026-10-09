"use client";

import { useState } from "react";
import { ApiError, tenantsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

/**
 * Settings > Profile: how long a make-up credit can be used. Applies to
 * credits issued from now on (an issued credit keeps its date).
 */
export default function MakeupPolicyCard() {
  const { tenant, refreshMe } = useAuth();
  const { t } = useLanguage();
  const current = tenant?.makeupCreditDays ?? null;
  // Untouched fields show the saved policy (null: not edited).
  const [expiresDraft, setExpires] = useState<boolean | null>(null);
  const [daysDraft, setDays] = useState<string | null>(null);
  const expires = expiresDraft ?? current !== null;
  const days = daysDraft ?? String(current ?? 30);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Math.round(Number(days));
  const valid = !expires || (Number.isFinite(n) && n >= 1 && n <= 365);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    if (!valid) {
      setError(t("mk.policyInvalid"));
      return;
    }
    setSaving(true);
    try {
      await tenantsApi.updateMe({ makeupCreditDays: expires ? n : null });
      await refreshMe();
      setExpires(null);
      setDays(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  const radio: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: "#181A1F", cursor: "pointer" };
  return (
    <section aria-labelledby="makeup-policy-title" style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22 }}>
      <h2 id="makeup-policy-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("mk.policyTitle")}</h2>
      <div style={{ fontSize: 12, color: "#686B75", marginTop: 4, marginBottom: 14, lineHeight: 1.5 }}>{t("mk.policyHint")}</div>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
        {saved && <div role="status" style={{ background: "#E9F8EF", color: "#167A48", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{t("common.saved")}</div>}
        <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t("mk.policyTitle")}</legend>
          <label style={radio}>
            <input type="radio" name="makeup-expiry" checked={!expires} onChange={() => { setExpires(false); setSaved(false); }} />
            {t("mk.policyNever")}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={radio}>
              <input type="radio" name="makeup-expiry" checked={expires} onChange={() => { setExpires(true); setSaved(false); }} />
              {t("mk.policyAfter")}
            </label>
            <input
              className="field-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              aria-label={t("mk.policyDays")}
              value={days}
              disabled={!expires}
              onChange={(e) => { setDays(e.target.value); setSaved(false); }}
              style={{ width: 96, opacity: expires ? 1 : 0.5 }}
            />
            <span style={{ fontSize: 13.5, color: "#4A4E58" }}>{t("mk.policyDaysUnit")}</span>
          </div>
        </fieldset>
        <button
          type="submit"
          className="btn"
          disabled={saving}
          style={{ background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: 10, alignSelf: "flex-start", border: "none" }}
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </section>
  );
}
