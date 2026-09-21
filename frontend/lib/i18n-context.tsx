"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { useAuth } from "./auth-context";
import { Lang, TranslationKey, translate } from "./i18n";

const STORAGE_KEY = "talimcrm_lang";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored === "UZ" || stored === "RU" || stored === "EN") return stored;
  } catch {
    // ignore
  }
  return null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { tenant } = useAuth();
  // Local, per-browser choice (e.g. picked on the login page before any
  // tenant is known) always wins over the tenant's saved preference — once
  // set, manualLang short-circuits the tenant-derived fallback below.
  const [manualLang, setManualLang] = useState<Lang | null>(() => readStoredLang());

  const lang = manualLang ?? tenant?.language ?? "UZ";

  function setLang(next: Lang) {
    setManualLang(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  function t(key: TranslationKey) {
    return translate(lang, key);
  }

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
