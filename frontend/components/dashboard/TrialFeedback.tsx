"use client";

import { useState, type FormEvent } from "react";
import { ApiError, leadsApi, type TrialFeedback as Feedback } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

/**
 * The teacher's word on a trial lesson once it has begun: what the newcomer
 * knows, how they took part, which group fits them, anything else. Saving
 * marks a booked trial as attended; the admissions manager reads it on the lead.
 */
export default function TrialFeedback({ trialId, onSaved }: { trialId: string; onSaved: (note: string | null) => void }) {
  const { t } = useLanguage();
  const [f, setF] = useState<Feedback>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await leadsApi.trialFeedback(trialId, {
        level: f.level?.trim() || undefined,
        engagement: f.engagement || undefined,
        recommendation: f.recommendation?.trim() || undefined,
        note: f.note?.trim() || undefined,
      });
      onSaved(saved.outcomeNote ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const label = { display: "grid", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)" } as const;
  return (
    <form onSubmit={submit} data-testid="trial-feedback" style={{ display: "grid", gap: 10, width: "100%", marginTop: 8 }}>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label style={label}>
          {t("th.fbLevel")}
          <input className="field-input" value={f.level ?? ""} onChange={(e) => setF({ ...f, level: e.target.value })} maxLength={60} placeholder={t("th.fbLevelPh")} />
        </label>
        <label style={label}>
          {t("th.fbEngagement")}
          <select className="field-input" value={f.engagement ?? ""} onChange={(e) => setF({ ...f, engagement: (e.target.value || undefined) as Feedback["engagement"] })}>
            <option value="">—</option>
            <option value="ACTIVE">{t("th.fbActive")}</option>
            <option value="AVERAGE">{t("th.fbAverage")}</option>
            <option value="PASSIVE">{t("th.fbPassive")}</option>
          </select>
        </label>
        <label style={label}>
          {t("th.fbRecommend")}
          <input className="field-input" value={f.recommendation ?? ""} onChange={(e) => setF({ ...f, recommendation: e.target.value })} maxLength={200} placeholder={t("th.fbRecommendPh")} />
        </label>
      </div>
      <label style={label}>
        {t("th.fbNote")}
        <textarea className="field-input" rows={3} value={f.note ?? ""} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} placeholder={t("th.fbNotePh")} />
      </label>
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      <button type="submit" className="btn-primary btn-sm" disabled={busy} style={{ justifySelf: "start" }}>
        {busy ? "…" : t("th.fbSave")}
      </button>
    </form>
  );
}
