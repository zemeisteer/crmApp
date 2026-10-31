"use client";

import { useEffect, useState } from "react";
import { ApiError, billingApi, type PaymentAccounts as Accounts, type PaymentProvider } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import CardSettings from "./CardSettings";

const ACCENT = "var(--primary)";
const code: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 12, background: "var(--surface-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", padding: "2px 6px", wordBreak: "break-all" };

/**
 * The center's own Click / Payme merchant accounts: students pay the center
 * directly. The secret is typed here once; it is never shown back.
 */
export default function PaymentAccounts() {
  const { t } = useLanguage();
  const [data, setData] = useState<Accounts | null>(null);
  const [editing, setEditing] = useState<PaymentProvider | null>(null);

  useEffect(() => {
    billingApi.accounts().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return null;
  return (
    <div data-testid="payment-accounts" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{t("pacc.hint")}</div>
      {(["CLICK", "PAYME"] as const).map((p) => {
        const acc = p === "CLICK" ? data.click : data.payme;
        const fallback = p === "CLICK" ? data.platformFallback.click : data.platformFallback.payme;
        return (
          <div key={p} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <b>{p === "CLICK" ? "Click" : "Payme"}</b>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {acc.connected ? `Merchant ID: ${acc.merchantId}${acc.serviceId ? ` · Service ID: ${acc.serviceId}` : ""}` : fallback ? t("pacc.viaPlatform") : t("pacc.notConnected")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: acc.connected ? "var(--success-soft)" : "var(--surface-muted)", color: acc.connected ? "var(--success)" : "var(--text-muted)" }}>
                  {acc.connected ? t("pacc.connected") : t("pacc.off")}
                </span>
                {editing !== p && (
                  <button type="button" className="btn" onClick={() => setEditing(p)} style={{ background: acc.connected ? "var(--surface-muted)" : ACCENT, color: acc.connected ? "var(--text)" : "var(--on-ink)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: "var(--radius-xs)" }}>
                    {acc.connected ? t("pacc.edit") : t("pacc.connect")}
                  </button>
                )}
              </div>
            </div>
            {editing === p && (
              <AccountForm
                provider={p}
                initial={acc}
                canStore={data.canStore}
                onCancel={() => setEditing(null)}
                onSaved={(next) => {
                  setData(next);
                  setEditing(null);
                }}
              />
            )}
            {acc.connected && (
              <div style={{ fontSize: 12, color: "var(--text-soft)", lineHeight: 1.7 }}>
                {t("pacc.webhook")} <span style={code}>{acc.webhookUrl}</span>
              </div>
            )}
          </div>
        );
      })}
      <CardSettings />
      <div style={{ fontSize: 12.5, color: "var(--text-soft)", background: "var(--primary-soft)", border: "1px solid var(--primary-border)", borderRadius: "var(--radius-sm)", padding: "10px 14px", lineHeight: 1.6 }}>
        💡 {t("pacc.noYatt2")}
      </div>
    </div>
  );
}

function AccountForm({
  provider,
  initial,
  canStore,
  onCancel,
  onSaved,
}: {
  provider: PaymentProvider;
  initial: Accounts["click"];
  canStore: boolean;
  onCancel: () => void;
  onSaved: (next: Accounts) => void;
}) {
  const { t } = useLanguage();
  const [merchantId, setMerchantId] = useState(initial.merchantId ?? "");
  const [serviceId, setServiceId] = useState(initial.serviceId ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Accounts>) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await action());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (!canStore) return <div role="note" style={{ fontSize: 12.5, color: "var(--warning)" }}>{t("pacc.cannotStore")}</div>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => billingApi.saveAccount(provider, { merchantId, serviceId: provider === "CLICK" ? serviceId : undefined, secret: secret || undefined }));
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <label style={{ fontSize: 12.5, fontWeight: 600 }}>
        Merchant ID
        <input className="field-input" required value={merchantId} onChange={(e) => setMerchantId(e.target.value)} autoComplete="off" />
      </label>
      {provider === "CLICK" && (
        <label style={{ fontSize: 12.5, fontWeight: 600 }}>
          Service ID
          <input className="field-input" required value={serviceId} onChange={(e) => setServiceId(e.target.value)} autoComplete="off" />
        </label>
      )}
      <label style={{ fontSize: 12.5, fontWeight: 600 }}>
        {provider === "CLICK" ? "Secret key" : t("pacc.paymeKey")}
        <input
          className="field-input"
          type="password"
          required={!initial.connected}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
          placeholder={initial.connected ? t("pacc.keepSecret") : ""}
        />
      </label>
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="submit" disabled={busy} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        <button type="button" className="btn" onClick={onCancel} style={{ background: "transparent", color: "var(--text-soft)", fontSize: 13, fontWeight: 600, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}>
          {t("common.cancel")}
        </button>
        {initial.connected && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("pacc.confirmRemove"))) void run(() => billingApi.removeAccount(provider));
            }}
            style={{ background: "var(--danger-soft)", color: "var(--danger)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)", marginLeft: "auto" }}
          >
            {t("pacc.remove")}
          </button>
        )}
      </div>
    </form>
  );
}
