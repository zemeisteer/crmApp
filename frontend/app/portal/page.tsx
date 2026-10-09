"use client";

import PortalHome from "@/components/portal/PortalHome";
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import { centerTimeZone } from "@/lib/center-time";
import PortalExamList from "@/components/portal/PortalExams";
import PortalLogin from "@/components/portal/PortalLogin";
import { useCenterFromHost } from "@/lib/use-center-host";
import { AttendanceTab, HomeworkTab, PaymentsTab, ScheduleTab, TabTitle } from "@/components/portal/PortalTabs";
import PortalTutor from "@/components/portal/PortalTutor";
import PortalMessages from "@/components/portal/PortalMessages";
import PortalPractice from "@/components/portal/PortalPractice";
import PortalCustomFields from "@/components/portal/PortalCustomFields";
import type { Lang, TranslationKey } from "@/lib/i18n";
import {
  portalApi,
  fileUrl,
  getPortalToken,
  setPortalToken,
  getToken,
  getPortalSessions,
  addPortalSessions,
  type PortalSession,
  clearPortalToken,
  PortalMe,
  PortalSchedule,
  PortalAttendance,
  PortalHomework,
  PortalExams,
  PortalPayments,
  PortalAnnouncement,
  ApiError,
} from "@/lib/api";

const ACCENT = "#4F46E5";

type PortalTab = "home" | "schedule" | "attendance" | "homework" | "ai" | "practice" | "exams" | "payments" | "notifications";
const NAV: Array<{ id: PortalTab; icon: string; label: TranslationKey; short: TranslationKey; bottom: boolean }> = [
  { id: "home", icon: "🏠", label: "ptn.home", short: "ptn.home", bottom: true },
  { id: "schedule", icon: "🗓️", label: "ptn.schedule", short: "ptn.schedule", bottom: true },
  { id: "homework", icon: "📚", label: "ptn.homework", short: "ptn.homework", bottom: true },
  { id: "ai", icon: "🤖", label: "ptn.ai", short: "ptn.aiShort", bottom: true },
  { id: "practice", icon: "🎯", label: "ptn.practice", short: "ptn.practiceShort", bottom: true },
  { id: "exams", icon: "📝", label: "ptn.exams", short: "ptn.examsShort", bottom: true },
  { id: "payments", icon: "💳", label: "ptn.payments", short: "ptn.paymentsShort", bottom: true },
  { id: "attendance", icon: "✅", label: "ptn.attendance", short: "ptn.attendance", bottom: false },
  { id: "notifications", icon: "🔔", label: "ptn.notifications", short: "ptn.notifications", bottom: false },
];
const PORTAL_CSS = `
  .ptl-side{width:236px;flex:0 0 236px;background:#12131A;display:flex;flex-direction:column;padding:20px 14px 14px;box-sizing:border-box;height:100vh;position:sticky;top:0;align-self:flex-start;}
  .ptl-side-nav{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;margin-bottom:10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.12) transparent;}
  .ptl-side-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:none;border-radius:9px;background:transparent;color:#C7C9D1;font-size:14px;font-weight:600;font-family:inherit;text-align:left;cursor:pointer;white-space:nowrap;}
  .ptl-side-item:hover{background:rgba(255,255,255,0.06);}
  .ptl-side-item.on{background:#4F46E5;color:#fff;}
  .ptl-count{background:#EF4444;color:#fff;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:100px;line-height:1.5;}
  .ptl-ai-badge{font-size:9.5px;font-weight:800;background:linear-gradient(135deg,#8B7CF6,#4F46E5);color:#fff;padding:2px 6px;border-radius:5px;}
  .ptl-head{display:none;}
  .ptl-bell{position:relative;display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 8px;border-radius:9px;border:1px solid #E2E8F0;background:#F8FAFC;color:#475569;cursor:pointer;}
  .ptl-bell .ptl-count{position:absolute;top:-6px;right:-6px;}
  .ptl-bottom{display:none;}
  .ptl-kids{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
  .ptl-kids button{border:1px solid #EAE8E2;background:#fff;color:#4A4E58;border-radius:100px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}
  .ptl-kids button.on{background:#4F46E5;border-color:#4F46E5;color:#fff;}
  .ptl-kids button.add{border-style:dashed;color:#4F46E5;}
  .ptl-parent-badge{font-size:12px;font-weight:800;color:#9D174D;background:#FDF2F8;border-radius:100px;padding:6px 10px;margin-right:2px;}
  .ptl-add-child{background:linear-gradient(135deg,#0F172A,#1E1B4B);color:#fff;border-radius:18px;padding:18px;margin-bottom:14px;}
  .ptl-ai-cta{width:100%;display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:14px 16px;border:none;border-radius:16px;cursor:pointer;color:#fff;background:linear-gradient(135deg,#4F46E5,#7C3AED);box-shadow:0 14px 30px -18px rgba(79,70,229,0.9);font-family:inherit;}
  @media (max-width:760px){
    .ptl-side{display:none;}
    .ptl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:30;background:#fff;border-bottom:1px solid #E2E8F0;padding:10px 14px;}
    .ptl-bottom{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(255,255,255,0.97);backdrop-filter:blur(8px);border-top:1px solid #EAE8E2;padding:0 4px env(safe-area-inset-bottom);box-shadow:0 -6px 20px rgba(18,19,26,0.06);}
    .ptl-main{padding-bottom:96px!important;}
  }
`;

