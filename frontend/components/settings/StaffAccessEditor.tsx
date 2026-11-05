"use client";

import type { AccessCatalog, Role } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "var(--primary)";

export function isConfigurableRole(catalog: AccessCatalog, role: Role) {
  return catalog.roles.includes(role);
}

export function templateOf(catalog: AccessCatalog, role: Role) {
  return catalog.keys.filter((k) => k.template.includes(role)).map((k) => k.key);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// What a staff member may do: their role's default, ticked, which the owner
// can change item by item. `value` null means "the role's default"; a list
// equal to the default is stored as null too.
export default function StaffAccessEditor({
  catalog,
  role,
  value,
  onChange,
  disabled,
}: {
  catalog: AccessCatalog;
  role: Role;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  if (!isConfigurableRole(catalog, role)) {
    return <div style={{ fontSize: 12.5, color: "var(--text-soft)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>{t("perm.adminAll")}</div>;
  }
  const template = templateOf(catalog, role);
  const current = value ?? template;
  const custom = value !== null;

  function toggle(key: string) {
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    onChange(sameSet(next, template) ? null : next);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          className="badge"
          style={{ background: custom ? "var(--warning-soft)" : "var(--success-soft)", color: custom ? "var(--warning)" : "var(--success)", fontWeight: 700, fontSize: 11.5, borderRadius: "var(--radius-xs)", padding: "3px 9px" }}
        >
          {custom ? t("perm.custom") : t("perm.default")}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("perm.count").replace("{n}", String(current.length)).replace("{m}", String(catalog.keys.length))}</span>
        {custom && (
          <button type="button" className="btn" disabled={disabled} onClick={() => onChange(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: ACCENT, fontSize: 12.5, fontWeight: 700, padding: 0, cursor: "pointer" }}>
            ↺ {t("perm.reset")}
          </button>
        )}
      </div>
      {catalog.areas.map((area) => {
        const keys = catalog.keys.filter((k) => k.area === area);
        if (keys.length === 0) return null;
        return (
          <fieldset key={area} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", margin: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: "var(--text-soft)", padding: "0 6px" }}>{t(`acc.area.${area}` as TranslationKey)}</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
              {keys.map((k) => {
                const on = current.includes(k.key);
                const changed = on !== template.includes(k.key);
                return (
                  <label
                    key={k.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 9px",
                      borderRadius: "var(--radius-xs)",
                      background: on ? "var(--primary-soft)" : "var(--surface-muted)",
                      border: `1px solid ${changed ? "var(--warning)" : on ? "var(--primary-border)" : "var(--border)"}`,
                      cursor: disabled ? "default" : "pointer",
                      fontSize: 12.5,
                      fontWeight: on ? 600 : 500,
                      color: on ? "var(--primary)" : "var(--text-soft)",
                    }}
                  >
                    <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(k.key)} style={{ accentColor: ACCENT }} />
                    <span>{t(`perm.${k.key}` as TranslationKey)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{t("perm.ownerOnly")}</div>
    </div>
  );
}
