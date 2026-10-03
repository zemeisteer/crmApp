"use client";

import { useEffect, useState } from "react";
import { fileUrl, portalApi, type PortalAttendance, type PortalHomework, type PortalPastLesson, type PortalPayments, type PortalSchedule } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { MONTH_KEYS, MONTH_SHORT_KEYS, type TranslationKey } from "@/lib/i18n";
import Modal from "@/components/Modal";

// The student cabinet's tabs in the same look as PortalHome: light cards,
// big tap targets, lists instead of tables so nothing scrolls sideways on
// a phone.

export const PORTAL_ACCENT = "#4F46E5";
const ACCENT = PORTAL_ACCENT;
export const portalCard: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 16 };
const card = portalCard;
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const DAY_KEYS: TranslationKey[] = [
  "weekday.monday", "weekday.tuesday", "weekday.wednesday", "weekday.thursday",
  "weekday.friday", "weekday.saturday", "weekday.sunday",
];
const todayDow = () => (new Date().getDay() === 0 ? 7 : new Date().getDay());
const monthLabel = (ym: string, t: (k: TranslationKey) => string) =>
  /^\d{4}-\d{2}/.test(ym) ? `${t(MONTH_KEYS[Number(ym.slice(5, 7)) - 1])} ${ym.slice(0, 4)}` : ym;

export function TabTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ padding: "2px 2px 0" }}>
      <h2 style={{ fontFamily: "'Manrope', sans-serif", fontSize: 21, fontWeight: 800, margin: 0 }}>{title}</h2>
      {hint && <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ ...card, padding: "36px 20px", textAlign: "center", color: "#8A8D96", fontSize: 14 }}>
      <div style={{ fontSize: 34, marginBottom: 8 }}>{icon}</div>
      {text}
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "green" | "red" | "amber" | "grey" | "accent" }) {
  const tones = {
    green: { color: "#1FA463", background: "#E9F8EF" },
    red: { color: "#DC2626", background: "#FEE2E2" },
    amber: { color: "#B45309", background: "#FEF3C7" },
    grey: { color: "#6B6E78", background: "#F2F1EC" },
    accent: { color: ACCENT, background: "#EEF0FF" },
  }[tone];
  return <span style={{ ...tones, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 100, whiteSpace: "nowrap" }}>{children}</span>;
}

// ---------------------------------------------------------------- schedule

