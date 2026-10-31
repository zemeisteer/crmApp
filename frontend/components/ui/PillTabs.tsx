"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * The black pill tab switcher, for sections within a page (not for the main
 * navigation). Arrow keys move between tabs (WAI-ARIA tabs pattern).
 */
export default function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  size = "md",
}: {
  tabs: Array<{ id: T; label: ReactNode; badge?: ReactNode; testId?: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDivElement>(null);
  function onKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    onChange(tabs[next].id);
    ref.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }
  return (
    <div ref={ref} role="tablist" aria-label={label} className={`ui-pilltabs ui-pilltabs-${size}`}>
      {tabs.map((tab, i) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-testid={tab.testId}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={on ? "on" : undefined}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
