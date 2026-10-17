"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n-context";
import { planFeatureLines } from "@/lib/plans";
import { LANDING_TEXT, type LandingLang } from "./landing-text";
import { plansApi, type Plan } from "@/lib/api";

// Public home page — a port of the original talimcrm-demo design
// (Downloads/talimcrm-demo/index.html), in three languages and phone-ready.

const ACCENT = "#4F46E5";
const LANG_LABELS: Record<LandingLang, string> = { UZ: "O'zbekcha", RU: "Русский", EN: "English" };

const CSS = `
  .lp-root{--bg:#F7F7F5;--surface:#FFFFFF;--border:#EAE8E2;--text:#181A1F;--text-2:#4A4E58;--muted:#686B75;--chip:#F2F1EC;color:var(--text);background:var(--bg);font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;}
  .lp-root h1,.lp-root h2,.lp-root h3{font-family:'Manrope',system-ui,sans-serif;margin:0;}
  .lp-root a{color:inherit;text-decoration:none;}
  .lp-btn{cursor:pointer;border:none;transition:opacity .15s ease,transform .15s ease;display:inline-flex;align-items:center;justify-content:center;}
  .lp-btn:hover{opacity:.92;}
  .lp-reveal{opacity:0;transform:translateY(26px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1);}
  .lp-reveal.in-view{opacity:1;transform:translateY(0);}
  .lp-group>.lp-reveal:nth-child(2){transition-delay:.1s;}
  .lp-group>.lp-reveal:nth-child(3){transition-delay:.2s;}
  .lp-group>.lp-reveal:nth-child(4){transition-delay:.3s;}
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
    .lp-menu-btn{display:inline-flex!important;}
  }
  .lp-root [id]{scroll-margin-top:84px;}
  .lp-mobile-menu a{display:block;padding:12px 14px;border-radius:10px;font-size:15px;font-weight:600;color:var(--text);}
  .lp-mobile-menu a:hover{background:var(--chip);}
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
    .lp-footer{flex-direction:column;gap:14px;align-items:flex-start!important;}
  }
  /* A phone: the logo, the language and the menu button fit; "Start" is in the menu and the hero. */
  @media (max-width:440px){
    .lp-start{display:none!important;}
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
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16794A" strokeWidth="2.6" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export default function Landing() {
  const { lang, setLang } = useLanguage();
  const L = LANDING_TEXT[(lang as LandingLang) in LANDING_TEXT ? (lang as LandingLang) : "UZ"];
  // Screenshots of the app with demo data, one per language (public/landing).
  const shot = ((lang as LandingLang) in LANDING_TEXT ? (lang as string) : "UZ").toLowerCase();
  const [langOpen, setLangOpen] = useState(false);
  // The menu on phones and tablets, where the header has no room for it.
  const [menuOpen, setMenuOpen] = useState(false);
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

  const whoIcons = [
    <path key="a" d="M4 6h16M4 12h16M4 18h7" />,
    <g key="b"><path d="M16 18 22 12 16 6" /><path d="M8 6 2 12 8 18" /></g>,
    <g key="c"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6" /></g>,
    <g key="d"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></g>,
  ];
  const featureIcons = [
    <g key="a"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></g>,
    <g key="b"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></g>,
    <g key="c"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 18h6" /></g>,
    <g key="d"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></g>,
  ];
  const aiIcons = [
    <g key="a"><path d="M14 3H6v18h12V7Z" /><path d="M14 3v4h4M9 13h6M9 17h4" /></g>,
    <g key="b"><path d="M12 2a7 7 0 0 0-4 12.75c.6.47 1 1.2 1 2.02V17h6v-.23c0-.82.4-1.55 1-2.02A7 7 0 0 0 12 2Z" /><path d="M9 18h6M10 22h4" /></g>,
    <g key="c"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></g>,
  ];
  const whyIcons = [
    <path key="a" d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z" />,
    <g key="b"><path d="M21 11.5a8.4 8.4 0 0 1-9.9 8.3A8.4 8.4 0 1 1 21 11.5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></g>,
    <g key="c"><path d="M4 4v16h16" /><path d="M7 15l4-5 3 3 5-7" /></g>,
    <g key="d"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V8a5 5 0 0 1 10 0v3" /></g>,
  ];
  // One look for every icon: the brand color on a neutral chip.
  const iconChip = (size: number, radius: number): CSSProperties => ({ width: size, height: size, borderRadius: radius, background: "var(--chip)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });
  const planNames = ["Basic", "Pro", "Business"];
  const planPrices = ["299 000", "590 000", L.individual];
  // The tariffs the platform admin keeps on the Tariflar page; the texts
  // above are only shown if they cannot be loaded.
  const [livePlans, setLivePlans] = useState<Plan[] | null>(null);
  useEffect(() => {
    plansApi.listPublic().then((list) => setLivePlans(list.length ? list : null)).catch(() => setLivePlans(null));
  }, []);
  const FREE = { UZ: "Bepul", RU: "Бесплатно", EN: "Free" } as const;
  const cards = livePlans
    ? livePlans.map((p) => ({
        name: p.name,
        price: p.price > 0 ? new Intl.NumberFormat("uz-UZ").format(p.price).replace(/,/g, " ") : FREE[lang as keyof typeof FREE] ?? FREE.UZ,
        monthly: p.price > 0,
        sub: "",
        items: planFeatureLines(p, lang),
        highlight: p.popular,
        cta: L.choose,
      }))
    : L.plans.map(([sub, ...items], i) => ({ name: planNames[i], price: planPrices[i], monthly: i < 2, sub, items, highlight: i === 1, cta: i === 2 ? L.contact : L.choose }));

  const navLinks: [string, string][] = [
    ["#features", L.navFeatures],
    ["#ai", L.navAi],
    ["#how", L.navHow],
    ["#portal", L.navPortal],
    ["#pricing", L.navPricing],
    ["#faq", L.navFaq],
  ];

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
          <nav className="lp-nav" aria-label={L.menu} style={{ display: "flex", alignItems: "center", gap: 28, fontSize: 14.5, fontWeight: 500, color: "var(--text-2)" }}>
            {navLinks.map(([href, label]) => (
              <a key={href} href={href}>{label}</a>
            ))}
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
            <button
              type="button"
              className="lp-btn lp-menu-btn"
              aria-label={L.menu}
              aria-expanded={menuOpen}
              aria-controls="lp-mobile-menu"
              onClick={() => setMenuOpen((o) => !o)}
              style={{ display: "none", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 9, background: "var(--chip)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="lp-mobile-menu" className="lp-mobile-menu" aria-label={L.menu} style={{ borderTop: "1px solid var(--border)", padding: "8px 16px 14px", display: "grid", gap: 2 }}>
            {navLinks.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
            <Link href="/login" onClick={() => setMenuOpen(false)}>{L.login}</Link>
            <Link href="/register" onClick={() => setMenuOpen(false)}>{L.start}</Link>
          </nav>
        )}
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

        <div style={{ flex: 1.3, minWidth: 0 }}>
          <Image src={`/landing/dashboard-${shot}.webp`} alt={L.heroShotAlt} width={1600} height={1000} priority unoptimized style={{ display: "block", width: "100%", height: "auto", borderRadius: 12, border: "1px solid var(--border)" }} />
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
              <div key={i} className="lp-reveal" style={{ ...card, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={iconChip(38, 10)}>
                  <Icon d={whoIcons[i]} color={ACCENT} size={19} />
                </div>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5 }}>{title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-2)" }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FEATURES */}
      <div id="features" className="lp-wrap lp-section" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
          <span style={label}>{L.featuresLabel}</span>
          <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.featuresTitle}</h2>
        </div>
        <div className="lp-grid4 lp-group">
          {L.features.map(([title, desc], i) => (
            <div key={i} className="lp-reveal" style={{ ...card, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={iconChip(40, 10)}>
                <Icon d={featureIcons[i]} color={ACCENT} />
              </div>
              <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5 }}>{title}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* AI FEATURES */}
      <div id="ai" className="lp-section" style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div className="lp-wrap" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
            <span style={{ display: "inline-flex", alignSelf: "flex-start", background: "#ECEBFB", color: ACCENT, fontSize: 12, fontWeight: 800, padding: "6px 13px", borderRadius: 100, letterSpacing: "0.02em" }}>{L.aiNew}</span>
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.aiTitle}</h2>
            <p style={{ fontSize: 15.5, lineHeight: 1.7, color: "var(--text-2)", margin: 0 }}>{L.aiDesc}</p>
          </div>
          <div className="lp-grid3 lp-group">
            {L.ai.map(([title, desc], i) => (
              <div key={i} className="lp-reveal" style={{ ...card, background: "var(--bg)", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={iconChip(40, 10)}>
                  <Icon d={aiIcons[i]} color={ACCENT} />
                </div>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5 }}>{title}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>{desc}</div>
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
      <div id="portal" className="lp-wrap lp-split lp-group">
        <div className="lp-reveal" style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <Image src={`/landing/portal-${shot}.webp`} alt={L.portalShotAlt} width={780} height={600} unoptimized style={{ display: "block", width: "100%", maxWidth: 420, height: "auto", borderRadius: 16, border: "1px solid var(--border)" }} />
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
                <div style={iconChip(44, 12)}>
                  <Icon d={whyIcons[i]} color={ACCENT} size={22} />
                </div>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 15.5 }}>{title}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-2)" }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div id="faq" className="lp-section" style={{ background: "var(--surface)" }}>
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
            {cards.map(({ name, price, monthly, sub, items, highlight, cta }, i) => {
              const pro = highlight;
              return (
                <div key={i} className="lp-reveal" style={{ border: pro ? `2px solid ${ACCENT}` : "1px solid var(--border)", borderRadius: 18, padding: 28, display: "flex", flexDirection: "column", gap: 18, position: "relative" }}>
                  {pro && <div style={{ position: "absolute", top: -13, left: 28, background: ACCENT, color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 100 }}>{L.popular}</div>}
                  <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 17 }}>{name}</div>
                  <div>
                    <span style={{ fontSize: 32, fontWeight: 800, fontFamily: "'Manrope',sans-serif" }}>{price}</span>
                    {monthly && <span style={{ fontSize: 14, color: "var(--muted)" }}>{L.perMonth}</span>}
                  </div>
                  {sub && <div style={{ fontSize: 13, color: "var(--muted)" }}>{sub}</div>}
                  <Link href="/register" className="lp-btn" style={{ background: pro ? ACCENT : "var(--chip)", color: pro ? "#fff" : "var(--text)", fontSize: 14.5, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}>
                    {cta}
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
