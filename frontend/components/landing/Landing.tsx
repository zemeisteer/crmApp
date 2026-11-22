"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { planFeatureLines } from "@/lib/plans";
import { plansApi, type Plan } from "@/lib/api";
import PublicShell, { usePublicText } from "@/components/public/PublicShell";

// Public home page in the purple design the owner approved (2026-11):
// hero, trusted-by strip, features, how it works, portals, tariffs, FAQ.
// The navbar, the closing call and the footer are shared (PublicShell).

const CSS = `
  .lp{--sec-y:104px;}
  .lp-sec{padding:var(--sec-y) 0;}
  .lp-head{display:grid;gap:14px;max-width:640px;justify-items:start;}
  .lp-head.center{margin:0 auto;text-align:center;justify-items:center;}
  .lp-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--pub-primary);background:var(--pub-primary-soft);padding:7px 14px;border-radius:999px;}
  .lp-eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--pub-primary);}
  .lp h2{font-size:40px;line-height:1.12;font-weight:800;}
  .lp-lead{margin:0;font-size:16.5px;line-height:1.65;color:var(--pub-muted);}
  .lp-card{background:var(--pub-surface);border:1px solid var(--pub-border);border-radius:var(--pub-radius);}

  .lp-hero{position:relative;overflow:hidden;padding:72px 0 88px;}
  .lp-hero::before{content:"";position:absolute;width:620px;height:620px;right:-160px;top:-220px;border-radius:50%;background:radial-gradient(circle,color-mix(in oklab,var(--pub-primary) 22%,transparent),transparent 68%);pointer-events:none;}
  .lp-hero::after{content:"";position:absolute;width:460px;height:460px;left:-220px;bottom:-240px;border-radius:50%;background:radial-gradient(circle,color-mix(in oklab,var(--pub-pink) 14%,transparent),transparent 70%);pointer-events:none;}
  .lp-hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:56px;align-items:center;}
  .lp-hero h1{font-size:clamp(36px,4.3vw,60px);line-height:1.05;font-weight:800;letter-spacing:-0.035em;}
  .lp-hero h1 em{font-style:normal;color:var(--pub-primary);display:block;}
  .lp-hero-desc{margin:0;font-size:17.5px;line-height:1.65;color:var(--pub-text);max-width:520px;}
  .lp-hero-ctas{display:flex;gap:12px;flex-wrap:wrap;}
  .lp-hero-ctas .pub-btn{font-size:15.5px;padding:15px 26px;border-radius:16px;}
  .lp-trust{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:14px;color:var(--pub-muted);}
  .lp-avatars{display:flex;}
  .lp-avatars span{width:36px;height:36px;border-radius:50%;border:3px solid var(--pub-bg);margin-left:-10px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:white;}
  .lp-avatars span:first-child{margin-left:0;}
  .lp-trust b{display:block;color:var(--pub-ink);font-size:14.5px;}
  .lp-stars{color:var(--pub-warning);letter-spacing:2px;font-size:13px;}

  .lp-visual{position:relative;padding:28px 0 36px 28px;}
  .lp-shot{position:relative;border-radius:var(--pub-radius-lg);background:var(--pub-surface);border:1px solid var(--pub-border);padding:10px;box-shadow:var(--pub-shadow);}
  .lp-shot img{display:block;width:100%;height:auto;border-radius:16px;}
  .lp-float{position:absolute;z-index:2;background:var(--pub-surface);border:1px solid var(--pub-border);border-radius:18px;box-shadow:var(--pub-shadow-sm);padding:14px 16px;display:flex;align-items:center;gap:12px;animation:lp-bob 6s ease-in-out infinite;}
  .lp-float small{display:block;font-size:12px;color:var(--pub-muted);margin-top:2px;}
  .lp-float strong{font-size:14px;color:var(--pub-ink);}
  .lp-toast{left:0;top:4px;}
  .lp-chart{right:-12px;bottom:0;flex-direction:column;align-items:stretch;gap:10px;min-width:190px;animation-delay:-3s;}
  .lp-bars{display:flex;align-items:flex-end;gap:6px;height:54px;}
  .lp-bars i{flex:1;border-radius:6px 6px 3px 3px;background:var(--pub-primary-soft);}
  .lp-bars i:last-child{background:var(--pub-primary);}
  .lp-chip{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  @keyframes lp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}

  .lp-partners{padding:8px 0 40px;}
  .lp-partners-label{text-align:center;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--pub-muted);}
  .lp-logos{margin-top:22px;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;}
  .lp-logos span{height:64px;display:flex;align-items:center;justify-content:center;border-radius:16px;background:var(--pub-surface);border:1px solid var(--pub-border);font-family:var(--pub-font-display);font-weight:800;font-size:16px;letter-spacing:-0.01em;color:color-mix(in oklab,var(--pub-muted) 80%,var(--pub-bg));text-align:center;padding:0 10px;}
  .lp-stats{margin-top:20px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;}
  .lp-stats div{padding:22px 24px;}
  .lp-stats b{display:block;font-family:var(--pub-font-display);font-size:30px;font-weight:800;color:var(--pub-primary);letter-spacing:-0.03em;}
  .lp-stats span{font-size:14px;color:var(--pub-muted);}

  .lp-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;}
  .lp-feature{padding:28px;display:grid;gap:14px;align-content:start;transition:transform .25s ease,box-shadow .25s ease,border-color .25s ease;}
  .lp-feature:hover{transform:translateY(-4px);box-shadow:var(--pub-shadow-sm);border-color:color-mix(in oklab,var(--pub-primary) 30%,var(--pub-border));}
  .lp-feature h3{font-size:18px;font-weight:800;}
  .lp-feature p{margin:0;font-size:14.5px;line-height:1.65;color:var(--pub-muted);}

  .lp-how{background:var(--pub-surface);border-top:1px solid var(--pub-border);border-bottom:1px solid var(--pub-border);}
  .lp-steps{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;margin-top:56px;}
  .lp-steps::before{content:"";position:absolute;top:28px;left:16%;right:16%;border-top:2px dashed color-mix(in oklab,var(--pub-primary) 30%,transparent);}
  .lp-step{position:relative;text-align:center;display:grid;justify-items:center;gap:14px;padding:0 12px;}
  .lp-step-n{width:56px;height:56px;border-radius:18px;background:var(--pub-primary);color:white;font-family:var(--pub-font-display);font-weight:800;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 8px var(--pub-surface),0 14px 28px -12px var(--pub-primary);}
  .lp-step h3{font-size:18.5px;font-weight:800;}
  .lp-step p{margin:0;font-size:14.5px;line-height:1.65;color:var(--pub-muted);max-width:300px;}

  .lp-cab-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:56px;align-items:center;margin-top:52px;}
  .lp-cabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
  .lp-cab{padding:24px;display:grid;gap:12px;align-content:start;}
  .lp-cab h3{font-size:16.5px;font-weight:800;}
  .lp-cab p{margin:0;font-size:14px;line-height:1.6;color:var(--pub-muted);}
  .lp-phone{position:relative;display:flex;justify-content:center;padding:30px 0;}
  .lp-phone::before{content:"";position:absolute;inset:12% 8%;border-radius:40px;background:linear-gradient(150deg,var(--pub-primary-soft),color-mix(in oklab,var(--pub-pink) 12%,var(--pub-bg)));}
  .lp-phone img{position:relative;display:block;width:100%;max-width:400px;height:auto;border-radius:24px;border:1px solid var(--pub-border);box-shadow:var(--pub-shadow);}
  .lp-profile{left:0;top:18%;}
  .lp-profile2{right:0;bottom:14%;animation-delay:-3s;}
  .lp-ava{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;color:white;flex-shrink:0;}

  .lp-pricing{background:var(--pub-surface);border-top:1px solid var(--pub-border);border-bottom:1px solid var(--pub-border);}
  .lp-plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:52px;align-items:stretch;}
  .lp-plan{position:relative;padding:30px;display:flex;flex-direction:column;gap:18px;background:var(--pub-bg);border:1px solid var(--pub-border);border-radius:var(--pub-radius-lg);}
  .lp-plan h3{font-size:19px;font-weight:800;}
  .lp-plan-price b{font-family:var(--pub-font-display);font-size:36px;font-weight:800;letter-spacing:-0.03em;color:var(--pub-ink);}
  .lp-plan-price span{font-size:14px;color:var(--pub-muted);}
  .lp-plan ul{list-style:none;margin:0;padding:0;display:grid;gap:11px;}
  .lp-plan li{display:flex;gap:10px;font-size:14px;line-height:1.5;color:var(--pub-text);}
  .lp-plan .pub-btn{padding:13px;border-radius:14px;font-size:15px;}
  .lp-plan.hot{background:linear-gradient(160deg,var(--pub-primary),color-mix(in oklab,var(--pub-primary) 72%,var(--pub-band)));border-color:transparent;box-shadow:var(--pub-shadow);}
  .lp-plan.hot h3,.lp-plan.hot .lp-plan-price b{color:white;}
  .lp-plan.hot .lp-plan-price span,.lp-plan.hot li{color:color-mix(in oklab,white 85%,var(--pub-primary));}
  .lp-plan.hot .pub-btn{background:white;color:var(--pub-primary)!important;}
  .lp-plan.hot .pub-btn:hover{background:var(--pub-primary-soft);}
  .lp-popular{position:absolute;top:18px;right:18px;font-size:12px;font-weight:800;padding:6px 12px;border-radius:999px;background:color-mix(in oklab,white 20%,transparent);color:white;}

  .lp-faq-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:40px;align-items:start;margin-top:48px;}
  .lp-faq{display:grid;gap:12px;}
  .lp-q{overflow:hidden;}
  .lp-q button{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;font-family:var(--pub-font-display);font-weight:700;font-size:16px;color:var(--pub-ink);}
  .lp-q button:focus-visible{outline:2px solid var(--pub-primary);outline-offset:-2px;border-radius:var(--pub-radius);}
  .lp-q-icon{width:30px;height:30px;border-radius:10px;background:var(--pub-primary-soft);color:var(--pub-primary);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .25s ease;}
  .lp-q[data-open="true"] .lp-q-icon{transform:rotate(45deg);background:var(--pub-primary);color:white;}
  .lp-q[data-open="true"]{border-color:color-mix(in oklab,var(--pub-primary) 35%,var(--pub-border));}
  .lp-q p{margin:0;padding:0 22px 20px;font-size:14.5px;line-height:1.7;color:var(--pub-muted);}
  .lp-contact{padding:32px;display:grid;gap:16px;background:linear-gradient(170deg,var(--pub-primary-soft),var(--pub-surface));position:sticky;top:96px;}
  .lp-contact h3{font-size:22px;font-weight:800;}
  .lp-contact p{margin:0;font-size:14.5px;line-height:1.65;color:var(--pub-text);}
  .lp-contact .pub-btn{padding:14px;border-radius:14px;font-size:15px;}

  .lp-reveal{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1);}
  .lp-reveal.in-view{opacity:1;transform:none;}
  .lp-group>.lp-reveal:nth-child(2){transition-delay:.08s;}
  .lp-group>.lp-reveal:nth-child(3){transition-delay:.16s;}
  .lp-group>.lp-reveal:nth-child(4){transition-delay:.24s;}
  .lp-group>.lp-reveal:nth-child(5){transition-delay:.32s;}
  .lp-group>.lp-reveal:nth-child(6){transition-delay:.4s;}
  .lp [id]{scroll-margin-top:88px;}
  @media (prefers-reduced-motion:reduce){
    .lp-reveal{opacity:1;transform:none;transition:none;}
    .lp-float{animation:none;}
  }

  @media (max-width:1020px){
    .lp{--sec-y:80px;}
    .lp-hero-grid,.lp-cab-grid,.lp-faq-grid{grid-template-columns:minmax(0,1fr);}
    .lp-visual{max-width:720px;margin:0 auto;width:100%;}
    .lp-grid3{grid-template-columns:repeat(2,minmax(0,1fr));}
    .lp-logos{grid-template-columns:repeat(3,minmax(0,1fr));}
    .lp-stats{grid-template-columns:repeat(2,minmax(0,1fr));}
    .lp-contact{position:static;}
  }
  @media (max-width:640px){
    .lp{--sec-y:60px;}
    .lp-hero{padding:40px 0 56px;}
    .lp-hero-desc{font-size:16px;}
    .lp h2{font-size:28px;}
    .lp-hero-ctas .pub-btn{flex:1 1 100%;}
    .lp-visual{padding:20px 0 28px;}
    .lp-toast{left:-4px;top:-6px;padding:10px 12px;}
    .lp-chart{right:-4px;bottom:-6px;min-width:150px;padding:10px 12px;}
    .lp-bars{height:36px;}
    .lp-grid3,.lp-cabs,.lp-steps{grid-template-columns:minmax(0,1fr);}
    .lp-steps::before{display:none;}
    .lp-logos{grid-template-columns:repeat(2,minmax(0,1fr));}
    .lp-logos span{height:54px;font-size:14px;}
    .lp-stats b{font-size:24px;}
    .lp-stats div{padding:16px;}
    .lp-profile{left:-4px;top:4%;}
    .lp-profile2{right:-4px;bottom:4%;}
    .lp-plan,.lp-contact{padding:24px;}
  }
`;

