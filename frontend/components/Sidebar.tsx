"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import type { Role } from "@/lib/api";

const ACCENT = "#4F46E5";

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: React.ReactNode;
  badge?: string;
  roles?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    labelKey: "nav.dashboard" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/leads",
    labelKey: "nav.leads" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "RECEPTIONIST"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
    ),
  },
  {
    href: "/groups",
    labelKey: "nav.groups" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
        <circle cx="10" cy="7" r="4" />
      </svg>
    ),
  },
  {
    href: "/schedule",
    labelKey: "nav.schedule" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: "/attendance",
    labelKey: "nav.attendance" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER", "RECEPTIONIST"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    href: "/students",

    labelKey: "nav.students" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M9 18h6" />
      </svg>
    ),
  },
  {
    href: "/teachers",
    labelKey: "nav.teachers" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
  {
    href: "/homework",
    labelKey: "nav.homework" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/ai-materials",
    labelKey: "nav.aiMaterials" as TranslationKey,
    badge: "AI",
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
        <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />
      </svg>
    ),
  },
  {
    href: "/exams",
    labelKey: "nav.exams" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    href: "/certificates",
    labelKey: "nav.certificates" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="6" />
        <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
      </svg>
    ),
  },
  {
    href: "/announcements",
    labelKey: "nav.announcements" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 11 18-5v12L3 14v-3z" />
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>
    ),
  },
  {
    href: "/ai-insights",
    labelKey: "nav.aiInsights" as TranslationKey,
    badge: "AI",
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.75c.6.47 1 1.2 1 2.02V17h6v-.23c0-.82.4-1.55 1-2.02A7 7 0 0 0 12 2Z" />
      </svg>
    ),
  },
  {
    href: "/payments",
    labelKey: "nav.payments" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    ),
  },
  {
    href: "/reports",
    labelKey: "nav.reports" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 15l4-5 3 3 5-7" />
      </svg>
    ),
  },
  {
    href: "/audit-log",
    labelKey: "nav.auditLog" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M8 12h8M8 8h8M8 16h5" />
      </svg>
    ),
  },
  {
    href: "/settings",
    labelKey: "nav.settings" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    ),
  },
];

const SUPERADMIN_ITEM = {
  href: "/admin",
  labelKey: "nav.platformAdmin" as TranslationKey,
  icon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 3 7l9 5 9-5-9-5Z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 17l9 5 9-5" />
    </svg>
  ),
};

export default function Sidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { user, tenant, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const initials = user?.fullName
    ? user.fullName
        .split(" ")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "??";

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <div
        className={`sidebar${open ? " sidebar-open" : ""}`}
        style={{
          width: 236,
          flex: "0 0 236px",
          background: "#12131A",
          display: "flex",
          flexDirection: "column",
          padding: "20px 14px",
          boxSizing: "border-box",
          height: "100vh",
          position: "sticky",
          top: 0,
        }}
      >
      <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 22px" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 10 12 5 2 10l10 5 10-5Z" />
            <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
          </svg>
        </div>
        <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 16.5, color: "#fff" }}>CRMAPP</span>
      </Link>

      <div
        className="sidebar-nav-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          paddingRight: 4,
          marginBottom: 10,
        }}
      >
        {NAV_ITEMS.filter((item) => !item.roles || (user?.role && item.roles.includes(user.role))).map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="nav-item"
              style={active ? { background: ACCENT, color: "#fff" } : { color: "#C7C9D1" }}
            >
              {item.icon}
              {t(item.labelKey)}
              {"badge" in item && item.badge && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 9.5,
                    fontWeight: 800,
                    background: "linear-gradient(135deg,#8B7CF6,#4F46E5)",
                    color: "#fff",
                    padding: "2px 6px",
                    borderRadius: 5,
                    letterSpacing: "0.02em",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        {user?.role === "SUPERADMIN" && (
          <Link
            href={SUPERADMIN_ITEM.href}
            className="nav-item"
            style={
              pathname === SUPERADMIN_ITEM.href || pathname.startsWith(SUPERADMIN_ITEM.href + "/")
                ? { background: ACCENT, color: "#fff" }
                : { color: "#C7C9D1" }
            }
          >
            {SUPERADMIN_ITEM.icon}
            {t(SUPERADMIN_ITEM.labelKey)}
          </Link>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, padding: "0 8px 10px" }}>
        {(["UZ", "RU", "EN"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className="btn"
            style={{
              flex: 1, fontSize: 11, fontWeight: 700, padding: "6px 0", borderRadius: 7, border: "none",
              background: lang === l ? ACCENT : "rgba(255,255,255,0.06)",
              color: lang === l ? "#fff" : "#71737C",
            }}
          >
            {l}
          </button>
        ))}
      </div>

      <button
        onClick={logout}
        className="nav-item btn"
        style={{ color: "#C7C9D1", background: "transparent", width: "100%", textAlign: "left", marginBottom: 6 }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
        {t("nav.logout")}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: ACCENT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontFamily: "'Manrope', sans-serif",
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {initials}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{user?.fullName ?? "..."}</div>
          <div style={{ fontSize: 11, color: "#71737C" }}>{tenant?.subdomain ? `${tenant.subdomain}.crmapp.com` : ""}</div>
        </div>
      </div>
      </div>
    </>
  );
}
