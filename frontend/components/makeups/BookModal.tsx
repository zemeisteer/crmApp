"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
import { groupsApi, lessonsApi, makeupsApi, scheduleApi, teachersApi, type Group, type LessonOccurrence, type MakeupCredit, type MakeupMode, type Room, type Teacher } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";
import { addDays, validTimeRange } from "@/lib/makeups";
import { matchesSubject } from "@/lib/subject";
import { centerWallClock } from "@/lib/center-time";
import { ACCENT, Notice, dayLabel, errorText, lbl, primaryBtn } from "./shared";

// How far ahead the booking form offers a group's lessons (the server
// accepts up to 180 days; one request covers at most 120).
const LOOKAHEAD_DAYS = 90;
// Lessons are offered four weeks at a time ("show more" adds the next four).
const PAGE_DAYS = 28;
const WEEKDAY_KEYS = ["weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday", "weekday.short.thursday", "weekday.short.friday", "weekday.short.saturday", "weekday.short.sunday"] as const;

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
  // The direction of the missed lesson: groups of it are offered first.
  const [originSubject, setOriginSubject] = useState<string | null>(null);
  const [otherSubjects, setOtherSubjects] = useState(false);
  const [shownDays, setShownDays] = useState(PAGE_DAYS);
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
      .then((list) => {
        if (!alive) return;
        setOriginSubject(list.find((g) => g.id === credit.originGroupId)?.subject ?? null);
        setGroups(list.filter((g) => g.id !== credit.originGroupId && g.status !== "COMPLETED" && g.status !== "ARCHIVED"));
      })
      .catch(() => alive && setGroupsError(true));
    return () => {
      alive = false;
    };
  }, [credit.originGroupId]);

  useEffect(() => {
    if (mode !== "SESSION" || teachers) return;
    let alive = true;
    // Both lists land together: setting the teachers runs this effect again,
    // and a room list still on its way then would be dropped.
    Promise.all([teachersApi.list().catch(() => [] as Teacher[]), scheduleApi.listRooms().catch(() => [] as Room[])]).then(([teacherList, roomList]) => {
      if (!alive) return;
      setRooms(roomList);
      setTeachers(teacherList);
    });
    return () => {
      alive = false;
    };
  }, [mode, teachers]);

  // The group whose lessons were asked for last: an answer for a group
  // picked before it (slower network) must not fill the list of this one.
  const lessonsFor = useRef("");

  function pickGroup(id: string) {
    lessonsFor.current = id;
    setGroupId(id);
    setLessonDate("");
    setLessons(null);
    setLessonsError(false);
    setShownDays(PAGE_DAYS);
    if (!id) return;
    lessonsApi
      .list(today, addDays(today, LOOKAHEAD_DAYS), id)
      .then((l) => lessonsFor.current === id && setLessons(l.filter((x) => !x.cancelled)))
      .catch(() => lessonsFor.current === id && setLessonsError(true));
  }

  // Every lesson is its own choice (a date may hold two): the booking is
  // bound to the one picked, by its date and start.
  // A lesson already begun today cannot be booked any more.
  const nowHm = (() => {
    const w = centerWallClock(new Date(), clock.tz);
    return w ? `${String(w.getHours()).padStart(2, "0")}:${String(w.getMinutes()).padStart(2, "0")}` : "00:00";
  })();
  const upcoming = (lessons ?? []).filter((l) => l.date > today || (l.date === today && l.startTime > nowHm));
  const until = addDays(today, shownDays);
  const lessonDates = upcoming.filter((l) => l.date < until);
  const moreLessons = upcoming.length > lessonDates.length;
  // The chosen group's week at a glance ("Du, Cho, Ju · 10:00–11:30").
  const pattern = (() => {
    const seen = new Map<string, Set<number>>();
    for (const l of upcoming) {
      const key = `${l.startTime}–${l.endTime}`;
      const wd = (new Date(`${l.date}T00:00:00Z`).getUTCDay() + 6) % 7;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(wd);
    }
    return [...seen].map(([time, days]) => `${[...days].sort().map((d) => t(WEEKDAY_KEYS[d])).join(", ")} · ${time}`).join("; ");
  })();

  // Groups of the missed lesson's direction first; the rest on request.
  const sameSubject = (groups ?? []).filter((g) => originSubject && matchesSubject(g.subject, originSubject));
  const groupChoices = otherSubjects || sameSubject.length === 0 ? groups ?? [] : sameSubject;
  const lessonKey = (l: LessonOccurrence) => `${l.date}|${l.startTime}|${l.scheduleId ?? ""}`;

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
    // The lesson may have begun while the form was open: the server refuses
    // it then too, this only says so before asking.
    const w = centerWallClock(new Date(), clock.tz);
    const now = w ? `${clock.today()}|${String(w.getHours()).padStart(2, "0")}:${String(w.getMinutes()).padStart(2, "0")}` : "";
    const [pickDate, pickStart] = mode === "GROUP_LESSON" ? lessonDate.split("|") : [date, startTime];
    if (now && `${pickDate}|${pickStart}` <= now) return setError(t("mk.lessonStarted"));
    setBusy(true);
    try {
      if (mode === "GROUP_LESSON") {
        const [pickedDate, pickedStart, pickedLesson] = lessonDate.split("|");
        await makeupsApi.book(credit.id, { mode, targetGroupId: groupId, date: pickedDate, startTime: pickedStart, scheduleId: pickedLesson || undefined, note: note.trim() || undefined });
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
                  options={groupChoices.map((g) => ({ value: g.id, label: [g.name, g.subject, g.teacher?.fullName].filter(Boolean).join(" · ") }))}
                  value={groupId}
                  onChange={pickGroup}
                />
              )}
              {groups !== null && originSubject && (
                <div style={{ fontSize: 12, color: "#686B75", marginTop: 6, lineHeight: 1.5 }}>
                  {sameSubject.length === 0
                    ? t("mk.noSameSubject").replace("{subject}", originSubject)
                    : otherSubjects
                      ? t("mk.allSubjectsShown")
                      : t("mk.sameSubjectShown").replace("{subject}", originSubject)}
                  {sameSubject.length > 0 && sameSubject.length < (groups ?? []).length && (
                    <button
                      type="button"
                      onClick={() => setOtherSubjects((v) => !v)}
                      style={{ marginLeft: 8, background: "none", border: "none", padding: 0, color: ACCENT, fontWeight: 600, cursor: "pointer", fontSize: 12 }}
                    >
                      {otherSubjects ? t("mk.onlySameSubject") : t("mk.showOtherSubjects")}
                    </button>
                  )}
                </div>
              )}
            </div>
            {groupId && (
              <div role="group" aria-label={t("mk.lessonDate")}>
                <span style={lbl}>{t("mk.lessonDate")}</span>
                {lessonsError ? (
                  <Notice tone="error">{t("mk.loadError")}</Notice>
                ) : lessons === null ? (
                  <div role="status" style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
                ) : upcoming.length === 0 ? (
                  <Notice tone="warn">{t("mk.noLessonsAhead").replace("{n}", String(LOOKAHEAD_DAYS))}</Notice>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "#686B75", marginBottom: 6 }}>
                      {t("mk.groupWeek")}: <b style={{ color: "#3A3D45" }}>{pattern}</b>
                    </div>
                    <Select
                      ariaLabel={t("mk.lessonDate")}
                      sheetOnPhone
                      sheetTitle={t("mk.lessonDate")}
                      placeholder={t("mk.chooseDate")}
                      options={lessonDates.map((l) => ({ value: lessonKey(l), label: `${dayLabel(l.date, lang, t)} · ${l.startTime}–${l.endTime}` }))}
                      value={lessonDate}
                      onChange={setLessonDate}
                    />
                    {moreLessons && (
                      <button
                        type="button"
                        onClick={() => setShownDays((d) => d + PAGE_DAYS)}
                        style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: ACCENT, fontWeight: 600, cursor: "pointer", fontSize: 12 }}
                      >
                        {t("mk.moreWeeks")}
                      </button>
                    )}
                  </>
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
