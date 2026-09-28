"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n-context";
import { LANDING_TEXT, type LandingLang } from "./landing-text";

// Public home page — a port of the original talimcrm-demo design
// (Downloads/talimcrm-demo/index.html), in three languages and phone-ready.

const ACCENT = "#4F46E5";
const LANG_LABELS: Record<LandingLang, string> = { UZ: "O'zbekcha", RU: "Русский", EN: "English" };

const CSS = `
  .lp-root{--bg:#F7F7F5;--surface:#FFFFFF;--border:#EAE8E2;--text:#181A1F;--text-2:#4A4E58;--muted:#8A8D96;--chip:#F2F1EC;color:var(--text);background:var(--bg);font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;}
  .lp-root h1,.lp-root h2,.lp-root h3{font-family:'Manrope',system-ui,sans-serif;margin:0;}
  .lp-root a{color:inherit;text-decoration:none;}
  .lp-btn{cursor:pointer;border:none;transition:opacity .15s ease,transform .15s ease;display:inline-flex;align-items:center;justify-content:center;}
  .lp-btn:hover{opacity:.92;}
  .lp-reveal{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1);}
  .lp-reveal.in-view{opacity:1;transform:translateY(0);}
  .lp-group>.lp-reveal:nth-child(2){transition-delay:.1s;}
  .lp-group>.lp-reveal:nth-child(3){transition-delay:.2s;}
  .lp-group>.lp-reveal:nth-child(4){transition-delay:.3s;}
  .lp-track{display:flex;gap:20px;width:max-content;}
  .lp-left{animation:lp-left 22s linear infinite;}
  .lp-right{animation:lp-right 22s linear infinite;}
  @keyframes lp-left{from{transform:translateX(0);}to{transform:translateX(-50%);}}
  @keyframes lp-right{from{transform:translateX(-50%);}to{transform:translateX(0);}}
  .lp-pill{flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:14px 26px;border-radius:12px;background:var(--chip);border:1px solid var(--border);color:var(--muted);font-family:'Manrope',sans-serif;font-weight:700;font-size:14px;white-space:nowrap;}
  .lp-pane{animation:lp-fade .5s ease;}
  @keyframes lp-fade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
  .lp-lang-code{display:none;}
  .lp-wrap{max-width:1200px;margin:0 auto;width:100%;box-sizing:border-box;}
  .lp-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;}
  .lp-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;}
  .lp-hero{display:flex;align-items:center;gap:64px;padding:88px 32px 64px;}
  .lp-split{display:flex;align-items:center;gap:64px;padding:96px 32px;}
  .lp-section{padding:96px 32px;box-sizing:border-box;width:100%;}
  .lp-cta{max-width:1200px;margin:0 auto;background:${ACCENT};border-radius:24px;padding:56px;display:flex;align-items:center;justify-content:space-between;gap:24px;}
  @media (max-width:980px){
    .lp-grid4{grid-template-columns:repeat(2,minmax(0,1fr));}
    .lp-grid3{grid-template-columns:minmax(0,1fr);}
    .lp-hero,.lp-split{flex-direction:column;align-items:stretch;gap:40px;}
    .lp-nav{display:none!important;}
  }
  @media (max-width:640px){
    .lp-grid4{grid-template-columns:minmax(0,1fr);}
    .lp-hero{padding:48px 16px 40px;}
    .lp-split{padding:56px 16px;}
    .lp-section{padding:56px 16px;}
    .lp-hero h1{font-size:36px!important;}
    .lp-root h2{font-size:26px!important;}
    .lp-header{padding:14px 16px!important;}
    .lp-header-login{display:none!important;}
    .lp-lang-label{display:none;}
    .lp-lang-code{display:inline!important;}
    .lp-start{padding:9px 14px!important;font-size:13.5px!important;}
    .lp-header-right{gap:8px!important;}
    .lp-cta{flex-direction:column;align-items:flex-start;padding:32px 24px;}
    .lp-phone{width:100%!important;max-width:360px;}
    .lp-footer{flex-direction:column;gap:14px;align-items:flex-start!important;}
  }
`;

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 };
const label: CSSProperties = { fontSize: 13, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.04em" };

function Icon({ d, color, size = 20 }: { d: ReactNode; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

const Check = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1FA463" strokeWidth="2.6" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

function Dots({ active, onPick }: { active: number; onPick: (i: number) => void }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          onClick={() => onPick(i)}
          style={{ display: "block", width: i === active ? 16 : 6, height: 6, borderRadius: 100, background: i === active ? ACCENT : "#EAE8E2", transition: "all .3s ease", cursor: "pointer" }}
        />
      ))}
    </>
  );
}

