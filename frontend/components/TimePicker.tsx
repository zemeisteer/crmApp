"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { usePopoverPlacement, useEscapeToClose } from "@/lib/use-popover";

const ACCENT = "var(--primary)";
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

export default function TimePicker({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useLanguage();
  const effectivePlaceholder = placeholder ?? t("picker.selectTime");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Opens upward / right-aligned when there is no room (phones, modals).
  const place = usePopoverPlacement(ref, open, 260, 200);
  const [h, m] = value ? value.split(":") : ["", ""];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);
  useEscapeToClose(open, () => setOpen(false));

  function setHour(hour: string) {
    onChange(`${hour}:${m || "00"}`);
  }
  function setMinute(min: string) {
    onChange(`${h || "00"}:${min}`);
  }

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="field-input"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left", width: "100%" }}
      >
        <span style={{ color: value ? "var(--text)" : "var(--text-muted)" }}>{value || effectivePlaceholder}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            width: 200,
            zIndex: 50,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 12px 32px rgba(18,19,26,0.14)",
            display: "flex",
            overflow: "hidden",
            ...place,
          }}
        >
          <div style={{ flex: 1, maxHeight: 200, overflow: "auto", borderRight: "1px solid var(--border)" }}>
            {HOURS.map((hour) => (
              <button
                type="button"
                key={hour}
                onClick={() => setHour(hour)}
                style={{
                  display: "block", width: "100%", textAlign: "center", padding: "7px 0", border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: hour === h ? 700 : 500,
                  background: hour === h ? "var(--primary-soft)" : "transparent", color: hour === h ? ACCENT : "var(--text)",
                }}
              >
                {hour}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, maxHeight: 200, overflow: "auto" }}>
            {MINUTES.map((min) => (
              <button
                type="button"
                key={min}
                onClick={() => setMinute(min)}
                style={{
                  display: "block", width: "100%", textAlign: "center", padding: "7px 0", border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: min === m ? 700 : 500,
                  background: min === m ? "var(--primary-soft)" : "transparent", color: min === m ? ACCENT : "var(--text)",
                }}
              >
                {min}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
