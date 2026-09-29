"use client";

import PortalHome from "@/components/portal/PortalHome";
import { formatDateTime } from "@/lib/format-date";
import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import PortalExamList from "@/components/portal/PortalExams";
import PortalLogin from "@/components/portal/PortalLogin";
import { AttendanceTab, HomeworkTab, PaymentsTab, ScheduleTab, TabTitle } from "@/components/portal/PortalTabs";
import PortalTutor from "@/components/portal/PortalTutor";
import type { Lang, TranslationKey } from "@/lib/i18n";
import {
  portalApi,
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

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

type PortalTab = "home" | "schedule" | "attendance" | "homework" | "ai" | "exams" | "payments" | "notifications";
const NAV: Array<{ id: PortalTab; icon: string; label: TranslationKey; short: TranslationKey; bottom: boolean }> = [
  { id: "home", icon: "🏠", label: "ptn.home", short: "ptn.home", bottom: true },
  { id: "schedule", icon: "🗓️", label: "ptn.schedule", short: "ptn.schedule", bottom: true },
  { id: "homework", icon: "📚", label: "ptn.homework", short: "ptn.homework", bottom: true },
  { id: "ai", icon: "🤖", label: "ptn.ai", short: "ptn.aiShort", bottom: true },
  { id: "exams", icon: "📝", label: "ptn.exams", short: "ptn.examsShort", bottom: true },
  { id: "payments", icon: "💳", label: "ptn.payments", short: "ptn.paymentsShort", bottom: true },
  { id: "attendance", icon: "✅", label: "ptn.attendance", short: "ptn.attendance", bottom: false },
  { id: "notifications", icon: "🔔", label: "ptn.notifications", short: "ptn.notifications", bottom: false },
];
const PORTAL_CSS = `
  .ptl-bottom{display:none;}
  .ptl-kids{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
  .ptl-kids button{border:1px solid #EAE8E2;background:#fff;color:#4A4E58;border-radius:100px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}
  .ptl-kids button.on{background:#4F46E5;border-color:#4F46E5;color:#fff;}
  .ptl-kids button.add{border-style:dashed;color:#4F46E5;}
  .ptl-parent-badge{font-size:12px;font-weight:800;color:#9D174D;background:#FDF2F8;border-radius:100px;padding:6px 10px;margin-right:2px;}
  .ptl-add-child{background:linear-gradient(135deg,#0F172A,#1E1B4B);color:#fff;border-radius:18px;padding:18px;margin-bottom:14px;}
  .ptl-ai-cta{width:100%;display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:14px 16px;border:none;border-radius:16px;cursor:pointer;color:#fff;background:linear-gradient(135deg,#4F46E5,#7C3AED);box-shadow:0 14px 30px -18px rgba(79,70,229,0.9);font-family:inherit;}
  @media (max-width:640px){
    .ptl-top{display:none;}
    .ptl-bottom{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(255,255,255,0.97);backdrop-filter:blur(8px);border-top:1px solid #EAE8E2;padding:0 4px env(safe-area-inset-bottom);box-shadow:0 -6px 20px rgba(18,19,26,0.06);}
    .ptl-main{padding-bottom:96px!important;}
  }
`;

// Portal users (students, parents) pick their own language here.
function LangSwitch({ lang, setLang, dark }: { lang: Lang; setLang: (l: Lang) => void; dark?: boolean }) {
  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      {(["UZ", "RU", "EN"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          style={{
            fontSize: 11, fontWeight: 700, padding: "5px 8px", borderRadius: 7, cursor: "pointer",
            border: "none",
            background: lang === l ? ACCENT : dark ? "rgba(255,255,255,0.1)" : "#F1F5F9",
            color: lang === l ? "#fff" : dark ? "#CBD5E1" : "#64748B",
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

  async function handlePayOnline(provider: "CLICK" | "PAYME") {
    if (!payments || payments.debtAmount <= 0) return;
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
    } catch (err) {
      alert(err instanceof Error ? err.message : t("ptl.linkError"));
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
      .catch(() => {
        clearPortalToken();
        setTokenState(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const notifCount = announcements.length + (payments && payments.debtAmount > 0 ? 1 : 0);

  function handleLogout() {
    clearPortalToken();
    setSessions([]);
    setTokenState(null);
    setMe(null);
  }

  const isParent = me?.viewer === "parent";
  const nav = NAV.filter((x) => !(isParent && x.id === "ai"));

  async function handleHomeworkSubmit(id: string) {
    try {
      await portalApi.submitHomework(id);
      // update state locally
      setHomework((prev) =>
        prev.map((hw) => (hw.id === id ? { ...hw, completed: true } : hw)),
      );
    } catch (err) {
      alert(err instanceof ApiError ? err.message : t("ptl.submitError"));
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
        flexDirection: "column",
      }}
    >
      {/* Top Navbar */}
      <header
        style={{
          background: "#fff",
          borderBottom: "1px solid #E2E8F0",
          padding: "14px 20px",
          position: "sticky",
          top: 0,
          zIndex: 30,
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div
          style={{
            maxWidth: 1000,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
            <div
              style={{
                flexShrink: 0,
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "#EEF2FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
              }}
            >
              🎓
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1E293B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {me?.tenant?.name || t("ptl.center")}
              </div>
              <div style={{ fontSize: 11.5, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {me?.fullName || t("ptl.student")}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setActiveTab("notifications")}
              style={{
                position: "relative",
                background: activeTab === "notifications" ? "#EEF2FF" : "#F8FAFC",
                color: activeTab === "notifications" ? ACCENT : "#475569",
                border: activeTab === "notifications" ? `1.5px solid ${ACCENT}` : "1px solid #E2E8F0",
                fontSize: 12.5,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="hide-sm">{t("ptl.messages")}</span>
              {notifCount > 0 && (
                <span
                  style={{
                    background: "#EF4444",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 800,
                    padding: "1px 6px",
                    borderRadius: 100,
                  }}
                >
                  {notifCount}
                </span>
              )}
            </button>
            <LangSwitch lang={lang} setLang={setLang} />
            <button
              onClick={handleLogout}
              style={{
                background: "#F1F5F9",
                color: "#64748B",
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {t("ptl.logout")}
            </button>
          </div>
        </div>
      </header>

      <style>{PORTAL_CSS}</style>
      {/* Tabs: a pill row on wide screens, a bottom bar on phones */}
      <div className="ptl-top" style={{ background: "#fff", borderBottom: "1px solid #EAE8E2" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", padding: "10px 16px", gap: 6, overflowX: "auto" }}>
          {nav.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: activeTab === tab.id ? 700 : 600, background: activeTab === tab.id ? "#EEF0FF" : "transparent", color: activeTab === tab.id ? ACCENT : "#6B6E78", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              <span aria-hidden>{tab.icon}</span>
              {t(tab.label)}
              {tab.id === "notifications" && notifCount > 0 && <span style={{ background: "#EF4444", color: "#fff", fontSize: 10.5, fontWeight: 800, padding: "1px 6px", borderRadius: 100 }}>{notifCount}</span>}
            </button>
          ))}
        </div>
      </div>
      <nav className="ptl-bottom" aria-label="menu">
        {nav.filter((x) => x.bottom).map((tab) => {
          const on = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" onClick={() => { setActiveTab(tab.id); window.scrollTo(0, 0); }} aria-current={on ? "page" : undefined} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "8px 2px 6px", border: "none", background: "transparent", color: on ? ACCENT : "#8A8D96", cursor: "pointer" }}>
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
            <PortalLogin onLoggedIn={(list, activeId) => activate(list, activeId)} />
          </div>
        )}
        {activeTab === "home" && !isParent && (
          <button type="button" onClick={() => setActiveTab("ai")} className="ptl-ai-cta">
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
            onOpen={(tab) => setActiveTab(tab)}
            parent={isParent}
          />
        )}

        {activeTab === "schedule" && <ScheduleTab schedule={schedule} />}
        {activeTab === "attendance" && <AttendanceTab attendance={attendance} />}
        {activeTab === "homework" && <HomeworkTab homework={homework} onSubmit={handleHomeworkSubmit} readOnly={isParent} />}
        {activeTab === "ai" && !isParent && <PortalTutor firstName={me?.fullName?.split(" ")[0]} />}

        {/* ========================================================================= */}
        {/* TAB: EXAMS                                                                */}
        {/* ========================================================================= */}
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

        {activeTab === "payments" && <PaymentsTab payments={payments} checkoutLoading={checkoutLoading} onPay={handlePayOnline} />}

        {/* ========================================================================= */}
        {/* TAB: NOTIFICATIONS                                                        */}
        {/* ========================================================================= */}
        {activeTab === "notifications" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Header Banner */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #E2E8F0",
                borderRadius: 18,
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>
                  {t("ptl.notifTitle")}
                </h2>
                <p style={{ margin: 0, fontSize: 13, color: "#64748B" }}>
                  {t("ptl.notifHint")}
                </p>
              </div>
              <span
                style={{
                  background: "#EEF2FF",
                  color: ACCENT,
                  padding: "6px 14px",
                  borderRadius: 100,
                  fontSize: 12,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                {t("ptl.total")}: {announcements.length + (payments && payments.debtAmount > 0 ? 1 : 0)}
              </span>
            </div>

            {/* Debt Reminder (if applicable) */}
            {payments && payments.debtAmount > 0 && (
              <div
                style={{
                  background: "#FFFBEB",
                  border: "1.5px solid #FDE68A",
                  borderRadius: 16,
                  padding: "18px 22px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  boxShadow: "0 2px 6px rgba(245,158,11,0.08)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: "#FEF3C7",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    💳
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span
                        style={{
                          background: "#F59E0B",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 800,
                          padding: "2px 8px",
                          borderRadius: 100,
                        }}
                      >
                        {t("ptl.payReminder")}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#92400E" }}>
                        {t("ptl.payDue")}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12.5, color: "#78350F", lineHeight: 1.5 }}>
                      {t("ptl.debtNotice")} <strong>{formatMoney(payments.debtAmount)} {t("common.sumUnit")}</strong> ({payments.forMonth})
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab("payments")}
                  style={{
                    background: "#D97706",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "9px 18px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {t("ptl.pay")}
                </button>
              </div>
            )}

            {/* Announcements List */}
            {announcements.length === 0 && (!payments || payments.debtAmount <= 0) ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: 16,
                  padding: "48px 24px",
                  textAlign: "center",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1E293B", margin: "0 0 6px" }}>
                  {t("ptl.noNotifs")}
                </h3>
                <p style={{ fontSize: 13, color: "#64748B", margin: 0 }}>
                  {t("ptl.allRead")}
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {announcements.map((item) => {
                  const isUrgent = item.priority === "URGENT";
                  const isHigh = item.priority === "HIGH";

                  return (
                    <div
                      key={item.id}
                      style={{
                        background: "#fff",
                        border: isUrgent ? "1.5px solid #FECDD3" : isHigh ? "1.5px solid #FDE68A" : "1px solid #E2E8F0",
                        borderRadius: 16,
                        padding: "18px 22px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              background: isUrgent ? "#F43F5E" : isHigh ? "#F59E0B" : "#EEF2FF",
                              color: isUrgent || isHigh ? "#fff" : ACCENT,
                              fontSize: 10.5,
                              fontWeight: 800,
                              padding: "3px 9px",
                              borderRadius: 100,
                            }}
                          >
                            {isUrgent ? t("ptl.urgent") : isHigh ? t("ptl.important") : t("ptl.announcement")}
                          </span>
                          <span style={{ fontSize: 11.5, color: "#94A3B8", fontWeight: 600 }}>
                            {formatDateTime(item.createdAt, lang)}
                          </span>
                        </div>
                      </div>

                      <h3 style={{ fontSize: 15.5, fontWeight: 800, color: "#0F172A", margin: 0 }}>
                        {item.title}
                      </h3>

                      <p style={{ fontSize: 13, color: "#334155", margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                        {item.content}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
