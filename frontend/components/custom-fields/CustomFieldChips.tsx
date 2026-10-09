"use client";

import type { CustomFieldDef, CustomFieldValue } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { activeDefs, isEmptyCfValue } from "@/lib/custom-fields";
import { formatCfValue } from "./CustomFieldValues";

// A long answer (a note) is cut on a chip; the whole text is its tooltip.
const CHIP_MAX = 60;

/**
 * A record's answered custom fields as small "Label: value" chips, for a
 * list card (a phone's list has no room for columns). Active fields only,
 * in their order; empty ones are left out. Renders nothing when none is set.
 */
export default function CustomFieldChips({ defs, values }: { defs: CustomFieldDef[]; values: Record<string, CustomFieldValue> | null | undefined }) {
  const { t, lang } = useLanguage();
  const shown = activeDefs(defs).filter((d) => !isEmptyCfValue(values?.[d.id]));
  if (shown.length === 0) return null;
  return (
    <ul aria-label={t("cf.section")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 }}>
      {shown.map((d) => {
        const text = formatCfValue(d, values?.[d.id], t, lang);
        return (
          <li
            key={d.id}
            title={text.length > CHIP_MAX ? text : undefined}
            style={{ fontSize: 12, color: "#4A4E58", background: "#F2F1EC", borderRadius: 999, padding: "3px 10px", maxWidth: "100%", overflowWrap: "anywhere" }}
          >
            <span style={{ color: "#686B75" }}>{d.label}:</span> <span style={{ fontWeight: 600 }}>{text.length > CHIP_MAX ? `${text.slice(0, CHIP_MAX)}…` : text}</span>
          </li>
        );
      })}
    </ul>
  );
}
