"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { authApi, fileUrl, planAllows, type PLAN_FEATURES } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import type { Role, WorkspaceItem } from "@/lib/api";
import { centerHost } from "@/lib/domain";
import { useChatUnread, useChatUnreadRefresh } from "@/lib/chat-unread";


interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: React.ReactNode;
  badge?: string;
  roles?: Role[];
  /** The access item(s) that open this page for staff whose access the owner sets (any of them). */
  access?: string | string[];
  /** Hidden when the center's plan leaves this feature out (plans entitlements). */
  feature?: PlanFeature;
}

type PlanFeature = (typeof PLAN_FEATURES)[number];

const CONFIGURABLE: Role[] = ["MANAGER", "RECEPTIONIST", "ACCOUNTANT", "TEACHER"];

// Staff whose access the owner sets see a page when its item is on their
// list (the server answers the same way); otherwise the role decides, and
// the owner has every admin right (same rule as the backend RolesGuard).
function canSee(item: NavItem, role?: Role, access?: string[]) {
  if (role && item.access && access && CONFIGURABLE.includes(role)) {
    const keys = Array.isArray(item.access) ? item.access : [item.access];
    return keys.some((k) => access.includes(k));
  }
  if (!item.roles) return true;
  if (!role) return false;
  return item.roles.includes(role) || (role === "OWNER" && item.roles.includes("ADMIN"));
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
    access: "leads.view",
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
    access: "groups.view",
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
    access: "schedule.view",
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
    // Front desk and managers: credits and bookings; teachers: their roster.
    href: "/makeups",
    access: ["makeups.view", "makeups.attend"],
    labelKey: "mk.nav",
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "RECEPTIONIST", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 4v5h-5" />
        <path d="M12 8v4l3 2" />
      </svg>
    ),
  },
  {
    // Two-way messages with students and their parents (chat.use); the
    // center's inbox needs chat.center, checked by the server per conversation.
    href: "/messages",
    access: "chat.use",
    labelKey: "chat.nav",
    roles: ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 9h8M8 13h5" />
      </svg>
    ),
  },
  {
    // Everyone with an account has their own calendar (the role decides
    // which lessons); no access item: it is the person's own data.
    href: "/calendar",
    labelKey: "cal.nav",
    roles: ["ADMIN", "MANAGER", "RECEPTIONIST", "ACCOUNTANT", "TEACHER", "PARENT"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="M9 15.5l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/students",
    access: "students.view",

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
    access: "teachers.view",
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
    href: "/hiring",
    access: "hiring.manage",
    labelKey: "nav.hiring" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6M22 11h-6" />
      </svg>
    ),
  },
  {
    href: "/homework",
    access: "homework.view",
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
    access: "ai.use",
    feature: "AI_TOOLS",
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
    access: "exams.view",
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
    href: "/mock-tests",
    access: "mockTests.manage",
    feature: "MOCK_EXAMS",
    labelKey: "nav.mockTests" as TranslationKey,
    roles: ["SUPERADMIN", "ADMIN", "MANAGER", "TEACHER"],
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
      </svg>
    ),
  },
  {
    href: "/certificates",
    access: "certificates.manage",
    feature: "CERTIFICATES",
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
    access: "announcements.view",
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
    access: "ai.use",
    feature: "AI_TOOLS",
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
    access: "payments.view",
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
    access: "reports.finance",
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

// The platform superadmin outside any center: only what runs the platform.
// (Inside a center opened with "Ochish" the center's own menu is shown.)
const PLATFORM_ITEMS: Array<{ href: string; labelKey: TranslationKey; icon: React.ReactNode; exact?: boolean }> = [
  {
    href: "/admin/overview",
    labelKey: "nav.platformDashboard" as TranslationKey,
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
    // "/admin" itself is the centers list; the pages under it have their own items.
    href: "/admin",
    exact: true,
    labelKey: "nav.centers" as TranslationKey,
    icon: SUPERADMIN_ITEM.icon,
  },
  {
    href: "/admin/subscriptions",
    labelKey: "nav.subscriptions" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20M6 15h4" />
      </svg>
    ),
  },
  {
    href: "/pricing",
    labelKey: "nav.pricing" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
        <circle cx="7.5" cy="7.5" r="1.5" />
      </svg>
    ),
  },
  {
    href: "/admin/trials",
    labelKey: "nav.trials" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2 2M9 2h6" />
      </svg>
    ),
  },
  {
    href: "/admin/flags",
    labelKey: "nav.flags" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="10" rx="5" />
        <circle cx="16" cy="12" r="3" />
      </svg>
    ),
  },
  {
    href: "/admin/integrations",
    labelKey: "nav.integrations" as TranslationKey,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4" />
      </svg>
    ),
  },
];

/** The platform admin's home page (after sign-in, and from any page they cannot open). */
export const PLATFORM_HOME = "/admin/overview";

/** True for the superadmin while no center is opened. */
export function isPlatformMode(role?: Role, hasCenter?: boolean) {
  return role === "SUPERADMIN" && !hasCenter;
}