const svg = (children: React.ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
    {children}
  </svg>
);
const ICONS: Record<PortalTab | "logout" | "logo", React.ReactNode> = {
  home: svg(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  schedule: svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  homework: svg(<><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></>),
  ai: svg(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" /></>),
  practice: svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>),
  exams: svg(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  payments: svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
  attendance: svg(<><path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /><circle cx="10" cy="7" r="4" /></>),
  notifications: svg(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>),
  logout: svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>),
  logo: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
    </svg>
  ),
};

const initials = (name?: string | null) =>
  (name ?? "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

// Portal users (students, parents) pick their own language here.
function LangSwitch({ lang, setLang, dark, full }: { lang: Lang; setLang: (l: Lang) => void; dark?: boolean; full?: boolean }) {
  return (
    <div style={{ display: full ? "flex" : "inline-flex", gap: 4 }}>
      {(["UZ", "RU", "EN"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          style={{
            flex: full ? 1 : undefined, fontSize: 11, fontWeight: 700, padding: "5px 8px", borderRadius: 7, cursor: "pointer",
            border: "none",
            background: lang === l ? ACCENT : dark ? "rgba(255,255,255,0.08)" : "#F1F5F9",
            color: lang === l ? "#fff" : dark ? "#9A9CA5" : "#64748B",
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export default function StudentPortalPage() {
  const { t, lang, setLang } = useLanguage();
  const hostCenter = useCenterFromHost();
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [token, setTokenState] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PortalSession[]>([]);
  const [addingChild, setAddingChild] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PortalTab>("home");

  // Auth form state
  const [authError, setAuthError] = useState<string | null>(null);

  // Portal data states
  const [me, setMe] = useState<PortalMe | null>(null);
  const [schedule, setSchedule] = useState<PortalSchedule | null>(null);
  const [attendance, setAttendance] = useState<PortalAttendance | null>(null);
  const [homework, setHomework] = useState<PortalHomework[]>([]);
  const [exams, setExams] = useState<PortalExams | null>(null);
  const [payments, setPayments] = useState<PortalPayments | null>(null);
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  async function handlePayOnline(provider: "CLICK" | "PAYME") {
    if (!payments || payments.debtAmount <= 0) return;
    setPayError(null);
    setCheckoutLoading(provider);
    try {
      const res = await portalApi.createCheckoutLink({
        provider,
        amount: payments.debtAmount,
        forMonth: payments.forMonth,
      });
      if (res.url) {
        window.open(res.url, "_blank");
      }
    } catch {
      setPayError(t("ptl.linkError"));
    } finally {
      setCheckoutLoading(null);
    }
  }

  // Check token and initialize
  useEffect(() => {
    // If Telegram WebApp SDK is available, notify ready
    if (typeof window !== "undefined" && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      tg.ready();
      tg.expand();
    }

    const searchParams = new URLSearchParams(window.location.search);
    const urlToken = searchParams.get("token");

    if (urlToken) {
      portalApi
        .loginWithToken(urlToken)
        .then((res) => {
          setPortalToken(res.accessToken);
          setTokenState(res.accessToken);
          // Clean token from url without refresh
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((err) => {
          setAuthError(err instanceof ApiError ? err.message : t("ptl.badLink"));
        })
        .finally(() => {
          setLoading(false);
        });
      return;
    }

    const stored = getPortalToken();
    setSessions(getPortalSessions());
    if (stored) {
      setTokenState(stored);
      setLoading(false);
      return;
    }
    // A parent signed in with their own account: open their children.
    const staff = getToken();
    if (staff) {
      portalApi
        .parentAccount(staff)
        .then((res) => activate(res.sessions))
        .catch(() => undefined)
        .finally(() => setLoading(false));
      return;
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep every signed-in child; show the chosen one.
  function activate(list: PortalSession[], activeId?: string) {
    if (list.length === 0) return;
    const all = addPortalSessions(list);
    const pick = list.find((s) => s.student.id === activeId) ?? list[0];
    setPortalToken(pick.accessToken);
    setSessions(all);
    setTokenState(pick.accessToken);
    setActiveTab("home");
    setAddingChild(false);
  }

  function switchChild(s: PortalSession) {
    if (s.accessToken === token) return;
    setPortalToken(s.accessToken);
    setTokenState(s.accessToken);
    setActiveTab("home");
    window.scrollTo(0, 0);
  }

  // Load portal data once token exists
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(false);

    Promise.all([
      portalApi.getMe(),
      portalApi.getSchedule(),
      portalApi.getAttendance(),
      portalApi.getHomework(),
      portalApi.getExams(),
      portalApi.getPayments(),
      portalApi.getAnnouncements(),
    ])
      .then(([m, s, a, h, e, p, ann]) => {
        setMe(m);
        setSchedule(s);
        setAttendance(a);
        setHomework(h);
        setExams(e);
        setPayments(p);
        setAnnouncements(ann);
      })
      .catch((err) => {
        // Only an expired/invalid session signs the student out; a busy
        // server (429) or a network blip keeps them in to retry.
        if (err instanceof ApiError && err.status === 401) {
          clearPortalToken();
          setTokenState(null);
        } else {
          setLoadError(true);
        }
      })
      .finally(() => setLoading(false));
  }, [token, reloadKey]);

  // Unread announcements, plus the debt reminder while money is owed.
  const notifCount = announcements.filter((a) => !a.read).length + (payments && payments.debtAmount > 0 ? 1 : 0);

  // One id, or every announcement when none is given. The badge updates at
  // once; the server keeps the read state per student.
  async function markRead(id?: string) {
    setAnnouncements((prev) => prev.map((a) => (!id || a.id === id ? { ...a, read: true } : a)));
    try {
      if (id) await portalApi.readAnnouncement(id);
      else await portalApi.readAllAnnouncements();
    } catch {
      setAnnouncements(await portalApi.getAnnouncements().catch(() => announcements));
    }
  }

  function go(tab: PortalTab) {
    setActiveTab(tab);
    window.scrollTo(0, 0);
  }

  function handleLogout() {
    clearPortalToken();
    setSessions([]);
    setTokenState(null);
    setMe(null);
  }

  const isParent = me?.viewer === "parent";
  const nav = NAV.filter((x) => !(isParent && x.id === "ai"));

  async function handleHomeworkSubmit(id: string, data: { text?: string; file?: File | null }) {
    try {
      await portalApi.submitHomework(id, data);
      // Reload to show the stored answer (text, photo) under the task.
      setHomework(await portalApi.getHomework());
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("ptl.submitError"));
      throw err;
    }
  }

  // -------------------------------------------------------------
  // Render Login Screen if not authenticated
  // -------------------------------------------------------------
  if (!token) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          fontFamily: "'Inter', sans-serif",
          color: "#fff",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "rgba(30, 41, 59, 0.75)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 24,
            padding: "32px 24px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
                boxShadow: "0 8px 16px rgba(79, 70, 229, 0.4)",
                marginBottom: 12,
              }}
            >
              🎓
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}><LangSwitch lang={lang} setLang={setLang} dark /></div>
            {hostCenter?.name && <div style={{ fontSize: 13, fontWeight: 700, color: "#A5B4FC", marginBottom: 4 }}>{hostCenter.name}</div>}
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px 0" }}>
              {t("ptl.cabinet")}
            </h1>
            <p style={{ fontSize: 13, color: "#94A3B8", margin: 0 }}>
              {t("ptl.subtitle")}
            </p>
          </div>

          {authError && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#FCA5A5",
                fontSize: 13,
                fontWeight: 600,
                padding: "10px 14px",
                borderRadius: 12,
                marginBottom: 16,
              }}
            >
              {authError}
            </div>
          )}

          <PortalLogin
            subdomain={hostCenter?.subdomain}
            onLoggedIn={(list, activeId) => {
              activate(list, activeId);
            }}
          />

          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid rgba(255, 255, 255, 0.1)",
              textAlign: "center",
              fontSize: 12,
              color: "#94A3B8",
            }}
          >
            {t("ptl.telegramHint")}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render Loading
  // -------------------------------------------------------------
  if (loading && !me) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#F8FAFC",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', sans-serif",
          color: "#64748B",
          fontSize: 14,
        }}
      >
        {t("common.loading")}
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render Full Portal Interface
  // -------------------------------------------------------------
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F7F7F5",
        color: "#181A1F",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
      }}
    >
      <style>{PORTAL_CSS}</style>
      {/* Desktop: dark sidebar like the staff app. Phones: bottom bar. */}
      <aside className="ptl-side">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 20px" }}>
          {me?.tenant?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(me.tenant.logoUrl) || ""} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "#fff" }} />
          ) : (
            <div style={{ width: 30, height: 30, borderRadius: 8, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ICONS.logo}</div>
          )}
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 16, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={me?.tenant?.name}>
            {me?.tenant?.name || t("ptl.center")}
          </span>
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5B5E68", padding: "0 10px 8px" }}>{t("ptl.cabinet")}</div>
        <nav className="ptl-side-nav" aria-label="menu">
          {nav.map((tab) => {
            const on = activeTab === tab.id;
            return (
              <button key={tab.id} type="button" onClick={() => go(tab.id)} aria-current={on ? "page" : undefined} className={`ptl-side-item${on ? " on" : ""}`}>
                {ICONS[tab.id]}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t(tab.label)}</span>
                {tab.id === "notifications" && notifCount > 0 && <span className="ptl-count">{notifCount}</span>}
                {tab.id === "ai" && <span className="ptl-ai-badge">AI</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: "0 4px 10px" }}><LangSwitch lang={lang} setLang={setLang} dark full /></div>
        <button type="button" onClick={handleLogout} className="ptl-side-item">
          {ICONS.logout}
          {t("ptl.logout")}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px 0", marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: ACCENT, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
            {initials(me?.fullName)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me?.fullName || t("ptl.student")}</div>
            <div style={{ fontSize: 11, color: "#686B75" }}>{isParent ? t("ptp.parentView") : t("ptl.student")}</div>
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {/* Phone header: center, messages, language, sign out */}
      <header className="ptl-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 11, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🎓</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me?.tenant?.name || t("ptl.center")}</div>
            <div style={{ fontSize: 11.5, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me?.fullName || t("ptl.student")}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={() => go("notifications")} aria-label={t("ptl.messages")} className="ptl-bell">
            {ICONS.notifications}
            {notifCount > 0 && <span className="ptl-count">{notifCount}</span>}
          </button>
          <LangSwitch lang={lang} setLang={setLang} />
          <button type="button" onClick={handleLogout} aria-label={t("ptl.logout")} className="ptl-bell">{ICONS.logout}</button>
        </div>
      </header>
      <nav className="ptl-bottom" aria-label="menu">
        {nav.filter((x) => x.bottom).map((tab) => {
          const on = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" onClick={() => go(tab.id)} aria-current={on ? "page" : undefined} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 2px 6px", border: "none", background: "transparent", color: on ? ACCENT : "#686B75", cursor: "pointer" }}>
              <span aria-hidden style={{ fontSize: 19, lineHeight: 1, filter: on ? "none" : "grayscale(1)", opacity: on ? 1 : 0.75 }}>{tab.icon}</span>
              <span style={{ fontSize: 10.5, fontWeight: on ? 800 : 600, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(tab.short)}</span>
              <span style={{ width: 18, height: 3, borderRadius: 3, background: on ? ACCENT : "transparent" }} />
            </button>
          );
        })}
      </nav>

      {/* Main Container */}
      <main
        style={{
          flex: 1,
          maxWidth: 1000,
          width: "100%",
          margin: "0 auto",
          padding: "20px 16px 40px 16px",
          boxSizing: "border-box",
        }}
        className="ptl-main"
      >
        {/* ========================================================================= */}
        {/* TAB: HOME                                                                 */}
        {/* ========================================================================= */}
        {loadError && (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", fontSize: 13.5 }}>
            <span>⚠️ {t("ptl.loadError")}</span>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} style={{ background: "#D97706", color: "#fff", border: "none", borderRadius: 9, padding: "7px 12px", fontWeight: 700, cursor: "pointer" }}>↻ {t("ptl.retry")}</button>
          </div>
        )}
        {(isParent || sessions.length > 1) && (
          <div className="ptl-kids">
            {isParent && <span className="ptl-parent-badge">👪 {t("ptp.parentView")}</span>}
            {sessions.map((s) => (
              <button key={s.student.id} type="button" onClick={() => switchChild(s)} aria-pressed={s.accessToken === token} className={s.accessToken === token ? "on" : ""}>
                {s.student.fullName.split(" ")[0]}
              </button>
            ))}
            <button type="button" onClick={() => setAddingChild((v) => !v)} className="add">＋ {t("ptp.addChild")}</button>
          </div>
        )}
        {addingChild && (
          <div className="ptl-add-child">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 }}>
              <div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 16 }}>{t("ptp.addChild")}</div>
                <div style={{ fontSize: 12.5, color: "#94A3B8", marginTop: 2 }}>{t("ptp.addChildHint")}</div>
              </div>
              <button type="button" onClick={() => setAddingChild(false)} aria-label={t("common.cancel")} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <PortalLogin subdomain={hostCenter?.subdomain} onLoggedIn={(list, activeId) => activate(list, activeId)} />
          </div>
        )}
        {activeTab === "home" && !isParent && (
          <button type="button" onClick={() => go("ai")} className="ptl-ai-cta">
            <span style={{ fontSize: 26 }} aria-hidden>🤖</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "block", fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15.5 }}>{t("tutor.ctaTitle")}</span>
              <span style={{ display: "block", fontSize: 13, opacity: 0.85, marginTop: 2 }}>{t("tutor.ctaText")}</span>
            </span>
            <span aria-hidden style={{ fontSize: 18 }}>→</span>
          </button>
        )}
        {activeTab === "home" && (
          <PortalHome
            me={me}
            schedule={schedule}
            attendance={attendance}
            homework={homework}
            payments={payments}
            announcements={announcements}
            onOpen={(tab) => go(tab)}
            onReadAnnouncement={(id) => void markRead(id)}
            parent={isParent}
          />
        )}
        {activeTab === "home" && <PortalCustomFields key={token ?? ""} token={token} />}

        {activeTab === "schedule" && <ScheduleTab key={token ?? ""} schedule={schedule} tz={centerTimeZone(me?.tenant?.timezone)} />}
        {activeTab === "attendance" && <AttendanceTab attendance={attendance} tz={centerTimeZone(me?.tenant?.timezone)} />}
        {activeTab === "homework" && <HomeworkTab homework={homework} onSubmit={handleHomeworkSubmit} readOnly={isParent} />}
        {activeTab === "ai" && !isParent && <PortalTutor firstName={me?.fullName?.split(" ")[0]} />}

        {/* ========================================================================= */}
        {/* TAB: EXAMS                                                                */}
        {/* ========================================================================= */}
        {activeTab === "practice" && <PortalPractice key={token ?? ""} readOnly={isParent} />}
        {activeTab === "exams" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <TabTitle title={t("ptl.examsCerts")} />

            <PortalExamList readOnly={isParent} onFinished={() => portalApi.getExams().then(setExams).catch(() => undefined)} />

            {/* Certificates */}
            {exams?.certificates && exams.certificates.length > 0 && (
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 10 }}>
                  {t("ptl.certs")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {exams.certificates.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        background: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)",
                        border: "1px solid #FCD34D",
                        borderRadius: 16,
                        padding: 16,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#78350F" }}>
                          {c.title}
                        </div>
                        <div style={{ fontSize: 12, color: "#92400E", marginTop: 2 }}>
                          Kod: {c.code} {c.grade ? `• Daraja: ${c.grade}` : ""}
                        </div>
                      </div>
                      <a
                        href={c.verifyUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          background: "#B45309",
                          color: "#fff",
                          textDecoration: "none",
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "6px 12px",
                          borderRadius: 8,
                        }}
                      >
                        {t("ptl.verify")}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Exam Results */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#334155", marginBottom: 10 }}>
                {t("ptl.examResults")}
              </div>
              {exams?.results.length === 0 && exams?.attempts.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #E2E8F0",
                    borderRadius: 16,
                    padding: 32,
                    textAlign: "center",
                    color: "#64748B",
                  }}
                >
                  {t("ptl.noResults")}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {exams?.results.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        background: "#fff",
                        border: "1px solid #E2E8F0",
                        borderRadius: 14,
                        padding: 16,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>
                          {r.examTitle || t("ptl.exam")}
                        </div>
                        {r.note && (
                          <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                            {r.note}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: ACCENT }}>
                        {r.score} {t("ptl.points")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "payments" && <PaymentsTab payments={payments} checkoutLoading={checkoutLoading} onPay={handlePayOnline} payError={payError} />}

        {/* ========================================================================= */}
        {/* TAB: NOTIFICATIONS                                                        */}
        {/* ========================================================================= */}
        {activeTab === "notifications" && (
          <PortalMessages
            announcements={announcements}
            debt={payments && payments.debtAmount > 0 ? { amount: payments.debtAmount, forMonth: payments.forMonth } : null}
            onPay={() => go("payments")}
            onRead={markRead}
          />
        )}
      </main>
      </div>
    </div>
  );
}
