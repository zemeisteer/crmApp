"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n-context";
import { LANDING_TEXT, type LandingLang } from "@/components/landing/landing-text";

// The main site's shared frame (the purple design, 2026-11): one navbar, one
// closing call to action and one footer on every public page of TalimCRM.
// Wrap a page in <PublicShell>; the landing passes `home` so its menu links
// scroll within the page instead of going back to it.

const LANG_LABELS: Record<LandingLang, string> = { UZ: "O'zbekcha", RU: "Русский", EN: "English" };

export function usePublicText() {
  const { lang, setLang } = useLanguage();
  const code: LandingLang = (lang as LandingLang) in LANDING_TEXT ? (lang as LandingLang) : "UZ";
  return { L: LANDING_TEXT[code], code, lang, setLang };
}

const SHELL_CSS = `
  .pub-theme a{color:inherit;text-decoration:none;}
  .pub-theme h1,.pub-theme h2,.pub-theme h3{font-family:var(--pub-font-display);margin:0;color:var(--pub-ink);letter-spacing:-0.025em;}
  .pub-wrap{max-width:1200px;margin:0 auto;width:100%;box-sizing:border-box;padding:0 32px;}
  .pub-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;border:none;font:inherit;font-weight:700;white-space:nowrap;transition:background .18s ease,transform .18s ease,box-shadow .18s ease,color .18s ease;}
  .pub-btn:active{transform:translateY(1px);}
  .pub-btn-primary{background:var(--pub-primary);color:var(--pub-on-primary)!important;box-shadow:0 10px 24px -12px var(--pub-primary);}
  .pub-btn-primary:hover{background:var(--pub-primary-hover);}
  .pub-btn-ghost{background:var(--pub-surface);color:var(--pub-ink)!important;border:1px solid var(--pub-border);}
  .pub-btn-ghost:hover{border-color:var(--pub-primary);color:var(--pub-primary)!important;}
  .pub-btn:focus-visible,.pub-theme a:focus-visible,.pub-theme button:focus-visible{outline:2px solid var(--pub-primary);outline-offset:2px;}
  .pub-head{position:sticky;top:0;z-index:30;background:color-mix(in oklab,var(--pub-bg) 86%,transparent);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid color-mix(in oklab,var(--pub-border) 70%,transparent);}
  .pub-head-row{display:flex;align-items:center;justify-content:space-between;gap:16px;height:72px;}
  .pub-nav{display:flex;align-items:center;gap:28px;font-size:14.5px;font-weight:600;white-space:nowrap;}
  .pub-nav a{color:var(--pub-text);transition:color .15s ease;}
  .pub-nav a:hover{color:var(--pub-primary);}
  .pub-right{display:flex;align-items:center;gap:12px;}
  .pub-lang{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--pub-border);color:var(--pub-ink);font-size:13px;font-weight:700;padding:8px 11px;border-radius:12px;cursor:pointer;}
  .pub-lang-menu{position:absolute;top:calc(100% + 8px);right:0;background:var(--pub-surface);border:1px solid var(--pub-border);border-radius:14px;box-shadow:var(--pub-shadow-sm);padding:6px;min-width:130px;z-index:40;}
  .pub-lang-menu button{display:block;width:100%;text-align:left;font:inherit;font-size:13.5px;font-weight:600;padding:9px 11px;border-radius:10px;border:none;cursor:pointer;background:transparent;color:var(--pub-ink);}
  .pub-lang-menu button[aria-current="true"]{background:var(--pub-primary-soft);color:var(--pub-primary);}
  .pub-login{font-size:14.5px;font-weight:700;color:var(--pub-ink);padding:8px 6px;}
  .pub-login:hover{color:var(--pub-primary);}
  .pub-start{font-size:14.5px;padding:11px 20px;border-radius:14px;}
  .pub-menu-btn{display:none;align-items:center;justify-content:center;width:42px;height:42px;border-radius:12px;background:var(--pub-surface);border:1px solid var(--pub-border);color:var(--pub-ink);cursor:pointer;}
  .pub-mobile{border-top:1px solid var(--pub-border);background:var(--pub-surface);padding:10px 16px 16px;display:grid;gap:2px;}
  .pub-mobile a{display:block;padding:12px 14px;border-radius:12px;font-size:15px;font-weight:600;color:var(--pub-ink);}
  .pub-mobile a:hover{background:var(--pub-primary-tint);}
  .pub-mobile .pub-btn{display:flex;margin-top:8px;padding:13px;border-radius:14px;}
  .pub-lang-code{display:none;}
  .pub-logo{display:flex;align-items:center;gap:10px;flex-shrink:0;}
  .pub-logo-mark{width:36px;height:36px;border-radius:11px;background:linear-gradient(140deg,color-mix(in oklab,var(--pub-primary) 70%,white),var(--pub-primary));display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -10px var(--pub-primary);}
  .pub-logo-text{font-family:var(--pub-font-display);font-weight:800;font-size:20px;letter-spacing:-0.03em;color:var(--pub-ink);}
  .pub-cta-wrap{padding:24px 0 88px;}
  .pub-cta{position:relative;overflow:hidden;border-radius:28px;padding:56px 56px;background:linear-gradient(120deg,var(--pub-primary) 0%,color-mix(in oklab,var(--pub-primary) 70%,var(--pub-band)) 100%);display:flex;align-items:center;justify-content:space-between;gap:28px;color:var(--pub-on-primary);}
  .pub-cta::before,.pub-cta::after{content:"";position:absolute;border-radius:50%;background:color-mix(in oklab,white 12%,transparent);pointer-events:none;}
  .pub-cta::before{width:340px;height:340px;right:-90px;top:-170px;}
  .pub-cta::after{width:220px;height:220px;right:180px;bottom:-150px;}
  .pub-cta h2{color:var(--pub-on-primary);font-size:34px;line-height:1.15;}
  .pub-cta p{margin:10px 0 0;font-size:16px;color:color-mix(in oklab,var(--pub-on-primary) 82%,var(--pub-primary));}
  .pub-cta .pub-btn{position:relative;z-index:1;background:var(--pub-surface);color:var(--pub-primary)!important;font-size:15.5px;padding:15px 28px;border-radius:16px;}
  .pub-cta .pub-btn:hover{background:var(--pub-primary-soft);}
  .pub-cta-actions{display:flex;gap:12px;flex-wrap:wrap;position:relative;z-index:1;}
  .pub-cta .pub-btn-line{background:transparent;color:var(--pub-on-primary)!important;border:1px solid color-mix(in oklab,white 45%,transparent);}
  .pub-cta .pub-btn-line:hover{background:color-mix(in oklab,white 12%,transparent);}
  .pub-foot{background:var(--pub-band);color:color-mix(in oklab,white 70%,var(--pub-band));padding:64px 0 28px;}
  .pub-foot-grid{display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:40px;}
  .pub-foot h4{margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:white;}
  .pub-foot ul{list-style:none;margin:0;padding:0;display:grid;gap:10px;font-size:14px;}
  .pub-foot a:hover{color:white;}
  .pub-foot .pub-logo-text{color:white;}
  .pub-foot-bottom{margin-top:44px;padding-top:22px;border-top:1px solid color-mix(in oklab,white 12%,transparent);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px;}
  @media (max-width:1100px){
    .pub-nav{display:none;}
    .pub-menu-btn{display:inline-flex;}
  }
  @media (max-width:1020px){
    .pub-foot-grid{grid-template-columns:1fr 1fr;}
    .pub-cta{flex-direction:column;align-items:flex-start;padding:44px 36px;}
  }
  @media (max-width:640px){
    .pub-wrap{padding:0 16px;}
    .pub-head-row{height:64px;}
    .pub-login{display:none;}
    .pub-lang-label{display:none;}
    .pub-lang-code{display:inline;}
    .pub-start{padding:10px 14px;font-size:13.5px;}
    .pub-right{gap:8px;}
    .pub-cta{padding:36px 22px;border-radius:24px;}
    .pub-cta h2{font-size:26px;}
    .pub-cta-wrap{padding:8px 0 56px;}
    .pub-foot-grid{grid-template-columns:1fr;gap:28px;}
  }
  @media (max-width:440px){ .pub-start{display:none;} }
`;

