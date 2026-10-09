"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fileUrl, placementApi, tenantsApi, type PlacementTestSummary, type SiteContent } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import Select from "@/components/Select";
import { centerHost, centerSiteUrl } from "@/lib/domain";

const ACCENT = "#4F46E5";
const ICONS = ["✅", "🎯", "👩‍🏫", "📚", "🏆", "💡", "🕒", "💬", "📈", "🧑‍🎓", "🏫", "💳", "🌍", "🤝", "⭐", "🎓"];
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 };
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const small: React.CSSProperties = { background: "none", border: "1px dashed #CBD5E1", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: ACCENT, cursor: "pointer" };
const xBtn: React.CSSProperties = { width: 32, height: 32, flexShrink: 0, border: "1px solid #EAE8E2", background: "#fff", borderRadius: 8, color: "#B23A47", cursor: "pointer" };

// Settings → Site: what the center shows on its public page. Sections left
// empty are simply not shown there.
export default function SiteContentEditor() {
  const { t } = useLanguage();
  const { tenant } = useAuth();
  const [site, setSite] = useState<SiteContent | null>(null);
  const [tests, setTests] = useState<PlacementTestSummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    tenantsApi.getSite().then(setSite).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
    placementApi.list().then(setTests).catch(() => setTests([]));
  }, [t]);

  if (!site) return <div style={{ color: "#686B75", fontSize: 14 }}>{error ?? t("common.loading")}</div>;
  const set = (patch: Partial<SiteContent>) => {
    setSite({ ...site, ...patch });
    setSaved(false);
  };

  async function save() {
    if (!site) return;
    setSaving(true);
    setError(null);
    try {
      setSite(await tenantsApi.updateSite(site));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files || !site) return;
    setUploading(true);
    setError(null);
    try {
      const paths: string[] = [];
      for (const f of Array.from(files).slice(0, 12 - site.gallery.length)) paths.push((await tenantsApi.uploadSiteImage(f)).path);
      set({ gallery: [...site.gallery, ...paths] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Generic list editor for the repeatable blocks.
  function rows<K extends "advantages" | "results" | "testimonials" | "faq">(key: K, max: number, empty: SiteContent[K][number], render: (row: SiteContent[K][number], update: (p: Partial<SiteContent[K][number]>) => void) => React.ReactNode) {
    const list = site![key] as SiteContent[K][number][];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#F7F6F2", borderRadius: 12, padding: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {render(row, (p) => set({ [key]: list.map((r, j) => (j === i ? { ...r, ...p } : r)) } as Partial<SiteContent>))}
            </div>
            <button type="button" style={xBtn} onClick={() => set({ [key]: list.filter((_, j) => j !== i) } as Partial<SiteContent>)} aria-label={t("common.delete")}>✕</button>
          </div>
        ))}
        {list.length < max && (
          <button type="button" style={{ ...small, alignSelf: "flex-start" }} onClick={() => set({ [key]: [...list, empty] } as Partial<SiteContent>)}>
            + {t("site.add")}
          </button>
        )}
      </div>
    );
  }

  // The site lives on the center's own subdomain: <sub>.<main domain>.
  const siteUrl = tenant?.subdomain ? centerSiteUrl(tenant.subdomain) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "#F5F3FF", borderColor: "#DDD6FE" }}>
        <div style={{ fontSize: 13.5, color: "#4A4E58", lineHeight: 1.5, flex: 1, minWidth: 220 }}>
          {t("site.intro")}
          {tenant?.subdomain && <div style={{ marginTop: 4, fontWeight: 700, color: ACCENT, overflowWrap: "anywhere" }}>{centerHost(tenant.subdomain)}</div>}
        </div>
        {siteUrl && (
          <a href={siteUrl} target="_blank" rel="noreferrer" className="btn" style={{ background: "#fff", border: "1px solid #DDD6FE", color: ACCENT, fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 9, textDecoration: "none" }}>
            🌐 {t("site.open")}
          </a>
        )}
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{t("site.secHero")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={lbl}>{t("site.heroTitle")}</div>
            <input className="field-input" value={site.heroTitle ?? ""} maxLength={120} onChange={(e) => set({ heroTitle: e.target.value })} placeholder={t("site.heroTitlePh")} />
          </div>
          <div>
            <div style={lbl}>{t("site.heroSubtitle")}</div>
            <textarea className="field-input" rows={2} value={site.heroSubtitle ?? ""} maxLength={300} onChange={(e) => set({ heroSubtitle: e.target.value })} placeholder={t("site.heroSubtitlePh")} style={{ resize: "vertical" }} />
          </div>
          <div>
            <div style={lbl}>{t("site.about")}</div>
            <textarea className="field-input" rows={4} value={site.about ?? ""} maxLength={2000} onChange={(e) => set({ about: e.target.value })} placeholder={t("site.aboutPh")} style={{ resize: "vertical" }} />
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("site.secAdvantages")}</div>
        <div style={{ fontSize: 12.5, color: "#686B75", margin: "4px 0 12px" }}>{t("site.advantagesHint")}</div>
        {rows("advantages", 8, { icon: "✅", title: "", text: "" }, (r, u) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <Select value={r.icon} onChange={(v) => u({ icon: v })} options={ICONS.map((i) => ({ value: i, label: i }))} style={{ width: 76 }} />
              <input className="field-input" value={r.title} maxLength={80} onChange={(e) => u({ title: e.target.value })} placeholder={t("site.advTitlePh")} />
            </div>
            <input className="field-input" value={r.text} maxLength={300} onChange={(e) => u({ text: e.target.value })} placeholder={t("site.advTextPh")} />
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("site.secResults")}</div>
        <div style={{ fontSize: 12.5, color: "#686B75", margin: "4px 0 12px" }}>{t("site.resultsHint")}</div>
        {rows("results", 12, { name: "", result: "", detail: "" }, (r, u) => (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input className="field-input" value={r.name} maxLength={80} onChange={(e) => u({ name: e.target.value })} placeholder={t("site.resNamePh")} />
            <input className="field-input" value={r.result} maxLength={60} onChange={(e) => u({ result: e.target.value })} placeholder={t("site.resResultPh")} />
            <input className="field-input" value={r.detail} maxLength={120} onChange={(e) => u({ detail: e.target.value })} placeholder={t("site.resDetailPh")} style={{ gridColumn: "1 / -1" }} />
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("site.secTestimonials")}</div>
        <div style={{ fontSize: 12.5, color: site.testimonials.length >= 10 ? "#16794A" : "#B45309", margin: "4px 0 12px", fontWeight: 600 }}>
          {t("site.testimonialsHint").replace("{n}", String(site.testimonials.length))}
        </div>
        {rows("testimonials", 20, { name: "", role: "", text: "" }, (r, u) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input className="field-input" value={r.name} maxLength={80} onChange={(e) => u({ name: e.target.value })} placeholder={t("site.tstNamePh")} />
              <input className="field-input" value={r.role} maxLength={80} onChange={(e) => u({ role: e.target.value })} placeholder={t("site.tstRolePh")} />
            </div>
            <textarea className="field-input" rows={2} value={r.text} maxLength={600} onChange={(e) => u({ text: e.target.value })} placeholder={t("site.tstTextPh")} style={{ resize: "vertical" }} />
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{t("site.secFaq")}</div>
        {rows("faq", 12, { q: "", a: "" }, (r, u) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input className="field-input" value={r.q} maxLength={200} onChange={(e) => u({ q: e.target.value })} placeholder={t("site.faqQPh")} />
            <textarea className="field-input" rows={2} value={r.a} maxLength={800} onChange={(e) => u({ a: e.target.value })} placeholder={t("site.faqAPh")} style={{ resize: "vertical" }} />
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("site.secGallery")}</div>
        <div style={{ fontSize: 12.5, color: "#686B75", margin: "4px 0 12px" }}>{t("site.galleryHint")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
          {site.gallery.map((g) => (
            <div key={g} style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: "4 / 3", background: "#F2F1EC" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(g) ?? ""} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button type="button" onClick={() => set({ gallery: site.gallery.filter((x) => x !== g) })} style={{ ...xBtn, position: "absolute", top: 6, right: 6, width: 28, height: 28 }} aria-label={t("common.delete")}>✕</button>
            </div>
          ))}
          {site.gallery.length < 12 && (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...small, aspectRatio: "4 / 3", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {uploading ? t("common.loading") : `+ ${t("site.addPhoto")}`}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: "none" }} onChange={(e) => upload(e.target.files)} />
      </div>

      <div style={card}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{t("site.secExtra")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 13.5 }}>
            <input type="checkbox" checked={site.trialLesson} onChange={(e) => set({ trialLesson: e.target.checked })} style={{ marginTop: 2, accentColor: ACCENT, width: 16, height: 16 }} />
            <span>
              <b>{t("site.trial")}</b>
              <span style={{ display: "block", fontSize: 12.5, color: "#686B75" }}>{t("site.trialHint")}</span>
            </span>
          </label>
          {site.trialLesson && (
            <input className="field-input" value={site.trialText ?? ""} maxLength={200} onChange={(e) => set({ trialText: e.target.value })} placeholder={t("site.trialTextPh")} />
          )}
          <div>
            <div style={lbl}>{t("site.placement")}</div>
            <Select
              value={site.placementTestId ?? ""}
              onChange={(v) => set({ placementTestId: v || null })}
              options={[{ value: "", label: t("site.placementNone") }, ...tests.filter((x) => x.active).map((x) => ({ value: x.id, label: x.title }))]}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 12, color: "#686B75", marginTop: 4 }}>{t("site.placementHint")}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={lbl}>{t("site.hours")}</div>
              <input className="field-input" value={site.workingHours ?? ""} maxLength={120} onChange={(e) => set({ workingHours: e.target.value })} placeholder={t("site.hoursPh")} />
            </div>
            <div>
              <div style={lbl}>{t("site.video")}</div>
              <input className="field-input" value={site.videoUrl ?? ""} onChange={(e) => set({ videoUrl: e.target.value })} placeholder="https://youtube.com/watch?v=..." />
            </div>
          </div>
          <div>
            <div style={lbl}>{t("site.socials")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {(["instagram", "telegram", "youtube", "facebook", "tiktok"] as const).map((k) => (
                <input key={k} className="field-input" value={site.socials[k] ?? ""} onChange={(e) => set({ socials: { ...site.socials, [k]: e.target.value } })} placeholder={`${k[0].toUpperCase()}${k.slice(1)} — https://...`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
      <div style={{ position: "sticky", bottom: 0, background: "#F7F7F5", padding: "10px 0", display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" className="btn" disabled={saving} onClick={save} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: "11px 20px", borderRadius: 10 }}>
          {saving ? t("common.saving") : t("site.save")}
        </button>
        {saved && <span style={{ fontSize: 13, fontWeight: 600, color: "#167A48" }}>✓ {t("site.saved")}</span>}
      </div>
    </div>
  );
}
