"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import DirectionSelect, { useDirectionOptions } from "@/components/DirectionSelect";
import type { PracticeTemplate } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";

/** What "create" sends for one starting point. */
export interface NewTestChoice {
  subject: string;
  sample?: boolean;
  template?: PracticeTemplate;
}

interface Sample {
  id: string;
  icon: string;
  title: TranslationKey;
  text: TranslationKey;
  choice: Omit<NewTestChoice, "subject">;
}

const IELTS_SAMPLE: Sample = { id: "ielts-sample", icon: "🎧", title: "mock.smp.ieltsTitle", text: "mock.smp.ieltsText", choice: { sample: true } };
const IELTS_BLANK: Sample = { id: "ielts-blank", icon: "📄", title: "mock.smp.ieltsBlankTitle", text: "mock.smp.ieltsBlankText", choice: { sample: false } };
const ENGLISH: Sample = { id: "english", icon: "🇬🇧", title: "pre.tplENGLISH", text: "mock.smp.englishText", choice: { template: "ENGLISH" } };
const SAT: Sample = { id: "sat", icon: "🎓", title: "pre.tplSAT", text: "mock.smp.satText", choice: { template: "SAT" } };
const MATH: Sample = { id: "math", icon: "📐", title: "pre.tplMATH", text: "mock.smp.mathText", choice: { template: "MATH" } };
const PROGRAMMING: Sample = { id: "programming", icon: "💻", title: "pre.tplPROGRAMMING", text: "mock.smp.programmingText", choice: { template: "PROGRAMMING" } };
const BLANK: Sample = { id: "blank", icon: "📘", title: "mock.smp.blankTitle", text: "mock.smp.blankText", choice: { template: "GENERAL" } };

/** The starting points that fit a direction, the closest first; a blank test always closes the list. */
export function samplesFor(direction: string): Sample[] {
  const d = direction.toLowerCase();
  const out: Sample[] = [];
  if (/\bsat\b/.test(d)) out.push(SAT);
  if (/ingliz|english|ielts|cefr|англ/.test(d)) out.push(IELTS_SAMPLE, ENGLISH, IELTS_BLANK, SAT);
  if (/matem|math|algebra|geometr|матем/.test(d)) out.push(MATH, SAT);
  if (/dastur|program|python|java|kompyuter|informat|информат|программ|\bit\b/.test(d)) out.push(PROGRAMMING);
  out.push(BLANK);
  return [...new Map(out.map((s) => [s.id, s])).values()];
}

export default function NewTestPanel({ busy, onCreate, onClose }: { busy: boolean; onCreate: (choice: NewTestChoice) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const directions = useDirectionOptions();
  // Until one is picked, the first direction of the list is the choice.
  const [picked, setDirection] = useState("");
  const direction = picked || directions[0] || "";
  const samples = useMemo(() => (direction ? samplesFor(direction) : []), [direction]);

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${ACCENT}`, borderRadius: 16, padding: 18, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{t("mock.newTitle")}</div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} style={{ border: "none", background: "#F2F1EC", width: 30, height: 30, borderRadius: 100, cursor: "pointer", fontSize: 15, color: "#4A4E58" }}>×</button>
      </div>

      <div style={{ maxWidth: 360 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#4A4E58", marginBottom: 6 }}>{t("mock.pickDirection")}</span>
        <DirectionSelect value={direction} onChange={setDirection} directions={directions} placeholder={t("mock.pickDirectionPh")} ariaLabel={t("mock.pickDirection")} />
      </div>

      {directions.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8A5A00", background: "#FFF7E6", border: "1px solid #F5DDA8", borderRadius: 10, padding: "10px 12px" }}>
          {t("mock.noDirections")}{" "}
          <Link href="/groups" style={{ color: ACCENT, fontWeight: 700 }}>{t("nav.groups")}</Link>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#4A4E58", marginBottom: 8 }}>{t("mock.samplesFor")}: <span style={{ color: ACCENT }}>{direction}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => onCreate({ subject: direction, ...s.choice })}
                style={{ textAlign: "left", background: "#FAF9F6", border: "1px solid #EAE8E2", borderRadius: 12, padding: 14, cursor: busy ? "wait" : "pointer", display: "grid", gap: 4 }}
              >
                <span style={{ fontSize: 22 }} aria-hidden="true">{s.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#181A1F" }}>{t(s.title)}</span>
                <span style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t(s.text)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
