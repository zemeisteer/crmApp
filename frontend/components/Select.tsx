"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { usePopoverPlacement, useEscapeToClose } from "@/lib/use-popover";

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
  wrap = false,
  sheetOnPhone = false,
  sheetTitle,
  ariaLabel,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  // Long labels (e.g. IELTS headings) wrap instead of being cut off.
  wrap?: boolean;
  // On phones open as a sheet from the bottom of the screen: big tap
  // targets and nothing can end up off screen.
  sheetOnPhone?: boolean;
  sheetTitle?: string;
  ariaLabel?: string;
}) {
  const { t } = useLanguage();
  const effectivePlaceholder = placeholder ?? t("picker.select");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Opens upward / right-aligned when there is no room (phones, modals).
  const place = usePopoverPlacement(ref, open, 240);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (!sheetOnPhone) return;
    const mq = window.matchMedia("(max-width: 600px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [sheetOnPhone]);
  const asSheet = sheetOnPhone && phone;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);
  useEscapeToClose(open, () => setOpen(false));

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} className="ui-select" style={{ position: "relative", flexShrink: 0, maxWidth: "100%", ...style }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
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
        <span style={{ color: selectedLabel ? "#181A1F" : "#686B75", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: wrap ? "normal" : "nowrap", lineHeight: wrap ? 1.35 : undefined }}>
          {selectedLabel || effectivePlaceholder}
        </span>
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s ease" }}
        >
          <path d="M1 1.5L6 6.5L11 1.5" stroke={open ? ACCENT : "#686B75"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (() => {
        const list = options.length === 0 ? (
          <div style={{ padding: "10px 12px", fontSize: 12.5, color: "#686B75", textAlign: "center" }}>
            {t("common.noOptions")}
          </div>
        ) : (
          options.map((o) => {
            const isSelected = o.value === value;
            return (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: wrap ? "flex-start" : "center",
                  justifyContent: "space-between",
                  width: "100%",
                  textAlign: "left",
                  padding: asSheet ? "12px 14px" : "8px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: asSheet ? 15 : 13,
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
                <span style={wrap ? { lineHeight: 1.4, overflowWrap: "anywhere" } : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                {isSelected && <span style={{ color: ACCENT, fontSize: 13, fontWeight: 800, marginLeft: 6 }}>✓</span>}
              </button>
            );
          })
        );
        if (asSheet) {
          return (
            <div role="presentation" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(18,19,26,0.45)", display: "flex", alignItems: "flex-end" }}>
              <div
                role="listbox"
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxHeight: "70vh", overflowY: "auto", background: "#fff", borderRadius: "18px 18px 0 0", padding: "8px 8px calc(12px + env(safe-area-inset-bottom))", boxShadow: "0 -12px 36px rgba(18,19,26,0.2)" }}
              >
                <div style={{ width: 40, height: 4, borderRadius: 4, background: "#D9D6CE", margin: "4px auto 10px" }} />
                {sheetTitle && <div style={{ fontSize: 13, fontWeight: 800, color: "#4A4E58", padding: "0 10px 8px" }}>{sheetTitle}</div>}
                {list}
              </div>
            </div>
          );
        }
        return (
          <div
            role="listbox"
            style={{
              position: "absolute",
              top: "calc(100% + 5px)",
              left: 0,
              width: "100%",
              zIndex: 100,
              background: "#fff",
              border: "1px solid #EAE8E2",
              borderRadius: 12,
              maxHeight: 240,
              overflowY: "auto",
              padding: 5,
              boxShadow: "0 12px 36px rgba(18,19,26,0.14), 0 2px 6px rgba(18,19,26,0.06)",
              ...place,
            }}
          >
            {list}
          </div>
        );
      })()}
    </div>
  );
}