// Rotates 0..2 on an interval (the demo's slideshows).
function useRotate(ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % 3), ms);
    return () => clearInterval(id);
  }, [ms]);
  return [i, setI] as const;
}

export default function Landing() {
  const { lang, setLang } = useLanguage();
  const L = LANDING_TEXT[(lang as LandingLang) in LANDING_TEXT ? (lang as LandingLang) : "UZ"];
  const [hero, setHero] = useRotate(4000);
  const [portal, setPortal] = useRotate(4500);
  const [langOpen, setLangOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  // Cards slide in as they scroll into view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      root?.querySelectorAll(".lp-reveal").forEach((el) => el.classList.add("in-view"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in-view");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    root.querySelectorAll(".lp-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!langOpen) return;
    const close = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [langOpen]);

  const lessonRow = (initials: string, bg: string, fg: string, title: string, time: string, fill: string) => (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: fg, fontSize: 13 }}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{time}</div>
      </div>
      <div style={{ width: 34, height: 8, borderRadius: 5, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: fill, height: "100%", background: fg }} />
      </div>
    </div>
  );
  const stat = (name: string, value: string, color?: string) => (
    <div style={{ ...card, flex: 1, padding: 12 }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{name}</div>
      <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Manrope',sans-serif", color }}>{value}</div>
    </div>
  );
  const paneHead = (title: string, tag: string, tagColor: string, tagBg: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15 }}>{title}</span>
      <span style={{ fontSize: 12, color: tagColor, fontWeight: 700, background: tagBg, padding: "4px 10px", borderRadius: 100 }}>{tag}</span>
    </div>
  );
  const paidRow = (name: string, group: string, amount: string) => (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: "#E9F8EF", display: "flex", alignItems: "center", justifyContent: "center", color: "#1FA463" }}>
        <Icon d={<path d="M20 6 9 17l-5-5" />} color="currentColor" size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{group}</div>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap" }}>{amount}</div>
    </div>
  );

  const whoStyles = [
    { bg: "#F3F1FF", icon: "#E1DCFF", stroke: "#6B4FE0", d: <path d="M4 6h16M4 12h16M4 18h7" /> },
    { bg: "#E6F7F4", icon: "#CDEFE9", stroke: "#0E8A78", d: <><path d="M16 18 22 12 16 6" /><path d="M8 6 2 12 8 18" /></> },
    { bg: "#FFF1E5", icon: "#FFE2C9", stroke: "#C4611A", d: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6" /></> },
    { bg: "#FDEAEC", icon: "#FBD4D9", stroke: "#C6394A", d: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  ];
  const featureStyles = [
    { bg: "#ECEBFB", stroke: ACCENT, d: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></> },
    { bg: "#E9F8EF", stroke: "#1FA463", d: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></> },
    { bg: "#FFF1E8", stroke: "#EA7A3A", d: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 18h6" /></> },
    { bg: "#FDEBEC", stroke: "#E15361", d: <><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></> },
  ];
  const aiIcons = [
    <path key="a" d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />,
    <g key="b"><path d="M12 2a7 7 0 0 0-4 12.75c.6.47 1 1.2 1 2.02V17h6v-.23c0-.82.4-1.55 1-2.02A7 7 0 0 0 12 2Z" /><path d="M9 18h6M10 22h4" /></g>,
    <g key="c"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></g>,
  ];
  const whyStyles = [
    { bg: "#ECEBFB", stroke: ACCENT, d: <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z" /> },
    { bg: "#E9F8EF", stroke: "#1FA463", d: <><path d="M21 11.5a8.4 8.4 0 0 1-9.9 8.3A8.4 8.4 0 1 1 21 11.5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></> },
    { bg: "#FFF1E8", stroke: "#EA7A3A", d: <><path d="M4 4v16h16" /><path d="M7 15l4-5 3 3 5-7" /></> },
    { bg: "#FDEBEC", stroke: "#E15361", d: <><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V8a5 5 0 0 1 10 0v3" /></> },
  ];
  const planNames = ["Basic", "Pro", "Business"];
  const planPrices = ["299 000", "590 000", L.individual];

  return (
    <div className="lp-root" ref={rootRef}>
      <style>{CSS}</style>

      {/* HEADER */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, width: "100%", background: "rgba(247,247,245,0.92)", backdropFilter: "blur(6px)", borderBottom: "1px solid var(--border)" }}>
        <div className="lp-wrap lp-header" style={{ padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" /></svg>
            </div>
            <span style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em" }}>TalimCRM</span>
          </Link>
          <nav className="lp-nav" style={{ display: "flex", alignItems: "center", gap: 36, fontSize: 14.5, fontWeight: 500, color: "var(--text-2)" }}>
            <a href="#features">{L.navFeatures}</a>
            <a href="#how">{L.navHow}</a>
            <a href="#pricing">{L.navPricing}</a>
          </nav>
          <div className="lp-header-right" style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div ref={langRef} style={{ position: "relative" }}>
              <button type="button" className="lp-btn" onClick={() => setLangOpen((o) => !o)} style={{ gap: 6, background: "var(--chip)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 9 }}>
                <Icon d={<><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></>} color="currentColor" size={14} />
                <span className="lp-lang-label">{LANG_LABELS[(lang as LandingLang) in LANG_LABELS ? (lang as LandingLang) : "UZ"]}</span>
                <span className="lp-lang-code">{lang}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "transform .2s ease", transform: langOpen ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {langOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 12px 28px -12px rgba(18,19,26,0.25)", padding: 5, minWidth: 120, zIndex: 20 }}>
                  {(["UZ", "RU", "EN"] as const).map((l) => (
                    <button key={l} type="button" className="lp-btn" onClick={() => { setLang(l); setLangOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", fontSize: 13, fontWeight: 600, padding: "8px 10px", borderRadius: 7, background: lang === l ? "#ECEBFB" : "transparent", color: lang === l ? ACCENT : "var(--text)" }}>
                      {LANG_LABELS[l]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Link href="/login" className="lp-header-login" style={{ fontSize: 14.5, fontWeight: 600 }}>{L.login}</Link>
            <Link href="/register" className="lp-btn lp-start" style={{ background: ACCENT, color: "#fff", fontSize: 14.5, fontWeight: 600, padding: "10px 18px", borderRadius: 9, whiteSpace: "nowrap" }}>{L.start}</Link>
          </div>
        </div>
      </div>

      {/* HERO */}
      <div className="lp-wrap lp-hero">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 8, background: "#ECEBFB", color: ACCENT, fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 100 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: ACCENT }} />
            {L.badge}
          </div>
          <h1 style={{ fontSize: 52, lineHeight: 1.08, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.heroTitle}</h1>
          <p style={{ fontSize: 17.5, lineHeight: 1.6, color: "var(--text-2)", maxWidth: 480, margin: 0 }}>{L.heroDesc}</p>
          <div className="lp-group" style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6, flexWrap: "wrap" }}>
            <Link href="/register" className="lp-btn lp-reveal" style={{ background: ACCENT, color: "#fff", fontSize: 15.5, fontWeight: 700, padding: "14px 26px", borderRadius: 11 }}>{L.tryFree}</Link>
            <Link href="/login" className="lp-btn lp-reveal" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", fontSize: 15.5, fontWeight: 600, padding: "14px 24px", borderRadius: 11 }}>{L.demo}</Link>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--muted)", marginTop: 4 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            {L.noCard}
          </div>
        </div>

        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <div style={{ borderRadius: 18, background: "#12131A", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 30px 60px -20px rgba(18,19,26,0.35)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "#1B1D26" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F57" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FEBC2E" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28C840" }} />
              <div style={{ marginLeft: 14, background: "#282B36", color: "var(--muted)", fontSize: 12, padding: "5px 14px", borderRadius: 6 }}>azizbek.crmapp.uz</div>
            </div>
            <div style={{ background: "var(--bg)", padding: "22px 22px 40px", height: 336, boxSizing: "border-box", position: "relative", overflow: "hidden" }}>
              {hero === 0 && (
                <div key="h0" className="lp-pane" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {paneHead(L.todayLessons, L.online, ACCENT, "#ECEBFB")}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {lessonRow("IE", "#ECEBFB", ACCENT, "IELTS Speaking — B2", `14:00 · 18 ${L.students}`, "70%")}
                    {lessonRow("GR", "#FFF1E8", "#EA7A3A", "Grammar — A2", `16:30 · 12 ${L.students}`, "40%")}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {stat(L.monthIncome, `24 500 000 ${L.som}`)}
                    {stat(L.activeStudents, "186")}
                  </div>
                </div>
              )}
              {hero === 1 && (
                <div key="h1" className="lp-pane" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {paneHead(L.lastPayments, L.newCount, "#1FA463", "#E9F8EF")}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {paidRow("Madina Yusupova", "IELTS Speaking — B2", `320 000 ${L.som}`)}
                    {paidRow("Jasur Ergashev", "Grammar — A2", `280 000 ${L.som}`)}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {stat(L.paidToday, `1 240 000 ${L.som}`)}
                    {stat(L.waiting, L.waitingCount, "#EA7A3A")}
                  </div>
                </div>
              )}
              {hero === 2 && (
                <div key="h2" className="lp-pane" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {paneHead(L.monthStats, "+18%", ACCENT, "#ECEBFB")}
                  <div style={{ ...card, padding: 16, display: "flex", alignItems: "flex-end", gap: 10, height: 104 }}>
                    {[40, 58, 78, 64, 90, 100].map((h, i) => (
                      <div key={i} style={{ flex: 1, borderRadius: 5, height: `${h}%`, background: i === 2 || i === 5 ? ACCENT : "var(--muted)", opacity: i === 2 || i === 5 ? 1 : 0.4 }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {stat(L.growth, "+18%", "#1FA463")}
                    {stat(L.avgAttendance, "92%")}
                  </div>
                </div>
              )}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Dots active={hero} onPick={setHero} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WHO IT'S FOR */}
      <div className="lp-section" style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", paddingTop: 88, paddingBottom: 88 }}>
        <div className="lp-wrap" style={{ display: "flex", flexDirection: "column", gap: 44 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
            <span style={label}>{L.whoLabel}</span>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.whoTitle}</h2>
          </div>
          <div className="lp-grid4 lp-group">
            {L.who.map(([title, desc], i) => (
              <div key={i} className="lp-reveal" style={{ background: whoStyles[i].bg, borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: whoStyles[i].icon, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon d={whoStyles[i].d} color={whoStyles[i].stroke} size={19} />
                </div>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5 }}>{title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-2)" }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CLIENT LOGOS */}
      <div style={{ width: "100%", background: "var(--bg)", padding: "40px 0", overflow: "hidden" }}>
        <div className="lp-wrap" style={{ marginBottom: 18, padding: "0 32px", textAlign: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{L.clients}</span>
        </div>
        {[["lp-left", 1], ["lp-right", 7]].map(([cls, start]) => (
          <div key={cls as string} style={{ overflow: "hidden", padding: "4px 0", marginTop: cls === "lp-right" ? 12 : 0 }}>
            <div className={`lp-track ${cls}`}>
              {[0, 1].flatMap((rep) => Array.from({ length: 6 }, (_, i) => (
                <div key={`${rep}-${i}`} className="lp-pill">LOGO {(start as number) + i}</div>
              )))}
            </div>
          </div>
        ))}
      </div>

      {/* FEATURES */}
      <div id="features" className="lp-wrap lp-section" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
          <span style={label}>{L.featuresLabel}</span>
          <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.featuresTitle}</h2>
        </div>
        <div className="lp-grid4 lp-group">
          {L.features.map(([title, desc], i) => (
            <div key={i} className="lp-reveal" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: featureStyles[i].bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon d={featureStyles[i].d} color={featureStyles[i].stroke} />
              </div>
              <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5 }}>{title}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* AI FEATURES */}
      <div className="lp-section" style={{ background: "linear-gradient(135deg,#0F0B29,#1B1440)" }}>
        <div className="lp-wrap" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
            <span style={{ display: "inline-flex", alignSelf: "flex-start", background: "linear-gradient(135deg,#8B7CF6,#4F46E5)", color: "#fff", fontSize: 12, fontWeight: 800, padding: "6px 13px", borderRadius: 100, letterSpacing: "0.02em" }}>{L.aiNew}</span>
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>{L.aiTitle}</h2>
            <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "#B7B0E8", margin: 0 }}>{L.aiDesc}</p>
          </div>
          <div className="lp-grid3 lp-group">
            {L.ai.map(([title, desc], i) => (
              <div key={i} className="lp-reveal" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(139,124,246,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon d={aiIcons[i]} color="#B7B0E8" />
                </div>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5, color: "#fff" }}>{title}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#B7B0E8" }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div id="how" className="lp-section" style={{ background: "#12131A" }}>
        <div className="lp-wrap" style={{ display: "flex", flexDirection: "column", gap: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
            <span style={{ ...label, color: "#A9A6FF" }}>{L.howLabel}</span>
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>{L.howTitle}</h2>
          </div>
          <div className="lp-grid3 lp-group" style={{ gap: 32 }}>
            {L.how.map(([title, desc], i) => (
              <div key={i} className="lp-reveal" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: ACCENT, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 17 }}>{i + 1}</div>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 17, color: "#fff" }}>{title}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: "#9A9CA6" }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* STUDENT PORTAL PREVIEW */}
      <div className="lp-wrap lp-split lp-group">
        <div className="lp-reveal" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="lp-phone" style={{ width: 400, borderRadius: 36, border: "9px solid #12131A", background: "#12131A", boxShadow: "0 24px 48px -20px rgba(18,19,26,0.3)", overflow: "hidden", boxSizing: "border-box" }}>
            <div style={{ background: "var(--bg)", borderRadius: 27, overflow: "hidden" }}>
              <div style={{ height: 380, position: "relative", overflow: "hidden" }}>
                {portal === 0 && (
                  <div key="p0" className="lp-pane">
                    <div style={{ padding: "22px 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>{L.welcome}</div>
                        <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 18 }}>Madina</div>
                      </div>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: ACCENT }} />
                    </div>
                    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ ...card, borderRadius: 14, padding: 15 }}>
                        <div style={{ fontSize: 13.5, color: "var(--muted)" }}>{L.nextLesson}</div>
                        <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 3 }}>{L.nextLessonValue}</div>
                      </div>
                      <div style={{ ...card, borderRadius: 14, padding: 15, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 13.5, color: "var(--muted)" }}>{L.attendance}</div>
                          <div style={{ fontSize: 15.5, fontWeight: 700 }}>{L.attendanceValue}</div>
                        </div>
                        <svg width="40" height="40" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="#EAE8E2" strokeWidth="4" /><circle cx="18" cy="18" r="15" fill="none" stroke={ACCENT} strokeWidth="4" strokeDasharray="85 100" strokeLinecap="round" transform="rotate(-90 18 18)" /></svg>
                      </div>
                      <div style={{ ...card, borderRadius: 14, padding: 15 }}>
                        <div style={{ fontSize: 13.5, color: "var(--muted)" }}>{L.paymentStatus}</div>
                        <div style={{ fontSize: 15.5, fontWeight: 700, color: "#1FA463", marginTop: 3 }}>{L.paidUntil}</div>
                      </div>
                    </div>
                  </div>
                )}
                {portal === 1 && (
                  <div key="p1" className="lp-pane">
                    <div style={{ padding: "20px 20px 8px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#8B7CF6,#4F46E5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon d={aiIcons[0]} color="#fff" size={16} />
                      </div>
                      <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 16 }}>{L.aiHelper}</div>
                    </div>
                    <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ ...card, borderRadius: "14px 14px 14px 4px", padding: "12px 15px", fontSize: 14, lineHeight: 1.55, maxWidth: "88%" }}>{L.chat[0]}</div>
                      <div style={{ background: ACCENT, color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "12px 15px", fontSize: 14, lineHeight: 1.55, maxWidth: "88%", alignSelf: "flex-end" }}>{L.chat[1]}</div>
                      <div style={{ ...card, borderRadius: "14px 14px 14px 4px", padding: "12px 15px", fontSize: 14, lineHeight: 1.55, maxWidth: "88%" }}>{L.chat[2]}</div>
                    </div>
                  </div>
                )}
                {portal === 2 && (
                  <div key="p2" className="lp-pane">
                    <div style={{ padding: "22px 20px 10px", fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 17 }}>{L.homework}</div>
                    <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ ...card, borderRadius: 14, padding: "14px 15px" }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{L.hw[0]}</div>
                        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>{L.hw[1]}</div>
                      </div>
                      <div style={{ ...card, borderRadius: 14, padding: "14px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{L.hw[2]}</div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#1FA463", background: "#E9F8EF", padding: "4px 10px", borderRadius: 100, whiteSpace: "nowrap" }}>{L.hw[3]}</span>
                      </div>
                      <div style={{ ...card, borderRadius: 14, padding: "14px 15px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{L.hw[4]}</div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#8A8D96", background: "var(--chip)", padding: "4px 10px", borderRadius: 100, whiteSpace: "nowrap" }}>{L.hw[5]}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ padding: "4px 0 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Dots active={portal} onPick={setPortal} />
              </div>
            </div>
          </div>
        </div>
        <div className="lp-reveal" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
          <span style={label}>{L.portalLabel}</span>
          <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.portalTitle}</h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "var(--text-2)", maxWidth: 420, margin: 0 }}>{L.portalDesc}</p>
        </div>
      </div>

      {/* WHY US */}
      <div className="lp-section" style={{ background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
        <div className="lp-wrap" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
            <span style={label}>{L.whyLabel}</span>
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.whyTitle}</h2>
          </div>
          <div className="lp-grid4 lp-group">
            {L.why.map(([title, desc], i) => (
              <div key={i} className="lp-reveal" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: whyStyles[i].bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon d={whyStyles[i].d} color={whyStyles[i].stroke} size={22} />
                </div>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5 }}>{title}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="lp-section" style={{ background: "var(--surface)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "center", alignItems: "center" }}>
            <span style={label}>{L.faqLabel}</span>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.faqTitle}</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {L.faq.map(([q, a], i) => (
              <div key={i} style={{ padding: "22px 0", borderBottom: i < L.faq.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5, marginBottom: 8 }}>{q}</div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-2)" }}>{a}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div id="pricing" className="lp-section" style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 48, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center" }}>
            <span style={label}>{L.pricingLabel}</span>
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.pricingTitle}</h2>
          </div>
          <div className="lp-grid3 lp-group" style={{ gap: 24, width: "100%" }}>
            {L.plans.map(([sub, ...items], i) => {
              const pro = i === 1;
              return (
                <div key={i} className="lp-reveal" style={{ border: pro ? `2px solid ${ACCENT}` : "1px solid var(--border)", borderRadius: 18, padding: 28, display: "flex", flexDirection: "column", gap: 18, position: "relative", boxShadow: pro ? "0 20px 40px -20px rgba(79,70,229,0.35)" : "none" }}>
                  {pro && <div style={{ position: "absolute", top: -13, left: 28, background: ACCENT, color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 100 }}>{L.popular}</div>}
                  <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 17 }}>{planNames[i]}</div>
                  <div>
                    <span style={{ fontSize: 32, fontWeight: 800, fontFamily: "'Manrope',sans-serif" }}>{planPrices[i]}</span>
                    {i < 2 && <span style={{ fontSize: 14, color: "var(--muted)" }}>{L.perMonth}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{sub}</div>
                  <Link href="/register" className="lp-btn" style={{ background: pro ? ACCENT : "var(--chip)", color: pro ? "#fff" : "var(--text)", fontSize: 14.5, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}>
                    {i === 2 ? L.contact : L.choose}
                  </Link>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                    {items.map((it) => (
                      <div key={it} style={{ display: "flex", gap: 8, fontSize: 13.5, color: "var(--text-2)" }}>
                        <Check />
                        {it}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ width: "100%", padding: "80px 16px", boxSizing: "border-box" }}>
        <div className="lp-cta lp-reveal">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{L.ctaTitle}</h2>
            <div style={{ fontSize: 15, color: "#E4E2FB" }}>{L.ctaDesc}</div>
          </div>
          <Link href="/register" className="lp-btn" style={{ background: "#fff", color: ACCENT, fontSize: 15.5, fontWeight: 700, padding: "14px 28px", borderRadius: 11, whiteSpace: "nowrap" }}>{L.register}</Link>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ width: "100%", borderTop: "1px solid var(--border)", padding: "40px 32px", boxSizing: "border-box" }}>
        <div className="lp-wrap lp-footer" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
          <span>© {new Date().getFullYear()} TalimCRM</span>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Link href="/login">{L.login}</Link>
            <Link href="/terms">{L.footerContact}</Link>
            <Link href="/privacy">{L.privacy}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
