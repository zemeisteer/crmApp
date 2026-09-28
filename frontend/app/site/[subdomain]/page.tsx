"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { tenantsApi, fileUrl, PublicShowcaseData, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { SITE_TEXT, type SiteLang } from "@/components/site/site-text";
import HeroSlides, { STOCK_PHOTOS, type Slide } from "@/components/site/HeroSlides";
import PhoneInput from "@/components/PhoneInput";
import { isCompleteUzPhone, phoneOrEmpty } from "@/lib/validation";

// A center's public site, in the style of the TalimCRM demo: light, the
// center's own accent colour, three languages, phone-ready. Visitors see
// real groups, teachers and branches, and leave an application (a lead).

const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const DAY_KEYS: Record<string, TranslationKey> = {
  dushanba: "weekday.short.monday", seshanba: "weekday.short.tuesday", chorshanba: "weekday.short.wednesday",
  payshanba: "weekday.short.thursday", juma: "weekday.short.friday", shanba: "weekday.short.saturday", yakshanba: "weekday.short.sunday",
  mon: "weekday.short.monday", tue: "weekday.short.tuesday", wed: "weekday.short.wednesday", thu: "weekday.short.thursday",
  fri: "weekday.short.friday", sat: "weekday.short.saturday", sun: "weekday.short.sunday",
};

// YouTube watch / share links -> embed URL (other links are not embedded).
function youtubeEmbed(url?: string | null) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

// Reviews are shown only once there are enough of them to be convincing.
const MIN_TESTIMONIALS = 10;

const SOCIAL_ICON: Record<string, string> = { instagram: "📸", telegram: "✈️", youtube: "▶️", facebook: "📘", tiktok: "🎵" };

