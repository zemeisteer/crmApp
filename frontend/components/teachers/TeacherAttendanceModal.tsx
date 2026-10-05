"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { ApiError, teacherAttendanceApi, type Teacher, type TeacherLesson, type TeacherMark } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";

const ACCENT = "#4F46E5";
const STATES: Array<{ key: TeacherMark; label: "ptl.present" | "ptl.late" | "ptl.absent"; color: string }> = [
  { key: "PRESENT", label: "ptl.present", color: "#1FA463" },
  { key: "LATE", label: "ptl.late", color: "#D97706" },
  { key: "ABSENT", label: "ptl.absent", color: "#B23A47" },
];

type Draft = { status: TeacherMark | null; substituteTeacherId: string; note: string };

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
        setDrafts(Object.fromEntries(rows.map((l) => [l.groupId, { status: l.status, substituteTeacherId: l.substituteTeacherId ?? "", note: l.note ?? "" }])));
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : t("common.errorGeneric")));
    return () => {
      cancelled = true;
    };
  }, [date, t]);

  const update = (groupId: string, patch: Partial<Draft>) => {
    setSaved(false);
    setDrafts((d) => ({ ...d, [groupId]: { ...d[groupId], ...patch } }));
  };

  async function save() {
    const entries = Object.entries(drafts)
      .filter(([, d]) => d.status)
      .map(([groupId, d]) => ({ groupId, status: d.status as TeacherMark, substituteTeacherId: d.status === "ABSENT" && d.substituteTeacherId ? d.substituteTeacherId : null, note: d.note || null }));
    if (entries.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const rows = await teacherAttendanceApi.mark(date, entries);
      setLessons(rows);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  const allPresent = () => {
    setSaved(false);
    setDrafts((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.status ? v : { ...v, status: "PRESENT" as TeacherMark }])));
  };

  return (
    <Modal open onClose={onClose} title={`📋 ${t("tatt.title")}`} width={760}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <DatePicker value={date} onChange={setDate} style={{ width: 200 }} />
        {lessons && lessons.length > 0 && (
          <button type="button" onClick={allPresent} style={ghost}>✓ {t("tatt.allPresent")}</button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "#8A8D96", marginBottom: 12 }}>{t("tatt.hint")}</div>
      {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 10 }}>{error}</div>}

      {lessons === null ? (
        <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("common.loading")}</div>
      ) : lessons.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8A8D96", border: "1px dashed #EAE8E2", borderRadius: 12, padding: 20, textAlign: "center" }}>{t("tatt.noLessons")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 460, overflowY: "auto" }}>
          {lessons.map((l) => {
            const d = drafts[l.groupId] ?? { status: null, substituteTeacherId: "", note: "" };
            return (
              <div key={l.groupId} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, color: ACCENT, minWidth: 92 }}>{l.startTime}–{l.endTime}</span>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{l.groupName}</div>
                    <div style={{ fontSize: 12, color: "#8A8D96" }}>{l.teacherName ?? t("tatt.noTeacher")}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {STATES.map((s) => {
                      const on = d.status === s.key;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          disabled={!l.teacherId}
                          onClick={() => update(l.groupId, { status: s.key })}
                          style={{ fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8, cursor: l.teacherId ? "pointer" : "not-allowed", border: `1px solid ${on ? s.color : "#EAE8E2"}`, background: on ? s.color : "#fff", color: on ? "#fff" : "#4A4E58" }}
                        >
                          {t(s.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {d.status === "ABSENT" && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginTop: 10 }}>
                    <Select
                      value={d.substituteTeacherId}
                      onChange={(v) => update(l.groupId, { substituteTeacherId: v })}
                      options={[{ value: "", label: t("tatt.noSubstitute") }, ...teachers.filter((x) => x.id !== l.teacherId).map((x) => ({ value: x.id, label: x.fullName }))]}
                    />
                    <input className="field-input" value={d.note} onChange={(e) => update(l.groupId, { note: e.target.value })} placeholder={t("tatt.notePh")} maxLength={300} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lessons && lessons.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
          {saved && <span style={{ fontSize: 13, fontWeight: 700, color: "#1FA463" }}>✓ {t("common.saved")}</span>}
          <button type="button" onClick={save} disabled={saving} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9, cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </Modal>
  );
}

const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8, cursor: "pointer" };
