"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import LoadError from "@/components/LoadError";
import RoomsManager from "@/components/schedule/RoomsManager";
import QuickAddLesson, { type QuickAddPrefill } from "@/components/schedule/QuickAddLesson";
import MoveLessonDialog from "@/components/schedule/MoveLessonDialog";
import Select from "@/components/Select";
import TimePicker from "@/components/TimePicker";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";
import { addDays } from "@/lib/makeups";
import {
  ApiError,
  scheduleApi,
  groupsApi,
  teachersApi,
  branchesApi,
  ScheduleItem,
  Room,
  ScheduleConflict,
  Group,
  Teacher,
  Branch,
  makeupsApi,
  type MakeupRosterItem,
} from "@/lib/api";

const ACCENT = "#4F46E5";
const MOVE_DAYS = [1, 2, 3, 4, 5, 6, 7];

const DAYS_OF_WEEK = [
  { day: 1, labelKey: "schedule.days.mon" as const, shortKey: "weekday.short.monday" as const },
  { day: 2, labelKey: "schedule.days.tue" as const, shortKey: "weekday.short.tuesday" as const },
  { day: 3, labelKey: "schedule.days.wed" as const, shortKey: "weekday.short.wednesday" as const },
  { day: 4, labelKey: "schedule.days.thu" as const, shortKey: "weekday.short.thursday" as const },
  { day: 5, labelKey: "schedule.days.fri" as const, shortKey: "weekday.short.friday" as const },
  { day: 6, labelKey: "schedule.days.sat" as const, shortKey: "weekday.short.saturday" as const },
  { day: 7, labelKey: "schedule.days.sun" as const, shortKey: "weekday.short.sunday" as const },
];