const CSS = `
  .ps{--bg:#F7F7F5;--surface:#fff;--border:#EAE8E2;--text:#181A1F;--text-2:#4A4E58;--muted:#8A8D96;--chip:#F2F1EC;background:var(--bg);color:var(--text);min-height:100vh;font-family:'Inter',system-ui,sans-serif;}
  .ps h1,.ps h2,.ps h3{font-family:'Manrope',system-ui,sans-serif;margin:0;}
  .ps a{color:inherit;text-decoration:none;}
  .ps-wrap{max-width:1160px;margin:0 auto;padding:0 32px;box-sizing:border-box;}
  .ps-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;}
  .ps-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;}
  .ps-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
  /* Card rows: a short row (2 reviews, 3 teachers...) sits in the middle
     instead of hugging the left edge. */
  .ps-cards{display:flex;flex-wrap:wrap;justify-content:center;gap:18px;}
  .ps-cards>*{box-sizing:border-box;min-width:0;flex:0 1 calc((100% - 36px) / 3);}
  .ps-cards.c4{gap:16px;}
  .ps-cards.c4>*{flex-basis:calc((100% - 48px) / 4);}
  .ps-cards.c2{gap:16px;}
  .ps-cards.c2>*{flex-basis:calc((100% - 16px) / 2);}
  .ps-head{display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center;}
  .ps-chips{display:flex;gap:8px;flex-wrap:wrap;}
  .ps-chip{border:1.5px solid var(--border);background:#fff;color:var(--text-2);font-size:13.5px;font-weight:600;padding:9px 14px;border-radius:100px;cursor:pointer;font-family:inherit;text-align:left;line-height:1.3;}
  .ps-chip:hover{border-color:var(--accent);}
  .ps-chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;}
  .ps-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:none;cursor:pointer;font-weight:700;font-family:inherit;border-radius:12px;min-height:44px;white-space:nowrap;transition:transform .15s, box-shadow .15s, background .15s, opacity .15s;}
  .ps-btn:hover{transform:translateY(-1px);}
  .ps-btn:active{transform:translateY(0);}
  .ps-btn:disabled{cursor:default;transform:none;}
  .ps-primary{background:var(--accent);color:#fff;box-shadow:0 10px 22px -10px color-mix(in srgb, var(--accent) 70%, transparent);}
  .ps-primary:hover{box-shadow:0 14px 28px -10px color-mix(in srgb, var(--accent) 80%, transparent);}
  .ps-outline{background:#fff;color:var(--text);border:1.5px solid var(--border);}
  .ps-outline:hover{border-color:var(--accent);color:var(--accent);}
  .ps-soft{background:color-mix(in srgb, var(--accent) 10%, white);color:var(--accent);}
  .ps-hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:48px;align-items:center;}
  .ps-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:100%;max-width:520px;}
  .ps-span2{grid-column:1/-1;}
  .ps-cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
  .ps-slide{animation:psFade .5s ease;}
  @keyframes psFade{from{opacity:0;transform:scale(.985);}to{opacity:1;transform:none;}}
  .ps-field{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:11px;padding:11px 13px;font-size:14px;background:#fff;color:var(--text);font-family:inherit;}
  .ps-field:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);}
  .ps-faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:12px;font-weight:700;font-size:15px;}
  .ps-faq summary::-webkit-details-marker{display:none;}
  .ps-faq[open] summary .ps-plus{transform:rotate(45deg);}
  .ps-plus{transition:transform .2s;color:var(--accent);font-size:20px;line-height:1;}
  .ps-float{position:fixed;right:16px;bottom:16px;z-index:30;display:none;gap:8px;}
  @media (max-width:980px){.ps-cards>*,.ps-cards.c4>*{flex-basis:calc((100% - 18px) / 2);}.ps-hero{grid-template-columns:minmax(0,1fr);gap:32px;}.ps-grid3{grid-template-columns:repeat(2,minmax(0,1fr));}.ps-grid4{grid-template-columns:repeat(2,minmax(0,1fr));}.ps-nav{display:none!important;}}
  @media (max-width:640px){
    .ps-wrap{padding:0 16px;}
    .ps-grid3,.ps-grid2,.ps-grid4{grid-template-columns:minmax(0,1fr);}
    .ps-cards>*,.ps-cards.c4>*,.ps-cards.c2>*{flex-basis:100%;}
    .ps h1{font-size:32px!important;}
    .ps h2{font-size:24px!important;}
    .ps-hide-sm{display:none!important;}
    .ps-field{font-size:16px;}
    .ps-float{display:flex;}
    .ps-footer{padding-bottom:88px!important;}
    .ps-cta{flex-direction:column;align-items:stretch;}
    .ps-cta .ps-btn{width:100%;}
    .ps-full-sm{width:100%;}
    .ps-hero-sec{padding:36px 16px 40px!important;}
    .ps-stats{gap:8px;}
    .ps-stats>div{min-width:0!important;padding:12px 14px!important;}
  }
`;

