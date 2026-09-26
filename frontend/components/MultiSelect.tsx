"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

export interface MultiSelectOption {
  value: string;
  label: string;
  // Options with a group are listed under that heading (e.g. a direction).
  group?: string;
}

export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  style,
  summary,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  // When set, the closed field shows this text instead of one chip per
  // selected option (for pages that list the picks themselves).
  summary?: (count: number) => string;
}) {
  const { t } = useLanguage();
  const effectivePlaceholder = placeholder ?? t("picker.select");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
  // Long lists get a search box; it matches the option and its group.
  const searchable = options.length > 6;
  const needle = query.trim().toLowerCase();
  const visible = needle ? options.filter((o) => `${o.group ?? ""} ${o.label}`.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="field-input"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: "pointer",
          textAlign: "left",
          minHeight: 44,
          flexWrap: "wrap",
          borderColor: open ? ACCENT : undefined,
          boxShadow: open ? "0 0 0 3px rgba(79, 70, 229, 0.12)" : undefined,
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, flex: 1 }}>
          {selectedLabels.length === 0 ? (
            <span style={{ color: "#8A8D96" }}>{effectivePlaceholder}</span>
          ) : summary ? (
            <span style={{ fontWeight: 600 }}>{summary(selectedLabels.length)}</span>
          ) : (
            selectedLabels.map((l) => (
              <span
                key={l}
                style={{
                  background: "#EEF0FF",
                  color: ACCENT,
                  fontSize: 11.5,
                  fontWeight: 700,
                  padding: "3px 9px",
                  borderRadius: 100,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {l}
              </span>
            ))
          )}
        </div>
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s ease" }}
        >
          <path d="M1 1.5L6 6.5L11 1.5" stroke={open ? ACCENT : "#8A8D96"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: 0,
            minWidth: "100%",
            maxWidth: 360,
            zIndex: 100,
            background: "#fff",
            border: "1px solid #EAE8E2",
            borderRadius: 12,
            maxHeight: 320,
            overflowY: "auto",
            padding: 5,
            boxShadow: "0 12px 36px rgba(18,19,26,0.14), 0 2px 6px rgba(18,19,26,0.06)",
          }}
        >
          {searchable && (
            <input
              autoFocus
              className="field-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("picker.search")}
              style={{ position: "sticky", top: 0, zIndex: 1, marginBottom: 4, height: 36, fontSize: 13 }}
            />
          )}
          {visible.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#8A8D96", textAlign: "center" }}>
              {t("picker.noOptions")}
            </div>
          ) : (
            visible.map((o, i) => {
              const isChecked = selected.includes(o.value);
              const heading = o.group && o.group !== visible[i - 1]?.group ? o.group : null;
              return (
                <div key={o.value}>
                {heading && (
                  <div style={{ padding: "8px 10px 4px", fontSize: 11, fontWeight: 800, color: "#8A8D96", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    {heading}
                  </div>
                )}
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "8px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: isChecked ? 600 : 500,
                    background: isChecked ? "#EEF0FF" : "transparent",
                    color: isChecked ? ACCENT : "#181A1F",
                    transition: "background 0.12s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isChecked) e.currentTarget.style.background = "#F7F6FF";
                  }}
                  onMouseLeave={(e) => {
                    if (!isChecked) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(o.value)}
                    style={{ accentColor: ACCENT, cursor: "pointer", width: 15, height: 15 }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                </label>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
