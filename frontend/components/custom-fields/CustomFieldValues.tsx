"use client";

import type { CustomFieldDef, CustomFieldValue } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { Lang, TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { activeDefs, isEmptyCfValue, parseCfDate } from "@/lib/custom-fields";

/** A stored value as text: option names, yes/no, dates as the rest of the app prints them. */
export function formatCfValue(def: CustomFieldDef, v: CustomFieldValue | null | undefined, t: (k: TranslationKey) => string, lang: Lang): string {
  if (isEmptyCfValue(v)) return "—";
  const option = (id: string) => def.options.find((o) => o.id === id)?.label ?? id;
  switch (def.fieldType) {
    case "BOOLEAN":
      return v ? `✓ ${t("cf.yes")}` : `✗ ${t("cf.no")}`;
    case "SELECT":
      return typeof v === "string" ? option(v) : "—";
    case "MULTI_SELECT":
      return Array.isArray(v) ? v.map(option).join(", ") : "—";
    case "DATE": {
      const d = typeof v === "string" ? parseCfDate(v) : null;
      return d ? formatDate(d, lang, "long") : String(v);
    }
    default:
      return String(v);
  }
}

/** Whether the display below would show anything. */
export function hasCustomFieldContent(defs: CustomFieldDef[] | null, values: Record<string, CustomFieldValue> | null | undefined) {
  if (!defs) return false;
  return defs.some((d) => !d.archivedAt || !isEmptyCfValue(values?.[d.id]));
}

function Item({ label, value, long, badge, muted }: { label: string; value: string; long?: boolean; badge?: string; muted?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: "#686B75" }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3, color: muted ? "#686B75" : "#181A1F", overflowWrap: "anywhere", whiteSpace: long ? "pre-wrap" : undefined }}>
        {value}
      </div>
      {badge && (
        <span style={{ display: "inline-block", marginTop: 4, fontSize: 11, fontWeight: 700, color: "#B45309", background: "#FEF3C7", padding: "2px 8px", borderRadius: 999 }}>{badge}</span>
      )}
    </div>
  );
}

/**
 * The center's own fields of a record, read-only: active fields in order
 * ("—" when empty, a badge on a required one that is missing), then the
 * archived fields that still hold a value, muted.
 */
export default function CustomFieldValues({ defs, values }: { defs: CustomFieldDef[]; values: Record<string, CustomFieldValue> | null | undefined }) {
  const { t, lang } = useLanguage();
  const active = activeDefs(defs);
  const archived = defs.filter((d) => d.archivedAt && !isEmptyCfValue(values?.[d.id]));
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "18px 16px" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {active.length > 0 && (
        <div style={grid}>
          {active.map((d) => (
            <Item
              key={d.id}
              label={d.label}
              value={formatCfValue(d, values?.[d.id], t, lang)}
              long={d.fieldType === "LONG_TEXT"}
              badge={d.required && isEmptyCfValue(values?.[d.id]) ? t("cf.missingRequired") : undefined}
            />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <div style={{ borderTop: "1px dashed #EAE8E2", paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#8A8D96", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>{t("cf.archivedGroup")}</div>
          <div style={grid}>
            {archived.map((d) => (
              <Item key={d.id} label={d.label} value={formatCfValue(d, values?.[d.id], t, lang)} long={d.fieldType === "LONG_TEXT"} muted />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
