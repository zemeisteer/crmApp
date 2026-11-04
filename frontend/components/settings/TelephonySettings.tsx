"use client";

import { useEffect, useState } from "react";
import { ApiError, staffApi, telephonyApi, type StaffMember, type TelephonyProviderName, type TelephonySettings as Settings } from "@/lib/api";
import { formatDateTime } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";
import Badge from "@/components/ui/Badge";
import { resetCallsMe } from "@/components/telephony/useCallsMe";

const code: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 12, background: "var(--surface-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", padding: "2px 6px", wordBreak: "break-all" };
const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)", display: "grid", gap: 6 };
const box: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 14, display: "grid", gap: 12 };

/**
 * The center's own IP-telephony account (Zadarma first): its keys, the
 * address to paste into the provider's cabinet, who answers which extension,
 * and who sees what. The secret is typed here once and never shown back.
 */
export default function TelephonySettings() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Settings | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<TelephonyProviderName>("ZADARMA");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [rows, setRows] = useState<Array<{ extension: string; userId: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    telephonyApi.settings().then((s) => {
      setData(s);
      setRows(s.extensions.map((e) => ({ extension: e.extension, userId: e.userId })));
      if (s.provider) setProvider(s.provider);
      if (!s.connected) setEditing(true);
    }).catch(() => setData(null));
    staffApi.list().then(setStaff).catch(() => setStaff([]));
  }, []);

  if (!data) return null;

  const run = async (fn: () => Promise<Settings | void>, okText?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await fn();
      if (next) {
        setData(next);
        setRows(next.extensions.map((e) => ({ extension: e.extension, userId: e.userId })));
      }
      resetCallsMe();
      if (okText) setMsg({ tone: "ok", text: okText });
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof ApiError ? e.message : t("tel.saveFailed") });
    } finally {
      setBusy(false);
    }
  };

  const saveKeys = () =>
    run(async () => {
      const next = await telephonyApi.save({ provider, apiKey: apiKey.trim(), apiSecret: apiSecret.trim() || undefined });
      setEditing(false);
      setApiSecret("");
      return next;
    }, t("tel.saved"));

  const savePolicy = (patch: Partial<Pick<Settings, "enabled" | "callsVisibility" | "recordingsAccess">>) =>
    run(() => telephonyApi.policy(patch));

  return (
    <div data-testid="telephony-settings" style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{t("tel.settingsHint")}</div>

      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <b>{data.provider === "MOCK" ? t("tel.providerMock") : "Zadarma"}</b>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {data.connected ? `API key ${data.apiKeyHint}` : t("tel.notConnected")}
              {data.lastEventAt ? ` · ${t("tel.lastEvent")}: ${formatDateTime(data.lastEventAt, lang)}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge tone={data.connected && data.enabled ? "success" : "neutral"}>{data.connected ? (data.enabled ? t("tel.on") : t("tel.paused")) : t("tel.off")}</Badge>
            {data.connected && !editing && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => {
                  const r = await telephonyApi.test();
                  setMsg({ tone: r.ok ? "ok" : "err", text: r.ok ? t("tel.testOk") : r.message ?? t("tel.testFailed") });
                })}>{t("tel.test")}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>{t("tel.changeKeys")}</button>
              </>
            )}
          </div>
        </div>

        {!data.canStore && <div role="alert" style={{ fontSize: 12.5, color: "var(--danger)" }}>{t("tel.cannotStore")}</div>}

        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveKeys();
            }}
            style={{ display: "grid", gap: 10 }}
          >
            {data.mockAllowed && (
              <label style={label}>
                {t("tel.provider")}
                <select className="field-input" value={provider} onChange={(e) => setProvider(e.target.value as TelephonyProviderName)}>
                  <option value="ZADARMA">Zadarma</option>
                  <option value="MOCK">{t("tel.providerMock")}</option>
                </select>
              </label>
            )}
            <label style={label}>
              API key
              <input className="field-input" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder={data.apiKeyHint ?? ""} />
            </label>
            <label style={label}>
              API secret
              <input className="field-input" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="new-password" required={!data.connected || data.provider !== provider} placeholder={data.connected ? t("tel.secretKeep") : ""} />
            </label>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{t("tel.keysWhere")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !data.canStore}>{t("common.save")}</button>
              {data.connected && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t("common.cancel")}</button>}
            </div>
          </form>
        )}

        {data.connected && data.webhookUrl && (
          <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.7, display: "grid", gap: 6 }}>
            <div>{t("tel.webhookHint")}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={code} data-testid="telephony-webhook-url">{data.webhookUrl}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard?.writeText(data.webhookUrl!).then(() => setMsg({ tone: "ok", text: t("tel.copied") }), () => undefined)}>{t("tel.copy")}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
                if (window.confirm(t("tel.rotateConfirm"))) void run(() => telephonyApi.rotateToken(), t("tel.rotated"));
              }}>{t("tel.rotate")}</button>
            </div>
          </div>
        )}
        {msg && <div role={msg.tone === "err" ? "alert" : "status"} style={{ fontSize: 12.5, color: msg.tone === "err" ? "var(--danger)" : "var(--success)" }}>{msg.text}</div>}
      </div>

      {data.connected && (
        <>
          <div style={box}>
            <b style={{ fontSize: 14 }}>{t("tel.extensionsTitle")}</b>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("tel.extensionsHint")}</div>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 8, alignItems: "center" }}>
                <input className="field-input" inputMode="numeric" aria-label={t("tel.extension")} value={r.extension} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, extension: e.target.value.replace(/\D/g, "") } : x)))} placeholder="100" />
                <select className="field-input" aria-label={t("tel.staffMember")} value={r.userId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))}>
                  <option value="">{t("tel.chooseStaff")}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={t("common.delete")} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, { extension: "", userId: "" }])}>+ {t("tel.addExtension")}</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || rows.some((r) => !r.extension || !r.userId)} onClick={() => run(() => telephonyApi.setExtensions(rows), t("tel.saved"))}>{t("common.save")}</button>
            </div>
          </div>

          <div style={box}>
            <b style={{ fontSize: 14 }}>{t("tel.policyTitle")}</b>
            <label style={label}>
              {t("tel.visibility")}
              <select className="field-input" value={data.callsVisibility} disabled={busy} onChange={(e) => void savePolicy({ callsVisibility: e.target.value as "OWN" | "ALL" })}>
                <option value="OWN">{t("tel.visibilityOwn")}</option>
                <option value="ALL">{t("tel.visibilityAll")}</option>
              </select>
            </label>
            <label style={label}>
              {t("tel.recordings")}
              <select className="field-input" value={data.recordingsAccess} disabled={busy} onChange={(e) => void savePolicy({ recordingsAccess: e.target.value as "ADMINS" | "CALL_VIEWERS" })}>
                <option value="ADMINS">{t("tel.recordingsAdmins")}</option>
                <option value="CALL_VIEWERS">{t("tel.recordingsViewers")}</option>
              </select>
            </label>
            <label style={{ ...label, display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={data.enabled} disabled={busy} onChange={(e) => void savePolicy({ enabled: e.target.checked })} />
              {t("tel.enabled")}
            </label>
            <div>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => {
                if (window.confirm(t("tel.disconnectConfirm"))) void run(async () => {
                  const next = await telephonyApi.remove();
                  setEditing(true);
                  return next;
                });
              }}>{t("tel.disconnect")}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
