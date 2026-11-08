"use client";

import { useRef, useState } from "react";
import { ApiError, fileUrl, tenantsApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

export interface TeacherProfile {
  score: string;
  experienceYears: string;
  photoPath: string;
}
export const emptyProfile: TeacherProfile = { score: "", experienceYears: "", photoPath: "" };

/** The teacher's result is named after what they teach: IELTS for English, and so on. */
export function scoreHint(subject: string) {
  const s = subject.toLowerCase();
  if (/ingliz|english|англ|ielts/.test(s)) return "IELTS 8.0";
  if (/rus|рус|russian/.test(s)) return "TORFL C1";
  if (/matem|math|матем|algebra|geometr/.test(s)) return "SAT Math 790";
  if (/sat/.test(s)) return "SAT 1520";
  if (/nemis|german|немец/.test(s)) return "Goethe C1";
  if (/korea|корей/.test(s)) return "TOPIK 6";
  if (/arab|араб/.test(s)) return "C1";
  return "Sertifikat";
}

/** What the center's site shows about a teacher: their own score, years of teaching, a photo. */
export default function TeacherProfileFields({ subject, value, onChange }: { subject: string; value: TeacherProfile; onChange: (v: TeacherProfile) => void }) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = value.photoPath ? fileUrl(value.photoPath) : null;

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const r = await tenantsApi.uploadSiteImage(f);
      onChange({ ...value, photoPath: r.path });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6, display: "block" };
  return (
    <fieldset data-testid="teacher-profile" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <legend style={{ fontSize: 12.5, fontWeight: 700, padding: "0 6px" }}>{t("tprof.title")}</legend>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: "var(--surface-muted)", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 11 }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : t("tprof.noPhoto")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()} style={{ background: "var(--surface-muted)", color: "var(--text)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: "var(--radius-xs)" }}>
            {busy ? t("common.saving") : t("tprof.photo")}
          </button>
          {value.photoPath && (
            <button type="button" className="btn" onClick={() => onChange({ ...value, photoPath: "" })} style={{ background: "none", color: "var(--danger)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 6px" }}>{t("common.delete")}</button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} style={{ display: "none" }} aria-label={t("tprof.photo")} />
        </div>
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 10 }}>
        <label>
          <span style={lbl}>{t("tprof.score")}</span>
          <input className="field-input" value={value.score} maxLength={60} placeholder={scoreHint(subject)} onChange={(e) => onChange({ ...value, score: e.target.value })} />
        </label>
        <label>
          <span style={lbl}>{t("tprof.experience")}</span>
          <input className="field-input" type="number" min={0} max={60} value={value.experienceYears} placeholder="5" onChange={(e) => onChange({ ...value, experienceYears: e.target.value })} />
        </label>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("tprof.hint")}</div>
    </fieldset>
  );
}

/** For the API: blank fields are left out on create and cleared on edit. */
export function profileBody(v: TeacherProfile, editing: boolean) {
  const years = v.experienceYears.trim() === "" ? undefined : Math.max(0, Math.min(60, Math.round(Number(v.experienceYears))));
  return {
    score: v.score.trim() || (editing ? "" : undefined),
    experienceYears: Number.isFinite(years) ? years : undefined,
    photoPath: v.photoPath || (editing ? "" : undefined),
  };
}
