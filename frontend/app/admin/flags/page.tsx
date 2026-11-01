"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import { ApiError, featureFlagsApi, platformApi, type FlagOverview } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 };

function Switch({ flag, onChanged }: { flag: FlagOverview; onChanged: () => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState("");

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function toggleGlobal() {
    // Turning a switch off reaches every center: asked first.
    if (flag.enabled && !window.confirm(t("pf.fl.confirmOff").replace("{name}", t(`pf.fl.${flag.key}` as TranslationKey)))) return;
    void run(() => featureFlagsApi.setGlobal(flag.key, !flag.enabled));
  }

  function addException(e: React.FormEvent) {
    e.preventDefault();
    const wanted = sub.trim().toLowerCase();
    if (!wanted) return;
    void run(async () => {
      const found = (await platformApi.subscriptions({ search: wanted, pageSize: 20 })).items.find((c) => c.subdomain === wanted);
      if (!found) throw new ApiError(t("pf.fl.notFound"), 404);
      // The exception is the opposite of the global state.
      await featureFlagsApi.setForTenant(flag.key, found.id, !flag.enabled);
      setSub("");
    });
  }

  return (
    <section style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }} data-testid={`flag-${flag.key}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800 }}>{t(`pf.fl.${flag.key}` as TranslationKey)}</h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.55 }}>{t(`pf.fl.${flag.key}.d` as TranslationKey)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, padding: "6px 12px", borderRadius: "var(--radius-pill)", background: flag.enabled ? "var(--success-soft)" : "var(--danger-soft)", color: flag.enabled ? "var(--success)" : "var(--danger)" }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: flag.enabled ? "var(--success)" : "var(--danger)" }} />
            {flag.enabled ? t("pf.fl.on") : t("pf.fl.off")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={flag.enabled}
            aria-label={t(`pf.fl.${flag.key}` as TranslationKey)}
            disabled={busy}
            onClick={toggleGlobal}
            className="btn"
            style={{ background: flag.enabled ? "var(--surface)" : ACCENT, color: flag.enabled ? "var(--danger)" : "var(--on-ink)", border: flag.enabled ? "1px solid var(--danger-border)" : "none", borderRadius: "var(--radius-sm)", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}
          >
            {flag.enabled ? t("pf.fl.turnOff") : t("pf.fl.turnOn")}
          </button>
        </div>
      </div>

      <details open={flag.overrides.length > 0}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)" }}>{t("pf.fl.oneCenter")}</summary>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 6 }}>
          {flag.enabled ? t("pf.fl.offFor") : t("pf.fl.onFor")}
        </div>
        {flag.overrides.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("pf.fl.noExceptions")}</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {flag.overrides.map((o) => (
              <li key={o.tenantId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13, padding: "6px 10px", background: "var(--surface-muted)", borderRadius: "var(--radius-xs)" }}>
                <span>
                  <b>{o.name ?? o.tenantId}</b> <span style={{ color: "var(--text-muted)" }}>{o.subdomain}</span> · {o.enabled ? t("pf.fl.on") : t("pf.fl.off")}
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => void run(() => featureFlagsApi.clearForTenant(flag.key, o.tenantId))} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {t("pf.fl.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addException} style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input className="field-input" aria-label={t("pf.fl.subdomain")} placeholder={t("pf.fl.subdomain")} value={sub} onChange={(e) => setSub(e.target.value)} style={{ flex: "1 1 200px" }} />
          <button type="submit" className="btn" disabled={busy || !sub.trim()} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {t("pf.fl.add")}
          </button>
        </form>
      </div>
      </details>
      {error && <div role="alert" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)" }}>{error}</div>}
    </section>
  );
}

function FlagsContent() {
  const { t } = useLanguage();
  const [flags, setFlags] = useState<FlagOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    featureFlagsApi.overview().then(setFlags).catch((e) => setError(e instanceof ApiError ? e.message : ""));
  }
  useEffect(load, []);

  return (
    <>
      <div style={{ padding: "var(--page-head-pad)" }}>
        <h1 className="page-title">{t("nav.flags")}</h1>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("pf.fl.subtitle")}</div>
      </div>
      <div style={{ padding: "var(--page-pad)", display: "flex", flexDirection: "column", gap: 14 }}>
        {error !== null ? (
          <LoadError message={error || t("adm.loadError")} onRetry={load} />
        ) : !flags ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          flags.map((f) => <Switch key={f.key} flag={f} onChanged={load} />)
        )}
      </div>
    </>
  );
}

export default function PlatformFlagsPage() {
  return (
    <DashboardShell>
      <FlagsContent />
    </DashboardShell>
  );
}
