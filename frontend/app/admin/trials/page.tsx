"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import { ApiError, platformApi, type TrialPurgeRow, type TrialPurgeState } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 10px", borderBottom: "1px solid var(--border)" };
const td: React.CSSProperties = { fontSize: 13, padding: "10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" };

// Red: it will go, or a notice failed; amber: on its way; grey: nothing will happen.
const TONE: Record<TrialPurgeState, { bg: string; fg: string }> = {
  DELETED: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  WOULD_DELETE: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  FIRST_NOTICE_FAILED: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  FINAL_NOTICE_FAILED: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  WAITING: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  WAITING_FOR_FINAL: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  FIRST_NOTICE_PENDING: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  FINAL_NOTICE_PENDING: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  NO_RECIPIENT: { bg: "var(--surface-muted)", fg: "var(--text-soft)" },
  TRIAL_CHANGED: { bg: "var(--surface-muted)", fg: "var(--text-soft)" },
  KEPT: { bg: "var(--success-soft)", fg: "var(--success)" },
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function PurgePreview() {
  const { t } = useLanguage();
  const [data, setData] = useState<{ purgeEnabled: boolean; report: TrialPurgeRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    setData(null);
    platformApi.trialPurgePreview().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : ""));
  }
  useEffect(load, []);

  return (
    <section style={card} aria-labelledby="purge-title">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <h2 id="purge-title" style={{ fontSize: 16, fontWeight: 800 }}>{t("pf.tr.previewTitle")}</h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.55 }}>{t("pf.tr.previewHint")}</div>
        </div>
        <button type="button" className="btn" onClick={load} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          {t("pf.tr.refresh")}
        </button>
      </div>
      {error !== null ? (
        <LoadError message={error || t("adm.loadError")} onRetry={load} compact />
      ) : !data ? (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
      ) : (
        <>
          <div role="status" style={{ fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 12, background: data.purgeEnabled ? "var(--danger-soft)" : "var(--primary-soft)", color: data.purgeEnabled ? "var(--danger)" : "var(--primary)" }}>
            {data.purgeEnabled ? t("pf.tr.purgeOn") : t("pf.tr.purgeOff")}
          </div>
          {data.report.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{t("pf.tr.none")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={th}>{t("pf.tr.center")}</th>
                    <th style={th}>{t("pf.tr.trialEnd")}</th>
                    <th style={th}>{t("pf.tr.date")}</th>
                    <th style={th}>{t("pf.tr.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.report.map((r) => (
                    <tr key={r.tenantId}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.subdomain}</div>
                      </td>
                      <td style={td}>{day(r.trialEndsAt)}</td>
                      <td style={td}>{day(r.purgeOn)}</td>
                      <td style={td}>
                        <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: TONE[r.state].bg, color: TONE[r.state].fg }}>
                          {t(`pf.tr.s.${r.state}` as TranslationKey)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReleaseClaim() {
  const { t } = useLanguage();
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await platformApi.releaseTrialClaim(phone.trim(), reason.trim());
      setDone(true);
      setPhone("");
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const ready = phone.trim().length >= 9 && reason.trim().length >= 10 && !busy;
  return (
    <section style={card} aria-labelledby="claim-title">
      <h2 id="claim-title" style={{ fontSize: 16, fontWeight: 800 }}>{t("pf.tr.claimTitle")}</h2>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, marginBottom: 14, lineHeight: 1.55 }}>{t("pf.tr.claimHint")}</div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)" }}>
          {t("pf.tr.phone")}
          <input className="field-input" type="tel" inputMode="tel" autoComplete="off" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)" }}>
          {t("pf.tr.reason")}
          <textarea className="field-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ resize: "vertical" }} />
        </label>
        {error && <div role="alert" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)" }}>{error}</div>}
        {done && <div role="status" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--success-soft)", color: "var(--success)" }}>{t("pf.tr.released")}</div>}
        <div>
          <button type="submit" className="btn" disabled={!ready} style={{ background: ready ? ACCENT : "var(--text-faint)", color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed" }}>
            {busy ? t("common.loading") : t("pf.tr.release")}
          </button>
        </div>
      </form>
    </section>
  );
}

function UncertainSms() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Array<{ id: string; name: string; subdomain: string; attempts: number; at: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    platformApi.smsUncertain().then(setRows).catch((e) => setError(e instanceof ApiError ? e.message : ""));
  }
  useEffect(load, []);

  return (
    <section style={card} aria-labelledby="sms-title">
      <h2 id="sms-title" style={{ fontSize: 16, fontWeight: 800 }}>{t("pf.tr.smsTitle")}</h2>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, marginBottom: 12, lineHeight: 1.55 }}>{t("pf.tr.smsHint")}</div>
      {error !== null ? (
        <LoadError message={error || t("adm.loadError")} onRetry={load} compact />
      ) : !rows ? (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{t("pf.tr.smsNone")}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
            <thead>
              <tr>
                <th style={th}>{t("pf.tr.center")}</th>
                <th style={th}>{t("pf.tr.when")}</th>
                <th style={th}>{t("pf.tr.attempts")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.subdomain}</div>
                  </td>
                  <td style={td}>{r.at.slice(0, 16).replace("T", " ")}</td>
                  <td style={td}>{r.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RenewalPreview() {
  const { t } = useLanguage();
  const [data, setData] = useState<Awaited<ReturnType<typeof platformApi.billingPreview>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    platformApi.billingPreview().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : ""));
  }
  useEffect(load, []);

  return (
    <section style={card} aria-labelledby="renewal-title">
      <h2 id="renewal-title" style={{ fontSize: 16, fontWeight: 800 }}>{t("pf.tr.renewalTitle")}</h2>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, marginBottom: 12, lineHeight: 1.55 }}>{t("pf.tr.renewalHint")}</div>
      {error !== null ? (
        <LoadError message={error || t("adm.loadError")} onRetry={load} compact />
      ) : !data ? (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
      ) : (
        <>
          <div role="status" style={{ fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 12, background: data.enforce ? "var(--danger-soft)" : "var(--primary-soft)", color: data.enforce ? "var(--danger)" : "var(--primary)" }}>
            {data.enforce ? t("pf.tr.enforceOn") : t("pf.tr.enforceOff")}
          </div>
          {data.report.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{t("pf.tr.renewalNone")}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                <thead>
                  <tr>
                    <th style={th}>{t("pf.tr.center")}</th>
                    <th style={th}>{t("pf.tr.paidUntil")}</th>
                    <th style={th}>{t("pf.tr.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.report.map((r) => (
                    <tr key={r.tenantId}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.subdomain}</div>
                      </td>
                      <td style={td}>{day(r.paidUntil)}</td>
                      <td style={td}>
                        <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: r.to === "SUSPENDED" ? "var(--danger-soft)" : "var(--warning-soft)", color: r.to === "SUSPENDED" ? "var(--danger)" : "var(--warning)" }}>
                          {t(r.to === "SUSPENDED" ? "pf.tr.toSuspended" : "pf.tr.toPastDue")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TrialsContent() {
  const { t } = useLanguage();
  return (
    <>
      <div style={{ padding: "var(--page-head-pad)" }}>
        <h1 className="page-title">{t("nav.trials")}</h1>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("pf.tr.subtitle")}</div>
      </div>
      <div style={{ padding: "var(--page-pad)", display: "flex", flexDirection: "column", gap: 18 }}>
        <RenewalPreview />
        <PurgePreview />
        <ReleaseClaim />
        <UncertainSms />
      </div>
    </>
  );
}

export default function PlatformTrialsPage() {
  return (
    <DashboardShell>
      <TrialsContent />
    </DashboardShell>
  );
}
