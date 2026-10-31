"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { ApiError, teacherAttendanceApi, type Teacher, type TeacherLesson, type TeacherMark } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";

const ACCENT = "var(--primary)";
const STATES: Array<{ key: TeacherMark; label: "ptl.present" | "ptl.late" | "ptl.absent"; color: string }> = [
  { key: "PRESENT", label: "ptl.present", color: "var(--success)" },
  { key: "LATE", label: "ptl.late", color: "var(--warning)" },
  { key: "ABSENT", label: "ptl.absent", color: "var(--danger)" },
];

type Draft = { status: TeacherMark | null; substituteTeacherId: string; note: string };

// A lesson is its timetable row; a group without rows has one lesson a day.
const keyOf = (l: Pick<TeacherLesson, "scheduleId" | "groupId">) => l.scheduleId ?? `group:${l.groupId}`;

// The day's lessons (from the timetable) with who taught them. Missed
// lessons come off that teacher's pay; a substitute is paid for the lesson.
export default function TeacherAttendanceModal({ teachers, onClose }: { teachers: Teacher[]; onClose: () => void }) {
  const { t } = useLanguage();
  const clock = useCenterClock();
  const [date, setDate] = useState(() => clock.today());
  const [lessons, setLessons] = useState<TeacherLesson[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLessons(null);
    setSaved(false);
    teacherAttendanceApi
      .day(date)
      .then((rows) => {
        if (cancelled) return;
        setLessons(rows);
        setDrafts(Object.fromEntries(rows.map((l) => [keyOf(l), { status: l.status, substituteTeacherId: l.substituteTeacherId ?? "", note: l.note ?? "" }])));
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t("common.errorGeneric")));
    return () => {
      cancelled = true;
    };
  }, [date, t]);

  const update = (key: string, patch: Partial<Draft>) => {
    setSaved(false);
    setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  };

  async function save() {
    const entries = (lessons ?? [])
      .filter((l) => !l.cancelled && drafts[keyOf(l)]?.status)
      .map((l) => {
        const d = drafts[keyOf(l)];
        return { groupId: l.groupId, scheduleId: l.scheduleId, status: d.status as TeacherMark, substituteTeacherId: d.status === "ABSENT" && d.substituteTeacherId ? d.substituteTeacherId : null, note: d.note || null };
      });
    if (entries.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const rows = await teacherAttendanceApi.mark(date, entries);
      setLessons(rows);
      setDrafts(Object.fromEntries(rows.map((l) => [keyOf(l), { status: l.status, substituteTeacherId: l.substituteTeacherId ?? "", note: l.note ?? "" }])));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  const allPresent = () => {
    setSaved(false);
    const open = new Set((lessons ?? []).filter((l) => !l.cancelled && l.teacherId).map(keyOf));
    setDrafts((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.status || !open.has(k) ? v : { ...v, status: "PRESENT" as TeacherMark }])));
  };

  return (
    <Modal open onClose={onClose} title={`📋 ${t("tatt.title")}`} width={760}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <DatePicker value={date} onChange={setDate} style={{ width: 200 }} />
        {lessons && lessons.length > 0 && (
          <button type="button" onClick={allPresent} style={ghost}>✓ {t("tatt.allPresent")}</button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>{t("tatt.hint")}</div>
      {error && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 10 }}>{error}</div>}

      {lessons === null ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("common.loading")}</div>
      ) : lessons.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-md)", padding: 20, textAlign: "center" }}>{t("tatt.noLessons")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 460, overflowY: "auto" }}>
          {lessons.map((l) => {
            const k = keyOf(l);
            const d = drafts[k] ?? { status: null, substituteTeacherId: "", note: "" };
            const markable = !!l.teacherId && !l.cancelled;
            return (
              <div key={k} role="group" aria-label={`${l.groupName} ${l.startTime}–${l.endTime}`} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 12, opacity: l.cancelled ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, color: ACCENT, minWidth: 92 }}>{l.startTime}–{l.endTime}</span>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{l.groupName}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{l.teacherName ?? t("tatt.noTeacher")}</div>
                    {l.cancelled && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>{t("tatt.cancelled")}</div>}
                    {l.dayStatus && !d.status && (
                      <div style={{ fontSize: 12, color: "var(--warning)" }}>{t("tatt.dayMark").replace("{status}", t(STATES.find((s) => s.key === l.dayStatus)!.label))}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {STATES.map((s) => {
                      const on = d.status === s.key;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          disabled={!markable}
                          aria-pressed={on}
                          onClick={() => update(k, { status: s.key })}
                          style={{ fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: "var(--radius-xs)", cursor: markable ? "pointer" : "not-allowed", border: `1px solid ${on ? s.color : "var(--border)"}`, background: on ? s.color : "var(--on-ink)", color: on ? "var(--on-ink)" : "var(--text-soft)" }}
                        >
                          {t(s.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {d.status === "ABSENT" && markable && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginTop: 10 }}>
                    <Select
                      value={d.substituteTeacherId}
                      onChange={(v) => update(k, { substituteTeacherId: v })}
                      options={[{ value: "", label: t("tatt.noSubstitute") }, ...teachers.filter((x) => x.id !== l.teacherId).map((x) => ({ value: x.id, label: x.fullName }))]}
                    />
                    <input className="field-input" value={d.note} onChange={(e) => update(k, { note: e.target.value })} placeholder={t("tatt.notePh")} maxLength={300} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lessons && lessons.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
          {saved && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--success)" }}>✓ {t("common.saved")}</span>}
          <button type="button" onClick={save} disabled={saving} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: "var(--radius-sm)", cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </Modal>
  );
}

const ghost: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: "var(--radius-xs)", cursor: "pointer" };