/**
 * Whether this role may open a back-office page: the same rule that decides
 * which menu items are shown, so a page hidden from the menu is not shown
 * through its address either. Pages that are not in the menu stay open (the
 * server still decides what data they get).
 */
export function canOpenPath(pathname: string, role?: Role, hasCenter = true, access?: string[]) {
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (isPlatformMode(role, hasCenter)) return PLATFORM_ITEMS.some((i) => under(i.href));
  if (under(SUPERADMIN_ITEM.href)) return role === "SUPERADMIN";
  const item = NAV_ITEMS.find((i) => under(i.href));
  return item ? canSee(item, role, access) : true;
}

const NAV_SCROLL_KEY = "sidebar-scroll";
const PIN_KEY = "talimcrm_rail_pinned";
const PIN_EVENT = "talimcrm-rail-pin";
function readPin() {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribePin(onChange: () => void) {
  window.addEventListener(PIN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PIN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The menu's sections (presentation only; who sees an item is canSee's call). */
const NAV_GROUPS: Array<{ id: "main" | "teaching" | "people" | "business"; label: TranslationKey }> = [
  { id: "main", label: "nav.groupMain" },
  { id: "teaching", label: "nav.groupTeaching" },
  { id: "people", label: "nav.groupPeople" },
  { id: "business", label: "nav.groupBusiness" },
];
const GROUP_OF: Record<string, (typeof NAV_GROUPS)[number]["id"]> = {
  "/dashboard": "main",
  "/leads": "main",
  "/messages": "main",
  "/calendar": "main",
  "/announcements": "main",
  "/groups": "teaching",
  "/schedule": "teaching",
  "/makeups": "teaching",
  "/homework": "teaching",
  "/ai-materials": "teaching",
  "/exams": "teaching",
  "/mock-tests": "teaching",
  "/certificates": "teaching",
  "/students": "people",
  "/teachers": "people",
  "/hiring": "people",
  "/payments": "business",
  "/reports": "business",
  "/ai-insights": "business",
  "/audit-log": "business",
  "/settings": "business",
};

export default function Sidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { user, tenant, logout, selectWorkspace } = useAuth();
  // Other centers this person works in: switching moves the session there
  // (no second login). Empty for most people, so nothing is shown.
  const [otherCenters, setOtherCenters] = useState<WorkspaceItem[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const userId = user?.id;
  const isSuperadmin = user?.role === "SUPERADMIN";
  const tenantId = tenant?.id;
  useEffect(() => {
    if (!userId || isSuperadmin || !tenantId) return;
    let alive = true;
    authApi
      .workspaces()
      .then((list) => {
        if (alive) setOtherCenters(list.filter((w) => w.tenantId !== tenantId));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId, isSuperadmin, tenantId]);
  async function switchTo(id: string) {
    setSwitching(id);
    try {
      await selectWorkspace(id);
    } catch {
      setSwitching(null);
    }
  }
  // Every page mounts its own shell, so the menu would jump back to the top
  // on each click. Keep its scroll position across pages, and make sure the
  // chosen item is in view.
  const navRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    try {
      const saved = Number(sessionStorage.getItem(NAV_SCROLL_KEY));
      if (saved > 0) el.scrollTop = saved;
    } catch {
      // storage unavailable (private mode): start at the top
    }
    // Scroll the menu itself rather than calling scrollIntoView: in Chromium
    // that also moves the keyboard's Tab starting point to the active item,
    // so the first Tab skipped "skip to content", the logo and earlier items.
    const reveal = () => {
      const item = el.querySelector<HTMLElement>("[data-active='true']");
      if (!item) return;
      const box = el.getBoundingClientRect();
      const r = item.getBoundingClientRect();
      // Out of view: bring it to the middle of the menu.
      if (r.top < box.top || r.bottom > box.bottom) el.scrollTop += r.top + r.height / 2 - (box.top + box.height / 2);
    };
    reveal();
    // The panel's footer (languages, account) renders a moment later and
    // shrinks the menu; reveal again while it settles, then stop watching so
    // the user's own scrolling is never overridden.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(reveal);
    ro.observe(el);
    const stop = window.setTimeout(() => ro.disconnect(), 1500);
    return () => {
      window.clearTimeout(stop);
      ro.disconnect();
    };
  }, [pathname]);
  const { t } = useLanguage();
  // Collapsed to an icon rail (it opens with its labels on hover or keyboard
  // focus) unless pinned open; the choice is remembered on this device.
  const pinned = useSyncExternalStore(subscribePin, readPin, () => false);
  function togglePin() {
    try {
      localStorage.setItem(PIN_KEY, pinned ? "0" : "1");
    } catch {
      // storage unavailable: the choice lasts until the page closes
    }
    window.dispatchEvent(new Event(PIN_EVENT));
  }
  // Unread messages next to "Messages" (for whoever has that page).
  const chatKey = userId && tenantId ? `${userId}:${tenantId}` : null;
  const seesChat = !isPlatformMode(user?.role, !!tenant) && canOpenPath("/messages", user?.role, !!tenant, user?.access);
  useChatUnreadRefresh(chatKey, seesChat);
  const chatUnread = useChatUnread(chatKey);

  const platform = isPlatformMode(user?.role, !!tenant);
  const visible = platform ? [] : NAV_ITEMS.filter((item) => canSee(item, user?.role, user?.access) && (!item.feature || planAllows(tenant?.entitlements, item.feature)));
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: visible.filter((i) => (GROUP_OF[i.href] ?? "business") === g.id) })).filter((g) => g.items.length > 0);
  const isActive = (href: string, exact?: boolean) => pathname === href || (!exact && pathname.startsWith(href + "/"));

  const link = (href: string, label: string, icon: React.ReactNode, active: boolean, extra?: React.ReactNode) => (
    <Link key={href} href={href} data-active={active} aria-current={active ? "page" : undefined} className={`nav-item rail-item${active ? " on" : ""}`}>
      <span className="rail-icon" aria-hidden="true">{icon}</span>
      <span className="rail-label">{label}</span>
      {extra}
    </Link>
  );

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <div className={`sidebar rail${pinned ? " rail-pinned" : ""}${open ? " sidebar-open" : ""}`}>
        <nav className="rail-panel" aria-label={t("shell.menuAriaLabel")}>
          <Link href={platform ? "/admin/overview" : "/dashboard"} className="rail-logo" title={platform ? "TalimCRM" : tenant?.name ?? "TalimCRM"}>
            {/* The center's own logo once set in Settings. */}
            {!platform && tenant?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(tenant.logoUrl) || ""} alt="" style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", objectFit: "cover", flexShrink: 0, background: "var(--surface)" }} />
            ) : (
              <span className="rail-logo-mark" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 10 12 5 2 10l10 5 10-5Z" />
                  <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
                </svg>
              </span>
            )}
            <span className="rail-label rail-brand">{platform ? "TalimCRM" : tenant?.name ?? "TalimCRM"}</span>
          </Link>

          <div
            ref={navRef}
            className="sidebar-nav-scroll rail-scroll"
            onScroll={(e) => {
              try {
                sessionStorage.setItem(NAV_SCROLL_KEY, String(e.currentTarget.scrollTop));
              } catch {
                // ignore
              }
            }}
          >
            {platform && (
              <div className="rail-group">
                <div className="rail-heading">{t("nav.groupPlatform")}</div>
                {PLATFORM_ITEMS.map((item) => link(item.href, t(item.labelKey), item.icon, isActive(item.href, item.exact)))}
              </div>
            )}

            {groups.map((g) => (
              <div key={g.id} className="rail-group">
                <div className="rail-heading">{t(g.label)}</div>
                {g.items.map((item) =>
                  link(
                    item.href,
                    t(item.labelKey),
                    item.icon,
                    isActive(item.href),
                    <>
                      {item.href === "/messages" && chatUnread !== null && chatUnread > 0 && (
                        <span data-testid="chat-unread-badge" className="rail-count">
                          <span aria-hidden="true">{chatUnread > 99 ? "99+" : chatUnread}</span>
                          <span className="sr-only">{t("chat.unreadN").replace("{n}", String(chatUnread))}</span>
                        </span>
                      )}
                      {"badge" in item && item.badge && <span className="rail-tag">{item.badge}</span>}
                    </>,
                  ),
                )}
              </div>
            ))}

            {user?.role === "SUPERADMIN" && tenant && (
              <div className="rail-group">
                <div className="rail-heading">{t("nav.groupPlatform")}</div>
                {link(SUPERADMIN_ITEM.href, t(SUPERADMIN_ITEM.labelKey), SUPERADMIN_ITEM.icon, isActive(SUPERADMIN_ITEM.href))}
              </div>
            )}
          </div>

          {otherCenters.length > 0 && (
            <div role="group" aria-label={t("nav.otherCenters")} className="rail-group rail-centers">
              <div className="rail-heading">{t("nav.otherCenters")}</div>
              {otherCenters.map((w) => (
                <button
                  key={w.tenantId}
                  type="button"
                  onClick={() => switchTo(w.tenantId)}
                  disabled={switching !== null}
                  className="nav-item rail-item btn"
                  title={centerHost(w.subdomain)}
                  style={{ opacity: switching && switching !== w.tenantId ? 0.5 : 1 }}
                >
                  <span className="rail-icon" aria-hidden="true">⇄</span>
                  <span className="rail-label">{switching === w.tenantId ? t("common.loading") : w.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="rail-foot">
            <button
              type="button"
              className="nav-item rail-item btn rail-pin"
              onClick={togglePin}
              aria-pressed={pinned}
              title={pinned ? t("nav.unpinMenu") : t("nav.pinMenu")}
            >
              <span className="rail-icon" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {pinned ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
                </svg>
              </span>
              <span className="rail-label">{pinned ? t("nav.unpinMenu") : t("nav.pinMenu")}</span>
            </button>
            <button onClick={logout} type="button" className="nav-item rail-item btn">
              <span className="rail-icon" aria-hidden="true">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
              </span>
              <span className="rail-label">{t("nav.logout")}</span>
            </button>
          </div>
        </nav>
      </div>
    </>
  );
}
