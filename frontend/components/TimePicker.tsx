"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";
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
  const [h, m] = value ? value.split(":") : ["", ""];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

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
        <span style={{ color: value ? "#181A1F" : "#8A8D96" }}>{value || effectivePlaceholder}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A8D96" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open && (
        <div style={{ marginTop: 6, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 12, boxShadow: "0 8px 24px rgba(18,19,26,0.1)", display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, maxHeight: 200, overflow: "auto", borderRight: "1px solid #F1F0EC" }}>
            {HOURS.map((hour) => (
              <button
                type="button"
                key={hour}
                onClick={() => setHour(hour)}
                style={{
                  display: "block", width: "100%", textAlign: "center", padding: "7px 0", border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: hour === h ? 700 : 500,
                  background: hour === h ? "#F7F6FF" : "transparent", color: hour === h ? ACCENT : "#181A1F",
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
                  background: min === m ? "#F7F6FF" : "transparent", color: min === m ? ACCENT : "#181A1F",
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
