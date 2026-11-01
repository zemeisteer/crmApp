"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import Modal from "@/components/Modal";
import { ApiError, platformApi, type PlatformIntegration, type PlatformIntegrationKey, type PlatformIntegrations } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";
const GROUPS: PlatformIntegration["group"][] = ["ai", "messaging", "payments", "other"];
// Who translates, by the name people know it by.
const TRANSLATOR: Record<string, string> = { ai: "AI", google: "Google Cloud Translation", "google-public": "Google Translate" };
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 18 };
const code: React.CSSProperties = { fontSize: 11, background: "var(--surface-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", padding: "2px 6px", color: "var(--text-soft)" };

const SOURCE_KEY: Record<"panel" | "env" | "none", TranslationKey> = { panel: "pf.int.src.panel", env: "pf.int.src.env", none: "pf.int.src.none" };
const SOURCE_COLOR = { panel: "var(--primary)", env: "var(--success)", none: "var(--text-muted)" };

function KeyState({ k }: { k: PlatformIntegrationKey }) {
  const { t } = useLanguage();
  const source = k.source ?? "none";
  return (
    <span style={{ fontSize: 11.5, color: SOURCE_COLOR[source], fontWeight: 600 }}>
      {k.shown ? <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--text)", marginRight: 6 }}>{k.shown}</span> : null}
      {t(SOURCE_KEY[source])}
    </span>
  );
}

