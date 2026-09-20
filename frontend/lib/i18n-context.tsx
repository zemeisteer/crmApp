"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./auth-context";
import { Lang, TranslationKey, translate } from "./i18n";

const STORAGE_KEY = "talimcrm_lang";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { tenant } = useAuth();
  const [lang, setLangState] = useState<Lang>("UZ");
  const [manualOverride, setManualOverride] = useState(false);

  // Local, per-browser choice (e.g. picked on the login page before any
  // tenant is known) always wins over the tenant's saved preference.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (stored === "UZ" || stored === "RU" || stored === "EN") {
        setLangState(stored);
        setManualOverride(true);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!manualOverride && tenant?.language) {
      setLangState(tenant.language);
    }
  }, [tenant, manualOverride]);

  function setLang(next: Lang) {
    setLangState(next);
    setManualOverride(true);
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
