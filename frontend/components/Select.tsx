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
    <div ref={ref} style={{ position: "relative", ...style }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="field-input"
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          cursor: disabled ? "not-allowed" : "pointer", textAlign: "left", opacity: disabled ? 0.6 : 1, width: "100%",
        }}
      >
        <span style={{ color: selectedLabel ? "#181A1F" : "#8A8D96", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel || effectivePlaceholder}
        </span>
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M1 1.5L6 6.5L11 1.5" stroke="#8A8D96" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            marginTop: 6, background: "#fff", border: "1px solid #EAE8E2",
            borderRadius: 10, maxHeight: 240, overflow: "auto", padding: 6,
            boxShadow: "0 8px 24px rgba(18,19,26,0.1)",
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12.5, color: "#8A8D96" }}>Variantlar yo&apos;q</div>
          ) : (
            options.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 8, cursor: "pointer",
                  fontSize: 13, border: "none", fontWeight: o.value === value ? 700 : 500,
                  background: o.value === value ? "#F7F6FF" : "transparent",
                  color: o.value === value ? ACCENT : "#181A1F",
                }}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
