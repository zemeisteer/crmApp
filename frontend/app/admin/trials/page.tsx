"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import { ApiError, platformApi, type TrialPurgeRow, type TrialPurgeState } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 18 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11.5, fontWeight: 700, color: "#686B75", textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 10px", borderBottom: "1px solid #EAE8E2" };
const td: React.CSSProperties = { fontSize: 13, padding: "10px", borderBottom: "1px solid #F2F1EC", verticalAlign: "top" };

// Red: it will go, or a notice failed; amber: on its way; grey: nothing will happen.
const TONE: Record<TrialPurgeState, { bg: string; fg: string }> = {
  DELETED: { bg: "#FDEBEC", fg: "#B23A47" },
  WOULD_DELETE: { bg: "#FDEBEC", fg: "#B23A47" },
  FIRST_NOTICE_FAILED: { bg: "#FDEBEC", fg: "#B23A47" },
  FINAL_NOTICE_FAILED: { bg: "#FDEBEC", fg: "#B23A47" },
  WAITING: { bg: "#FFF7E6", fg: "#8A5A00" },
  WAITING_FOR_FINAL: { bg: "#FFF7E6", fg: "#8A5A00" },
  FIRST_NOTICE_PENDING: { bg: "#FFF7E6", fg: "#8A5A00" },
  FINAL_NOTICE_PENDING: { bg: "#FFF7E6", fg: "#8A5A00" },
  NO_RECIPIENT: { bg: "#F2F1EC", fg: "#4A4E58" },
  TRIAL_CHANGED: { bg: "#F2F1EC", fg: "#4A4E58" },
  KEPT: { bg: "#E9F8EF", fg: "#16794A" },
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
          <div style={{ fontSize: 13, color: "#686B75", marginTop: 4, lineHeight: 1.55 }}>{t("pf.tr.previewHint")}</div>
        </div>
        <button type="button" className="btn" onClick={load} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          {t("pf.tr.refresh")}
        </button>
      </div>
      {error !== null ? (
        <LoadError message={error || t("adm.loadError")} onRetry={load} compact />
      ) : !data ? (
        <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
      ) : (
        <>
          <div role="status" style={{ fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 12, background: data.purgeEnabled ? "#FDEBEC" : "#EEF0FF", color: data.purgeEnabled ? "#B23A47" : "#33357A" }}>
            {data.purgeEnabled ? t("pf.tr.purgeOn") : t("pf.tr.purgeOff")}
          </div>
          {data.report.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "#686B75" }}>{t("pf.tr.none")}</div>
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
                        <div style={{ fontSize: 12, color: "#686B75" }}>{r.subdomain}</div>
                      </td>
                      <td style={td}>{day(r.trialEndsAt)}</td>
                      <td style={td}>{day(r.purgeOn)}</td>
                      <td style={td}>
                        <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: TONE[r.state].bg, color: TONE[r.state].fg }}>
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
      <div style={{ fontSize: 13, color: "#686B75", marginTop: 4, marginBottom: 14, lineHeight: 1.55 }}>{t("pf.tr.claimHint")}</div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: "#4A4E58" }}>
          {t("pf.tr.phone")}
          <input className="field-input" type="tel" inputMode="tel" autoComplete="off" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 700, color: "#4A4E58" }}>
          {t("pf.tr.reason")}
          <textarea className="field-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ resize: "vertical" }} />
        </label>
        {error && <div role="alert" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 10, background: "#FDEBEC", color: "#B23A47" }}>{error}</div>}
        {done && <div role="status" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 10, background: "#E9F8EF", color: "#16794A" }}>{t("pf.tr.released")}</div>}
        <div>
          <button type="submit" className="btn" disabled={!ready} style={{ background: ready ? ACCENT : "#A9ABB3", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: ready ? "pointer" : "not-allowed" }}>
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
      <div style={{ fontSize: 13, color: "#686B75", marginTop: 4, marginBottom: 12, lineHeight: 1.55 }}>{t("pf.tr.smsHint")}</div>
      {error !== null ? (
        <LoadError message={error || t("adm.loadError")} onRetry={load} compact />
      ) : !rows ? (
        <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13.5, color: "#686B75" }}>{t("pf.tr.smsNone")}</div>
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
                    <div style={{ fontSize: 12, color: "#686B75" }}>{r.subdomain}</div>
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
      <div style={{ fontSize: 13, color: "#686B75", marginTop: 4, marginBottom: 12, lineHeight: 1.55 }}>{t("pf.tr.renewalHint")}</div>
      {error !== null ? (
        <LoadError message={error || t("adm.loadError")} onRetry={load} compact />
      ) : !data ? (
        <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
      ) : (
        <>
          <div role="status" style={{ fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 12, background: data.enforce ? "#FDEBEC" : "#EEF0FF", color: data.enforce ? "#B23A47" : "#33357A" }}>
            {data.enforce ? t("pf.tr.enforceOn") : t("pf.tr.enforceOff")}
          </div>
          {data.report.length === 0 ? (
            <div style={{ fontSize: 13.5, color: "#686B75" }}>{t("pf.tr.renewalNone")}</div>
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
                        <div style={{ fontSize: 12, color: "#686B75" }}>{r.subdomain}</div>
                      </td>
                      <td style={td}>{day(r.paidUntil)}</td>
                      <td style={td}>
                        <span style={{ display: "inline-block", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: r.to === "SUSPENDED" ? "#FDEBEC" : "#FFF7E6", color: r.to === "SUSPENDED" ? "#B23A47" : "#8A5A00" }}>
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
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("nav.trials")}</h1>
        <div style={{ fontSize: 13, color: "#686B75", marginTop: 2 }}>{t("pf.tr.subtitle")}</div>
      </div>
      <div style={{ padding: "22px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
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