export function PublicLogo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="pub-logo" aria-label="TalimCRM">
      <span className="pub-logo-mark" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10 12 5 2 10l10 5 10-5Z" />
          <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
        </svg>
      </span>
      <span className="pub-logo-text" style={light ? { color: "white" } : undefined}>TalimCRM</span>
    </Link>
  );
}

export function PublicHeader({ home = false }: { home?: boolean }) {
  const { L, code, lang, setLang } = usePublicText();
  const [langOpen, setLangOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!langOpen) return;
    const close = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setLangOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [langOpen]);

  const base = home ? "" : "/";
  const links: [string, string][] = [
    [`${base}#features`, L.navFeatures],
    [`${base}#how`, L.navHow],
    [`${base}#cabinets`, L.navCabinets],
    [`${base}#pricing`, L.navPricing],
    [`${base}#faq`, L.navFaq],
  ];

  return (
    <header className="pub-head">
      <div className="pub-wrap pub-head-row">
        <PublicLogo />
        <nav className="pub-nav" aria-label={L.menu}>
          {links.map(([href, label]) => (
            <a key={href} href={href}>{label}</a>
          ))}
        </nav>
        <div className="pub-right">
          <div ref={langRef} style={{ position: "relative" }}>
            <button type="button" className="pub-lang" aria-haspopup="true" aria-expanded={langOpen} onClick={() => setLangOpen((o) => !o)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
              </svg>
              <span className="pub-lang-label">{LANG_LABELS[code]}</span>
              <span className="pub-lang-code">{lang}</span>
            </button>
            {langOpen && (
              <div className="pub-lang-menu">
                {(["UZ", "RU", "EN"] as const).map((l) => (
                  <button key={l} type="button" aria-current={lang === l} onClick={() => { setLang(l); setLangOpen(false); }}>
                    {LANG_LABELS[l]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Link href="/login" className="pub-login">{L.login}</Link>
          <Link href="/register" className="pub-btn pub-btn-primary pub-start">{L.start}</Link>
          <button
            type="button"
            className="pub-menu-btn"
            aria-label={L.menu}
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="lp-mobile-menu" className="pub-mobile" aria-label={L.menu}>
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
          ))}
          <Link href="/login" onClick={() => setMenuOpen(false)}>{L.login}</Link>
          <Link href="/register" className="pub-btn pub-btn-primary" onClick={() => setMenuOpen(false)}>{L.start}</Link>
        </nav>
      )}
    </header>
  );
}

export function PublicCta() {
  const { L } = usePublicText();
  return (
    <section className="pub-cta-wrap">
      <div className="pub-wrap">
        <div className="pub-cta">
          <div style={{ position: "relative", zIndex: 1, maxWidth: 620 }}>
            <h2>{L.ctaTitle}</h2>
            <p>{L.ctaDesc}</p>
          </div>
          <div className="pub-cta-actions">
            <Link href="/register" className="pub-btn">{L.register}</Link>
            <Link href="/login" className="pub-btn pub-btn-line">{L.login}</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PublicFooter({ home = false }: { home?: boolean }) {
  const { L } = usePublicText();
  const base = home ? "" : "/";
  return (
    <footer className="pub-foot">
      <div className="pub-wrap">
        <div className="pub-foot-grid">
          <div style={{ display: "grid", gap: 16, alignContent: "start", maxWidth: 340 }}>
            <PublicLogo light />
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65 }}>{L.footerTagline}</p>
          </div>
          <div>
            <h4>{L.footerProduct}</h4>
            <ul>
              <li><a href={`${base}#features`}>{L.navFeatures}</a></li>
              <li><a href={`${base}#cabinets`}>{L.navCabinets}</a></li>
              <li><a href={`${base}#pricing`}>{L.navPricing}</a></li>
              <li><a href={`${base}#faq`}>{L.navFaq}</a></li>
            </ul>
          </div>
          <div>
            <h4>{L.footerAccount}</h4>
            <ul>
              <li><Link href="/login">{L.login}</Link></li>
              <li><Link href="/register">{L.register}</Link></li>
            </ul>
          </div>
          <div>
            <h4>{L.footerLegal}</h4>
            <ul>
              <li><Link href="/terms">{L.footerContact}</Link></li>
              <li><Link href="/privacy">{L.privacy}</Link></li>
            </ul>
          </div>
        </div>
        <div className="pub-foot-bottom">
          <span>© {new Date().getFullYear()} TalimCRM. {L.rights}</span>
          <span>UZ · RU · EN</span>
        </div>
      </div>
    </footer>
  );
}

/** A public page: the shared navbar, the page, then the closing call and the footer. */
export default function PublicShell({ children, home = false, cta = true }: { children: ReactNode; home?: boolean; cta?: boolean }) {
  return (
    <div className="pub-theme force-light" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{SHELL_CSS}</style>
      <PublicHeader home={home} />
      <main style={{ flex: 1 }}>{children}</main>
      {cta && <PublicCta />}
      <PublicFooter home={home} />
    </div>
  );
}
