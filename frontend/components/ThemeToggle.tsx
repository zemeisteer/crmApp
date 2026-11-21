"use client";

import { useEffect, useState } from "react";
import { applyTheme, getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { useLanguage } from "@/lib/i18n-context";

const NEXT: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" };

/** One round button: light -> dark -> as the device -> light. */
export default function ThemeToggle({ className = "app-round" }: { className?: string }) {
  const { t } = useLanguage();
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    const now = getThemePref();
    setPref(now);
    applyTheme(now);
    // "As the device": follow it when it changes.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => getThemePref() === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const label = t(pref === "light" ? "theme.light" : pref === "dark" ? "theme.dark" : "theme.system");
  return (
    <button
      type="button"
      className={className}
      data-testid="theme-toggle"
      aria-label={`${t("theme.label")}: ${label}`}
      title={`${t("theme.label")}: ${label}`}
      onClick={() => {
        const next = NEXT[pref];
        setPref(next);
        setThemePref(next);
      }}
    >
      {pref === "light" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : pref === "dark" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      )}
    </button>
  );
}
