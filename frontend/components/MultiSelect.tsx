"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useLanguage();
  const effectivePlaceholder = placeholder ?? t("picker.select");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const selectedLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="field-input"
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer",
          textAlign: "left", minHeight: 44, flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, flex: 1 }}>
          {selectedLabels.length === 0 ? (
            <span style={{ color: "#8A8D96" }}>{effectivePlaceholder}</span>
          ) : (
            selectedLabels.map((l) => (
              <span key={l} style={{ background: "#EEF0FF", color: ACCENT, fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 100 }}>
                {l}
              </span>
            ))
          )}
        </div>
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style={{ flexShrink: 0 }}>
          <path d="M1 1.5L6 6.5L11 1.5" stroke="#8A8D96" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            // In-flow, not absolutely positioned: an overlay here would sit on
            // top of whatever follows this field (often a submit button right
            // below it), silently swallowing clicks meant for that button.
            marginTop: 6, background: "#fff", border: "1px solid #EAE8E2",
            borderRadius: 10, maxHeight: 220, overflow: "auto", padding: 6,
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12.5, color: "#8A8D96" }}>Variantlar yo&apos;q</div>
          ) : (
            options.map((o) => (
              <label
                key={o.value}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13,
                  background: selected.includes(o.value) ? "#F7F6FF" : "transparent",
                }}
              >
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.label}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
