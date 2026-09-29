"use client";

import { useState } from "react";
import { fileUrl, type PortalAttendance, type PortalHomework, type PortalPayments, type PortalSchedule } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { MONTH_KEYS, type TranslationKey } from "@/lib/i18n";

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
      {days.length === 0 && fallback.length === 0 ? (
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

// -------------------------------------------------------------- attendance

export function AttendanceTab({ attendance }: { attendance: PortalAttendance | null }) {
  const { t } = useLanguage();
  const present = attendance?.present ?? 0;
  const late = attendance?.late ?? 0;
  const absent = attendance?.absent ?? 0;
  const total = attendance?.total ?? present + late + absent;
  const rate = total > 0 ? Math.round(((present + late) / total) * 100) : null;
  const records = attendance?.records ?? [];
  const byMonth = new Map<string, typeof records>();
  for (const r of records) {
    const k = r.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), r]);
  }
  const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red"; dot: string }> = {
    PRESENT: { label: t("ptl.present"), tone: "green", dot: "#1FA463" },
    LATE: { label: t("ptl.late"), tone: "amber", dot: "#F59E0B" },
    ABSENT: { label: t("ptl.absent"), tone: "red", dot: "#DC2626" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <TabTitle title={t("ptl.attHistory")} />
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <svg width="84" height="84" viewBox="0 0 36 36" aria-hidden style={{ flexShrink: 0 }}>
          <circle cx="18" cy="18" r="15" fill="none" stroke="#EEF0F3" strokeWidth="4" />
          {rate !== null && (
            <circle cx="18" cy="18" r="15" fill="none" stroke={rate >= 80 ? ACCENT : "#EA7A3A"} strokeWidth="4" strokeDasharray={`${(rate / 100) * 94.2} 100`} strokeLinecap="round" transform="rotate(-90 18 18)" />
          )}
          <text x="18" y="21" textAnchor="middle" fontSize="8" fontWeight="800" fill="#181A1F">{rate === null ? "—" : `${rate}%`}</text>
        </svg>
        <div style={{ flex: 1, minWidth: 200, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {[
            { v: present, l: t("ptl.present"), c: "#1FA463" },
            { v: late, l: t("ptl.late"), c: "#B45309" },
            { v: absent, l: t("ptl.absent"), c: "#DC2626" },
          ].map((x) => (
            <div key={x.l} style={{ background: "#F7F7F5", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20, color: x.c }}>{x.v}</div>
              <div style={{ fontSize: 12, color: "#6B6E78" }}>{x.l}</div>
            </div>
          ))}
        </div>
      </div>

      {records.length === 0 ? (
        <Empty icon="📋" text={t("ptl.noAtt")} />
      ) : (
        [...byMonth.entries()].map(([ym, rows]) => (
          <div key={ym} style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", fontSize: 13, fontWeight: 800, color: "#4A4E58", borderBottom: "1px solid #F0EEE8", display: "flex", justifyContent: "space-between" }}>
              <span>{monthLabel(ym, t)}</span>
              <span style={{ color: "#8A8D96", fontWeight: 600 }}>{rows.filter((r) => r.status !== "ABSENT").length}/{rows.length}</span>
            </div>
            {rows.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, tone: "grey" as const, dot: "#8A8D96" };
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: "1px solid #F7F6F2" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.dot }} />
                    {new Date(r.date).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })}
                  </span>
                  <Pill tone={s.tone}>{s.label}</Pill>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- homework

export function HomeworkTab({ homework, onSubmit, readOnly = false }: { homework: PortalHomework[]; onSubmit: (id: string) => Promise<void>; readOnly?: boolean }) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const list = homework
    .filter((h) => (filter === "all" ? true : filter === "done" ? h.completed : !h.completed))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  const counts = { all: homework.length, todo: homework.filter((h) => !h.completed).length, done: homework.filter((h) => h.completed).length };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
        list.map((hw) => {
          const due = hw.dueDate ? new Date(hw.dueDate) : null;
          const overdue = !hw.completed && due !== null && due.getTime() < now;
          return (
            <div key={hw.id} style={{ ...card, borderColor: overdue ? "#FECACA" : "#EAE8E2", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>{hw.title}</div>
                  <div style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                    <span>{hw.groupName || t("ptl.general")}</span>
                    {due && <span style={{ color: overdue ? "#DC2626" : undefined }}>⏰ {due.toLocaleDateString()}</span>}
                  </div>
                </div>
                <Pill tone={hw.completed ? "green" : overdue ? "red" : "grey"}>{hw.completed ? t("hws.stDone") : overdue ? t("hws.stOverdue") : t("pth.todo")}</Pill>
              </div>
              {hw.description && <div style={{ background: "#F7F7F5", borderRadius: 12, padding: 12, fontSize: 13.5, color: "#33363D", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{hw.description}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {hw.attachmentPath && (
                  <a href={fileUrl(hw.attachmentPath) || "#"} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 11, border: "1px solid #C7D2FE", background: "#EEF0FF", color: "#4338CA", fontSize: 13, fontWeight: 700, textDecoration: "none", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📎 {hw.attachmentName || t("homework.file")}
                  </a>
                )}
                {!hw.completed && !readOnly && (
                  <button
                    type="button"
                    disabled={busy === hw.id}
                    onClick={async () => {
                      setBusy(hw.id);
                      try {
                        await onSubmit(hw.id);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    style={{ marginLeft: "auto", background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 11, cursor: "pointer", minHeight: 42, opacity: busy === hw.id ? 0.7 : 1, boxShadow: "0 8px 18px -10px rgba(79,70,229,0.8)" }}
                  >
                    ✓ {t("ptl.submit")}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------- payments

export function PaymentsTab({ payments, checkoutLoading, onPay }: { payments: PortalPayments | null; checkoutLoading: string | null; onPay: (p: "CLICK" | "PAYME") => void }) {
  const { t } = useLanguage();
  const debt = payments?.debtAmount ?? 0;
  const expected = payments?.expectedTuition ?? 0;
  const paid = payments?.monthPaid ?? 0;
  const pct = expected > 0 ? Math.min(100, Math.round((paid / expected) * 100)) : 0;
  const history = payments?.history ?? [];

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
              <span>{t("ptl.coursePrice")}: {money(expected)}</span>
            </div>
          </>
        )}
        {debt > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 16 }}>
            {([
              ["CLICK", t("ptl.payClick"), "#0073FF"],
              ["PAYME", t("ptl.payPayme"), "#18AC98"],
            ] as const).map(([p, l, c]) => (
              <button key={p} type="button" onClick={() => onPay(p)} disabled={checkoutLoading !== null} style={{ background: "#fff", color: c, border: "none", minHeight: 46, borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: "pointer", opacity: checkoutLoading && checkoutLoading !== p ? 0.6 : 1 }}>
                {checkoutLoading === p ? t("common.loading") : `💳 ${l}`}
              </button>
            ))}
          </div>
        )}
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
