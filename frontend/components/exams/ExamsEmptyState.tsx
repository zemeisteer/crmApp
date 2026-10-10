"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

const STEP_ICONS = [
  <path key="create" d="M12 5v14M5 12h14" />,
  <path key="questions" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  <path key="results" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
];

/** Shown while a center has no exam at all: what the page is for and how to start. */
export default function ExamsEmptyState({ onCreate, hasGroups }: { onCreate: () => void; hasGroups: boolean }) {
  const { t } = useLanguage();
  const steps = [
    { title: t("exams.empty.s1Title"), text: t("exams.empty.s1Text") },
    { title: t("exams.empty.s2Title"), text: t("exams.empty.s2Text") },
    { title: t("exams.empty.s3Title"), text: t("exams.empty.s3Text") },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: "36px 28px", textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "#EEF0FF", color: ACCENT, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <h2 style={{ fontSize: 19, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{t("exams.empty.title")}</h2>
        <p style={{ fontSize: 13.5, color: "#686B75", lineHeight: 1.6, maxWidth: 520, margin: "6px auto 18px" }}>{t("exams.empty.text")}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={onCreate} style={{ background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 10 }}>
            {t("exams.newExam")}
          </button>
          <Link href="/mock-tests" className="btn" style={{ background: "#fff", color: "#1F2128", border: "1px solid #EAE8E2", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 10, textDecoration: "none" }}>
            {t("exams.empty.mocks")}
          </Link>
        </div>
        {!hasGroups && (
          <p style={{ fontSize: 12.5, color: "#8A5A00", background: "#FFF7E6", border: "1px solid #F5DDA8", borderRadius: 10, padding: "8px 12px", display: "inline-block", marginTop: 16 }}>
            {t("exams.empty.needGroup")}{" "}
            <Link href="/groups" style={{ color: ACCENT, fontWeight: 700 }}>{t("nav.groups")}</Link>
          </p>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
        {steps.map((s, i) => (
          <div key={s.title} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: "#F4F3EF", color: ACCENT, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{STEP_ICONS[i]}</svg>
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#686B75", letterSpacing: "0.06em" }}>{i + 1} / 3</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontSize: 13, color: "#686B75", lineHeight: 1.55 }}>{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
