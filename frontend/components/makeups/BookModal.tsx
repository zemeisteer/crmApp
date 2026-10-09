"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
import { groupsApi, lessonsApi, makeupsApi, scheduleApi, teachersApi, type Group, type LessonOccurrence, type MakeupCredit, type MakeupMode, type Room, type Teacher } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";
import { addDays, validTimeRange } from "@/lib/makeups";
import { ACCENT, Notice, dayLabel, errorText, lbl, primaryBtn } from "./shared";

// How far ahead the booking form offers a group's lessons (the server
// accepts up to 180 days; one request covers at most 120).
const LOOKAHEAD_DAYS = 90;

/**
 * Books a credit: a seat in another group's lesson (only dates on which that
 * group really has a lesson, not called off) or a dedicated session with a
 * teacher at a chosen time.
 */
export default function BookModal({ credit, onClose, onBooked }: { credit: MakeupCredit; onClose: () => void; onBooked: (msg: string) => void }) {
  const { t, lang } = useLanguage();
  const clock = useCenterClock();
  const today = clock.today();
  const [mode, setMode] = useState<MakeupMode>("GROUP_LESSON");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupsError, setGroupsError] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [lessons, setLessons] = useState<LessonOccurrence[] | null>(null);
  const [lessonsError, setLessonsError] = useState(false);
  const [lessonDate, setLessonDate] = useState("");
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    groupsApi
      .list()
      .then((list) => alive && setGroups(list.filter((g) => g.id !== credit.originGroupId && g.status !== "COMPLETED" && g.status !== "ARCHIVED")))
      .catch(() => alive && setGroupsError(true));
    return () => {
      alive = false;
    };
  }, [credit.originGroupId]);

  useEffect(() => {
    if (mode !== "SESSION" || teachers) return;
    let alive = true;
    teachersApi.list().then((l) => alive && setTeachers(l)).catch(() => alive && setTeachers([]));
    scheduleApi.listRooms().then((l) => alive && setRooms(l)).catch(() => alive && setRooms([]));
    return () => {
      alive = false;
    };
  }, [mode, teachers]);

  function pickGroup(id: string) {
    setGroupId(id);
    setLessonDate("");
    setLessons(null);
    setLessonsError(false);
    if (!id) return;
    lessonsApi
      .list(today, addDays(today, LOOKAHEAD_DAYS), id)
      .then((l) => setLessons(l.filter((x) => !x.cancelled)))
      .catch(() => setLessonsError(true));
  }

  // One date may hold a weekly lesson and a one-off: the server books the first.
  const lessonDates = [...new Map((lessons ?? []).map((l) => [l.date, l])).values()];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "GROUP_LESSON") {
      if (!groupId || !lessonDate) return setError(t("mk.pickGroupAndDate"));
    } else {
      if (!date) return setError(t("mk.pickDate"));
      if (!validTimeRange(startTime, endTime)) return setError(t("mk.badTime"));
      if (!teacherId) return setError(t("mk.pickTeacher"));
    }
    setBusy(true);
    try {
      if (mode === "GROUP_LESSON") {
        await makeupsApi.book(credit.id, { mode, targetGroupId: groupId, date: lessonDate, note: note.trim() || undefined });
      } else {
        await makeupsApi.book(credit.id, { mode, date, startTime, endTime, teacherId, roomId: roomId || undefined, note: note.trim() || undefined });
      }
      onBooked(t("mk.booked").replace("{name}", credit.student?.fullName ?? ""));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const modeBtn = (m: MakeupMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => { setMode(m); setError(null); }}
      style={{
        flex: 1, fontSize: 12.5, fontWeight: 700, padding: "8px 10px", borderRadius: 8, cursor: "pointer", border: "none",
        background: mode === m ? "#fff" : "transparent", color: mode === m ? "#181A1F" : "#686B75",
        boxShadow: mode === m ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
      }}
    >
      {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title={t("mk.bookTitle")} width={520}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <Notice tone="error">{error}</Notice>}
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px", fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700 }}>{credit.student?.fullName ?? "—"}</div>
          <div style={{ color: "#686B75" }}>{t("mk.missedOn")}: {credit.originGroup?.name ?? "—"} · {dayLabel(credit.originDate, lang, t)}</div>
        </div>

        <div role="group" aria-label={t("mk.bookMode")} style={{ display: "flex", gap: 2, background: "#F2F1EC", borderRadius: 10, padding: 4 }}>
          {modeBtn("GROUP_LESSON", t("mk.modeGroup"))}
          {modeBtn("SESSION", t("mk.modeSession"))}
        </div>

        {mode === "GROUP_LESSON" ? (
          <>
            <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t("mk.modeGroupHint")}</div>
            <div role="group" aria-label={t("mk.targetGroup")}>
              <span style={lbl}>{t("mk.targetGroup")}</span>
              {groupsError ? (
                <Notice tone="error">{t("mk.loadError")}</Notice>
              ) : (
                <Select
                  ariaLabel={t("mk.targetGroup")}
                  sheetOnPhone
                  sheetTitle={t("mk.targetGroup")}
                  placeholder={groups === null ? t("common.loading") : t("mk.chooseGroup")}
                  disabled={groups === null}
                  options={(groups ?? []).map((g) => ({ value: g.id, label: g.teacher?.fullName ? `${g.name} · ${g.teacher.fullName}` : g.name }))}
                  value={groupId}
                  onChange={pickGroup}
                />
              )}
            </div>
            {groupId && (
              <div role="group" aria-label={t("mk.lessonDate")}>
                <span style={lbl}>{t("mk.lessonDate")}</span>
                {lessonsError ? (
                  <Notice tone="error">{t("mk.loadError")}</Notice>
                ) : lessons === null ? (
                  <div role="status" style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
                ) : lessonDates.length === 0 ? (
                  <Notice tone="warn">{t("mk.noLessonsAhead").replace("{n}", String(LOOKAHEAD_DAYS))}</Notice>
                ) : (
                  <Select
                    ariaLabel={t("mk.lessonDate")}
                    sheetOnPhone
                    sheetTitle={t("mk.lessonDate")}
                    placeholder={t("mk.chooseDate")}
                    options={lessonDates.map((l) => ({ value: l.date, label: `${dayLabel(l.date, lang, t)} · ${l.startTime}–${l.endTime}` }))}
                    value={lessonDate}
                    onChange={setLessonDate}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t("mk.modeSessionHint")}</div>
            <div role="group" aria-label={t("mk.sessionDate")}>
              <span style={lbl}>{t("mk.sessionDate")}</span>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div role="group" aria-label={t("mk.startTime")}>
                <span style={lbl}>{t("mk.startTime")}</span>
                <TimePicker value={startTime} onChange={setStartTime} />
              </div>
              <div role="group" aria-label={t("mk.endTime")}>
                <span style={lbl}>{t("mk.endTime")}</span>
                <TimePicker value={endTime} onChange={setEndTime} />
              </div>
            </div>
            <div role="group" aria-label={t("mk.teacher")}>
              <span style={lbl}>{t("mk.teacher")}</span>
              <Select
                ariaLabel={t("mk.teacher")}
                sheetOnPhone
                sheetTitle={t("mk.teacher")}
                placeholder={teachers === null ? t("common.loading") : t("mk.chooseTeacher")}
                disabled={teachers === null}
                options={(teachers ?? []).map((x) => ({ value: x.id, label: x.fullName }))}
                value={teacherId}
                onChange={setTeacherId}
              />
            </div>
            <div role="group" aria-label={t("mk.roomOptional")}>
              <span style={lbl}>{t("mk.roomOptional")}</span>
              <Select
                ariaLabel={t("mk.roomOptional")}
                sheetOnPhone
                sheetTitle={t("mk.roomOptional")}
                options={[{ value: "", label: t("mk.noRoom") }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]}
                value={roomId}
                onChange={setRoomId}
              />
            </div>
          </>
        )}

        <label>
          <span style={lbl}>{t("mk.noteOptional")}</span>
          <textarea className="field-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }} />
        </label>
        <button type="submit" className="btn" disabled={busy} style={{ ...primaryBtn, background: ACCENT, fontSize: 14, padding: "11px 16px", borderRadius: 10 }}>
          {busy ? t("common.saving") : t("mk.bookConfirm")}
        </button>
      </form>
    </Modal>
  );
}