function Icon({ children, color = "currentColor", size = 22 }: { children: ReactNode; color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const Check = ({ color = "var(--pub-success)" }: { color?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// Soft chip + strong stroke, one pair per card, from the public tokens.
const TONES = [
  ["var(--pub-primary-soft)", "var(--pub-primary)"],
  ["var(--pub-success-soft)", "var(--pub-success)"],
  ["var(--pub-warning-soft)", "var(--pub-warning)"],
  ["var(--pub-pink-soft)", "var(--pub-pink)"],
  ["var(--pub-sky-soft)", "var(--pub-sky)"],
  ["var(--pub-primary-soft)", "var(--pub-primary)"],
] as const;

const FEATURE_ICONS = [
  <g key="a"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 10h18M8 2v4M16 2v4" /></g>,
  <g key="b"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></g>,
  <g key="c"><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20M6 15h4" /></g>,
  <g key="d"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></g>,
  <g key="e"><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1Z" /></g>,
  <g key="f"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></g>,
];
const CABINET_ICONS = [
  <g key="a"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></g>,
  <g key="b"><path d="M2 4h20v12H2z" /><path d="M8 20h8M12 16v4" /></g>,
  <g key="c"><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" /></g>,
  <g key="d"><circle cx="9" cy="7" r="3.5" /><circle cx="17" cy="9" r="2.5" /><path d="M2 21c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5M15 15.6c3 .1 5.3 1.9 6 5.4" /></g>,
];

// Shown for now as placeholders (the owner's mockup); replaced with real
// partners later. Text wordmarks, not the organisations' logos.
const PARTNERS = ["Cambridge", "British Council", "IELTS", "TMC", "Oxford AQA", "Pearson"];

export default function Landing() {
  const { L, code, lang } = usePublicText();
  const shot = code.toLowerCase();
  const rootRef = useRef<HTMLDivElement>(null);
  const [openQ, setOpenQ] = useState<number>(0);

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
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    root.querySelectorAll(".lp-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // The tariffs the platform admin keeps on the Tariflar page; the texts in
  // landing-text are only shown if they cannot be loaded.
  const [livePlans, setLivePlans] = useState<Plan[] | null>(null);
  useEffect(() => {
    plansApi.listPublic().then((list) => setLivePlans(list.length ? list : null)).catch(() => setLivePlans(null));
  }, []);
  const FREE = { UZ: "Bepul", RU: "Бесплатно", EN: "Free" } as const;
  const planNames = ["Basic", "Pro", "Business"];
  const planPrices = ["299 000", "590 000", L.individual];
  const cards = livePlans
    ? livePlans.map((p) => ({
        name: p.name,
        price: p.price > 0 ? new Intl.NumberFormat("uz-UZ").format(p.price).replace(/,/g, " ") : FREE[code],
        monthly: p.price > 0,
        sub: "",
        items: planFeatureLines(p, lang),
        highlight: p.popular,
        cta: L.choose,
        href: `/plans/${encodeURIComponent(p.key.toLowerCase())}`,
      }))
    : L.plans.map(([sub, ...items], i) => ({ name: planNames[i], price: planPrices[i], monthly: i < 2, sub, items, highlight: i === 1, cta: i === 2 ? L.contact : L.choose, href: "/register" }));

  const avatarTones = ["var(--pub-primary)", "var(--pub-pink)", "var(--pub-success)", "var(--pub-warning)"];

  return (
    <PublicShell home>
      <div className="lp" ref={rootRef}>
        <style>{CSS}</style>

        {/* HERO */}
        <section className="lp-hero">
          <div className="pub-wrap lp-hero-grid">
            <div style={{ display: "grid", gap: 24, justifyItems: "start" }}>
              <span className="lp-eyebrow"><i />{L.badge}</span>
              <h1>
                {L.heroTitleA} <em>{L.heroTitleB}</em>
              </h1>
              <p className="lp-hero-desc">{L.heroDesc2}</p>
              <div className="lp-hero-ctas" style={{ width: "100%" }}>
                <Link href="/register" className="pub-btn pub-btn-primary">
                  {L.tryFree}
                  <Icon size={18}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
                </Link>
                <Link href="/login" className="pub-btn pub-btn-ghost">{L.demo}</Link>
              </div>
              <div className="lp-trust">
                <div className="lp-avatars" aria-hidden>
                  {["A", "D", "M", "S"].map((c, i) => (
                    <span key={c} style={{ background: avatarTones[i] }}>{c}</span>
                  ))}
                </div>
                <div>
                  <span className="lp-stars" aria-hidden>★★★★★</span>
                  <b>{L.trustLine}</b>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--pub-muted)" }}>
                <Check />
                {L.noCard}
              </div>
            </div>

            <div className="lp-visual">
              <div className="lp-shot">
                <Image src={`/landing/dashboard-${shot}.webp`} alt={L.heroShotAlt} width={1600} height={1000} priority unoptimized />
              </div>
              <div className="lp-float lp-toast" aria-hidden>
                <span className="lp-chip" style={{ background: "var(--pub-success-soft)" }}><Check /></span>
                <div>
                  <strong>{L.toastTitle}</strong>
                  <small>{L.toastSub}</small>
                </div>
              </div>
              <div className="lp-float lp-chart" aria-hidden>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <strong>{L.chartTitle}</strong>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--pub-success)", background: "var(--pub-success-soft)", padding: "3px 8px", borderRadius: 999 }}>{L.chartDelta}</span>
                </div>
                <div className="lp-bars">
                  {[38, 52, 44, 66, 58, 82, 100].map((h, i) => (
                    <i key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUSTED BY (placeholders for now) + figures */}
        <section className="lp-partners">
          <div className="pub-wrap">
            <div className="lp-partners-label">{L.partnersLabel}</div>
            <div className="lp-logos">
              {PARTNERS.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
            <div className="lp-stats lp-group">
              {L.stats.map(([n, label]) => (
                <div key={label} className="lp-card lp-reveal">
                  <b>{n}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="lp-sec">
          <div className="pub-wrap">
            <div className="lp-head center">
              <span className="lp-eyebrow"><i />{L.featuresLabel}</span>
              <h2>{L.featuresTitle2}</h2>
              <p className="lp-lead">{L.featuresDesc}</p>
            </div>
            <div className="lp-grid3 lp-group" style={{ marginTop: 52 }}>
              {L.features6.map(([title, desc], i) => (
                <div key={title} className="lp-card lp-feature lp-reveal">
                  <span className="lp-chip" style={{ width: 52, height: 52, borderRadius: 16, background: TONES[i][0] }}>
                    <Icon color={TONES[i][1]} size={24}>{FEATURE_ICONS[i]}</Icon>
                  </span>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how" className="lp-sec lp-how">
          <div className="pub-wrap">
            <div className="lp-head center">
              <span className="lp-eyebrow"><i />{L.howLabel}</span>
              <h2>{L.howTitle}</h2>
              <p className="lp-lead">{L.howDesc}</p>
            </div>
            <div className="lp-steps lp-group">
              {L.how.map(([title, desc], i) => (
                <div key={title} className="lp-step lp-reveal">
                  <span className="lp-step-n">{i + 1}</span>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PORTALS */}
        <section id="cabinets" className="lp-sec">
          <div className="pub-wrap">
            <div className="lp-head">
              <span className="lp-eyebrow"><i />{L.cabinetsLabel}</span>
              <h2>{L.cabinetsTitle}</h2>
              <p className="lp-lead">{L.cabinetsDesc}</p>
            </div>
            <div className="lp-cab-grid">
              <div className="lp-cabs lp-group">
                {L.cabinets.map(([title, desc], i) => (
                  <div key={title} className="lp-card lp-cab lp-reveal">
                    <span className="lp-chip" style={{ width: 46, height: 46, borderRadius: 14, background: TONES[i][0] }}>
                      <Icon color={TONES[i][1]}>{CABINET_ICONS[i]}</Icon>
                    </span>
                    <h3>{title}</h3>
                    <p>{desc}</p>
                  </div>
                ))}
              </div>
              <div className="lp-phone">
                <Image src={`/landing/portal-${shot}.webp`} alt={L.portalShotAlt} width={780} height={600} unoptimized />
                <div className="lp-float lp-profile" aria-hidden>
                  <span className="lp-ava" style={{ background: "var(--pub-primary)" }}>JT</span>
                  <div>
                    <strong>{L.profileStudent[0]}</strong>
                    <small>{L.profileStudent[1]}</small>
                  </div>
                </div>
                <div className="lp-float lp-profile2" aria-hidden>
                  <span className="lp-chip" style={{ background: "var(--pub-warning-soft)" }}>
                    <Icon color="var(--pub-warning)" size={20}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Icon>
                  </span>
                  <div>
                    <strong>{L.profileParent[0]}</strong>
                    <small>{L.profileParent[1]}</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="lp-sec lp-pricing">
          <div className="pub-wrap">
            <div className="lp-head center">
              <span className="lp-eyebrow"><i />{L.pricingLabel}</span>
              <h2>{L.pricingTitle}</h2>
              <p className="lp-lead">{L.ctaDesc}</p>
            </div>
            <div className="lp-plans lp-group">
              {cards.map(({ name, price, monthly, sub, items, highlight, cta, href }) => (
                <div key={name} className={`lp-plan lp-reveal${highlight ? " hot" : ""}`}>
                  {highlight && <span className="lp-popular">{L.popular}</span>}
                  <h3>{name}</h3>
                  <div className="lp-plan-price">
                    <b>{price}</b>
                    {monthly && <span>{L.perMonth}</span>}
                  </div>
                  {sub && <div style={{ fontSize: 13.5, color: highlight ? "white" : "var(--pub-muted)" }}>{sub}</div>}
                  <ul>
                    {items.map((it) => (
                      <li key={it}>
                        <Check color={highlight ? "white" : "var(--pub-success)"} />
                        {it}
                      </li>
                    ))}
                  </ul>
                  <Link href={href} className={`pub-btn ${highlight ? "" : "pub-btn-primary"}`} style={{ marginTop: "auto" }}>
                    {cta}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ + contact */}
        <section id="faq" className="lp-sec">
          <div className="pub-wrap">
            <div className="lp-head center">
              <span className="lp-eyebrow"><i />{L.faqLabel}</span>
              <h2>{L.faqTitle}</h2>
              <p className="lp-lead">{L.faqDesc}</p>
            </div>
            <div className="lp-faq-grid">
              <div className="lp-faq">
                {L.faq.map(([q, a], i) => {
                  const open = openQ === i;
                  return (
                    <div key={q} className="lp-card lp-q" data-open={open}>
                      <button type="button" aria-expanded={open} aria-controls={`lp-faq-${i}`} onClick={() => setOpenQ(open ? -1 : i)}>
                        {q}
                        <span className="lp-q-icon" aria-hidden>
                          <Icon size={16}><path d="M12 5v14M5 12h14" /></Icon>
                        </span>
                      </button>
                      <p id={`lp-faq-${i}`} hidden={!open}>{a}</p>
                    </div>
                  );
                })}
              </div>
              <aside className="lp-card lp-contact">
                <span className="lp-chip" style={{ width: 52, height: 52, borderRadius: 16, background: "var(--pub-primary)" }}>
                  <Icon color="white" size={24}><path d="M21 11.5a8.4 8.4 0 0 1-9.9 8.3L3 21l1.2-4.3A8.4 8.4 0 1 1 21 11.5Z" /></Icon>
                </span>
                <h3>{L.contactTitle}</h3>
                <p>{L.contactDesc}</p>
                <Link href="/register" className="pub-btn pub-btn-primary">{L.contactBtn}</Link>
              </aside>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