export default function SchedulePage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const clock = useCenterClock();

  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterGroup, setFilterGroup] = useState("");
  const [filterTeacher, setFilterTeacher] = useState("");
  const [filterRoom, setFilterRoom] = useState("");
  const [filterBranch, setFilterBranch] = useState("");

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRoomsModal, setShowRoomsModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null);

  // Lesson Form state
  const [groupId, setGroupId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:30");
  const [topic, setTopic] = useState("");
  const [onlineMeetingUrl, setOnlineMeetingUrl] = useState("");
  const [allowCollision, setAllowCollision] = useState(false);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [checkingConflict, setCheckingConflict] = useState(false);
  // The check could not be made: saving waits for a successful one.
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictRetry, setConflictRetry] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // The "+" of a day opens a small form beside that day.
  const [quickAdd, setQuickAdd] = useState<{ day: number; anchor: DOMRect } | null>(null);
  // A lesson is moved to another day by dragging its card there; the move
  // happens only when the room, the teacher, the group and its students are
  // all free at that time.
  const canEdit = can(user, "schedule.edit");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveBlocked, setMoveBlocked] = useState<{ item: ScheduleItem; day: number; conflicts: ScheduleConflict[] } | null>(null);
  // The same move from a button on the card: a touch screen and a keyboard
  // have no drag.
  const [moveItem, setMoveItem] = useState<ScheduleItem | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Room Form state

  // Today's day of week (1=Monday ... 7=Sunday), on the center's clock.
  const currentDayOfWeek = useMemo(() => clock.weekday(), [clock]);

  function loadData() {
    setLoading(true);
    Promise.all([
      scheduleApi.list(),
      scheduleApi.listRooms(),
      groupsApi.list(),
      teachersApi.list(),
      branchesApi.list(),
    ])
      .then(([sList, rList, gList, tList, bList]) => {
        setSchedules(sList);
        setRooms(rList);
        setGroups(gList);
        setTeachers(tList);
        setBranches(bList);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : ""))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  // This week's make-up lessons (dated, on the center's clock) beside the
  // weekly timetable, for whoever runs or teaches them.
  const [weekMakeups, setWeekMakeups] = useState<MakeupRosterItem[]>([]);
  const seesMakeups = can(user, "makeups.attend");
  useEffect(() => {
    if (!seesMakeups) return;
    const monday = addDays(clock.today(), 1 - clock.weekday());
    let current = true;
    makeupsApi
      .roster(monday, addDays(monday, 6))
      .then((list) => current && setWeekMakeups(list.filter((m) => m.status !== "CANCELLED")))
      .catch(() => current && setWeekMakeups([]));
    return () => {
      current = false;
    };
  }, [seesMakeups, clock]);

  // Live conflict check when form inputs change. Only the answer for the
  // current inputs counts: an older, slower answer is dropped, so the
  // warning (and the save button) never reflect inputs already changed.
  useEffect(() => {
    if (!showAddModal || !groupId || !startTime || !endTime) {
      setConflicts([]);
      setConflictError(null);
      return;
    }

    let current = true;
    const timer = setTimeout(() => {
      setCheckingConflict(true);
      scheduleApi
        .checkConflicts({
          groupId,
          teacherId: teacherId || undefined,
          roomId: roomId || undefined,
          dayOfWeek,
          startTime,
          endTime,
          excludeScheduleId: editingItem?.id,
        })
        .then((res) => {
          if (!current) return;
          setConflicts(res.conflicts);
          setConflictError(null);
        })
        .catch((err) => {
          if (!current) return;
          setConflicts([]);
          setConflictError(err instanceof ApiError ? err.message : t("sch.conflictCheckError"));
        })
        .finally(() => {
          if (current) setCheckingConflict(false);
        });
    }, 250);

    return () => {
      current = false;
      clearTimeout(timer);
      setCheckingConflict(false);
    };
  }, [showAddModal, groupId, teacherId, roomId, dayOfWeek, startTime, endTime, editingItem, conflictRetry, t]);

  const dayLabel = (d: number) => t(DAYS_OF_WEEK[d - 1].labelKey);

  async function moveLesson(item: ScheduleItem, day: number, isUndo = false) {
    const from = item.dayOfWeek ?? 1;
    if (from === day) return;
    setMovingId(item.id);
    try {
      const check = await scheduleApi.checkConflicts({
        groupId: item.groupId,
        teacherId: item.teacherId || undefined,
        roomId: item.roomId || undefined,
        dayOfWeek: day,
        startTime: item.startTime,
        endTime: item.endTime,
        excludeScheduleId: item.id,
      });
      if (check.conflicts.length > 0) {
        setMoveBlocked({ item, day, conflicts: check.conflicts });
        return;
      }
      await scheduleApi.update(item.id, { dayOfWeek: day });
      setSchedules((prev) => prev.map((s) => (s.id === item.id ? { ...s, dayOfWeek: day } : s)));
      setNotice({
        text: `${item.group?.name ?? t("schedule.group")} (${item.startTime}–${item.endTime}): ${dayLabel(from)} → ${dayLabel(day)}`,
        undo: isUndo ? undefined : () => moveLesson({ ...item, dayOfWeek: day }, from, true),
      });
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : t("msg.saveError"), error: true });
    } finally {
      setMovingId(null);
    }
  }

  function openCreateModal(defaultDay?: number, prefill?: QuickAddPrefill) {
    setEditingItem(null);
    const firstGroup = groups.find((g) => g.id === prefill?.groupId) ?? groups[0];
    setGroupId(firstGroup?.id || "");
    setTeacherId(prefill ? prefill.teacherId : firstGroup?.teacherId || teachers[0]?.id || "");
    setRoomId(prefill ? prefill.roomId : rooms[0]?.id || "");
    setBranchId(firstGroup?.branchId || branches[0]?.id || "");
    setDayOfWeek(defaultDay ?? 1);
    setStartTime(prefill?.startTime ?? "09:00");
    setEndTime(prefill?.endTime ?? "10:30");
    setTopic("");
    setOnlineMeetingUrl("");
    setAllowCollision(false);
    setConflicts([]);
    setFormError("");
    setShowAddModal(true);
  }

  function openEditModal(item: ScheduleItem) {
    setEditingItem(item);
    setGroupId(item.groupId);
    setTeacherId(item.teacherId || "");
    setRoomId(item.roomId || "");
    setBranchId(item.branchId || "");
    setDayOfWeek(item.dayOfWeek || 1);
    setStartTime(item.startTime);
    setEndTime(item.endTime);
    setTopic(item.topic || "");
    setOnlineMeetingUrl(item.onlineMeetingUrl || "");
    setAllowCollision(false);
    setConflicts([]);
    setFormError("");
    setShowAddModal(true);
  }

  function handleGroupSelect(val: string) {
    setGroupId(val);
    const grp = groups.find((g) => g.id === val);
    if (grp?.teacherId) setTeacherId(grp.teacherId);
    if (grp?.branchId) setBranchId(grp.branchId);
  }

  async function handleSaveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) {
      setFormError(t("msg.selectGroup"));
      return;
    }
    if (!startTime || !endTime) {
      setFormError(t("sch.enterTimes"));
      return;
    }
    if (startTime >= endTime) {
      setFormError(t("sch.endAfterStart"));
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      const payload = {
        groupId,
        teacherId: teacherId || undefined,
        roomId: roomId || undefined,
        branchId: branchId || undefined,
        dayOfWeek,
        startTime,
        endTime,
        topic: topic || undefined,
        onlineMeetingUrl: onlineMeetingUrl || undefined,
        allowCollision,
      };

      if (editingItem) {
        await scheduleApi.update(editingItem.id, payload);
      } else {
        await scheduleApi.create(payload);
      }

      setShowAddModal(false);
      loadData();
    } catch (err: unknown) {
      const apiErr = err as { message?: string; response?: { data?: { message?: string } } };
      setFormError(apiErr.response?.data?.message || apiErr.message || t("msg.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSchedule(id: string) {
    if (!confirm(t("schedule.deleteConfirm"))) return;
    try {
      await scheduleApi.remove(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error(err);
      alert(t("sch.deleteError"));
    }
  }

  const dragDay = dragId ? schedules.find((s) => s.id === dragId)?.dayOfWeek ?? 1 : null;

  // Filtered schedules
  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (filterGroup && s.groupId !== filterGroup) return false;
      if (filterTeacher && s.teacherId !== filterTeacher) return false;
      if (filterRoom && s.roomId !== filterRoom) return false;
      if (filterBranch && s.branchId !== filterBranch) return false;
      return true;
    });
  }, [schedules, filterGroup, filterTeacher, filterRoom, filterBranch]);

  // Group schedules by dayOfWeek (1..7)
  const schedulesByDay = useMemo(() => {
    const map: Record<number, ScheduleItem[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    filteredSchedules.forEach((item) => {
      const d = item.dayOfWeek ?? 1;
      if (!map[d]) map[d] = [];
      map[d].push(item);
    });
    // Sort each day by startTime
    Object.keys(map).forEach((k) => {
      map[Number(k)].sort((a, b) => a.startTime.localeCompare(b.startTime));
    });
    return map;
  }, [filteredSchedules]);

  const makeupsByDay = useMemo(() => {
    const map: Record<number, MakeupRosterItem[]> = {};
    for (const m of weekMakeups) {
      if (filterGroup && m.targetGroupId !== filterGroup) continue;
      if (filterTeacher && m.teacherId !== filterTeacher) continue;
      if (filterRoom && m.roomId !== filterRoom) continue;
      const d = new Date(`${m.date}T00:00:00Z`).getUTCDay() || 7;
      (map[d] ??= []).push(m);
    }
    Object.values(map).forEach((l) => l.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [weekMakeups, filterGroup, filterTeacher, filterRoom]);

  return (
    <DashboardShell>
      <div
        style={{
          padding: "24px 32px",
          width: "100%",
          maxWidth: 1600,
          margin: "0 auto",
          boxSizing: "border-box",
          minHeight: "calc(100vh - 60px)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827", margin: "0 0 6px" }}>{t("schedule.title")}</h1>
          <p style={{ color: "#6B7280", margin: 0, fontSize: 13.5 }}>{t("schedule.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {can(user, "rooms.manage") && (
            <button
              onClick={() => setShowRoomsModal(true)}
              className="btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 15px",
                background: "#F3F4F6",
                color: "#374151",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              {t("schedule.manageRooms")} ({rooms.length})
            </button>
          )}

          <button
            onClick={() => openCreateModal()}
            className="btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 18px",
              background: ACCENT,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(79,70,229,0.3)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("schedule.addLesson")}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 12,
          padding: "14px 18px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Select
          value={filterGroup}
          onChange={setFilterGroup}
          placeholder={t("schedule.filterGroup")}
          options={[{ value: "", label: t("schedule.filterGroup") }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
        />
        <Select
          value={filterTeacher}
          onChange={setFilterTeacher}
          placeholder={t("schedule.filterTeacher")}
          options={[{ value: "", label: t("schedule.filterTeacher") }, ...teachers.map((tc) => ({ value: tc.id, label: tc.fullName }))]}
        />
        <Select
          value={filterRoom}
          onChange={setFilterRoom}
          placeholder={t("schedule.filterRoom")}
          options={[{ value: "", label: t("schedule.filterRoom") }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]}
        />
        {branches.length > 0 && (
          <Select
            value={filterBranch}
            onChange={setFilterBranch}
            placeholder={t("schedule.filterBranch")}
            options={[{ value: "", label: t("schedule.filterBranch") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        )}
      </div>

      {canEdit && !loading && loadError === null && schedules.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#686B75", margin: "-10px 0 14px" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
          </svg>
          {t("sch.move.hint")}
        </div>
      )}

      {/* Weekly Timetable Grid (7 Days) */}
      {loadError !== null ? (
        <LoadError message={loadError || t("adm.loadError")} onRetry={loadData} />
      ) : loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#6B7280" }}>{t("common.loading")}</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(170px, 1fr))",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 24,
          }}
        >
          {DAYS_OF_WEEK.map(({ day, labelKey, shortKey }) => {
            const isToday = currentDayOfWeek === day;
            const dayLessons = schedulesByDay[day] || [];

            return (
              <div
                key={day}
                data-testid={`schedule-day-${day}`}
                onDragOver={(e) => {
                  if (!dragId || dragDay === day) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropDay !== day) setDropDay(day);
                }}
                onDragLeave={(e) => {
                  if (dropDay === day && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDropDay(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const item = schedules.find((s) => s.id === dragId);
                  setDragId(null);
                  setDropDay(null);
                  if (item) void moveLesson(item, day);
                }}
                style={{
                  transition: "background 0.12s ease",
                  background: dropDay === day ? "#EEF0FF" : isToday ? "#FAF5FF" : "#F9FAFB",
                  border: dropDay === day ? `2px dashed ${ACCENT}` : isToday ? "2px solid #A855F7" : "1px solid #E5E7EB",
                  borderRadius: 12,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 480,
                  overflow: "hidden",
                }}
              >
                {/* Day Header */}
                <div
                  style={{
                    padding: "12px 14px",
                    background: isToday ? "#7E22CE" : "#FFFFFF",
                    color: isToday ? "#fff" : "#111827",
                    borderBottom: isToday ? "none" : "1px solid #E5E7EB",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{t(labelKey)}</span>
                    <span style={{ fontSize: 11, opacity: 0.8 }}>({t(shortKey)})</span>
                  </div>
                  <button
                    onClick={(e) => setQuickAdd({ day, anchor: (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect() })}
                    aria-label={`${t(labelKey)}: ${t("schedule.addLesson")}`}
                    style={{
                      background: isToday ? "rgba(255,255,255,0.2)" : "#F3F4F6",
                      color: isToday ? "#fff" : "#4B5563",
                      border: "none",
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 700,
                    }}
                    title={t("schedule.addLesson")}
                  >
                    +
                  </button>
                </div>

                {/* Day Lessons List */}
                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {dayLessons.length === 0 && !makeupsByDay[day]?.length ? (
                    <div
                      style={{
                        margin: "auto",
                        textAlign: "center",
                        color: "#686B75",
                        fontSize: 12,
                        padding: "20px 8px",
                      }}
                    >
                      {t("schedule.noLessons")}
                    </div>
                  ) : (
                    dayLessons.map((item) => {
                      const roomColorBadge = item.room?.color || ACCENT;
                      return (
                        <div
                          key={item.id}
                          data-testid="schedule-lesson"
                          draggable={canEdit && movingId === null}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", item.id);
                            setDragId(item.id);
                          }}
                          onDragEnd={() => { setDragId(null); setDropDay(null); }}
                          title={canEdit ? t("sch.move.cardTitle") : undefined}
                          style={{
                            cursor: canEdit ? (dragId === item.id ? "grabbing" : "grab") : "default",
                            opacity: dragId === item.id || movingId === item.id ? 0.45 : 1,
                            background: "#FFFFFF",
                            border: "1px solid #E5E7EB",
                            borderRadius: 10,
                            padding: "10px 12px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            position: "relative",
                            borderLeft: `4px solid ${roomColorBadge}`,
                          }}
                        >
                          {/* Time & Menu */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                color: "#4F46E5",
                                background: "#EEF2FF",
                                padding: "2px 6px",
                                borderRadius: 4,
                              }}
                            >
                              {item.startTime} - {item.endTime}
                            </span>
                            <div style={{ display: "flex", gap: 4 }}>
                              {canEdit && (
                                <button
                                  type="button"
                                  data-testid="schedule-move"
                                  className="sched-act"
                                  onClick={() => setMoveItem(item)}
                                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "#686B75", padding: 2 }}
                                  title={t("sch.move.button")}
                                  aria-label={`${t("sch.move.button")}: ${item.group?.name ?? ""} ${item.startTime}`}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M7 4 3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7" />
                                  </svg>
                                </button>
                              )}
                              <button
                                className="sched-act"
                                onClick={() => openEditModal(item)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  color: "#686B75",
                                  padding: 2,
                                }}
                                title={t("common.edit")}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                </svg>
                              </button>
                              {can(user, "schedule.delete") && (
                                <button
                                  className="sched-act"
                                  onClick={() => handleDeleteSchedule(item.id)}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    color: "#EF4444",
                                    padding: 2,
                                  }}
                                  title={t("common.delete")}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Group Name */}
                          <div style={{ fontWeight: 700, fontSize: 13.5, color: "#111827" }}>
                            {item.group?.name || "Guruh"}
                          </div>

                          {/* Room & Teacher */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "#6B7280" }}>
                            {item.room && (
                              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: roomColorBadge,
                                  }}
                                />
                                <span style={{ fontWeight: 600, color: "#374151" }}>{item.room.name}</span>
                              </div>
                            )}

                            {item.teacher && (
                              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="7" r="4" /><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                                </svg>
                                <span>{item.teacher.fullName}</span>
                              </div>
                            )}
                          </div>

                          {/* Topic or Meeting link */}
                          {item.topic && (
                            <div style={{ fontSize: 11, color: "#4B5563", background: "#F3F4F6", padding: "3px 6px", borderRadius: 4 }}>
                              📌 {item.topic}
                            </div>
                          )}

                          {item.onlineMeetingUrl && (
                            <a
                              href={item.onlineMeetingUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: 11,
                                color: "#2563EB",
                                textDecoration: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 2,
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" />
                              </svg>
                              {t("sch.joinOnline")}
                            </a>
                          )}
                        </div>
                      );
                    })
                  )}
                  {dragId && dragDay !== day && (
                    <div style={{ border: `1.5px dashed ${dropDay === day ? ACCENT : "#C9C6F5"}`, borderRadius: 10, padding: "12px 8px", textAlign: "center", fontSize: 12, fontWeight: 700, color: ACCENT, background: dropDay === day ? "#fff" : "transparent", pointerEvents: "none" }}>
                      {t("sch.move.dropHere")}
                    </div>
                  )}
                  {(makeupsByDay[day] ?? []).length > 0 && (
                    <div aria-label={t("schedule.makeupsThisWeek")} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#686B75", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {t("schedule.makeupsThisWeek")}
                      </div>
                      {makeupsByDay[day].map((m) => (
                        <div
                          key={m.id}
                          data-testid="schedule-makeup"
                          style={{ background: "#FFFFFF", border: "1px dashed #8B84E8", borderRadius: 10, padding: "8px 10px", fontSize: 12, color: "#181A1F" }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            {m.startTime}–{m.endTime} · {t("schedule.makeupBadge")}
                          </div>
                          <div>{m.student.fullName}</div>
                          <div style={{ color: "#686B75" }}>
                            {m.date}
                            {m.groupName ? ` · ${m.groupName}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {quickAdd && (
        <QuickAddLesson
          key={quickAdd.day}
          day={quickAdd.day}
          dayLabel={dayLabel(quickAdd.day)}
          anchor={quickAdd.anchor}
          groups={groups}
          teachers={teachers}
          rooms={rooms}
          dayLessons={schedules.filter((s) => (s.dayOfWeek ?? 1) === quickAdd.day)}
          onClose={() => setQuickAdd(null)}
          onSaved={(label) => {
            setQuickAdd(null);
            setNotice({ text: `${label}: ${t("sch.quick.added")}` });
            loadData();
          }}
          onMore={(prefill) => {
            const day = quickAdd.day;
            setQuickAdd(null);
            openCreateModal(day, prefill);
          }}
        />
      )}

      {moveItem && (
        <MoveLessonDialog
          item={moveItem}
          days={MOVE_DAYS.map((day) => ({ day, label: dayLabel(day) }))}
          onClose={() => setMoveItem(null)}
          onPick={(day) => {
            const item = moveItem;
            setMoveItem(null);
            void moveLesson(item, day);
          }}
        />
      )}

      {/* A move that would clash: what is in the way, and the way out. */}
      {moveBlocked && (
        <div className="modal-backdrop" onClick={() => setMoveBlocked(null)}>
          <div className="modal-content" role="alertdialog" aria-labelledby="move-blocked-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2 id="move-blocked-title" style={{ fontSize: 17, fontWeight: 800, margin: "0 0 6px" }}>{t("sch.move.blockedTitle")}</h2>
            <p style={{ fontSize: 13, color: "#686B75", margin: "0 0 14px", lineHeight: 1.55 }}>
              <b style={{ color: "#181A1F" }}>{moveBlocked.item.group?.name}</b> · {moveBlocked.item.startTime}–{moveBlocked.item.endTime} → <b style={{ color: "#181A1F" }}>{dayLabel(moveBlocked.day)}</b>. {t("sch.move.blockedText")}
            </p>
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {moveBlocked.conflicts.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#FEF2F2", border: "1px solid #F5B5B5", borderRadius: 10, padding: "9px 12px" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#B91C1C", borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap", marginTop: 1 }}>{t(`sch.move.type.${c.type}`)}</span>
                  <span style={{ fontSize: 12.5, color: "#7F1D1D", lineHeight: 1.5 }}>{c.message}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setMoveBlocked(null)} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("common.cancel")}</button>
              <button
                type="button"
                onClick={() => {
                  const { item, day } = moveBlocked;
                  setMoveBlocked(null);
                  openEditModal({ ...item, dayOfWeek: day });
                }}
                style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {t("sch.move.pickTime")}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 70, background: notice.error ? "#B91C1C" : "#181A1F", color: "#fff", borderRadius: 12, padding: "11px 16px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 14, boxShadow: "0 12px 34px rgba(18,19,26,0.3)", maxWidth: "calc(100vw - 32px)" }}>
          <span>{notice.error ? "" : "✓ "}{notice.text}</span>
          {notice.undo && (
            <button type="button" onClick={() => { const undo = notice.undo!; setNotice(null); undo(); }} style={{ background: "rgba(255,255,255,0.16)", color: "#fff", border: "none", borderRadius: 8, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {t("sch.move.undo")}
            </button>
          )}
        </div>
      )}

      {/* Add / Edit Lesson Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
                {editingItem ? t("schedule.editLesson") : t("schedule.addLesson")}
              </h2>
              <button onClick={() => setShowAddModal(false)} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer" }}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Group */}
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                  {t("schedule.group")} *
                </label>
                <Select
                  value={groupId}
                  onChange={handleGroupSelect}
                  placeholder={t("common.select")}
                  options={groups.map((g) => ({ value: g.id, label: `${g.name} (${g.subject})` }))}
                />
              </div>

              {/* Teacher & Room in 2 columns */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                    {t("schedule.teacher")}
                  </label>
                  <Select
                    value={teacherId}
                    onChange={setTeacherId}
                    placeholder={t("common.notSelected")}
                    options={[{ value: "", label: t("common.notSelected") }, ...teachers.map((tc) => ({ value: tc.id, label: tc.fullName }))]}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                    {t("schedule.room")}
                  </label>
                  <Select
                    value={roomId}
                    onChange={setRoomId}
                    placeholder={t("common.notSelected")}
                    options={[{ value: "", label: t("common.notSelected") }, ...rooms.map((r) => ({ value: r.id, label: `${r.name} (${r.capacity} kishi)` }))]}
                  />
                </div>
              </div>

              {/* Day of Week */}
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                  {t("schedule.dayOfWeek")} *
                </label>
                <div style={{ display: "flex", gap: 4 }}>
                  {DAYS_OF_WEEK.map(({ day, shortKey }) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setDayOfWeek(day)}
                      style={{
                        flex: 1,
                        padding: "8px 0",
                        fontSize: 12,
                        fontWeight: 700,
                        borderRadius: 6,
                        border: dayOfWeek === day ? "none" : "1px solid #E5E7EB",
                        background: dayOfWeek === day ? ACCENT : "#F9FAFB",
                        color: dayOfWeek === day ? "#fff" : "#4B5563",
                        cursor: "pointer",
                      }}
                    >
                      {t(shortKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time inputs */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                    {t("schedule.startTime")} *
                  </label>
                  <TimePicker value={startTime} onChange={setStartTime} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                    {t("schedule.endTime")} *
                  </label>
                  <TimePicker value={endTime} onChange={setEndTime} />
                </div>
              </div>

              {/* Topic & Online Link */}
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                  {t("schedule.topic")}
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t("sch.topicPh")}
                  className="field-input"
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                  {t("schedule.onlineLink")}
                </label>
                <input
                  type="url"
                  value={onlineMeetingUrl}
                  onChange={(e) => setOnlineMeetingUrl(e.target.value)}
                  placeholder={t("sch.linkPh")}
                  className="field-input"
                  style={{ width: "100%" }}
                />
              </div>

              {conflictError && (
                <LoadError compact message={conflictError} onRetry={() => setConflictRetry((n) => n + 1)} />
              )}

              {/* Collision Alert Warning Box */}
              {conflicts.length > 0 && (
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1px solid #F87171",
                    borderRadius: 8,
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#DC2626", fontWeight: 700, fontSize: 13 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {t("schedule.conflictWarning")}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#991B1B" }}>
                    {conflicts.map((c, idx) => (
                      <div key={idx}>• {c.message}</div>
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#7F1D1D", fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={allowCollision}
                      onChange={(e) => setAllowCollision(e.target.checked)}
                    />
                    {t("schedule.allowConflictConfirm")}
                  </label>
                </div>
              )}

              {formError && (
                <div role="alert" style={{ color: "#DC2626", fontSize: 13, fontWeight: 600, background: "#FEE2E2", padding: "8px 12px", borderRadius: 6 }}>
                  {formError}
                </div>
              )}

              {/* Submit Buttons */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn"
                  style={{ padding: "8px 16px", background: "#F3F4F6", color: "#4B5563", border: "none", borderRadius: 8 }}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving || checkingConflict || !!conflictError || (conflicts.length > 0 && !allowCollision)}
                  className="btn"
                  style={{
                    padding: "8px 20px",
                    background: conflicts.length > 0 && !allowCollision ? "#9CA3AF" : ACCENT,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: conflicts.length > 0 && !allowCollision ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRoomsModal && (
        <RoomsManager
          rooms={rooms}
          branches={branches}
          lessonsPerRoom={schedules.reduce<Record<string, number>>((acc, l) => {
            if (l.roomId) acc[l.roomId] = (acc[l.roomId] ?? 0) + 1;
            return acc;
          }, {})}
          onChange={setRooms}
          onClose={() => setShowRoomsModal(false)}
        />
      )}
      </div>
    </DashboardShell>
  );
}
