"use client";

import { useState } from "react";
import type { MockProgress, MockSection } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { sectionKey } from "@/components/mock-tests/sections";
import { KindTable } from "@/components/portal/MockRunner";

// Bands over a student's mock sittings: the overall band as the main line,
// one skill at a time on top of it (picked below the chart), and the
// question types they miss most.
const SKILL_COLOR: Record<MockSection, string> = { listening: "#2a78c8", reading: "#1f9d6b", writing: "#c77c1e", speaking: "#a24bb8" };

export default function ProgressChart({ data, card }: { data: MockProgress; card: React.CSSProperties }) {
  const { t } = useLanguage();
  const [skill, setSkill] = useState<MockSection | null>(null);
  const pts = data.points;
  const W = 640, H = 220, L = 34, R = 12, T = 12, B = 30;
  const x = (i: number) => (pts.length <= 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (band: number) => T + ((9 - band) / 9) * (H - T - B);
  const line = (get: (p: MockProgress["points"][number]) => number | null | undefined) => {
    const segs: string[] = [];
    pts.forEach((p, i) => {
      const v = get(p);
      if (v == null) return;
      segs.push(`${segs.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    return segs.join(" ");
  };
  const weak = [...data.weak.listening.map((k) => ({ ...k })), ...data.weak.reading.map((k) => ({ ...k }))];
  const merged = Object.values(weak.reduce<Record<string, { kind: string; right: number; total: number }>>((acc, k) => {
    const m = acc[k.kind] ?? (acc[k.kind] = { kind: k.kind, right: 0, total: 0 });
    m.right += k.right;
    m.total += k.total;
    return acc;
  }, {})).sort((a, b) => a.right / a.total - b.right / b.total).slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div data-testid="progress-chart" style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>📈 {t("pmk.progress")}</div>
        {pts.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("pmk.progressEmpty")}</div>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("pmk.progress")} style={{ width: "100%", height: "auto", display: "block" }}>
              {[3, 5, 7, 9].map((b) => (
                <g key={b}>
                  <line x1={L} x2={W - R} y1={y(b)} y2={y(b)} stroke="var(--border)" strokeWidth={1} />
                  <text x={L - 8} y={y(b) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">{b}</text>
                </g>
              ))}
              {skill && <path d={line((p) => p[skill])} fill="none" stroke={SKILL_COLOR[skill]} strokeWidth={2} strokeDasharray="5 4" />}
              <path d={line((p) => p.overall)} fill="none" stroke="var(--text)" strokeWidth={2.5} />
              {pts.map((p, i) => {
                const v = p.overall ?? (skill ? p[skill] : null);
                return v == null ? null : (
                  <g key={p.attemptId}>
                    <circle cx={x(i)} cy={y(v)} r={4} fill="var(--surface)" stroke="var(--text)" strokeWidth={2}><title>{`${p.title}: ${v}`}</title></circle>
                  </g>
                );
              })}
              {skill && pts.map((p, i) => (p[skill] == null ? null : <circle key={`s${p.attemptId}`} cx={x(i)} cy={y(p[skill]!)} r={3} fill={SKILL_COLOR[skill]}><title>{`${p.title}: ${p[skill]}`}</title></circle>))}
              {pts.map((p, i) => (
                <text key={`d${p.attemptId}`} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">{new Date(p.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>
              ))}
            </svg>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12.5 }}>
              <span style={{ fontWeight: 800, padding: "4px 8px" }}>— {t("mock.overall")}</span>
              {(["listening", "reading", "writing", "speaking"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={skill === s} onClick={() => setSkill((v) => (v === s ? null : s))}
                  style={{ border: `1.5px solid ${SKILL_COLOR[s]}`, background: skill === s ? SKILL_COLOR[s] : "transparent", color: skill === s ? "#fff" : "var(--text)", borderRadius: 999, padding: "4px 10px", fontWeight: 700, cursor: "pointer" }}>
                  {t(sectionKey(s))}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {merged.length > 0 && <KindTable title={t("pmk.weakTypes")} kinds={merged} />}
    </div>
  );
}
