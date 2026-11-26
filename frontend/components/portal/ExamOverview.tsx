"use client";

import { useLanguage } from "@/lib/i18n-context";
import { PORTAL_ACCENT as ACCENT } from "@/components/portal/PortalTabs";

// The start page of a sitting (IELTS mock or a practice test): what the test
// is, how far the student has come and the result so far, then the sections
// as a path in exam order (state, time, score, the button), then the rules.

export type SectionState = "todo" | "started" | "done" | "locked" | "pending" | "review";

export interface OverviewItem {
  key: string;
  icon: string;
  title: string;
  meta: string;
  state: SectionState;
  // Shown big on the right once done ("6.5", "82%").
  score?: string | null;
  scoreColor?: string;
  // One line under the meta (raw score, "teacher marks", why it is locked).
  note?: string | null;
  noteTestId?: string;
  leftMs?: number | null;
  cta: { label: string; onClick: () => void; disabled?: boolean };
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const CSS = `
.eo-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:22px;border-radius:var(--radius-lg);border:1px solid var(--primary-border);background:radial-gradient(420px 220px at 100% 0%,color-mix(in oklab,var(--primary) 16%,transparent),transparent 70%),linear-gradient(135deg,var(--primary-soft),var(--surface));}
.eo-stats{display:flex;gap:8px;flex-wrap:wrap}
.eo-stat{display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-pill);padding:5px 12px;font-size:12.5px;font-weight:700;color:var(--text-soft)}
.eo-bar{height:8px;border-radius:99px;background:var(--surface);border:1px solid var(--border);overflow:hidden}
.eo-bar span{display:block;height:100%;background:linear-gradient(90deg,var(--primary),color-mix(in oklab,var(--primary) 60%,var(--success)));border-radius:99px;transition:width .4s ease}
.eo-ring{width:92px;height:92px;border-radius:50%;display:grid;place-items:center;text-align:center;background:var(--surface);box-shadow:0 10px 26px -14px var(--primary)}
.eo-path{display:grid;gap:12px;position:relative}
.eo-row{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:14px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;transition:border-color .2s,box-shadow .2s,transform .2s}
.eo-row:hover{border-color:var(--primary-border);box-shadow:0 12px 28px -20px var(--primary)}
.eo-row[data-state="locked"]{opacity:.72}
.eo-row[data-state="started"]{border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--primary) 14%,transparent)}
.eo-row:not(:last-child)::after{content:"";position:absolute;left:39px;top:calc(100% + 1px);height:10px;border-left:2px dashed var(--border)}
.eo-icon{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:21px;background:var(--primary-soft)}
.eo-row[data-state="done"] .eo-icon{background:var(--success-soft)}
.eo-pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;border-radius:var(--radius-pill);padding:3px 9px;white-space:nowrap}
.eo-right{display:flex;align-items:center;gap:14px}
.eo-btn{border:none;border-radius:var(--radius-sm);padding:11px 18px;font-weight:800;font-size:14px;cursor:pointer;white-space:nowrap;font-family:inherit}
.eo-btn:disabled{cursor:not-allowed;opacity:.5}
.eo-tips{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.eo-tip{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px;font-size:13px;line-height:1.5;color:var(--text-soft)}
.eo-tip b{display:block;color:var(--text);font-size:13.5px;margin-bottom:2px}
@media (max-width:640px){
  .eo-hero{grid-template-columns:minmax(0,1fr);padding:18px}
  .eo-ring{width:76px;height:76px}
  .eo-row{grid-template-columns:40px minmax(0,1fr);padding:14px}
  .eo-icon{width:40px;height:40px;font-size:19px}
  .eo-right{grid-column:1/-1;justify-content:space-between}
  .eo-btn{flex:1}
  .eo-row:not(:last-child)::after{left:33px}
}
`;

export default function ExamOverview({ title, tags, stats, items, result, tips }: {
  title: string;
  tags: string[];
  stats: string[];
  items: OverviewItem[];
  // The overall result once there is one ("6.5" band, "78%").
  result: { value: string; label: string; hint: string; color: string } | null;
  tips: Array<{ icon: string; title: string; text: string }>;
}) {
  const { t } = useLanguage();
  const done = items.filter((x) => x.state === "done" || x.state === "pending" || x.state === "review").length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const next = items.find((x) => x.state === "started") ?? items.find((x) => x.state === "todo");

  const pill = (s: SectionState, leftMs?: number | null) => {
    const map: Record<SectionState, [string, string, string]> = {
      todo: [t("pmk.st.todo"), "var(--surface-muted)", "var(--text-soft)"],
      started: [leftMs != null && leftMs > 0 ? `${t("pmk.st.started")} · ${mmss(leftMs)}` : t("pmk.st.started"), "var(--primary-soft)", ACCENT],
      done: [`✓ ${t("pmk.st.done")}`, "var(--success-soft)", "var(--success)"],
      locked: [`🔒 ${t("pmk.st.locked")}`, "var(--surface-muted)", "var(--text-muted)"],
      pending: [`⏳ ${t("pmk.st.pending")}`, "var(--primary-soft)", ACCENT],
      review: [`👩‍🏫 ${t("pmk.st.review")}`, "var(--warning-soft)", "var(--warning)"],
    };
    const [label, bg, fg] = map[s];
    return <span className="eo-pill" style={{ background: bg, color: fg }}>{label}</span>;
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <style>{CSS}</style>

      <section className="eo-hero">
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tags.filter(Boolean).map((x) => (
              <span key={x} className="eo-pill" style={{ background: "var(--surface)", color: ACCENT, border: "1px solid var(--primary-border)" }}>{x}</span>
            ))}
          </div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2 }}>{title}</div>
          <div className="eo-stats">
            {stats.filter(Boolean).map((x) => <span key={x} className="eo-stat">{x}</span>)}
          </div>
          <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)" }}>
              <span>{t("pmk.sectionsDone").replace("{d}", String(done)).replace("{n}", String(items.length))}</span>
              <span>{pct}%</span>
            </div>
            <div className="eo-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
        {result ? (
          <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
            <div className="eo-ring" style={{ border: `5px solid ${result.color}` }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: result.color }}>{result.value}</span>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>{result.label}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 160, textAlign: "center" }}>{result.hint}</div>
          </div>
        ) : next ? (
          <button type="button" className="eo-btn" disabled={next.cta.disabled} onClick={next.cta.onClick} style={{ background: ACCENT, color: "var(--on-ink)", padding: "14px 22px", fontSize: 15, boxShadow: "0 12px 26px -14px var(--primary)" }}>
            {next.icon} {next.cta.label}
          </button>
        ) : null}
      </section>

      <div className="eo-path">
        {items.map((x, i) => {
          const finished = x.state === "done" || x.state === "pending" || x.state === "review";
          return (
            <div key={x.key} className="eo-row" data-state={x.state}>
              <div className="eo-icon" aria-hidden="true">{x.icon}</div>
              <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)" }}>{i + 1}</span>
                  <span style={{ fontSize: 15.5, fontWeight: 800 }}>{x.title}</span>
                  {pill(x.state, x.leftMs)}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{x.meta}</div>
                {x.note && <div data-testid={x.noteTestId} style={{ fontSize: 12.5, fontWeight: 700, color: x.state === "locked" ? "var(--text-muted)" : x.state === "review" ? "var(--warning)" : x.state === "pending" ? ACCENT : "var(--success)" }}>{x.note}</div>}
              </div>
              <div className="eo-right">
                {x.score && <span style={{ fontSize: 24, fontWeight: 800, color: x.scoreColor ?? "var(--text)" }}>{x.score}</span>}
                <button type="button" className="eo-btn" disabled={x.cta.disabled} onClick={x.cta.onClick}
                  style={finished ? { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" } : { background: ACCENT, color: "var(--on-ink)" }}>
                  {x.cta.label}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {tips.length > 0 && (
        <div className="eo-tips">
          {tips.map((tip) => (
            <div key={tip.title} className="eo-tip">
              <span style={{ fontSize: 18 }} aria-hidden="true">{tip.icon}</span>
              <div><b>{tip.title}</b>{tip.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