function IntegrationsContent() {
  const { t } = useLanguage();
  const [data, setData] = useState<PlatformIntegrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlatformIntegration | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    setError(null);
    platformApi.integrations().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : ""));
  }
  useEffect(load, []);

  const on = data ? data.items.filter((i) => i.configured).length : 0;

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("pf.int.title")}</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("pf.int.subtitle")}</div>
        </div>
        {data && (
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-soft)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "8px 14px" }}>
            {t("pf.int.connected").replace("{n}", String(on)).replace("{total}", String(data.items.length))}
          </div>
        )}
      </div>

      <div style={{ padding: "22px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
        {error !== null ? (
          <LoadError message={error || t("adm.loadError")} onRetry={load} />
        ) : !data ? (
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: data.editable ? "var(--primary-soft)" : "var(--warning-soft)", border: `1px solid ${data.editable ? "var(--primary-border)" : "var(--warning-border)"}`, borderRadius: "var(--radius-lg)", padding: "12px 16px", fontSize: 13, color: data.editable ? "var(--primary)" : "var(--warning)", lineHeight: 1.6 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <div>
                {data.editable ? t("pf.int.how") : t("pf.int.readOnly")}
                <div style={{ marginTop: 6, color: "var(--text-soft)" }}>
                  {t("pf.int.env")}: <b>{data.environment}</b>{data.rootDomain ? <> · {t("pf.int.domain")}: <b>{data.rootDomain}</b></> : null}
                </div>
              </div>
            </div>

            {notice && <div role="status" style={{ fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", background: "var(--success-soft)", color: "var(--success)" }}>{notice}</div>}

            {GROUPS.map((group) => {
              const items = data.items.filter((i) => i.group === group);
              if (items.length === 0) return null;
              return (
                <section key={group}>
                  <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>{t(`pf.int.group.${group}`)}</h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                    {items.map((i) => (
                      <div key={i.id} data-testid={`integration-${i.id}`} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 800 }}>{t(`pf.int.${i.id}` as TranslationKey)}</div>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: "var(--radius-pill)", whiteSpace: "nowrap", background: i.configured ? "var(--success-soft)" : "var(--surface-muted)", color: i.configured ? "var(--success)" : "var(--text-muted)" }}>
                            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "var(--radius-pill)", background: i.configured ? "var(--success)" : "var(--text-faint)" }} />
                            {i.configured ? t("pf.int.on") : t("pf.int.off")}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>{t(`pf.int.${i.id}.d` as TranslationKey)}</div>
                        {i.configured && i.detail && <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{i.id === "translate" ? TRANSLATOR[i.detail] ?? i.detail : i.detail}</div>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                          {i.keys.map((k) => (
                            <div key={k.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <code style={code}>{k.name}</code>
                              <KeyState k={k} />
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 6 }}>
                          <span style={{ fontSize: 11.5, color: "var(--warning)" }}>{i.restart ? t("pf.int.restartBadge") : ""}</span>
                          {data.editable && (
                            <button type="button" className="btn" onClick={() => { setNotice(null); setEditing(i); }} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                              {t("pf.int.configure")}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>

      {editing && (
        <EditIntegration
          key={editing.id}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(restartNeeded) => {
            setEditing(null);
            setNotice(`${t(`pf.int.${editing.id}` as TranslationKey)}: ${t(restartNeeded ? "pf.int.savedRestart" : "pf.int.saved")}`);
            load();
          }}
        />
      )}
    </>
  );
}

function EditIntegration({ item, onClose, onSaved }: { item: PlatformIntegration; onClose: () => void; onSaved: (restartNeeded: boolean) => void }) {
  const { t } = useLanguage();
  // A secret starts empty (its value is not known here); an id or address
  // starts with what is in use, to be corrected in place.
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(item.keys.map((k) => [k.name, k.secret ? "" : k.shown ?? ""])));
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const changes: Record<string, string | null> = {};
    for (const k of item.keys) {
      const typed = values[k.name].trim();
      if (removing[k.name]) changes[k.name] = null;
      else if (k.secret ? typed !== "" : typed !== (k.shown ?? "")) changes[k.name] = typed === "" ? null : typed;
    }
    if (Object.keys(changes).length === 0) return setError(t("pf.int.nothing"));
    setSaving(true);
    setError(null);
    try {
      const res = await platformApi.saveIntegration(item.id, password, changes);
      onSaved(res.restartNeeded);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
      setSaving(false);
    }
  }

  const label: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" };

  return (
    <Modal open onClose={onClose} title={`${t("pf.int.editTitle")}: ${t(`pf.int.${item.id}` as TranslationKey)}`} width={540}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }} autoComplete="off">
        {item.keys.map((k) => {
          const id = `int-${k.name}`;
          const isRemoving = !!removing[k.name];
          return (
            <div key={k.name}>
              <div style={label}>
                <label htmlFor={id}><code style={{ ...code, fontSize: 12 }}>{k.name}</code></label>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t("pf.int.current")}: <KeyState k={k} /></span>
              </div>
              <input
                id={id}
                className="field-input"
                type={k.secret ? "password" : "text"}
                // Not a sign-in field: a password manager must neither fill it nor offer to save it.
                autoComplete={k.secret ? "new-password" : "off"}
                spellCheck={false}
                disabled={isRemoving}
                value={values[k.name]}
                onChange={(e) => setValues((prev) => ({ ...prev, [k.name]: e.target.value }))}
                placeholder={k.secret && k.set ? t("pf.int.keepPh") : t("pf.int.newValuePh")}
                style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, opacity: isRemoving ? 0.5 : 1 }}
              />
              {k.source === "panel" && (
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--danger)", fontWeight: 600, marginTop: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={isRemoving} onChange={(e) => setRemoving((prev) => ({ ...prev, [k.name]: e.target.checked }))} />
                  {t("pf.int.remove")}
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>· {t("pf.int.removeHint")}</span>
                </label>
              )}
            </div>
          );
        })}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <label htmlFor="int-admin-password" style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 6 }}>{t("pf.int.password")}</label>
          <input id="int-admin-password" className="field-input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>{t("pf.int.passwordHint")}</div>
        </div>

        {item.restart && <div style={{ fontSize: 12.5, color: "var(--warning)", background: "var(--warning-soft)", border: "1px solid var(--warning-border)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}>{t("pf.int.restartBadge")}</div>}
        {error && <div role="alert" style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)" }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" className="btn" onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{t("common.cancel")}</button>
          <button type="submit" className="btn" disabled={saving} style={{ background: saving ? "var(--text-faint)" : ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
            {saving ? t("common.loading") : t("pf.int.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function PlatformIntegrationsPage() {
  return (
    <DashboardShell>
      <IntegrationsContent />
    </DashboardShell>
  );
}
