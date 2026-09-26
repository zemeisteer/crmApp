"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Select from "@/components/Select";
import TimePicker from "@/components/TimePicker";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import {
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
} from "@/lib/api";

const ACCENT = "#4F46E5";

const DAYS_OF_WEEK = [
  { day: 1, labelKey: "schedule.days.mon" as const, short: "Du" },
  { day: 2, labelKey: "schedule.days.tue" as const, short: "Se" },
  { day: 3, labelKey: "schedule.days.wed" as const, short: "Cho" },
  { day: 4, labelKey: "schedule.days.thu" as const, short: "Pay" },
  { day: 5, labelKey: "schedule.days.fri" as const, short: "Jum" },
  { day: 6, labelKey: "schedule.days.sat" as const, short: "Sha" },
  { day: 7, labelKey: "schedule.days.sun" as const, short: "Yak" },
];

export default function SchedulePage() {
  const { user } = useAuth();
  const { t } = useLanguage();

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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Room Form state
  const [roomName, setRoomName] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("20");
  const [roomColor, setRoomColor] = useState("#4F46E5");
  const [roomBranchId, setRoomBranchId] = useState("");
  const [savingRoom, setSavingRoom] = useState(false);

  // Today's day of week (1=Monday ... 7=Sunday)
  const currentDayOfWeek = useMemo(() => {
    const jsDay = new Date().getDay();
    return jsDay === 0 ? 7 : jsDay;
  }, []);

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
      })
      .catch((err) => console.error("Error loading schedule:", err))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  // Live conflict check when form inputs change
  useEffect(() => {
    if (!showAddModal || !groupId || !startTime || !endTime) {
      setConflicts([]);
      return;
    }

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
          setConflicts(res.conflicts);
        })
        .catch(() => undefined)
        .finally(() => setCheckingConflict(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [showAddModal, groupId, teacherId, roomId, dayOfWeek, startTime, endTime, editingItem]);

  function openCreateModal(defaultDay?: number) {
    setEditingItem(null);
    setGroupId(groups[0]?.id || "");
    const firstGroup = groups[0];
    setTeacherId(firstGroup?.teacherId || teachers[0]?.id || "");
    setRoomId(rooms[0]?.id || "");
    setBranchId(firstGroup?.branchId || branches[0]?.id || "");
    setDayOfWeek(defaultDay ?? 1);
    setStartTime("09:00");
    setEndTime("10:30");
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
      setFormError("Guruhni tanlang");
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
      setFormError(apiErr.response?.data?.message || apiErr.message || "Saqlashda xatolik yuz berdi");
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

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!roomName.trim()) return;
    setSavingRoom(true);
    try {
      const created = await scheduleApi.createRoom({
        name: roomName.trim(),
        capacity: parseInt(roomCapacity, 10) || 20,
        color: roomColor,
        branchId: roomBranchId || undefined,
      });
      setRooms((prev) => [...prev, created]);
      setRoomName("");
      setRoomCapacity("20");
    } catch (err) {
      console.error(err);
      alert("Xonani saqlashda xatolik yuz berdi");
    } finally {
      setSavingRoom(false);
    }
  }

  async function handleDeleteRoom(id: string) {
    if (!confirm(t("sch.confirmDeleteRoom"))) return;
    try {
      await scheduleApi.deleteRoom(id);
      setRooms((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error(err);
      alert(t("sch.deleteRoomError"));
    }
  }

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
          {user?.role === "ADMIN" && (
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

      {/* Weekly Timetable Grid (7 Days) */}
      {loading ? (
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
          {DAYS_OF_WEEK.map(({ day, labelKey, short }) => {
            const isToday = currentDayOfWeek === day;
            const dayLessons = schedulesByDay[day] || [];

            return (
              <div
                key={day}
                style={{
                  background: isToday ? "#FAF5FF" : "#F9FAFB",
                  border: isToday ? "2px solid #A855F7" : "1px solid #E5E7EB",
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
                    background: isToday ? "#9333EA" : "#FFFFFF",
                    color: isToday ? "#fff" : "#111827",
                    borderBottom: isToday ? "none" : "1px solid #E5E7EB",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{t(labelKey)}</span>
                    <span style={{ fontSize: 11, opacity: 0.8 }}>({short})</span>
                  </div>
                  <button
                    onClick={() => openCreateModal(day)}
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
                  {dayLessons.length === 0 ? (
                    <div
                      style={{
                        margin: "auto",
                        textAlign: "center",
                        color: "#9CA3AF",
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
                          style={{
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
                              <button
                                onClick={() => openEditModal(item)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  color: "#9CA3AF",
                                  padding: 2,
                                }}
                                title={t("common.edit")}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                </svg>
                              </button>
                              {user?.role === "ADMIN" && (
                                <button
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
                </div>
              </div>
            );
          })}
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
                  {DAYS_OF_WEEK.map(({ day, short }) => (
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
                      {short}
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
                <div style={{ color: "#DC2626", fontSize: 13, fontWeight: 600, background: "#FEE2E2", padding: "8px 12px", borderRadius: 6 }}>
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
                  disabled={saving || checkingConflict || (conflicts.length > 0 && !allowCollision)}
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

      {/* Manage Rooms Modal */}
      {showRoomsModal && (
        <div className="modal-backdrop" onClick={() => setShowRoomsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{t("schedule.manageRooms")}</h2>
              <button onClick={() => setShowRoomsModal(false)} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer" }}>
                ✕
              </button>
            </div>

            {/* Create Room Form */}
            <form onSubmit={handleCreateRoom} style={{ background: "#F9FAFB", padding: 14, borderRadius: 8, marginBottom: 18, border: "1px solid #E5E7EB" }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "#374151" }}>{t("sch.newRoom")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "#6B7280", marginBottom: 3 }}>{t("schedule.roomName")}</label>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder={t("sch.roomPh")}
                    className="field-input"
                    style={{ width: "100%", padding: "6px 10px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "#6B7280", marginBottom: 3 }}>{t("schedule.roomCapacity")}</label>
                  <input
                    type="number"
                    value={roomCapacity}
                    onChange={(e) => setRoomCapacity(e.target.value)}
                    className="field-input"
                    style={{ width: "100%", padding: "6px 10px" }}
                    min="1"
                    max="200"
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11.5, color: "#6B7280", marginBottom: 3 }}>{t("schedule.roomColor")}</label>
                  <input
                    type="color"
                    value={roomColor}
                    onChange={(e) => setRoomColor(e.target.value)}
                    style={{ width: "100%", height: 35, padding: 2, borderRadius: 6, border: "1px solid #D1D5DB", cursor: "pointer" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingRoom || !roomName.trim()}
                  className="btn"
                  style={{
                    padding: "8px 16px",
                    background: ACCENT,
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                    height: 35,
                  }}
                >
                  +
                </button>
              </div>
            </form>

            {/* Rooms List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
              {rooms.length === 0 ? (
                <div style={{ textAlign: "center", color: "#9CA3AF", padding: 20 }}>{t("sch.noRooms")}</div>
              ) : (
                rooms.map((room) => (
                  <div
                    key={room.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      background: "#fff",
                      border: "1px solid #E5E7EB",
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 14, height: 14, borderRadius: 4, background: room.color }} />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: "#111827" }}>{room.name}</div>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>Sig'imi: {room.capacity} ta o'quvchi</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteRoom(room.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#EF4444",
                        cursor: "pointer",
                        padding: 6,
                      }}
                      title={t("common.delete")}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </DashboardShell>
  );
}
