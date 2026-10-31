"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { QUESTION_TYPES, TYPE_INFO, type QuestionType } from "@/lib/tests";
import { usePopoverPlacement } from "@/lib/use-popover";

const ACCENT = "var(--primary)";

// Question type chooser: a button with the current type, opening a grid of
// cards (icon, name, one-line hint) for all types.
export default function TypePicker({ value, onChange, exclude = [] }: { value: QuestionType; onChange: (t: QuestionType) => void; exclude?: QuestionType[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const place = usePopoverPlacement(ref, open, 360);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const info = TYPE_INFO[value];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: `1.5px solid ${open ? ACCENT : "var(--border)"}`, background: "var(--surface)", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ fontSize: 20 }}>{info.icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t(info.label)}</span>
          <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t(info.hint)}</span>
        </span>
        <span style={{ color: "var(--text-faint)" }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{ position: "absolute", zIndex: 50, top: "calc(100% + 6px)", left: 0, right: 0, minWidth: "min(280px, calc(100vw - 24px))", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "0 12px 32px rgba(15,23,42,0.16)", padding: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(190px, 100%), 1fr))", gap: 6, maxHeight: 360, overflowY: "auto", ...place }}
        >
          {QUESTION_TYPES.filter((x) => !exclude.includes(x)).map((type) => {
            const it = TYPE_INFO[type];
            const on = type === value;
            return (
              <button
                key={type}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(type);
                  setOpen(false);
                }}
                style={{ display: "flex", gap: 8, alignItems: "flex-start", textAlign: "left", padding: "8px 10px", borderRadius: "var(--radius-sm)", cursor: "pointer", border: `1.5px solid ${on ? ACCENT : "transparent"}`, background: on ? "var(--primary-soft)" : "var(--surface-muted)" }}
              >
                <span style={{ fontSize: 18, lineHeight: 1.2 }}>{it.icon}</span>
                <span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: on ? ACCENT : "var(--text)" }}>{t(it.label)}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.35 }}>{t(it.hint)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
