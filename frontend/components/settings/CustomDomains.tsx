"use client";

import { useEffect, useState } from "react";
import { ApiError, customDomainsApi, planAllows, type CustomDomain } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { ROOT_DOMAIN } from "@/lib/domain";

const ACCENT = "#4F46E5";
const code: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 12, background: "#F4F3EF", border: "1px solid #EAE8E2", borderRadius: 6, padding: "2px 6px", wordBreak: "break-all" };

/** The center's site on its own domain: add, prove with a DNS record, remove. */
export default function CustomDomains() {
  const { t } = useLanguage();
  const { tenant } = useAuth();
  const [list, setList] = useState<CustomDomain[] | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = planAllows(tenant?.entitlements, "CUSTOM_DOMAIN");

  function load() {
    customDomainsApi.list().then(setList).catch(() => setList([]));
  }
  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return <div role="note" style={{ fontSize: 13, color: "#686B75" }}>{t("dom.notInPlan")}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="custom-domains">
      <div style={{ fontSize: 13, color: "#686B75", lineHeight: 1.55 }}>{t("dom.hint").replace("{sub}", tenant ? `${tenant.subdomain}.${ROOT_DOMAIN}` : "")}</div>
      {list?.map((d) => (
        <div key={d.id} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b>{d.domain}</b>
            <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: d.verified ? "#E9F8EF" : "#FFF7E6", color: d.verified ? "#16794A" : "#8A5A00" }}>
              {d.verified ? t("dom.verified") : t("dom.pending")}
            </span>
          </div>
          {!d.verified && (
            <div style={{ fontSize: 12.5, color: "#4A4E58", lineHeight: 1.7 }}>
              {t("dom.addTxt")}
              <div>TXT <span style={code}>{d.txtName}</span> = <span style={code}>{d.txtValue}</span></div>
              {t("dom.pointIt").replace("{sub}", tenant ? `${tenant.subdomain}.${ROOT_DOMAIN}` : "")}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {!d.verified && (
              <button type="button" className="btn" disabled={busy} onClick={() => void run(() => customDomainsApi.verify(d.id))} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                {t("dom.check")}
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => customDomainsApi.remove(d.id))} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {t("dom.remove")}
            </button>
          </div>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (domain.trim()) void run(async () => { await customDomainsApi.add(domain.trim()); setDomain(""); });
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <input className="field-input" aria-label={t("dom.domain")} placeholder="academy.uz" value={domain} onChange={(e) => setDomain(e.target.value)} style={{ flex: "1 1 220px" }} />
        <button type="submit" className="btn" disabled={busy || !domain.trim()} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          {t("dom.add")}
        </button>
      </form>
      {error && <div role="alert" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 10, background: "#FDEBEC", color: "#B23A47" }}>{error}</div>}
    </div>
  );
}