export function ScheduleTab({ schedule }: { schedule: PortalSchedule | null }) {
  const { t } = useLanguage();
  const [view, setView] = useState<"week" | "past">("week");
  const timetable = schedule?.timetable ?? [];
  // Groups without timetable rows only (the rest are already in the week).
  const inTimetable = new Set(timetable.map((l) => l.group?.name).filter(Boolean));
  const fallback = (schedule?.fallbackGroups ?? []).filter((g) => !inTimetable.has(g.name));
  const today = todayDow();
  const days = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => ({ d, items: timetable.filter((l) => (l.dayOfWeek === 0 ? 7 : l.dayOfWeek) === d).sort((a, b) => a.startTime.localeCompare(b.startTime)) }))
    .filter((x) => x.items.length > 0);
  // Today first, then the rest of the week in order.
  days.sort((a, b) => ((a.d - today + 7) % 7) - ((b.d - today + 7) % 7));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <TabTitle title={t("ptl.schedule")} />
      <div role="tablist" style={{ display: "flex", gap: 4, background: "#F2F1EC", padding: 4, borderRadius: 12, alignSelf: "flex-start" }}>
        {(["week", "past"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            style={{ border: "none", cursor: "pointer", padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700, background: view === v ? "#fff" : "transparent", color: view === v ? ACCENT : "#6B6E78", boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}
          >
            {v === "week" ? t("pls.week") : t("pls.past")}
          </button>
        ))}
      </div>
      {view === "past" ? <PastLessons /> : days.length === 0 && fallback.length === 0 ? (
        <Empty icon="🗓️" text={t("ptl.noSchedule")} />
      ) : (
        <>
          {days.map(({ d, items }) => (
            <div key={d} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: d === today ? ACCENT : "#4A4E58", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                {t(DAY_KEYS[d - 1])}
                {d === today && <Pill tone="accent">{t("pth.today")}</Pill>}
              </div>
              {items.map((l) => (
                <div key={l.id} style={{ ...card, display: "flex", gap: 14, alignItems: "center", borderColor: d === today ? "#C7D2FE" : "#EAE8E2" }}>
                  <div style={{ width: 62, flexShrink: 0, textAlign: "center", borderRight: "1px solid #EAE8E2", paddingRight: 12 }}>
                    <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 16 }}>{l.startTime}</div>
                    <div style={{ fontSize: 12, color: "#8A8D96" }}>{l.endTime}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{l.group?.name ?? "—"}</div>
                    <div style={{ fontSize: 12.5, color: "#6B6E78", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                      {l.teacher && <span>👤 {l.teacher.fullName}</span>}
                      {l.room && <span>🚪 {l.room.name}</span>}
                    </div>
                  </div>
                  {l.onlineMeetingUrl && (
                    <a href={l.onlineMeetingUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0, background: ACCENT, color: "#fff", textDecoration: "none", fontSize: 12.5, fontWeight: 700, padding: "9px 12px", borderRadius: 10 }}>
                      {t("ptl.joinOnline")}
                    </a>
                  )}
                </div>
              ))}
            </div>
          ))}
          {fallback.map((g) => (
            <div key={g.id} style={card}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{g.name}</div>
              <div style={{ fontSize: 13, color: "#6B6E78", marginTop: 4, display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                <span>🗓️ {g.scheduleDays || g.schedule || "—"}</span>
                <span>⏰ {g.startTime || "—"}</span>
                {g.teacher && <span>👤 {g.teacher}</span>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const ATT_PILL: Record<string, { key: TranslationKey; tone: "green" | "amber" | "red" | "grey" }> = {
  PRESENT: { key: "ptl.present", tone: "green" },
  LATE: { key: "ptl.late", tone: "amber" },
  ABSENT: { key: "ptl.absent", tone: "red" },
  EXCUSED: { key: "pls.excused", tone: "grey" },
};

// Past lessons, newest first, as a grid of compact cards. A card opens the
// full lesson: topic, the student's mark, homework given that day (with the
// teacher's comment) and test/exam results, so a missed lesson shows exactly
// what to catch up on.
const PAST_CSS = `
.pls-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@media (min-width:720px){.pls-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pls-card{display:flex;gap:12px;text-align:left;width:100%;font-family:inherit;color:inherit;cursor:pointer;transition:box-shadow .15s,transform .15s,border-color .15s}
.pls-card:hover{border-color:#C7D2FE;box-shadow:0 10px 24px -16px rgba(79,70,229,.55);transform:translateY(-1px)}
.pls-card:focus-visible{outline:2px solid #4F46E5;outline-offset:2px}
.pls-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
`;

const ATT_ACCENT: Record<string, { bar: string; bg: string; fg: string }> = {
  green: { bar: "#1FA463", bg: "#E9F8EF", fg: "#15803D" },
  amber: { bar: "#F59E0B", bg: "#FEF3C7", fg: "#B45309" },
  red: { bar: "#DC2626", bg: "#FEE2E2", fg: "#B91C1C" },
  grey: { bar: "#CBD5E1", bg: "#F2F1EC", fg: "#6B6E78" },
};

function PastLessons() {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<PortalPastLesson[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<PortalPastLesson | null>(null);

  useEffect(() => {
    let alive = true;
    portalApi.getPastLessons(days)
      .then((r) => { if (alive) { setData(r.lessons); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [days]);

  if (error) return <Empty icon="⚠️" text={t("common.errorGeneric")} />;
  if (!data) return <div style={{ ...card, color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>;
  if (data.length === 0) return <Empty icon="📚" text={t("pls.none")} />;

  return (
    <>
      <style>{PAST_CSS}</style>
      <div className="pls-grid">
        {data.map((l) => {
          const mark = lessonMark(l);
          const tone = ATT_ACCENT[mark.tone];
          const hwCount = l.homework.length;
          const scored = l.exams.filter((e) => e.score != null);
          return (
            <button key={`${l.groupId}-${l.date}`} type="button" className="pls-card" onClick={() => setOpen(l)} style={{ ...card, padding: 14, opacity: l.cancelled ? 0.7 : 1 }}>
              <div style={{ width: 52, flexShrink: 0, borderRadius: 12, background: tone.bg, color: tone.fg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 0" }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20, lineHeight: 1 }}>{l.date.slice(8, 10)}</div>
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3 }}>{t(MONTH_SHORT_KEYS[Number(l.date.slice(5, 7)) - 1])}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.groupName}</div>
                    <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 1 }}>
                      {weekdayOf(l.date, t)}{l.startTime ? ` · ${l.startTime}${l.endTime ? `–${l.endTime}` : ""}` : ""}
                    </div>
                  </div>
                  <Pill tone={mark.tone}>{t(mark.key)}</Pill>
                </div>
                <div className="pls-clamp" style={{ fontSize: 13, color: l.topic ? "#2A2D35" : "#A3A6AE", fontStyle: l.topic ? "normal" : "italic" }}>
                  📖 {l.topic || t("pls.noTopic")}
                </div>
                {(hwCount > 0 || scored.length > 0) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                    {hwCount > 0 && <span style={chip}>📝 {t("pls.hwCount").replace("{n}", String(hwCount))}</span>}
                    {scored.map((e) => <span key={e.id} style={{ ...chip, background: "#F5F3FF", color: "#5B21B6" }}>🏆 {e.score}/{e.maxScore}</span>)}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {days < 90 && (
        <button type="button" onClick={() => { setData(null); setDays(90); }} style={{ ...card, cursor: "pointer", fontSize: 13, fontWeight: 700, color: ACCENT, textAlign: "center" }}>
          {t("pls.more")}
        </button>
      )}
      {open && <LessonDetails lesson={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const chip: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, padding: "3px 8px", borderRadius: 7, background: "#F2F1EC", color: "#4A4E58", whiteSpace: "nowrap" };

function weekdayOf(date: string, t: (k: TranslationKey) => string) {
  const d = new Date(`${date}T00:00:00`).getDay();
  return t(DAY_KEYS[d === 0 ? 6 : d - 1]);
}

function lessonMark(l: PortalPastLesson): { key: TranslationKey; tone: "green" | "amber" | "red" | "grey" } {
  if (l.cancelled) return { key: "pls.cancelled", tone: "grey" };
  const att = l.attendance ? ATT_PILL[l.attendance] : null;
  return att ?? { key: "pls.noMark", tone: "grey" };
}

function hwStatus(st: string | null): { key: TranslationKey; tone: "green" | "amber" | "grey" | "accent" } {
  return st === "GRADED" ? { key: "pls.hwGraded", tone: "green" } : st === "SUBMITTED" ? { key: "pls.hwSubmitted", tone: "accent" } : { key: "pls.hwTodo", tone: "amber" };
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#8A8D96", textTransform: "uppercase", letterSpacing: "0.04em" }}>{icon} {title}</div>
      {children}
    </section>
  );
}

function LessonDetails({ lesson: l, onClose }: { lesson: PortalPastLesson; onClose: () => void }) {
  const { t } = useLanguage();
  const mark = lessonMark(l);
  const tone = ATT_ACCENT[mark.tone];
  const date = `${weekdayOf(l.date, t)}, ${Number(l.date.slice(8, 10))} ${t(MONTH_KEYS[Number(l.date.slice(5, 7)) - 1])}`;
  return (
    <Modal open onClose={onClose} title={l.groupName} width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: -8 }}>
        <div style={{ fontSize: 13, color: "#6B6E78", display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          <span>🗓️ {date}</span>
          {l.startTime && <span>⏰ {l.startTime}{l.endTime ? `–${l.endTime}` : ""}</span>}
          {l.teacher && <span>👤 {l.teacher}</span>}
        </div>

        <Section icon="✅" title={t("pls.attendance")}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: tone.bg, color: tone.fg, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: tone.bar, flexShrink: 0 }} />
            {t(mark.key)}
          </div>
          {l.attendance === "ABSENT" && <div style={{ fontSize: 12.5, color: "#B45309" }}>💡 {t("pls.missedHint")}</div>}
        </Section>

        <Section icon="📖" title={t("pls.topic")}>
          <div style={{ fontSize: 14, color: l.topic ? "#181A1F" : "#A3A6AE", fontStyle: l.topic ? "normal" : "italic", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {l.topic || t("pls.noTopic")}
          </div>
        </Section>

        {l.homework.length > 0 && (
          <Section icon="📝" title={t("pls.homeworkGiven")}>
            {l.homework.map((h) => {
              const st = hwStatus(h.status);
              return (
                <div key={h.id} style={{ background: "#F9F8F5", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{h.title}</div>
                    <Pill tone={st.tone}>{h.status === "GRADED" && h.score != null ? `${h.score}/${h.maxScore}` : t(st.key)}</Pill>
                  </div>
                  {h.description && <div style={{ fontSize: 13, color: "#4A4E58", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{h.description}</div>}
                  {h.dueDate && <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("pls.due")}: {new Date(h.dueDate).toLocaleDateString()}</div>}
                  {h.attachmentPath && (
                    <a href={fileUrl(h.attachmentPath) ?? undefined} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT }}>📎 {h.attachmentName || t("pls.file")}</a>
                  )}
                  {h.feedback && (
                    <div style={{ borderLeft: `3px solid ${ACCENT}`, background: "#EEF0FF", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: ACCENT, marginBottom: 2 }}>{t("pls.feedback")}</div>
                      {h.feedback}
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {l.exams.length > 0 && (
          <Section icon="🏆" title={t("pls.results")}>
            {l.exams.map((e) => {
              const passed = e.score != null && e.passingScore != null ? e.score >= e.passingScore : null;
              const pct = e.score != null && e.maxScore > 0 ? Math.round((e.score / e.maxScore) * 100) : null;
              return (
                <div key={e.id} style={{ background: "#F5F3FF", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{e.title}</div>
                    <Pill tone={e.score == null ? "grey" : passed === false ? "red" : "green"}>
                      {e.score == null ? t("pls.noResult") : `${e.score}/${e.maxScore}`}
                    </Pill>
                  </div>
                  {pct != null && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 6, background: "#E4E0FB", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: passed === false ? "#DC2626" : "#7C3AED" }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#5B21B6" }}>{pct}%{passed != null ? ` · ${t(passed ? "pls.passed" : "pls.failed")}` : ""}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {l.homework.length === 0 && l.exams.length === 0 && (
          <div style={{ fontSize: 13, color: "#8A8D96", background: "#F9F8F5", borderRadius: 12, padding: "12px 14px" }}>{t("pls.nothing")}</div>
        )}
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- attendance

const ATT_COLORS: Record<string, { dot: string; bg: string }> = {
  PRESENT: { dot: "#1FA463", bg: "#E9F8EF" },
  LATE: { dot: "#F59E0B", bg: "#FEF3C7" },
  ABSENT: { dot: "#DC2626", bg: "#FEE2E2" },
};

const ATT_CSS = `
.pat-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (min-width:720px){.pat-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
.pat-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start}
@media (min-width:900px){.pat-cols{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}}
`;

export function AttendanceTab({ attendance }: { attendance: PortalAttendance | null }) {
  const { t } = useLanguage();
  const present = attendance?.present ?? 0;
  const late = attendance?.late ?? 0;
  const absent = attendance?.absent ?? 0;
  const total = attendance?.total ?? present + late + absent;
  const rate = total > 0 ? Math.round(((present + late) / total) * 100) : null;
  const records = attendance?.records ?? [];
  const months = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort().reverse();
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? months[0] ?? null;
  const STATUS_LABEL: Record<string, string> = { PRESENT: t("ptl.present"), LATE: t("ptl.late"), ABSENT: t("ptl.absent") };

  const stat = (icon: string, value: React.ReactNode, label: string, color: string, bg: string) => (
    <div style={{ ...card, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: bg, display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 22, color, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 12, color: "#6B6E78", marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{ATT_CSS}</style>
      <TabTitle title={t("ptl.attHistory")} />

      <div style={{ ...card, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", background: "linear-gradient(135deg, #EEF0FF 0%, #fff 70%)" }}>
        <svg width="96" height="96" viewBox="0 0 36 36" aria-hidden style={{ flexShrink: 0 }}>
          <circle cx="18" cy="18" r="15" fill="none" stroke="#E4E7F5" strokeWidth="4" />
          {rate !== null && (
            <circle cx="18" cy="18" r="15" fill="none" stroke={rate >= 80 ? ACCENT : rate >= 60 ? "#F59E0B" : "#DC2626"} strokeWidth="4" strokeDasharray={`${(rate / 100) * 94.2} 100`} strokeLinecap="round" transform="rotate(-90 18 18)" />
          )}
          <text x="18" y="21" textAnchor="middle" fontSize="8" fontWeight="800" fill="#181A1F">{rate === null ? "—" : `${rate}%`}</text>
        </svg>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 18, fontWeight: 800 }}>{t("pat.overall")}</div>
          <div style={{ fontSize: 13, color: "#6B6E78", marginTop: 4, lineHeight: 1.5 }}>
            {rate === null ? t("ptl.noAtt") : rate >= 90 ? t("pat.great") : rate >= 75 ? t("pat.good") : t("pat.low")}
          </div>
          {(attendance?.streak ?? 0) > 1 && (
            <div style={{ display: "inline-flex", marginTop: 8, gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "#B45309", background: "#FEF3C7", padding: "4px 10px", borderRadius: 100 }}>
              🔥 {t("pat.streak").replace("{n}", String(attendance?.streak))}
            </div>
          )}
        </div>
      </div>

      <div className="pat-stats">
        {stat("📚", total, t("pat.lessons"), "#181A1F", "#F2F1EC")}
        {stat("✅", present, t("ptl.present"), "#1FA463", "#E9F8EF")}
        {stat("⏰", late, t("ptl.late"), "#B45309", "#FEF3C7")}
        {stat("❌", absent, t("ptl.absent"), "#DC2626", "#FEE2E2")}
      </div>

      {records.length === 0 ? (
        <Empty icon="📋" text={t("ptl.noAtt")} />
      ) : (
        <div className="pat-cols">
          {shown && <MonthCalendar month={shown} months={months} onMonth={setMonth} records={records} statusLabel={STATUS_LABEL} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {(attendance?.byGroup?.length ?? 0) > 0 && (
              <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{t("pat.byGroup")}</div>
                {attendance!.byGroup!.map((g) => {
                  const r = g.total > 0 ? Math.round(((g.present + g.late) / g.total) * 100) : 0;
                  return (
                    <div key={g.groupId}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5 }}>
                        <span style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {g.groupName ?? "—"}{g.subject ? <span style={{ color: "#8A8D96", fontWeight: 500 }}> · {g.subject}</span> : null}
                        </span>
                        <span style={{ fontWeight: 800, color: r >= 80 ? "#1FA463" : r >= 60 ? "#B45309" : "#DC2626" }}>{r}%</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 99, background: "#F2F1EC", overflow: "hidden", margin: "6px 0 4px", display: "flex" }}>
                        <div style={{ width: `${(g.present / Math.max(1, g.total)) * 100}%`, background: "#1FA463" }} />
                        <div style={{ width: `${(g.late / Math.max(1, g.total)) * 100}%`, background: "#F59E0B" }} />
                        <div style={{ width: `${(g.absent / Math.max(1, g.total)) * 100}%`, background: "#DC2626" }} />
                      </div>
                      <div style={{ fontSize: 12, color: "#8A8D96" }}>
                        ✅ {g.present} · ⏰ {g.late} · ❌ {g.absent} · {t("pat.of").replace("{n}", String(g.total))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", fontSize: 14, fontWeight: 800, borderBottom: "1px solid #F0EEE8" }}>{t("pat.recent")}</div>
              {records.slice(0, 8).map((r) => {
                const c = ATT_COLORS[r.status] ?? { dot: "#8A8D96", bg: "#F2F1EC" };
                return (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 16px", borderBottom: "1px solid #F7F6F2" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}</span>
                        {r.groupName && <span style={{ display: "block", fontSize: 12, color: "#8A8D96", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.groupName}</span>}
                      </span>
                    </span>
                    <Pill tone={r.status === "PRESENT" ? "green" : r.status === "LATE" ? "amber" : "red"}>{STATUS_LABEL[r.status] ?? r.status}</Pill>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A month grid (Mon-Sun): each lesson day is coloured by the mark; a day with
// several lessons shows a dot per lesson.
function MonthCalendar({ month, months, onMonth, records, statusLabel }: {
  month: string;
  months: string[];
  onMonth: (m: string) => void;
  records: PortalAttendance["records"];
  statusLabel: Record<string, string>;
}) {
  const { t } = useLanguage();
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const daysIn = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const byDay = new Map<number, PortalAttendance["records"]>();
  for (const r of records) {
    if (r.date.slice(0, 7) !== month) continue;
    const d = Number(r.date.slice(8, 10));
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const idx = months.indexOf(month);
  const inMonth = records.filter((r) => r.date.slice(0, 7) === month);
  const ok = inMonth.filter((r) => r.status !== "ABSENT").length;
  const cells: Array<number | null> = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const todayStr = new Date().toISOString().slice(0, 10);
  const navBtn = (disabled: boolean): React.CSSProperties => ({ width: 34, height: 34, borderRadius: 10, border: "1px solid #EAE8E2", background: "#fff", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, fontSize: 16, fontWeight: 700 });

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button type="button" aria-label="prev" disabled={idx >= months.length - 1} onClick={() => onMonth(months[idx + 1])} style={navBtn(idx >= months.length - 1)}>‹</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 16, fontWeight: 800 }}>{monthLabel(month, t)}</div>
          <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("pat.monthSummary").replace("{a}", String(ok)).replace("{n}", String(inMonth.length))}</div>
        </div>
        <button type="button" aria-label="next" disabled={idx <= 0} onClick={() => onMonth(months[idx - 1])} style={navBtn(idx <= 0)}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, textAlign: "center" }}>
        {DAY_KEYS.map((k) => (
          <div key={k} style={{ fontSize: 11, fontWeight: 700, color: "#8A8D96", padding: "2px 0" }}>{t(k).slice(0, 2)}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const recs = byDay.get(d) ?? [];
          const worst = recs.some((r) => r.status === "ABSENT") ? "ABSENT" : recs.some((r) => r.status === "LATE") ? "LATE" : recs.length ? "PRESENT" : null;
          const c = worst ? ATT_COLORS[worst] : null;
          const iso = `${month}-${String(d).padStart(2, "0")}`;
          return (
            <div
              key={d}
              title={recs.map((r) => `${r.groupName ?? ""} ${statusLabel[r.status] ?? r.status}`.trim()).join("\n") || undefined}
              style={{ aspectRatio: "1 / 1", borderRadius: 10, background: c?.bg ?? "#FAFAF8", border: iso === todayStr ? `2px solid ${ACCENT}` : "1px solid #F0EEE8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}
            >
              <span style={{ fontSize: 13, fontWeight: c ? 800 : 500, color: c ? "#181A1F" : "#A3A6AE" }}>{d}</span>
              {recs.length > 0 && (
                <span style={{ display: "flex", gap: 2 }}>
                  {recs.slice(0, 3).map((r) => <span key={r.id} style={{ width: 5, height: 5, borderRadius: "50%", background: ATT_COLORS[r.status]?.dot ?? "#8A8D96" }} />)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "#6B6E78", justifyContent: "center" }}>
        {(["PRESENT", "LATE", "ABSENT"] as const).map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: ATT_COLORS[k].bg, border: `2px solid ${ATT_COLORS[k].dot}` }} /> {statusLabel[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- homework

const isImage = (name: string | null | undefined) => !!name && /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name);

// Two cards per row on wide screens; a card left alone in its row (the only
// one, or the last of an odd count) takes the whole row.
const HW_CSS = `
.phw-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start}
@media (min-width:880px){.phw-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.phw-grid>.phw-card:last-child:nth-child(odd){grid-column:1/-1}}
`;

export function HomeworkTab({ homework, onSubmit, readOnly = false }: { homework: PortalHomework[]; onSubmit: (id: string, data: { text?: string; file?: File | null }) => Promise<void>; readOnly?: boolean }) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [now] = useState(() => Date.now());
  const list = homework
    .filter((h) => (filter === "all" ? true : filter === "done" ? h.completed : !h.completed))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  const counts = { all: homework.length, todo: homework.filter((h) => !h.completed).length, done: homework.filter((h) => h.completed).length };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{HW_CSS}</style>
      <TabTitle title={t("ptl.homework")} />
      <div style={{ display: "flex", gap: 6, background: "#EFEEE9", padding: 4, borderRadius: 12, alignSelf: "flex-start", maxWidth: "100%", overflowX: "auto" }}>
        {([
          ["all", t("common.all")],
          ["todo", t("pth.todo")],
          ["done", t("hws.stDone")],
        ] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} style={{ border: "none", cursor: "pointer", whiteSpace: "nowrap", fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 9, background: filter === k ? "#fff" : "transparent", color: filter === k ? "#181A1F" : "#6B6E78", boxShadow: filter === k ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
            {l} <span style={{ color: "#8A8D96", fontWeight: 600 }}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <Empty icon="📚" text={t("ptl.noHomework")} />
      ) : (
        <div className="phw-grid">
          {list.map((hw) => <HomeworkCard key={hw.id} hw={hw} now={now} readOnly={readOnly} onSubmit={onSubmit} />)}
        </div>
      )}
    </div>
  );
}

function HomeworkCard({ hw, now, readOnly, onSubmit }: { hw: PortalHomework; now: number; readOnly: boolean; onSubmit: (id: string, data: { text?: string; file?: File | null }) => Promise<void> }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const due = hw.dueDate ? new Date(hw.dueDate) : null;
  const overdue = !hw.completed && due !== null && due.getTime() < now;
  const sub = hw.submission;
  const graded = sub?.status === "GRADED";

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(f: File | null) {
    if (!f) return;
    const { shrinkImage } = await import("@/lib/shrink-image");
    const ready = await shrinkImage(f);
    setFile(ready);
    setPreview(ready.type.startsWith("image/") ? URL.createObjectURL(ready) : null);
  }

  async function send() {
    setBusy(true);
    try {
      await onSubmit(hw.id, { text: text.trim() || undefined, file });
      setOpen(false);
      setText("");
      setFile(null);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const statusPill = graded
    ? <Pill tone="green">{sub?.score != null ? `${sub.score}/${hw.maxScore ?? 100}` : t("pls.hwGraded")}</Pill>
    : hw.completed ? <Pill tone="accent">{t("pls.hwSubmitted")}</Pill>
    : overdue ? <Pill tone="red">{t("hws.stOverdue")}</Pill>
    : <Pill tone="grey">{t("pth.todo")}</Pill>;

  return (
    <div className="phw-card" style={{ ...card, borderColor: overdue ? "#FECACA" : "#EAE8E2", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, overflowWrap: "anywhere" }}>{hw.title}</div>
          <div style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            <span>{hw.groupName || t("ptl.general")}</span>
            {due && <span style={{ color: overdue ? "#DC2626" : undefined, fontWeight: overdue ? 700 : 400 }}>⏰ {t("phw.due")}: {due.toLocaleDateString()}</span>}
            {hw.maxScore ? <span>🎯 {hw.maxScore} {t("phw.points")}</span> : null}
          </div>
        </div>
        {statusPill}
      </div>

      <div>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "#8A8D96", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{t("phw.task")}</div>
        <div style={{ background: "#F7F7F5", borderRadius: 12, padding: 12, fontSize: 14, color: "#33363D", lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {hw.description || <span style={{ color: "#8A8D96" }}>{hw.attachmentPath ? t("phw.seeFile") : t("phw.noDescription")}</span>}
        </div>
      </div>

      {hw.attachmentPath && (
        isImage(hw.attachmentName ?? hw.attachmentPath) ? (
          <a href={fileUrl(hw.attachmentPath) ?? "#"} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(hw.attachmentPath) ?? ""} alt={hw.attachmentName ?? ""} style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 12, border: "1px solid #EAE8E2", background: "#FAFAF8" }} />
          </a>
        ) : (
          <a href={fileUrl(hw.attachmentPath) || "#"} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 11, border: "1px solid #C7D2FE", background: "#EEF0FF", color: "#4338CA", fontSize: 13, fontWeight: 700, textDecoration: "none", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", alignSelf: "flex-start" }}>
            📎 {hw.attachmentName || t("homework.file")} ↓
          </a>
        )
      )}

      {sub && (sub.text || sub.file || sub.feedback) && (
        <div style={{ borderTop: "1px dashed #EAE8E2", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "#8A8D96", textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("phw.myAnswer")}</div>
          {sub.text && <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{sub.text}</div>}
          {sub.file && (isImage(sub.file) ? (
            <a href={fileUrl(sub.file) ?? "#"} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(sub.file) ?? ""} alt="" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 10, border: "1px solid #EAE8E2" }} />
            </a>
          ) : (
            <a href={fileUrl(sub.file) ?? "#"} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>📎 {t("phw.myFile")}</a>
          ))}
          {sub.feedback && (
            <div style={{ background: "#ECFDF5", border: "1px solid #BBF7D0", borderRadius: 10, padding: 10, fontSize: 13, color: "#14532D" }}>
              💬 <b>{t("phw.teacherSays")}:</b> {sub.feedback}
            </div>
          )}
        </div>
      )}

      {!readOnly && !graded && (
        open ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#FAFAFF", border: "1px solid #E0E7FF", borderRadius: 12, padding: 12 }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={5000} placeholder={t("phw.textPh")} style={{ width: "100%", boxSizing: "border-box", borderRadius: 10, border: "1px solid #EAE8E2", padding: 10, fontSize: 14, fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={fileBtn}>
                📷 {t("phw.takePhoto")}
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              </label>
              <label style={fileBtn}>
                📎 {t("phw.chooseFile")}
                <input type="file" accept="image/*,application/pdf,.doc,.docx" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            {file && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#4A4E58" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {preview ? <img src={preview} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} /> : <span>📄</span>}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{file.name}</span>
                <button type="button" onClick={() => { setFile(null); setPreview(null); }} style={{ background: "none", border: "none", color: "#B23A47", cursor: "pointer", fontWeight: 700 }}>✕</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setOpen(false)} style={{ background: "#F2F1EC", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 700, cursor: "pointer" }}>{t("common.cancel")}</button>
              <button type="button" disabled={busy || (!text.trim() && !file)} onClick={send} style={{ ...submitBtn, opacity: busy || (!text.trim() && !file) ? 0.6 : 1 }}>
                {busy ? t("common.saving") : `✓ ${t("ptl.submit")}`}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" onClick={() => setOpen(true)} style={submitBtn}>
              {hw.completed ? `✎ ${t("phw.resubmit")}` : `📤 ${t("phw.handIn")}`}
            </button>
          </div>
        )
      )}
    </div>
  );
}

const fileBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 12px", borderRadius: 10, border: "1px solid #C7D2FE", background: "#fff", color: "#4338CA", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const submitBtn: React.CSSProperties = { background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 11, cursor: "pointer", minHeight: 42, boxShadow: "0 8px 18px -10px rgba(79,70,229,0.8)" };

// ---------------------------------------------------------------- payments

export function PaymentsTab({ payments, checkoutLoading, onPay, payError }: { payments: PortalPayments | null; checkoutLoading: string | null; onPay: (p: "CLICK" | "PAYME") => void; payError?: string | null }) {
  const { t } = useLanguage();
  const debt = payments?.debtAmount ?? 0;
  const expected = payments?.expectedTuition ?? 0;
  const paid = payments?.monthPaid ?? 0;
  const discount = payments?.monthDiscount ?? 0;
  // A discount counts towards the month being covered.
  const pct = expected > 0 ? Math.min(100, Math.round(((paid + discount) / expected) * 100)) : 0;
  const history = payments?.history ?? [];
  // Pay-online buttons only for providers the center has set up.
  const providers = ([
    ["CLICK", t("ptl.payClick"), "#0073FF", payments?.online?.click],
    ["PAYME", t("ptl.payPayme"), "#18AC98", payments?.online?.payme],
  ] as const).filter((x) => x[3]).map(([p, l, c]) => [p, l, c] as const);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <TabTitle title={t("ptl.paymentsBalance")} />
      <div style={{ borderRadius: 20, padding: 20, color: "#fff", background: debt > 0 ? "linear-gradient(135deg, #B91C1C, #7F1D1D)" : `linear-gradient(135deg, ${ACCENT}, #1B1440)`, boxShadow: "0 18px 36px -20px rgba(18,19,26,0.6)" }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          {t("ptl.monthStatus")} · {payments?.forMonth ? monthLabel(payments.forMonth, t) : "—"}
        </div>
        <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 26, fontWeight: 800, marginTop: 6 }}>
          {debt > 0 ? `${money(debt)} ${t("common.sumUnit")}` : t("ptl.allPaid")}
        </div>
        {debt > 0 && <div style={{ fontSize: 13, opacity: 0.85 }}>{t("ptl.debtLabel")}</div>}
        {expected > 0 && (
          <>
            <div style={{ height: 8, background: "rgba(255,255,255,0.2)", borderRadius: 100, marginTop: 14, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "#fff", borderRadius: 100 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, opacity: 0.9, marginTop: 6, gap: 10, flexWrap: "wrap" }}>
              <span>{t("ptl.paidSoFar")}: {money(paid)}</span>
              {discount > 0 && <span>{t("ptl.discount")}: {money(discount)}</span>}
              <span>{t("ptl.coursePrice")}: {money(expected)}</span>
            </div>
          </>
        )}
        {debt > 0 && providers.length === 0 && (
          <div style={{ marginTop: 14, fontSize: 13, background: "rgba(255,255,255,0.14)", borderRadius: 12, padding: "10px 12px", lineHeight: 1.5 }}>🏫 {t("ptl.payAtCenter")}</div>
        )}
        {debt > 0 && providers.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 16 }}>
            {providers.map(([p, l, c]) => (
              <button key={p} type="button" onClick={() => onPay(p)} disabled={checkoutLoading !== null} style={{ background: "#fff", color: c, border: "none", minHeight: 46, borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", opacity: checkoutLoading && checkoutLoading !== p ? 0.6 : 1 }}>
                {checkoutLoading === p ? t("common.loading") : `💳 ${l}`}
              </button>
            ))}
          </div>
        )}
        {payError && <div role="alert" style={{ marginTop: 10, fontSize: 13, background: "rgba(255,255,255,0.92)", color: "#B91C1C", borderRadius: 10, padding: "8px 12px" }}>{payError}</div>}
      </div>

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", fontFamily: "'Manrope', sans-serif", fontSize: 16, fontWeight: 700, borderBottom: "1px solid #F0EEE8" }}>{t("ptl.history")}</div>
        {history.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#8A8D96", fontSize: 13.5 }}>{t("ptl.noHistory")}</div>
        ) : (
          history.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #F7F6F2" }}>
              <div style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 11, background: p.status === "PAID" ? "#E9F8EF" : "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>
                {p.status === "PAID" ? "✓" : "!"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{p.forMonth ? monthLabel(p.forMonth, t) : "—"}</div>
                <div style={{ fontSize: 12, color: "#8A8D96" }}>{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : "—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 15, fontWeight: 800 }}>{money(p.amount)}</div>
                <div style={{ fontSize: 11.5, color: p.status === "PAID" ? "#1FA463" : "#DC2626", fontWeight: 700 }}>{p.status === "PAID" ? t("ptl.paidStatus") : p.status}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
