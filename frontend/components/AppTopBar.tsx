"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { useChatUnread } from "@/lib/chat-unread";
import { canOpenPath, isPlatformMode } from "./Sidebar";

/**
 * The bar across the top of the staff app: the menu button (phones), the
 * center as a brand pill, then language, messages (with the unread dot),
 * settings and the signed-in person. Everything here already exists elsewhere
 * in the app; the bar only brings it within reach.
 */
export default function AppTopBar({ onMenu }: { onMenu: () => void }) {
  const { user, tenant } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const platform = isPlatformMode(user?.role, !!tenant);
  const chatKey = user?.id && tenant?.id ? `${user.id}:${tenant.id}` : null;
  const unread = useChatUnread(chatKey);
  const seesChat = !platform && canOpenPath("/messages", user?.role, !!tenant, user?.access);
  const seesSettings = !platform && canOpenPath("/settings", user?.role, !!tenant, user?.access) && (user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN");
  const initials = (user?.fullName ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="app-topbar">
      <button className="mobile-menu-btn btn app-round" onClick={onMenu} aria-label={t("shell.menuAriaLabel")} type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <div className="app-brand" title={platform ? "TalimCRM" : tenant?.name}>
        <span className="app-brand-spark" aria-hidden="true">✦</span>
        <span className="app-brand-name">{platform ? "TalimCRM" : tenant?.name ?? "TalimCRM"}</span>
        {platform && <span className="app-brand-mode">{t("nav.platformBadge")}</span>}
      </div>
      <div className="app-tools">
        <div className="app-lang" role="group" aria-label={t("nav.language")}>
          {(["UZ", "RU", "EN"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={lang === l ? "on" : undefined}>
              {l}
            </button>
          ))}
        </div>
        {seesChat && (
          <Link href="/messages" className="app-round" aria-label={t("chat.nav")} title={t("chat.nav")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unread !== null && unread > 0 && <span className="app-dot" aria-hidden="true" />}
          </Link>
        )}
        {seesSettings && (
          <Link href="/settings" className="app-round app-settings" aria-label={t("nav.settings")} title={t("nav.settings")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </Link>
        )}
        <div className="app-avatar" title={user?.fullName ?? ""}>
          <span aria-hidden="true">{initials}</span>
          <span className="sr-only">{user?.fullName}</span>
        </div>
      </div>
    </div>
  );
}