export default function PublicSitePage() {
  const params = useParams<{ subdomain: string }>();
  const { t, lang, setLang } = useLanguage();
  const L = SITE_TEXT[(lang as SiteLang) in SITE_TEXT ? (lang as SiteLang) : "UZ"];
  const [data, setData] = useState<PublicShowcaseData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedSubject, setSelectedSubject] = useState<string>("ALL");

  // Application form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+998 ");
  const [parentPhone, setParentPhone] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  // Anti-spam: a field humans never see, and when the form was first shown.
  const [honeypot, setHoneypot] = useState("");
  const formStartedAt = useRef(Date.now());
  const applyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!params.subdomain) return;
    tenantsApi
      .getPublicShowcase(params.subdomain)
      .then((res) => {
        setData(res);
        if (res.subjects.length > 0) setSelectedCourse(res.subjects[0].subject);
        if (res.branches.length > 0) setSelectedBranch(res.branches[0].id);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [params.subdomain]);

  const filteredGroups = useMemo(() => {
    if (!data) return [];
    return selectedSubject === "ALL" ? data.groups : data.groups.filter((g) => g.subject === selectedSubject);
  }, [data, selectedSubject]);

  function scrollToApply(subject?: string) {
    if (subject) setSelectedCourse(subject);
    applyRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const shortDays = (days?: string | null) =>
    (days ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (DAY_KEYS[d.toLowerCase()] ? t(DAY_KEYS[d.toLowerCase()]) : d))
      .join("/");

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    if (!fullName.trim() || !isCompleteUzPhone(phone)) {
      setSubmitError(L.errRequired);
      return;
    }
    if (!consent) {
      setSubmitError(L.errConsent);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    // Carry ad-campaign tags from the landing URL (?utm_source=instagram...).
    const qs = new URLSearchParams(window.location.search);
    try {
      await tenantsApi.publicApply(params.subdomain, {
        fullName: fullName.trim(),
        phone: phone.trim(),
        parentPhone: phoneOrEmpty(parentPhone) || undefined,
        subject: selectedCourse || undefined,
        branchId: selectedBranch || undefined,
        notes: notes.trim() || undefined,
        consent,
        website: honeypot || undefined,
        formStartedAt: formStartedAt.current,
        utmSource: qs.get("utm_source") || undefined,
        utmMedium: qs.get("utm_medium") || undefined,
        utmCampaign: qs.get("utm_campaign") || undefined,
      });
      setSubmitSuccess(true);
      setConsent(false);
      setFullName("");
      setPhone("+998 ");
      setParentPhone("");
      setNotes("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setSubmitError(L.errTooMany);
      else setSubmitError(err instanceof ApiError ? err.message : L.errGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5", color: "#8A8D96", fontSize: 14 }}>
        {L.loading}
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#F7F7F5", padding: 16, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "#fff", border: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#8A8D96" }}>404</div>
        <h2 style={{ fontFamily: "'Manrope',sans-serif", fontSize: 20, fontWeight: 800 }}>{L.notFoundTitle}</h2>
        <p style={{ fontSize: 13.5, color: "#8A8D96", maxWidth: 360 }}>{L.notFoundText}</p>
        <Link href="/" style={{ background: "#4F46E5", color: "#fff", fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: 10 }}>{L.backHome}</Link>
      </div>
    );
  }

  const { tenant, stats, subjects, teachers, branches, announcements } = data;
  const accent = tenant.accentColor || "#4F46E5";
  const logo = fileUrl(tenant.logoUrl);
  const statItems = [
    { value: stats.coursesCount, label: L.statGroups },
    { value: stats.teachersCount, label: L.statTeachers },
    { value: stats.branchesCount, label: L.statBranches },
  ].filter((i) => i.value > 0);
  const site = data.site;
  const placement = data.placementTest ?? null;
  const prices = data.groups.map((g) => g.monthlyPrice).filter((p) => p > 0);
  const priceText = prices.length ? (Math.min(...prices) === Math.max(...prices) ? money(prices[0]) : `${money(Math.min(...prices))} – ${money(Math.max(...prices))}`) : null;
  const video = youtubeEmbed(site?.videoUrl);
  const socials = site ? (Object.entries(site.socials).filter(([, v]) => v) as Array<[string, string]>) : [];
  const telegramLink = tenant.telegramUsername ? `https://t.me/${tenant.telegramUsername.replace(/^@/, "")}` : site?.socials.telegram ?? null;
  const slides: Slide[] = [
    ...(site?.gallery ?? []).slice(0, 3).map((g): Slide => ({ kind: "photo", title: tenant.name, text: L.slidePhoto, src: fileUrl(g) ?? "" })),
    { kind: "teacher", title: L.slideTeacherTitle, text: L.slideTeacherText, src: STOCK_PHOTOS.teacher },
    { kind: "ai", title: L.slideAiTitle, text: L.slideAiText, src: STOCK_PHOTOS.ai },
    { kind: "results", title: L.slideResultsTitle, text: L.slideResultsText, src: STOCK_PHOTOS.results },
  ];
  // Questions every visitor asks, answered from the center's real data when
  // it has not written its own.
  const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  const autoFaq: Array<{ q: string; a: string }> = [
    ...(priceText ? [{ q: L.faqPriceQ, a: fill(L.faqPriceA, { price: priceText }) }] : []),
    ...(site?.trialLesson ? [{ q: L.faqTrialQ, a: fill(L.faqTrialA, { trial: site.trialText || L.trialBadge.toLowerCase() }) }] : []),
    { q: L.faqLevelQ, a: placement ? L.faqLevelTestA : L.faqLevelA },
    { q: L.faqScheduleQ, a: [L.faqScheduleA, site?.workingHours ? fill(L.faqHoursA, { hours: site.workingHours }) : ""].filter(Boolean).join(" ") },
    ...(teachers.length > 0
      ? [{ q: L.faqTeachersQ, a: fill(L.faqTeachersA, { n: String(teachers.length), names: teachers.slice(0, 6).map((x) => (x.subject ? `${x.fullName} (${x.subject})` : x.fullName)).join(", ") }) }]
      : []),
    ...(branches.length > 0 || tenant.address
      ? [{ q: L.faqWhereQ, a: branches.length > 0 ? branches.map((b) => [b.name, b.address].filter(Boolean).join(" — ")).join("; ") : tenant.address! }]
      : []),
    { q: L.faqHowQ, a: fill(L.faqHowA, { phone: tenant.phone ? fill(L.faqHowPhone, { phone: tenant.phone }) : "" }) },
  ];
  const faq = (site?.faq.length ?? 0) > 0 ? site!.faq : autoFaq;
  const testimonials = (site?.testimonials.length ?? 0) >= MIN_TESTIMONIALS ? site!.testimonials : [];
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.04em" };
  const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16 };

  return (
    <div className="ps" style={{ ["--accent" as string]: accent }}>
      <style>{CSS}</style>

      {/* HEADER */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(247,247,245,0.92)", backdropFilter: "blur(6px)", borderBottom: "1px solid var(--border)" }}>
        <div className="ps-wrap" style={{ height: 66, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <a href="#" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={tenant.name} style={{ width: 36, height: 36, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: 10, background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{tenant.name.slice(0, 1).toUpperCase()}</div>
            )}
            <span style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 17, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tenant.name}</span>
          </a>
          <nav className="ps-nav" style={{ display: "flex", gap: 28, fontSize: 14, fontWeight: 500, color: "var(--text-2)" }}>
            <a href="#courses">{L.navCourses}</a>
            {teachers.length > 0 && <a href="#teachers">{L.navTeachers}</a>}
            {branches.length > 0 && <a href="#branches">{L.navBranches}</a>}
            <a href="#faq">{L.faqLabel}</a>
            {announcements.length > 0 && <a href="#news">{L.navNews}</a>}
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ display: "flex", background: "var(--chip)", borderRadius: 9, padding: 3 }}>
              {(["UZ", "RU", "EN"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} style={{ border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "5px 8px", borderRadius: 7, background: lang === l ? "#fff" : "transparent", color: lang === l ? "var(--text)" : "var(--muted)" }}>
                  {l}
                </button>
              ))}
            </div>
            <Link href="/login" className="ps-hide-sm" style={{ fontSize: 14, fontWeight: 600, padding: "0 6px" }}>{L.login}</Link>
            <button type="button" className="ps-btn ps-primary ps-hide-sm" onClick={() => scrollToApply()} style={{ fontSize: 14, padding: "0 18px", minHeight: 40 }}>{L.apply}</button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="ps-wrap ps-hero ps-hero-sec" style={{ padding: "64px 32px 56px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-start", minWidth: 0 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `color-mix(in srgb, ${accent} 12%, white)`, color: accent, fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 100 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent }} />
          {L.category[tenant.category] ?? L.category.BOSHQA}
        </span>
        {site?.trialLesson && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#E9F8EF", color: "#1FA463", fontSize: 13, fontWeight: 700, padding: "6px 12px", borderRadius: 100 }}>
            🎁 {L.trialBadge}{site.trialText ? ` — ${site.trialText}` : ""}
          </span>
        )}
        <h1 style={{ fontSize: 48, lineHeight: 1.1, fontWeight: 800, letterSpacing: "-0.02em", maxWidth: 760 }}>{site?.heroTitle || L.heroTitle.replace("{name}", tenant.name)}</h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--text-2)", maxWidth: 560, margin: 0 }}>{site?.heroSubtitle || L.heroDesc}</p>
        <div className="ps-cta" style={{ width: "100%" }}>
          <button type="button" className="ps-btn ps-primary" onClick={() => scrollToApply()} style={{ fontSize: 15, padding: "0 24px", minHeight: 50 }}>{site?.trialLesson ? L.trialCta : L.apply} →</button>
          <a href="#courses" className="ps-btn ps-outline" style={{ fontSize: 15, padding: "0 22px", minHeight: 50 }}>{L.seeCourses}</a>
        </div>
        {tenant.phone && (
          <a href={`tel:${tenant.phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 600, color: "var(--text-2)" }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: `color-mix(in srgb, ${accent} 12%, white)` }}>📞</span>
            {tenant.phone}
          </a>
        )}
        {(statItems.length > 0 || priceText) && (
          <div className="ps-stats" style={{ marginTop: 8 }}>
            {priceText && (
              <div className="ps-span2" style={{ ...card, padding: "14px 20px", minWidth: 120 }}>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 20 }}>{priceText}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{L.priceFrom}, so&apos;m / {L.perMonth}</div>
              </div>
            )}
            {statItems.map((i) => (
              <div key={i.label} style={{ ...card, padding: "14px 20px", minWidth: 120 }}>
                <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 26 }}>{i.value}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{i.label}</div>
              </div>
            ))}
          </div>
        )}
        </div>
        <HeroSlides slides={slides} accent={accent} />
      </section>

      {/* PLACEMENT TEST */}
      {placement && (
        <section className="ps-wrap" style={{ paddingBottom: 48 }}>
          <div style={{ background: `linear-gradient(135deg, ${accent}, #1B1440)`, color: "#fff", borderRadius: 20, padding: "28px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <div style={{ maxWidth: 560 }}>
              <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 22 }}>🧭 {L.placementTitle}</div>
              <div style={{ fontSize: 14.5, opacity: 0.85, marginTop: 6 }}>{L.placementDesc}</div>
            </div>
            <Link href={`/t/${placement.token}`} className="ps-btn ps-full-sm" style={{ background: "#fff", color: accent, fontSize: 15, padding: "0 22px", minHeight: 48, boxShadow: "0 10px 24px -12px rgba(0,0,0,0.4)" }}>{L.placementCta} →</Link>
          </div>
        </section>
      )}

      {/* ABOUT + WHY US */}
      {(site?.about || (site?.advantages.length ?? 0) > 0) && (
        <section className="ps-wrap" style={{ padding: "24px 32px 72px", display: "flex", flexDirection: "column", gap: 28 }}>
          {site?.about && (
            <div className="ps-head" style={{ maxWidth: 760, margin: "0 auto" }}>
              <span style={label}>{L.aboutLabel}</span>
              <p style={{ fontSize: 16, lineHeight: 1.75, color: "var(--text-2)", margin: 0, whiteSpace: "pre-wrap" }}>{site.about}</p>
            </div>
          )}
          {(site?.advantages.length ?? 0) > 0 && (
            <>
              <div className="ps-head">
                <span style={label}>{L.whyLabel}</span>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.whyTitle}</h2>
              </div>
              <div className="ps-cards c4">
                {site!.advantages.map((a, i) => (
                  <div key={i} style={{ ...card, padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: `color-mix(in srgb, ${accent} 12%, white)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{a.icon}</div>
                    <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 16 }}>{a.title}</div>
                    {a.text && <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-2)" }}>{a.text}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* RESULTS */}
      {(site?.results.length ?? 0) > 0 && (
        <section style={{ background: "linear-gradient(135deg,#0F0B29,#1B1440)", padding: "72px 0" }}>
          <div className="ps-wrap" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div className="ps-head">
              <span style={{ ...label, color: "#A9A6FF" }}>{L.resultsLabel}</span>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>{L.resultsTitle}</h2>
            </div>
            <div className="ps-cards c4">
              {site!.results.map((r, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: 20, color: "#fff" }}>
                  <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 24, color: "#C4B5FD" }}>{r.result}</div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginTop: 6 }}>{r.name}</div>
                  {r.detail && <div style={{ fontSize: 13, color: "#B7B0E8", marginTop: 4 }}>{r.detail}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* COURSES */}
      <section id="courses" style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "72px 0" }}>
        <div className="ps-wrap" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div className="ps-head">
            <span style={label}>{L.coursesLabel}</span>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.coursesTitle}</h2>
          </div>
          {subjects.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {[{ key: "ALL", name: `${L.all} (${data.groups.length})` }, ...subjects.map((s) => ({ key: s.subject, name: `${s.subject} (${s.groupCount})` }))].map((f) => (
                <button key={f.key} type="button" onClick={() => setSelectedSubject(f.key)} style={{ border: `1px solid ${selectedSubject === f.key ? accent : "var(--border)"}`, background: selectedSubject === f.key ? accent : "#fff", color: selectedSubject === f.key ? "#fff" : "var(--text-2)", fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 100, cursor: "pointer" }}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
          {filteredGroups.length === 0 ? (
            <div style={{ ...card, padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{L.noCourses}</div>
          ) : (
            <div className="ps-cards">
              {filteredGroups.map((g) => (
                <div key={g.id} style={{ ...card, background: "var(--bg)", padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: accent, background: `color-mix(in srgb, ${accent} 12%, white)`, padding: "3px 10px", borderRadius: 100 }}>{g.subject}</span>
                    {g.level && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", background: "var(--chip)", padding: "3px 10px", borderRadius: 100 }}>{g.level}</span>}
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 700 }}>{g.name}</h3>
                  {g.seatsLeft !== null && g.seatsLeft !== undefined && (
                    <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 100, ...(g.seatsLeft === 0 ? { color: "#B23A47", background: "#FDEBEC" } : g.seatsLeft <= 3 ? { color: "#B45309", background: "#FEF3C7" } : { color: "#1FA463", background: "#E9F8EF" }) }}>
                      {g.seatsLeft === 0 ? L.seatsFull : L.seatsLeft.replace("{n}", String(g.seatsLeft))}
                    </span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13.5, color: "var(--text-2)" }}>
                    {(g.scheduleDays || g.startTime) && (
                      <div>🗓 {[shortDays(g.scheduleDays), g.startTime ? `${g.startTime}${g.endTime ? `–${g.endTime}` : ""}` : ""].filter(Boolean).join(", ")}</div>
                    )}
                    {g.teacherName && <div>👩‍🏫 {g.teacherName}</div>}
                    {g.branchName && <div>📍 {g.branchName}</div>}
                  </div>
                  <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      {g.monthlyPrice > 0 ? (
                        <>
                          <span style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 800, fontSize: 18 }}>{money(g.monthlyPrice)}</span>
                          <span style={{ fontSize: 12.5, color: "var(--muted)" }}> so&apos;m / {L.perMonth}</span>
                        </>
                      ) : (
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-2)" }}>{L.priceOnRequest}</span>
                      )}
                    </div>
                    <button type="button" className="ps-btn ps-primary" onClick={() => scrollToApply(g.subject)} style={{ fontSize: 13.5, padding: "0 16px", minHeight: 40 }}>{L.enroll} →</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* GALLERY + VIDEO */}
      {((site?.gallery.length ?? 0) > 0 || video) && (
        <section className="ps-wrap" style={{ padding: "72px 32px 0", display: "flex", flexDirection: "column", gap: 24 }}>
          <div className="ps-head">
            <span style={label}>{L.galleryLabel}</span>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.galleryTitle}</h2>
          </div>
          {video && (
            <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 16, overflow: "hidden", background: "#000" }}>
              <iframe src={video} title={L.videoTitle} allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
            </div>
          )}
          {(site?.gallery.length ?? 0) > 0 && (
            <div className="ps-cards">
              {site!.gallery.map((g) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={g} src={fileUrl(g) ?? ""} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 14, border: "1px solid var(--border)" }} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* TEACHERS */}
      {teachers.length > 0 && (
        <section id="teachers" className="ps-wrap" style={{ padding: "72px 32px", display: "flex", flexDirection: "column", gap: 28 }}>
          <div className="ps-head">
            <span style={label}>{L.teachersLabel}</span>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.teachersTitle}</h2>
          </div>
          <div className="ps-cards c4">
            {teachers.map((tc) => (
              <div key={tc.id} style={{ ...card, padding: 20, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: "50%", background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flexShrink: 0 }}>
                  {tc.fullName.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{tc.fullName}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{tc.subject || L.teacherFallback}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TESTIMONIALS */}
      {testimonials.length > 0 && (
        <section style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "72px 0" }}>
          <div className="ps-wrap" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div className="ps-head">
              <span style={label}>{L.testimonialsLabel}</span>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.testimonialsTitle}</h2>
            </div>
            <div className="ps-cards">
              {testimonials.map((r, i) => (
                <div key={i} style={{ ...card, background: "var(--bg)", padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ fontSize: 28, lineHeight: 1, color: accent }}>“</div>
                  <div style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{r.text}</div>
                  <div style={{ marginTop: "auto" }}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    {r.role && <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.role}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      {faq.length > 0 && (
        <section id="faq" className="ps-wrap" style={{ padding: "72px 32px", maxWidth: 860, display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="ps-head">
            <span style={label}>{L.faqLabel}</span>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.faqTitle}</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {faq.map((f, i) => (
              <details key={i} className="ps-faq" style={{ ...card, padding: "16px 20px" }}>
                <summary>
                  <span>{f.q}</span>
                  <span className="ps-plus">+</span>
                </summary>
                <div style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--text-2)", marginTop: 10, whiteSpace: "pre-wrap" }}>{f.a}</div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* BRANCHES */}
      {branches.length > 0 && (
        <section id="branches" style={{ background: "#12131A", padding: "72px 0" }}>
          <div className="ps-wrap" style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div className="ps-head">
              <span style={{ ...label, color: "#A9A6FF" }}>{L.branchesLabel}</span>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>{L.branchesTitle}</h2>
              {site?.workingHours && <div style={{ color: "#B7B0E8", fontSize: 14.5 }}>🕒 {L.hours}: {site.workingHours}</div>}
            </div>
            <div className="ps-cards c2">
              {branches.map((b) => (
                <div key={b.id} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 20, color: "#fff", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontFamily: "'Manrope',sans-serif", fontWeight: 700, fontSize: 16 }}>📍 {b.name}</div>
                  <div style={{ fontSize: 14, color: "#B7B0E8" }}>{b.address || L.noAddress}</div>
                  {b.phone && <a href={`tel:${b.phone}`} style={{ fontSize: 14, color: "#fff" }}>📞 {b.phone}</a>}
                  {b.mapUrl && <a href={b.mapUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, color: "#A9A6FF", fontWeight: 600 }}>🗺 {L.openMap} →</a>}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* NEWS */}
      {announcements.length > 0 && (
        <section id="news" className="ps-wrap" style={{ padding: "72px 32px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 860 }}>
          <div className="ps-head">
            <span style={label}>{L.newsLabel}</span>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.newsTitle}</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {announcements.map((a) => (
              <div key={a.id} style={{ ...card, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 15.5 }}>{a.title}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{formatDate(a.publishedAt, lang, "dayMonth")}</div>
                </div>
                <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{a.content}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* APPLICATION */}
      <section ref={applyRef} id="apply" style={{ padding: "72px 16px", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", ...card, padding: "32px 28px", position: "relative", boxShadow: "0 24px 48px -28px rgba(18,19,26,0.25)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
            <span style={label}>{L.formLabel}</span>
            <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>{L.formTitle}</h2>
            <p style={{ fontSize: 14.5, color: "var(--text-2)", margin: 0 }}>{L.formDesc}</p>
          </div>
          {submitSuccess ? (
            <div style={{ textAlign: "center", padding: "20px 0", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#E9F8EF", color: "#1FA463", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 800 }}>✓</div>
              <h3 style={{ fontSize: 19, fontWeight: 800 }}>{L.successTitle}</h3>
              <p style={{ fontSize: 14, color: "var(--text-2)", margin: 0 }}>{L.successText}</p>
              <button type="button" className="ps-btn ps-soft" onClick={() => setSubmitSuccess(false)} style={{ fontSize: 13.5, padding: "0 18px", marginTop: 6 }}>{L.again}</button>
            </div>
          ) : (
            <form onSubmit={handleApply} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {submitError && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13.5, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{submitError}</div>}
              <Field label={`${L.fullName} *`}>
                <input className="ps-field" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={L.fullNamePh} autoComplete="name" />
              </Field>
              <div className="ps-grid2" style={{ gap: 12 }}>
                <Field label={`${L.phone} *`}>
                  <PhoneInput className="ps-field" value={phone} onChange={setPhone} />
                </Field>
                <Field label={L.parentPhone}>
                  <PhoneInput className="ps-field" value={parentPhone} onChange={setParentPhone} placeholder="+998 90 987 65 43" autoComplete="off" />
                </Field>
              </div>
              {/* Choices as buttons, not dropdowns: every option is visible
                  and works the same on phones and computers. */}
              {subjects.length > 0 && (
                <ChipGroup
                  label={L.course}
                  value={selectedCourse}
                  onChange={setSelectedCourse}
                  options={[...subjects.map((x) => ({ value: x.subject, label: x.subject })), { value: "", label: L.courseUnsure }]}
                />
              )}
              {branches.length > 1 && (
                <ChipGroup
                  label={L.branchPick}
                  value={selectedBranch}
                  onChange={setSelectedBranch}
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                />
              )}
              <Field label={L.notes}>
                <textarea className="ps-field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={L.notesPh} style={{ resize: "vertical" }} />
              </Field>
              {/* Honeypot: hidden from people and screen readers; bots fill it. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                <label>
                  Website
                  <input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </label>
              </div>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, cursor: "pointer" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3, accentColor: accent, width: 16, height: 16 }} />
                <span>
                  {L.consent}{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: accent, textDecoration: "underline" }}>{L.privacy}</a>
                </span>
              </label>
              <button type="submit" className="ps-btn ps-primary" disabled={submitting} style={{ width: "100%", fontSize: 15, minHeight: 52, opacity: submitting ? 0.7 : 1 }}>
                {submitting ? L.sending : `${L.send} →`}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="ps-footer" style={{ borderTop: "1px solid var(--border)", padding: "32px 0" }}>
        <div className="ps-wrap" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
          <div>
            <div style={{ fontWeight: 700, color: "var(--text)" }}>{tenant.name}</div>
            <div>{branches[0]?.address || tenant.address || ""}</div>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            {tenant.telegramUsername && (
              <a href={`https://t.me/${tenant.telegramUsername.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Telegram: @{tenant.telegramUsername.replace(/^@/, "")}</a>
            )}
            {tenant.phone && <a href={`tel:${tenant.phone}`}>{tenant.phone}</a>}
            {tenant.email && <a href={`mailto:${tenant.email}`}>{tenant.email}</a>}
          </div>
          <div>© {new Date().getFullYear()} {tenant.name} · {L.poweredBy}</div>
        </div>
        {socials.length > 0 && (
          <div className="ps-wrap" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13, color: "var(--muted)" }}>
            <span>{L.followUs}:</span>
            {socials.map(([k, v]) => (
              <a key={k} href={v} target="_blank" rel="noreferrer" style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 100, padding: "6px 12px", fontWeight: 600, color: "var(--text)" }}>
                {SOCIAL_ICON[k]} {k[0].toUpperCase() + k.slice(1)}
              </a>
            ))}
          </div>
        )}
      </footer>

      {/* Phones: quick call / message buttons */}
      {(tenant.phone || telegramLink) && (
        <div className="ps-float">
          {telegramLink && (
            <a href={telegramLink} target="_blank" rel="noreferrer" className="ps-btn" style={{ background: "#229ED9", color: "#fff", padding: "0 18px", minHeight: 48, borderRadius: 100, fontSize: 14, boxShadow: "0 10px 24px rgba(0,0,0,0.18)" }}>✈️ {L.write}</a>
          )}
          {tenant.phone && (
            <a href={`tel:${tenant.phone}`} className="ps-btn ps-primary" style={{ padding: "0 18px", minHeight: 48, borderRadius: 100, fontSize: 14 }}>📞 {L.call}</a>
          )}
        </div>
      )}
    </div>
  );
}

function ChipGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      <div className="ps-chips">
        {options.map((o) => (
          <button key={o.value || "none"} type="button" role="radio" aria-checked={value === o.value} aria-pressed={value === o.value} className="ps-chip" onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      {children}
    </label>
  );
}
