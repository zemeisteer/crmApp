"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import LoadError from "@/components/LoadError";
import Select from "@/components/Select";
import TimePicker from "@/components/TimePicker";
import { ApiError, scheduleApi, type Group, type Room, type ScheduleConflict, type ScheduleItem, type Teacher } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";
const WIDTH = 348;
const DURATIONS = [60, 90, 120];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toTime = (minutes: number) => {
  const m = Math.max(0, Math.min(minutes, 23 * 60 + 45));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export interface QuickAddPrefill {
  groupId: string;
  teacherId: string;
  roomId: string;
  startTime: string;
  endTime: string;
}

/**
 * The "+" of a day opens this next to that day: group, time, room and
 * teacher, with the clash check running as the fields change. The day is the
 * column the "+" belongs to; everything rarer (topic, online link, saving
 * past a clash) is one click away in the full form.
 */
export default function QuickAddLesson({
  day,
  dayLabel,
  anchor,
  groups,
  teachers,
  rooms,
  dayLessons,
  onClose,
  onSaved,
  onMore,
}: {
  day: number;
  dayLabel: string;
  /** The day's header: the panel opens under it, over that day, and stays on screen. */
  anchor: DOMRect;
  groups: Group[];
  teachers: Teacher[];
  rooms: Room[];
  /** Lessons already on this day: the form starts after the last one. */
  dayLessons: ScheduleItem[];
  onClose: () => void;
  onSaved: (dayLabel: string) => void;
  onMore: (prefill: QuickAddPrefill) => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

  const firstFree = useMemo(() => {
    const lastEnd = dayLessons.reduce((max, l) => Math.max(max, toMinutes(l.endTime)), 0);
    const start = lastEnd === 0 ? 9 * 60 : Math.min(Math.ceil((lastEnd + 10) / 15) * 15, 21 * 60);
    return toTime(start);
  }, [dayLessons]);

  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState(groups[0]?.teacherId ?? "");
  const [roomId, setRoomId] = useState("");
  const [startTime, setStartTime] = useState(firstFree);
  const [endTime, setEndTime] = useState(toTime(toMinutes(firstFree) + 90));
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Under the "+", moved left or up when it would leave the screen.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 8 });
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 440;
    const width = Math.min(WIDTH, window.innerWidth - 24);
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
    let top = anchor.bottom + 8;
    if (top + height > window.innerHeight - 12) top = Math.max(12, window.innerHeight - height - 12);
    setPos({ left, top });
  }, [anchor, conflicts.length, checkError, error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // Only the answer for the fields as they are now counts.
  useEffect(() => {
    if (!groupId || !startTime || !endTime || startTime >= endTime) {
      setConflicts([]);
      setCheckError(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      setChecking(true);
      scheduleApi
        .checkConflicts({ groupId, teacherId: teacherId || undefined, roomId: roomId || undefined, dayOfWeek: day, startTime, endTime })
        .then((res) => { if (current) { setConflicts(res.conflicts); setCheckError(null); } })
        .catch((err) => { if (current) { setConflicts([]); setCheckError(err instanceof ApiError ? err.message : t("sch.conflictCheckError")); } })
        .finally(() => { if (current) setChecking(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); setChecking(false); };
  }, [groupId, teacherId, roomId, day, startTime, endTime, retry, t]);

  function pickGroup(id: string) {
    setGroupId(id);
    const g = groups.find((x) => x.id === id);
    if (g?.teacherId) setTeacherId(g.teacherId);
  }

  function pickStart(value: string) {
    // The length chosen so far moves with the start.
    const length = startTime < endTime ? toMinutes(endTime) - toMinutes(startTime) : 90;
    setStartTime(value);
    setEndTime(toTime(toMinutes(value) + length));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) return setError(t("msg.selectGroup"));
    if (startTime >= endTime) return setError(t("sch.endAfterStart"));
    setSaving(true);
    setError("");
    try {
      const group = groups.find((g) => g.id === groupId);
      await scheduleApi.create({
        groupId,
        teacherId: teacherId || undefined,
        roomId: roomId || undefined,
        branchId: group?.branchId || undefined,
        dayOfWeek: day,
        startTime,
        endTime,
      });
      onSaved(dayLabel);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("msg.saveError"));
    } finally {
      setSaving(false);
    }
  }

  const length = startTime < endTime ? toMinutes(endTime) - toMinutes(startTime) : 0;
  const blocked = saving || checking || !!checkError || conflicts.length > 0 || !groupId;
  const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#4A4E58", marginBottom: 5 };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${dayLabel}: ${t("schedule.addLesson")}`}
      style={{ position: "fixed", left: pos.left, top: pos.top, width: `min(${WIDTH}px, calc(100vw - 24px))`, zIndex: 60, background: "#fff", borderRadius: 16, border: "1px solid #E5E3DC", boxShadow: "0 18px 50px rgba(18,19,26,0.22)", overflow: "visible" }}
    >
      <div style={{ background: ACCENT, color: "#fff", borderRadius: "15px 15px 0 0", padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("schedule.addLesson")}</div>
          <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{dayLabel}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} style={{ background: "rgba(255,255,255,0.18)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: 100, cursor: "pointer", fontSize: 15 }}>×</button>
      </div>

      {groups.length === 0 ? (
        <div style={{ padding: 16, fontSize: 13, color: "#686B75" }}>{t("sch.quick.noGroups")}</div>
      ) : (
        <form onSubmit={save} style={{ padding: 14, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
          <div>
            <span style={label}>{t("schedule.group")} *</span>
            <Select value={groupId} onChange={pickGroup} options={groups.map((g) => ({ value: g.id, label: g.subject ? `${g.name} · ${g.subject}` : g.name }))} ariaLabel={t("schedule.group")} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
            <div>
              <span style={label}>{t("schedule.startTime")}</span>
              <TimePicker value={startTime} onChange={pickStart} />
            </div>
            <div>
              <span style={label}>{t("schedule.endTime")}</span>
              <TimePicker value={endTime} onChange={setEndTime} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: -4 }}>
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setEndTime(toTime(toMinutes(startTime) + d))}
                style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 100, cursor: "pointer", border: `1px solid ${length === d ? ACCENT : "#EAE8E2"}`, background: length === d ? "#EEF0FF" : "#fff", color: length === d ? ACCENT : "#4A4E58" }}
              >
                {d} {t("sch.quick.min")}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
            <div>
              <span style={label}>{t("schedule.room")}</span>
              <Select value={roomId} onChange={setRoomId} placeholder={t("common.notSelected")} options={[{ value: "", label: t("common.notSelected") }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]} ariaLabel={t("schedule.room")} />
            </div>
            <div>
              <span style={label}>{t("schedule.teacher")}</span>
              <Select value={teacherId} onChange={setTeacherId} placeholder={t("common.notSelected")} options={[{ value: "", label: t("common.notSelected") }, ...teachers.map((x) => ({ value: x.id, label: x.fullName }))]} ariaLabel={t("schedule.teacher")} />
            </div>
          </div>

          {checkError && <LoadError compact message={checkError} onRetry={() => setRetry((n) => n + 1)} />}

          {conflicts.length > 0 ? (
            <div role="alert" style={{ background: "#FEF2F2", border: "1px solid #F5B5B5", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#991B1B", display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 800, color: "#B91C1C" }}>{t("sch.quick.busy")}</div>
              {conflicts.map((c, i) => <div key={i}>• {c.message}</div>)}
            </div>
          ) : !checkError && groupId && startTime < endTime ? (
            <div style={{ fontSize: 12, fontWeight: 700, color: checking ? "#686B75" : "#16794A", display: "flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true">{checking ? "…" : "✓"}</span>
              {checking ? t("sch.quick.checking") : t("sch.quick.free")}
            </div>
          ) : null}

          {error && <div role="alert" style={{ color: "#B91C1C", fontSize: 12.5, fontWeight: 600, background: "#FEE2E2", padding: "8px 10px", borderRadius: 8 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => onMore({ groupId, teacherId, roomId, startTime, endTime })} style={{ background: "none", border: "none", color: ACCENT, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              {t("sch.quick.more")}
            </button>
            <button type="submit" className="btn" disabled={blocked} style={{ background: blocked ? "#A9ABB3" : ACCENT, color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: blocked ? "not-allowed" : "pointer" }}>
              {saving ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
