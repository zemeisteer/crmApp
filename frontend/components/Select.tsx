"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

export interface SelectOption {
  value: string;
  label: string;
}

export default function Select({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  style,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
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

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, ...style }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="field-input"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          opacity: disabled ? 0.6 : 1,
          width: "100%",
          borderColor: open ? ACCENT : undefined,
          boxShadow: open ? "0 0 0 3px rgba(79, 70, 229, 0.12)" : undefined,
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
      >
        <span style={{ color: selectedLabel ? "#181A1F" : "#8A8D96", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel || effectivePlaceholder}
        </span>
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
            maxWidth: 340,
            zIndex: 100,
            background: "#fff",
            border: "1px solid #EAE8E2",
            borderRadius: 12,
            maxHeight: 240,
            overflowY: "auto",
            padding: 5,
            boxShadow: "0 12px 36px rgba(18,19,26,0.14), 0 2px 6px rgba(18,19,26,0.06)",
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#8A8D96", textAlign: "center" }}>
              Variantlar yo&apos;q
            </div>
          ) : (
            options.map((o) => {
              const isSelected = o.value === value;
              return (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 13,
                    border: "none",
                    fontWeight: isSelected ? 700 : 500,
                    background: isSelected ? "#EEF0FF" : "transparent",
                    color: isSelected ? ACCENT : "#181A1F",
                    transition: "all 0.12s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "#F7F6FF";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                  {isSelected && <span style={{ color: ACCENT, fontSize: 13, fontWeight: 800, marginLeft: 6 }}>✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
