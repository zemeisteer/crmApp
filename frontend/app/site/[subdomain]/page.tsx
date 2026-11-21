"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { tenantsApi, fileUrl, PublicShowcaseData, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { SITE_TEXT, type SiteLang } from "@/components/site/site-text";
import PhoneInput from "@/components/PhoneInput";
import ThemeToggle from "@/components/ThemeToggle";
import HeroSlides, { type Slide } from "@/components/site/HeroSlides";
import { isCompleteUzPhone, phoneOrEmpty } from "@/lib/validation";

// A center's public site: calm and editorial (white, one accent colour, the
// center's own photos and numbers), three languages, phone-ready. Visitors see
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


const CSS = `
  .ps{--bg:var(--surface);--text-2:var(--text-soft);--muted:var(--text-muted);--ps-display:'Manrope',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
  .ps h1,.ps h2,.ps h3{font-family:var(--ps-display);margin:0;}
  .ps a{color:inherit;text-decoration:none;}
  .ps-wrap{max-width:1180px;margin:0 auto;padding:0 32px;box-sizing:border-box;}
  .ps-header{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--surface) 94%,transparent);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--border);}
  .ps-nav{display:flex;gap:28px;font-size:14px;color:var(--text-2);}
  .ps-nav a:hover,.ps-link:hover{color:var(--text);}
  .ps-link{font-size:14px;color:var(--text-2);white-space:nowrap;}
  .ps-link-accent{font-size:14px;font-weight:600;color:var(--accent)!important;}
  .ps-lang{display:flex;gap:2px;}
  .ps-lang button{border:none;background:none;cursor:pointer;font-size:12px;font-weight:600;color:var(--muted);padding:4px 6px;border-radius:6px;font-family:inherit;}
  .ps-lang button[aria-pressed="true"]{color:var(--text);background:var(--surface-muted);}
  .ps-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;cursor:pointer;font-weight:600;font-size:14px;font-family:inherit;border-radius:10px;min-height:40px;padding:0 16px;white-space:nowrap;transition:background .15s,border-color .15s,color .15s;}
  .ps-btn-lg{min-height:48px;padding:0 22px;font-size:15px;}
  .ps-btn:disabled{cursor:default;}
  .ps-primary{background:var(--accent);color:#fff;}
  .ps-primary:hover{background:color-mix(in srgb,var(--accent) 88%,#000);}
  .ps-ghost{background:transparent;color:var(--text);border-color:var(--border);}
  .ps-ghost:hover{border-color:var(--text);}
  .ps-dark{background:var(--text);color:var(--surface);}
  .ps-hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.9fr);gap:64px;align-items:center;padding-top:72px;padding-bottom:56px;}
  .ps-eyebrow{font-size:14px;color:var(--muted);}
  .ps-h1{font-size:56px;line-height:1.05;font-weight:700;letter-spacing:-0.035em;max-width:640px;}
  .ps-lead{font-size:19px;line-height:1.6;color:var(--text-2);max-width:540px;margin:0;}
  .ps-h2{font-size:36px;line-height:1.15;font-weight:700;letter-spacing:-0.025em;}
  .ps-h3{font-size:22px;font-weight:700;letter-spacing:-0.015em;}
  .ps-h4{font-size:17px;font-weight:700;letter-spacing:-0.01em;margin:0;}
  .ps-label{font-size:13px;font-weight:600;color:var(--accent);margin-bottom:10px;}
  .ps-cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
  .ps-hero-media{aspect-ratio:4/5;max-height:520px;border-radius:20px;overflow:hidden;background:var(--surface-muted);}
  .ps-hero-media img{width:100%;height:100%;object-fit:cover;display:block;}
  .ps-hero-list{height:100%;box-sizing:border-box;padding:28px;display:flex;flex-direction:column;gap:4px;justify-content:center;}
  .ps-hero-row{display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-top:8px;cursor:pointer;font-family:inherit;color:var(--text);font-size:15px;}
  .ps-hero-row:hover{border-color:var(--text);}
  .ps-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));border-top:1px solid var(--border);border-bottom:1px solid var(--border);}
  .ps-facts>div{padding:26px 24px 26px 0;}
  .ps-facts>div+div{border-left:1px solid var(--border);padding-left:24px;}
  .ps-fact-v{font-family:var(--ps-display);font-size:26px;white-space:nowrap;font-weight:700;letter-spacing:-0.02em;}
  .ps-fact-l{font-size:14px;color:var(--muted);margin-top:4px;}
  .ps-sec{padding-top:96px;padding-bottom:96px;}
  .ps-sec-sm{padding-top:48px;}
  .ps-muted{background:var(--surface-muted);}
  .ps-band{border:1px solid var(--border);border-radius:16px;padding:28px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}
  .ps-section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:36px;}
  .ps-split{display:grid;grid-template-columns:minmax(0,0.8fr) minmax(0,1.2fr);gap:64px;align-items:start;}
  .ps-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
  .ps-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;}
  .ps-grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;}
  .ps-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;}
  .ps-feature{display:flex;flex-direction:column;gap:10px;padding-top:20px;border-top:1px solid var(--text);}
  .ps-index{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;}
  .ps-group{padding:24px;display:flex;flex-direction:column;gap:12px;}
  .ps-tag{font-size:12px;font-weight:600;color:var(--accent);border:1px solid currentColor;border-radius:999px;padding:2px 9px;}
  .ps-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:14px;}
  .ps-dl dt{color:var(--muted);}
  .ps-dl dd{margin:0;color:var(--text);}
  .ps-group-foot{margin-top:auto;padding-top:16px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
  .ps-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:-12px 0 28px;}
  .ps-tabs button{border:1px solid var(--border);background:var(--surface);color:var(--text-2);font-size:14px;font-weight:500;padding:8px 14px;border-radius:999px;cursor:pointer;font-family:inherit;}
  .ps-tabs button[aria-selected="true"]{background:var(--text);border-color:var(--text);color:var(--surface);}
  .ps-gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
  .ps-gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;display:block;}
  .ps-gallery img:first-child{grid-column:span 2;grid-row:span 2;aspect-ratio:auto;height:100%;}
  .ps-person{display:flex;flex-direction:column;gap:4px;}
  .ps-avatar img{width:100%;height:100%;object-fit:cover;border-radius:16px;display:block;}
  .ps-tag-muted{color:var(--text-2);}
  .ps-avatar{width:100%;aspect-ratio:1;overflow:hidden;border-radius:16px;background:var(--surface-muted);display:flex;align-items:center;justify-content:center;font-family:var(--ps-display);font-weight:700;font-size:40px;color:var(--text-2);margin-bottom:10px;}
  .ps-faq-list{border-top:1px solid var(--border);}
  .ps-faq{border-bottom:1px solid var(--border);padding:20px 0;}
  .ps-faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:16px;font-weight:600;font-size:16px;}
  .ps-faq summary::-webkit-details-marker{display:none;}
  .ps-faq[open] .ps-plus{transform:rotate(45deg);}
  .ps-plus{transition:transform .2s;color:var(--muted);font-size:22px;line-height:1;}
  .ps-list{display:flex;flex-direction:column;}
  .ps-list article{padding:22px 0;border-top:1px solid var(--border);}
  .ps-apply{display:grid;grid-template-columns:minmax(0,0.85fr) minmax(0,1.15fr);gap:64px;align-items:start;}
  .ps-chips{display:flex;gap:8px;flex-wrap:wrap;}
  .ps-chip{border:1px solid var(--border);background:var(--surface);color:var(--text-2);font-size:14px;font-weight:500;padding:8px 14px;border-radius:999px;cursor:pointer;font-family:inherit;text-align:left;line-height:1.3;}
  .ps-chip:hover{border-color:var(--text);}
  .ps-chip[aria-pressed="true"],.ps-chip[aria-checked="true"]{background:var(--text);border-color:var(--text);color:var(--surface);}
  .ps-field{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;padding:11px 13px;font-size:15px;background:var(--surface);color:var(--text);font-family:inherit;}
  .ps-field:focus{outline:none;border-color:var(--text);}
  .ps-footer{border-top:1px solid var(--border);padding:48px 0 32px;font-size:14px;color:var(--muted);}
  .ps-footer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;}
  .ps-footer a:hover{color:var(--text);}
  .ps-float{position:fixed;right:16px;bottom:16px;z-index:30;display:none;gap:8px;}
  .ps-span2{grid-column:1/-1;}
  .ps a.ps-primary{color:#fff;}
  .ps a.ps-dark{color:var(--surface);}
  .ps-icon-btn{width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}
  .ps-hero-carousel{min-width:0;}
  .ps-grid1{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;}
  .ps-result{padding:22px;height:100%;box-sizing:border-box;}
  .ps-marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);}
  .ps-marquee-track{display:flex;gap:20px;width:max-content;animation:psMarquee linear infinite;}
  .ps-marquee:hover .ps-marquee-track{animation-play-state:paused;}
  .ps-marquee-item{width:260px;flex:0 0 260px;}
  @keyframes psMarquee{from{transform:translateX(0);}to{transform:translateX(calc(-50% - 10px));}}
  @media (prefers-reduced-motion:reduce){.ps-marquee-track{animation:none;}.ps-marquee{overflow-x:auto;}}
  .ps-pages{display:flex;gap:6px;justify-content:center;margin-top:32px;}
  .ps-pages button{min-width:40px;height:40px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;}
  .ps-pages button[aria-current="page"]{background:var(--text);border-color:var(--text);color:var(--surface);}
  .ps-pages button:disabled{opacity:.4;cursor:default;}
  .ps-branch{overflow:hidden;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);}
  .ps-grid2 .ps-branch,.ps-grid3 .ps-branch{grid-template-columns:minmax(0,1fr);}
  .ps-map{width:100%;height:100%;min-height:260px;border:0;display:block;background:var(--surface-muted);}
  .ps-news{padding:24px;display:flex;gap:20px;align-items:flex-start;}
  .ps-news-date{flex:0 0 64px;height:64px;border-radius:14px;background:var(--surface-muted);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;}
  .ps-news-date b{font-family:var(--ps-display);font-size:24px;}
  .ps-news-date span{font-size:12px;color:var(--muted);}
  .ps-steps{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:18px;}
  .ps-steps li{display:flex;gap:14px;align-items:flex-start;font-size:15.5px;}
  .ps-step-n{flex:0 0 32px;height:32px;border-radius:50%;border:1px solid var(--border);background:var(--surface);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;}
  /* Dashboard feel: soft glow behind the hero, tiles with depth, a floating bar. */
  .ps{background:radial-gradient(1100px 520px at 12% -8%,color-mix(in srgb,var(--accent) 16%,transparent),transparent 60%),radial-gradient(900px 480px at 100% 0%,color-mix(in srgb,var(--accent) 9%,transparent),transparent 55%),var(--bg);background-attachment:fixed;}
  .ps-header{margin:12px auto 0;max-width:1180px;border:1px solid var(--border);border-radius:16px;top:12px;background:color-mix(in srgb,var(--surface) 78%,transparent);backdrop-filter:blur(14px) saturate(1.5);box-shadow:0 8px 30px rgba(0,0,0,.18);}
  .ps-card{background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 92%,#fff 8%),var(--surface));border-radius:18px;box-shadow:0 1px 0 color-mix(in srgb,#fff 6%,transparent) inset,0 10px 30px rgba(0,0,0,.14);transition:transform .2s,border-color .2s;}
  .ps-group:hover,.ps-result:hover,.ps-news:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--accent) 55%,var(--border));}
  .ps-hero-media{border-radius:24px;border:1px solid var(--border);box-shadow:0 24px 60px rgba(0,0,0,.35);}
  .ps-h1{background:linear-gradient(180deg,var(--text),color-mix(in srgb,var(--text) 70%,var(--accent)));-webkit-background-clip:text;background-clip:text;color:transparent;}
  .ps-facts{border:none;gap:14px;}
  .ps-facts>div,.ps-facts>div+div{border:1px solid var(--border);border-radius:18px;padding:22px 24px;background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 90%,#fff 10%),var(--surface));}
  .ps-fact-v{white-space:normal!important;font-size:22px!important;line-height:1.2;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 60%,var(--text)));-webkit-background-clip:text;background-clip:text;color:transparent;}
  .ps-feature{border:1px solid var(--border);border-radius:18px;padding:22px;background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 92%,#fff 8%),var(--surface));}
  .ps-index{display:inline-flex;width:34px;height:34px;border-radius:10px;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);font-weight:700;}
  .ps-muted{background:color-mix(in srgb,var(--surface-muted) 70%,transparent);}
  .ps-tabs button,.ps-chip{transition:border-color .15s,background .15s;}
  .ps-tabs button[aria-selected="true"],.ps-chip[aria-pressed="true"],.ps-chip[aria-checked="true"]{background:var(--accent);border-color:var(--accent);color:#fff;}
  .ps-btn{border-radius:12px;}
  .ps-primary{box-shadow:0 6px 18px color-mix(in srgb,var(--accent) 40%,transparent);}
  .ps-progress{height:6px;border-radius:3px;background:var(--surface-muted);overflow:hidden;}
  .ps-progress span{display:block;height:100%;background:var(--accent);border-radius:3px;transition:width .3s;}
  .ps-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
  .ps-tile{display:flex;align-items:center;gap:10px;text-align:left;border:1.5px solid var(--border);background:var(--surface);color:var(--text);border-radius:14px;padding:14px;cursor:pointer;font-family:inherit;font-size:14.5px;font-weight:600;line-height:1.3;transition:border-color .15s,background .15s,transform .15s;}
  .ps-tile:hover{border-color:var(--accent);transform:translateY(-1px);}
  .ps-tile[aria-pressed="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--surface));}
  .ps-tile-check{flex:0 0 22px;height:22px;border-radius:7px;border:1.5px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:#fff;}
  .ps-tile[aria-pressed="true"] .ps-tile-check{background:var(--accent);border-color:var(--accent);}
  .ps-linkbtn{border:none;background:none;color:var(--accent);font-weight:600;font-size:14px;cursor:pointer;padding:0;text-align:left;font-family:inherit;}
  @media (max-width:640px){.ps-header{margin:8px 8px 0;border-radius:14px;}}
  @media (max-width:980px){
    .ps-nav{display:none!important;}
    .ps-hero{grid-template-columns:minmax(0,1fr);gap:40px;padding-top:48px;}
    .ps-hero-media{aspect-ratio:auto;max-height:none;}
    .ps-hero-media img{aspect-ratio:16/10;}
    .ps-split,.ps-apply{grid-template-columns:minmax(0,1fr);gap:28px;}
    .ps-branch{grid-template-columns:minmax(0,1fr);}
    .ps-grid3{grid-template-columns:repeat(2,minmax(0,1fr));}
    .ps-grid4{grid-template-columns:repeat(2,minmax(0,1fr));}
  }
  @media (max-width:640px){
    .ps-wrap{padding:0 16px;}
    .ps-h1{font-size:38px;}
    .ps-h2{font-size:28px;}
    .ps-lead{font-size:17px;}
    .ps-sec{padding-top:64px;padding-bottom:64px;}
    .ps-grid3,.ps-grid2,.ps-grid4{grid-template-columns:minmax(0,1fr);}
    .ps-gallery{grid-template-columns:repeat(2,minmax(0,1fr));}
    .ps-facts{grid-template-columns:repeat(2,minmax(0,1fr));}
    .ps-facts>div,.ps-facts>div+div{padding:18px 12px;border-left:none;}
    .ps-facts>div:nth-child(even){border-left:1px solid var(--border);}
    .ps-facts>div:nth-child(n+3){border-top:1px solid var(--border);}
    .ps-hide-sm{display:none!important;}
    .ps-field{font-size:16px;}
    .ps-float{display:flex;}
    .ps-footer{padding-bottom:96px;}
    .ps-cta{flex-direction:column;align-items:stretch;width:100%;}
    .ps-cta .ps-btn{width:100%;}
    .ps-full-sm{width:100%;}
    .ps-band{padding:22px;}
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
  const [coursePage, setCoursePage] = useState(1);

  // Application form
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+998 ");
  const [parentPhone, setParentPhone] = useState("");
  // Subjects the applicant is interested in (several may be chosen; none: "not sure yet").
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
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
    if (subject) setSelectedCourses((list) => (list.includes(subject) ? list : [...list, subject]));
    applyRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const shortDays = (days?: string | null) =>
    (days ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (DAY_KEYS[d.toLowerCase()] ? t(DAY_KEYS[d.toLowerCase()]) : d))
      .join("/");

  // The application is two small steps: what to study, then who to call.
  const [step, setStep] = useState(0);
  const [more, setMore] = useState(false);

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
        subject: selectedCourses[0] || undefined,
        subjects: selectedCourses.length ? selectedCourses : undefined,
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
      setStep(0);
      setMore(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setSubmitError(L.errTooMany);
      else setSubmitError(err instanceof ApiError ? err.message : L.errGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)", color: "var(--text-muted)", fontSize: 14 }}>
        {L.loading}
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--surface-muted)", padding: 16, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "var(--radius-lg)", background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "var(--text-muted)" }}>404</div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800 }}>{L.notFoundTitle}</h2>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", maxWidth: 360 }}>{L.notFoundText}</p>
        <Link href="/" style={{ background: "var(--primary)", color: "var(--on-ink)", fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: "var(--radius-sm)" }}>{L.backHome}</Link>
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
  // The hero carousel: the center's own photos first, then three drawn scenes
  // (a lesson in class, practising with the AI helper, a graduate).
  const slides: Slide[] = [
    ...(site?.gallery ?? []).slice(0, 5).map((g): Slide => ({ kind: "photo", title: tenant.name, text: L.slidePhoto, src: fileUrl(g) ?? "" })),
    { kind: "teacher", title: L.slideTeacherTitle, text: L.slideTeacherText },
    { kind: "ai", title: L.slideAiTitle, text: L.slideAiText },
    { kind: "results", title: L.slideResultsTitle, text: L.slideResultsText },
  ];
  const pageCount = Math.max(1, Math.ceil(filteredGroups.length / COURSES_PER_PAGE));
  const shownGroups = filteredGroups.slice((Math.min(coursePage, pageCount) - 1) * COURSES_PER_PAGE, Math.min(coursePage, pageCount) * COURSES_PER_PAGE);
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

  return (
    <div className="ps" style={{ ["--accent" as string]: accent }}>
      <style>{CSS}</style>

      {/* HEADER */}
      <header className="ps-header">
        <div className="ps-wrap" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <a href="#" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={tenant.name} style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--text)", color: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>{tenant.name.slice(0, 1).toUpperCase()}</div>
            )}
            <span style={{ fontFamily: "var(--ps-display)", fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tenant.name}</span>
          </a>
          <nav className="ps-nav">
            <a href="#courses">{L.navCourses}</a>
            {teachers.length > 0 && <a href="#teachers">{L.navTeachers}</a>}
            {branches.length > 0 && <a href="#branches">{L.navBranches}</a>}
            <a href="#faq">{L.faqLabel}</a>
            {announcements.length > 0 && <a href="#news">{L.navNews}</a>}
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
            <div className="ps-lang" role="group" aria-label="Language">
              {(["UZ", "RU", "EN"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}>{l}</button>
              ))}
            </div>
            {/* The cabinet lives on the same address: <sub>.<ROOT_DOMAIN>/portal */}
            <ThemeToggle className="ps-icon-btn" />
            <Link href="/portal" className="ps-link">{L.cabinet}</Link>
            <Link href="/login" className="ps-link ps-hide-sm">{L.login}</Link>
            <button type="button" className="ps-btn ps-primary ps-hide-sm" onClick={() => scrollToApply()}>{L.apply}</button>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="ps-wrap ps-hero">
        <div style={{ display: "flex", flexDirection: "column", gap: 22, alignItems: "flex-start", minWidth: 0 }}>
          <div className="ps-eyebrow">
            {L.category[tenant.category] ?? L.category.BOSHQA}
            {site?.trialLesson && <> · <span style={{ color: "var(--text)" }}>{L.trialBadge}{site.trialText ? ` — ${site.trialText}` : ""}</span></>}
          </div>
          <h1 className="ps-h1">{site?.heroTitle || L.heroTitle.replace("{name}", tenant.name)}</h1>
          <p className="ps-lead">{site?.heroSubtitle || L.heroDesc}</p>
          <div className="ps-cta">
            <button type="button" className="ps-btn ps-primary ps-btn-lg" onClick={() => scrollToApply()}>{site?.trialLesson ? L.trialCta : L.apply}</button>
            <a href="#courses" className="ps-btn ps-ghost ps-btn-lg">{L.seeCourses} →</a>
          </div>
          {tenant.phone && <a href={`tel:${tenant.phone}`} style={{ fontSize: 14, color: "var(--text-2)" }}>{L.call}: <b style={{ color: "var(--text)", fontWeight: 600 }}>{tenant.phone}</b></a>}
        </div>
        <div className="ps-hero-carousel">
          <HeroSlides slides={slides} accent={accent} />
        </div>
      </section>

      {/* KEY FACTS */}
      {(statItems.length > 0 || priceText) && (
        <section className="ps-wrap">
          <div className="ps-facts">
            {priceText && (
              <div>
                <div className="ps-fact-v">{priceText}</div>
                <div className="ps-fact-l">{L.priceFrom}, so&apos;m / {L.perMonth}</div>
              </div>
            )}
            {statItems.map((i) => (
              <div key={i.label}>
                <div className="ps-fact-v">{i.value}</div>
                <div className="ps-fact-l">{i.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* PLACEMENT TEST */}
      {placement && (
        <section className="ps-wrap ps-sec-sm">
          <div className="ps-band">
            <div style={{ maxWidth: 620 }}>
              <h2 className="ps-h3">{L.placementTitle}</h2>
              <p style={{ fontSize: 15, color: "var(--text-2)", margin: "6px 0 0", lineHeight: 1.6 }}>{L.placementDesc}</p>
            </div>
            <Link href={`/t/${placement.token}`} className="ps-btn ps-dark ps-full-sm">{L.placementCta} →</Link>
          </div>
        </section>
      )}

      {/* ABOUT + WHY US */}
      {(site?.about || (site?.advantages.length ?? 0) > 0) && (
        <section className="ps-wrap ps-sec">
          {site?.about && (
            <div className="ps-split">
              <div>
                <div className="ps-label">{L.aboutLabel}</div>
                <h2 className="ps-h2">{tenant.name}</h2>
              </div>
              <p style={{ fontSize: 17, lineHeight: 1.75, color: "var(--text-2)", margin: 0, whiteSpace: "pre-wrap" }}>{site.about}</p>
            </div>
          )}
          {(site?.advantages.length ?? 0) > 0 && (
            <div style={{ marginTop: site?.about ? 64 : 0 }}>
              <SectionHead label={L.whyLabel} title={L.whyTitle} />
              <div className="ps-grid4">
                {site!.advantages.map((a, i) => (
                  <div key={i} className="ps-feature">
                    <div className="ps-index">{String(i + 1).padStart(2, "0")}</div>
                    <h3 className="ps-h4">{a.title}</h3>
                    {a.text && <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--text-2)", margin: 0 }}>{a.text}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* RESULTS */}
      {(site?.results.length ?? 0) > 0 && (
        <section className="ps-muted">
          <div className="ps-wrap ps-sec">
            <SectionHead label={L.resultsLabel} title={L.resultsTitle} />
            <Marquee items={site!.results} min={5} render={(r) => (
              <div className="ps-card ps-result">
                <div style={{ fontFamily: "var(--ps-display)", fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em" }}>{r.result}</div>
                <div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>{r.name}</div>
                {r.detail && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{r.detail}</div>}
              </div>
            )} />
          </div>
        </section>
      )}

      {/* COURSES */}
      <section id="courses" className="ps-muted">
        <div className="ps-wrap ps-sec">
          <SectionHead label={L.coursesLabel} title={L.coursesTitle} />
          {subjects.length > 1 && (
            <div className="ps-tabs" role="tablist" aria-label={L.coursesLabel}>
              {[{ key: "ALL", name: `${L.all} (${data.groups.length})` }, ...subjects.map((s) => ({ key: s.subject, name: `${s.subject} (${s.groupCount})` }))].map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={selectedSubject === f.key} onClick={() => { setSelectedSubject(f.key); setCoursePage(1); }}>{f.name}</button>
              ))}
            </div>
          )}
          {filteredGroups.length === 0 ? (
            <div className="ps-card" style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{L.noCourses}</div>
          ) : (
            <>
              <div className="ps-grid3">
                {shownGroups.map((g) => (
                  <GroupCard key={g.id} g={g} isNew={!!g.isNew} L={L} shortDays={shortDays} onApply={() => scrollToApply(g.subject)} />
                ))}
              </div>
              {pageCount > 1 && (
                <nav className="ps-pages" aria-label={L.coursesLabel}>
                  <button type="button" disabled={coursePage <= 1} onClick={() => setCoursePage((p) => Math.max(1, p - 1))} aria-label="prev">←</button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <button key={n} type="button" aria-current={n === Math.min(coursePage, pageCount) ? "page" : undefined} onClick={() => setCoursePage(n)}>{n}</button>
                  ))}
                  <button type="button" disabled={coursePage >= pageCount} onClick={() => setCoursePage((p) => Math.min(pageCount, p + 1))} aria-label="next">→</button>
                </nav>
              )}
            </>
          )}
        </div>
      </section>

      {/* GALLERY + VIDEO */}
      {((site?.gallery.length ?? 0) > 0 || video) && (
        <section className="ps-wrap ps-sec">
          <SectionHead label={L.galleryLabel} title={L.galleryTitle} />
          {video && (
            <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 16, overflow: "hidden", background: "#000", marginBottom: 16 }}>
              <iframe src={video} title={L.videoTitle} allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
            </div>
          )}
          {(site?.gallery.length ?? 0) > 0 && (
            <div className="ps-gallery">
              {site!.gallery.map((g) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={g} src={fileUrl(g) ?? ""} alt="" loading="lazy" />
              ))}
            </div>
          )}
        </section>
      )}

      {/* TEACHERS */}
      {teachers.length > 0 && (
        <section id="teachers" className="ps-wrap ps-sec">
          <SectionHead label={L.teachersLabel} title={L.teachersTitle} />
          <Marquee items={teachers} min={5} render={(tc) => (
            <div className="ps-person">
              <div className="ps-avatar">
                {tc.photoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(tc.photoPath) ?? ""} alt={tc.fullName} loading="lazy" />
                ) : tc.fullName.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
              </div>
              <div style={{ fontWeight: 600, fontSize: 15.5 }}>{tc.fullName}</div>
              <div style={{ fontSize: 14, color: "var(--text-2)" }}>{tc.subject ? L.teacherOf.replace("{s}", tc.subject.split(",")[0].trim()) : L.teacherFallback}</div>
              {(tc.score || tc.experienceYears) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {tc.score && <span className="ps-tag">{tc.score}</span>}
                  {tc.experienceYears ? <span className="ps-tag ps-tag-muted">{L.yearsExp.replace("{n}", String(tc.experienceYears))}</span> : null}
                </div>
              )}
            </div>
          )} />
        </section>
      )}

      {/* TESTIMONIALS */}
      {testimonials.length > 0 && (
        <section className="ps-muted">
          <div className="ps-wrap ps-sec">
            <SectionHead label={L.testimonialsLabel} title={L.testimonialsTitle} />
            <div className="ps-grid3">
              {testimonials.map((r, i) => (
                <figure key={i} className="ps-card" style={{ padding: 24, margin: 0, display: "flex", flexDirection: "column", gap: 18 }}>
                  <blockquote style={{ margin: 0, fontSize: 15.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>“{r.text}”</blockquote>
                  <figcaption style={{ marginTop: "auto", fontSize: 14 }}>
                    <b style={{ fontWeight: 600 }}>{r.name}</b>
                    {r.role && <span style={{ color: "var(--muted)" }}> · {r.role}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      {faq.length > 0 && (
        <section id="faq" className="ps-wrap ps-sec">
          <div className="ps-split">
            <div>
              <div className="ps-label">{L.faqLabel}</div>
              <h2 className="ps-h2">{L.faqTitle}</h2>
            </div>
            <div className="ps-faq-list">
              {faq.map((f, i) => (
                <details key={i} className="ps-faq">
                  <summary>
                    <span>{f.q}</span>
                    <span className="ps-plus" aria-hidden="true">+</span>
                  </summary>
                  <div style={{ fontSize: 15, lineHeight: 1.7, color: "var(--text-2)", paddingTop: 10, whiteSpace: "pre-wrap" }}>{f.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* BRANCHES */}
      {branches.length > 0 && (
        <section id="branches" className="ps-muted">
          <div className="ps-wrap ps-sec">
            <SectionHead label={L.branchesLabel} title={L.branchesTitle} />
            <div className={branches.length === 1 ? "ps-grid1" : "ps-grid2"}>
              {branches.map((b) => (
                <div key={b.id} className="ps-card ps-branch">
                  {mapEmbed(b) && (
                    <iframe className="ps-map" src={mapEmbed(b)!} title={b.name} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                  )}
                  <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 8 }}>
                    <h3 className="ps-h4">{b.name}</h3>
                    <div className="ps-dl" style={{ fontSize: 14.5 }}>
                      <dt>{L.addressLabel}</dt><dd>{b.address || L.noAddress}</dd>
                      {b.phone && (<><dt>{L.phoneLabel}</dt><dd><a href={`tel:${b.phone}`}>{b.phone}</a></dd></>)}
                      {site?.workingHours && (<><dt>{L.hours}</dt><dd>{site.workingHours}</dd></>)}
                    </div>
                    {(b.mapUrl || b.address) && (
                      <a href={b.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address!)}`} target="_blank" rel="noreferrer" className="ps-btn ps-ghost" style={{ alignSelf: "flex-start", marginTop: 6 }}>{L.openMap} →</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* NEWS */}
      {announcements.length > 0 && (
        <section id="news" className="ps-wrap ps-sec">
          <SectionHead label={L.newsLabel} title={L.newsTitle} />
          <div className={announcements.length === 1 ? "ps-grid1" : announcements.length === 2 ? "ps-grid2" : "ps-grid3"}>
            {announcements.slice(0, 6).map((a) => (
              <article key={a.id} className="ps-card ps-news">
                <div className="ps-news-date">
                  <b>{new Date(a.publishedAt).getDate()}</b>
                  <span>{formatDate(a.publishedAt, lang, "dayMonth").replace(/^\d+\s*/, "")}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 className="ps-h4">{a.title}</h3>
                  <div style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.65, whiteSpace: "pre-wrap", marginTop: 8 }}>{a.content}</div>
                  <button type="button" className="ps-link-accent" onClick={() => scrollToApply()} style={{ background: "none", border: "none", padding: 0, marginTop: 14, cursor: "pointer", fontFamily: "inherit" }}>{L.apply} →</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* APPLICATION */}
      <section ref={applyRef} id="apply" className="ps-muted">
        <div className="ps-wrap ps-sec ps-apply">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="ps-label">{L.formLabel}</div>
            <h2 className="ps-h2">{L.formTitle}</h2>
            <p style={{ fontSize: 16, color: "var(--text-2)", margin: 0, lineHeight: 1.65 }}>{L.formDesc}</p>
            <ol className="ps-steps">
              {[[L.step1Title, L.step1Text], [L.step2Title, L.step2Text], [L.step3Title, L.step3Text]].map(([title, text], i) => (
                <li key={i}>
                  <span className="ps-step-n">{i + 1}</span>
                  <div><b>{title}</b><div style={{ color: "var(--text-2)", fontSize: 14.5, marginTop: 2 }}>{text}</div></div>
                </li>
              ))}
            </ol>
            {(tenant.phone || telegramLink || branches[0]?.phone) && (
              <div className="ps-card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6, fontSize: 15, marginTop: 6 }}>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{L.orContact}</div>
                {(tenant.phone || branches[0]?.phone) && <a href={`tel:${tenant.phone || branches[0]?.phone}`} style={{ fontWeight: 600 }}>{tenant.phone || branches[0]?.phone}</a>}
                {telegramLink && <a href={telegramLink} target="_blank" rel="noreferrer">Telegram</a>}
                {site?.workingHours && <span style={{ color: "var(--muted)" }}>{L.hours}: {site.workingHours}</span>}
              </div>
            )}
          </div>
          <div className="ps-card" style={{ padding: "28px 26px", position: "relative" }}>
            {submitSuccess ? (
              <div style={{ textAlign: "center", padding: "20px 0", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--success-soft)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700 }}>✓</div>
                <h3 className="ps-h4">{L.successTitle}</h3>
                <p style={{ fontSize: 14.5, color: "var(--text-2)", margin: 0 }}>{L.successText}</p>
                <button type="button" className="ps-btn ps-ghost" onClick={() => setSubmitSuccess(false)} style={{ marginTop: 6 }}>{L.again}</button>
              </div>
            ) : (
              <form onSubmit={handleApply} noValidate style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
                    <span>{L.stepOf.replace("{n}", String(step + 1)).replace("{m}", "2")}</span>
                  </div>
                  <div className="ps-progress" aria-hidden="true"><span style={{ width: step === 0 ? "50%" : "100%" }} /></div>
                </div>
                {submitError && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13.5, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{submitError}</div>}

                {step === 0 && (
                  <>
                    <h3 className="ps-h3" style={{ margin: 0 }}>{L.stepCourse}</h3>
                    {subjects.length > 0 ? (
                      <div className="ps-tiles" role="group" aria-label={L.course}>
                        {subjects.map((x) => {
                          const on = selectedCourses.includes(x.subject);
                          return (
                            <button key={x.subject} type="button" className="ps-tile" aria-pressed={on}
                              onClick={() => setSelectedCourses(on ? selectedCourses.filter((c) => c !== x.subject) : [...selectedCourses, x.subject])}>
                              <span className="ps-tile-check" aria-hidden="true">{on ? "✓" : ""}</span>
                              <span>{x.subject}</span>
                            </button>
                          );
                        })}
                        <button type="button" className="ps-tile" aria-pressed={selectedCourses.length === 0} onClick={() => setSelectedCourses([])}>
                          <span className="ps-tile-check" aria-hidden="true">{selectedCourses.length === 0 ? "✓" : ""}</span>
                          <span>{L.courseUnsure}</span>
                        </button>
                      </div>
                    ) : null}
                    {branches.length > 1 && (
                      <ChipGroup label={L.branchPick} value={selectedBranch} onChange={setSelectedBranch} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
                    )}
                    <button type="button" className="ps-btn ps-primary ps-btn-lg" onClick={() => { setSubmitError(null); setStep(1); }} style={{ width: "100%" }}>{L.next} →</button>
                  </>
                )}

                {step === 1 && (
                  <>
                    <h3 className="ps-h3" style={{ margin: 0 }}>{L.stepContact}</h3>
                    <Field label={`${L.fullName} *`}>
                      <input className="ps-field" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={L.fullNamePh} autoComplete="name" autoFocus />
                    </Field>
                    <Field label={`${L.phone} *`}>
                      <PhoneInput className="ps-field" value={phone} onChange={setPhone} />
                    </Field>
                    {more ? (
                      <>
                        <Field label={L.parentPhone}>
                          <PhoneInput className="ps-field" value={parentPhone} onChange={setParentPhone} placeholder="+998 90 987 65 43" autoComplete="off" />
                        </Field>
                        <Field label={L.notes}>
                          <textarea className="ps-field" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={L.notesPh} style={{ resize: "vertical" }} />
                        </Field>
                      </>
                    ) : (
                      <button type="button" className="ps-linkbtn" onClick={() => setMore(true)}>+ {L.moreInfo}</button>
                    )}
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
                        <a href="/privacy" target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{L.privacy}</a>
                      </span>
                    </label>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button type="button" className="ps-btn ps-ghost ps-btn-lg" onClick={() => setStep(0)}>← {L.back}</button>
                      <button type="submit" className="ps-btn ps-primary ps-btn-lg" disabled={submitting} style={{ flex: 1, opacity: submitting ? 0.7 : 1 }}>
                        {submitting ? L.sending : L.send}
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="ps-footer">
        <div className="ps-wrap ps-footer-grid">
          <div>
            <div style={{ fontFamily: "var(--ps-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{tenant.name}</div>
            <div style={{ marginTop: 6 }}>{branches[0]?.address || tenant.address || ""}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tenant.phone && <a href={`tel:${tenant.phone}`}>{tenant.phone}</a>}
            {tenant.email && <a href={`mailto:${tenant.email}`}>{tenant.email}</a>}
            {tenant.telegramUsername && (
              <a href={`https://t.me/${tenant.telegramUsername.replace(/^@/, "")}`} target="_blank" rel="noreferrer">@{tenant.telegramUsername.replace(/^@/, "")}</a>
            )}
          </div>
          {socials.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {socials.map(([k, v]) => (
                <a key={k} href={v} target="_blank" rel="noreferrer">{k[0].toUpperCase() + k.slice(1)}</a>
              ))}
            </div>
          )}
        </div>
        <div className="ps-wrap" style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--border)" }}>© {new Date().getFullYear()} {tenant.name} · {L.poweredBy}</div>
      </footer>

      {/* Phones: quick call / message buttons */}
      {(tenant.phone || telegramLink) && (
        <div className="ps-float">
          {telegramLink && <a href={telegramLink} target="_blank" rel="noreferrer" className="ps-btn ps-ghost" style={{ background: "var(--surface)" }}>{L.write}</a>}
          {tenant.phone && <a href={`tel:${tenant.phone}`} className="ps-btn ps-primary">{L.call}</a>}
        </div>
      )}
    </div>
  );
}

const COURSES_PER_PAGE = 6;

/**
 * A map for a branch: the Google Maps link's own coordinates or place when it
 * carries them, otherwise the branch address. Short links (maps.app.goo.gl)
 * carry neither, so the address is used. Null with neither.
 */
function mapEmbed(b: { mapUrl?: string | null; address?: string | null }) {
  const url = b.mapUrl ?? "";
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return `https://maps.google.com/maps?q=${at[1]},${at[2]}&z=16&output=embed`;
  const place = url.match(/\/maps\/place\/([^/@?]+)/);
  if (place) return `https://maps.google.com/maps?q=${place[1]}&z=16&output=embed`;
  if (b.address?.trim()) return `https://maps.google.com/maps?q=${encodeURIComponent(b.address)}&z=15&output=embed`;
  return null;
}

/**
 * A row of cards: still when they fit, otherwise moving right to left without
 * end (paused under the pointer; still for people who ask for less motion).
 */
function Marquee<T>({ items, render, min }: { items: T[]; render: (x: T) => React.ReactNode; min: number }) {
  if (items.length < min) {
    return <div className="ps-grid4">{items.map((x, i) => <div key={i}>{render(x)}</div>)}</div>;
  }
  return (
    <div className="ps-marquee">
      <div className="ps-marquee-track" style={{ animationDuration: `${Math.max(20, items.length * 6)}s` }}>
        {[...items, ...items].map((x, i) => (
          <div key={i} className="ps-marquee-item" aria-hidden={i >= items.length || undefined}>{render(x)}</div>
        ))}
      </div>
    </div>
  );
}

/** A section's small label, its title, and an optional note at the right. */
function SectionHead({ label, title, note }: { label: string; title: string; note?: string }) {
  return (
    <div className="ps-section-head">
      <div>
        <div className="ps-label">{label}</div>
        <h2 className="ps-h2">{title}</h2>
      </div>
      {note && <div style={{ fontSize: 14.5, color: "var(--muted)" }}>{note}</div>}
    </div>
  );
}

/** One group as visitors see it: what, when, who, how much, and "enrol". */
function GroupCard({ g, isNew, L, shortDays, onApply }: { g: PublicShowcaseData["groups"][number]; isNew: boolean; L: (typeof SITE_TEXT)[SiteLang]; shortDays: (d?: string | null) => string; onApply: () => void }) {
  const when = [shortDays(g.scheduleDays), g.startTime ? `${g.startTime}${g.endTime ? `–${g.endTime}` : ""}` : ""].filter(Boolean).join(", ");
  return (
    <div className="ps-card ps-group">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{g.subject}{g.level ? ` · ${g.level}` : ""}</span>
        {isNew && <span className="ps-tag">{L.newBadge}</span>}
      </div>
      <h3 className="ps-h4">{g.name}</h3>
      <dl className="ps-dl">
        {when && (<><dt>{L.scheduleLabel}</dt><dd>{when}</dd></>)}
        {g.teacherName && (<><dt>{L.teacherLabel}</dt><dd>{g.teacherName}</dd></>)}
        {g.branchName && (<><dt>{L.branchLabel}</dt><dd>{g.branchName}</dd></>)}
        {isNew && g.startDate && (<><dt>{L.startsOn.replace(":", "")}</dt><dd>{g.startDate.slice(0, 10)}</dd></>)}
        {g.seatsLeft !== null && g.seatsLeft !== undefined && (<><dt>{L.seatsLabel}</dt><dd style={{ color: g.seatsLeft === 0 ? "var(--danger)" : g.seatsLeft <= 3 ? "var(--warning)" : undefined }}>{g.seatsLeft === 0 ? L.seatsFull : L.seatsLeft.replace("{n}", String(g.seatsLeft))}</dd></>)}
      </dl>
      <div className="ps-group-foot">
        {g.monthlyPrice > 0 ? (
          <div><span style={{ fontFamily: "var(--ps-display)", fontWeight: 700, fontSize: 19 }}>{money(g.monthlyPrice)}</span><span style={{ fontSize: 13, color: "var(--muted)" }}> so&apos;m / {L.perMonth}</span></div>
        ) : (
          <span style={{ fontSize: 14, color: "var(--text-2)" }}>{L.priceOnRequest}</span>
        )}
        <button type="button" className="ps-btn ps-ghost" onClick={onApply}>{L.enroll}</button>
      </div>
    </div>
  );
}


function ChipGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      <div className="ps-chips">
        {options.map((o) => (
          <button key={o.value || "none"} type="button" role="radio" aria-checked={value === o.value} className="ps-chip" onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Several choices (checkboxes as buttons); the last one, "not sure yet", clears the rest. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      {children}
    </label>
  );
}
