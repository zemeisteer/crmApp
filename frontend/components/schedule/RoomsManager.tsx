"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import { ApiError, scheduleApi, type Branch, type Room } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";
const COLORS = ["#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#8B5CF6", "#64748B"];

// Rooms: add, edit and remove, with branch, capacity and a colour used on
// the timetable. Shows how many weekly lessons each room already has.
export default function RoomsManager({
  rooms,
  branches,
  lessonsPerRoom,
  onChange,
  onClose,
}: {
  rooms: Room[];
  branches: Branch[];
  lessonsPerRoom: Record<string, number>;
  onChange: (rooms: Room[]) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState<Room | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [branchId, setBranchId] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEditing(null);
    setName("");
    setCapacity("20");
    setBranchId("");
    setColor(COLORS[0]);
    setError(null);
  }

  function edit(room: Room) {
    setEditing(room);
    setName(room.name);
    setCapacity(String(room.capacity));
    setBranchId(room.branchId ?? "");
    setColor(room.color || COLORS[0]);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("rooms.nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const data = { name: name.trim(), capacity: Math.max(1, parseInt(capacity, 10) || 1), color, branchId: branchId || undefined };
    try {
      if (editing) {
        const updated = await scheduleApi.updateRoom(editing.id, data);
        onChange(rooms.map((r) => (r.id === editing.id ? { ...r, ...updated } : r)));
      } else {
        const created = await scheduleApi.createRoom(data);
        onChange([...rooms, created]);
      }
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(room: Room) {
    if (!window.confirm(t("sch.confirmDeleteRoom"))) return;
    try {
      await scheduleApi.deleteRoom(room.id);
      onChange(rooms.filter((r) => r.id !== room.id));
      if (editing?.id === room.id) reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sch.deleteRoomError"));
    }
  }

  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name;

  return (
    <Modal open onClose={onClose} title={`🚪 ${t("schedule.manageRooms")}`} width={640}>
      <form onSubmit={save} noValidate style={{ border: "1px solid #EAE8E2", borderRadius: 14, padding: 16, background: editing ? "#F7F6FF" : "#FAFAF8", marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{editing ? `✏️ ${t("rooms.editTitle")}` : `+ ${t("sch.newRoom")}`}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <div>
            <div style={lbl}>{t("schedule.roomName")} *</div>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sch.roomPh")} />
          </div>
          <div>
            <div style={lbl}>{t("schedule.roomCapacity")}</div>
            <input className="field-input" type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          {branches.length > 0 && (
            <div>
              <div style={lbl}>{t("groups.fieldBranch")}</div>
              <Select value={branchId} onChange={setBranchId} options={[{ value: "", label: t("groups.notSelected") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
            </div>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={lbl}>{t("schedule.roomColor")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                style={{ width: 28, height: 28, borderRadius: 8, background: c, cursor: "pointer", border: color === c ? "3px solid #181A1F" : "3px solid transparent", boxShadow: color === c ? "0 0 0 2px #fff inset" : "none" }}
              />
            ))}
          </div>
        </div>
        {error && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "#B91C1C" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          {editing && (
            <button type="button" className="btn" onClick={reset} style={ghost}>{t("common.cancel")}</button>
          )}
          <button type="submit" className="btn" disabled={saving} style={{ ...primary, opacity: saving ? 0.7 : 1 }}>
            {saving ? t("common.saving") : editing ? t("common.save") : t("rooms.add")}
          </button>
        </div>
      </form>

      {rooms.length === 0 ? (
        <div style={{ textAlign: "center", color: "#8A8D96", padding: 24, border: "1px dashed #EAE8E2", borderRadius: 12 }}>{t("sch.noRooms")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, maxHeight: 340, overflowY: "auto" }}>
          {rooms.map((room) => (
            <div key={room.id} style={{ border: `1px solid ${editing?.id === room.id ? ACCENT : "#EAE8E2"}`, borderRadius: 12, overflow: "hidden", background: "#fff" }}>
              <div style={{ height: 6, background: room.color || ACCENT }} />
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{room.name}</div>
                <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 4, lineHeight: 1.6 }}>
                  👥 {room.capacity} {t("rooms.seats")}
                  {branchName(room.branchId) && <><br />📍 {branchName(room.branchId)}</>}
                  <br />📅 {lessonsPerRoom[room.id] ?? 0} {t("rooms.weeklyLessons")}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button type="button" onClick={() => edit(room)} style={{ ...ghost, padding: "5px 10px", fontSize: 12 }}>{t("common.edit")}</button>
                  <button type="button" onClick={() => remove(room)} style={{ ...ghost, padding: "5px 10px", fontSize: 12, color: "#B23A47" }}>{t("common.delete")}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const ghost: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer" };
const primary: React.CSSProperties = { background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "8px 16px", borderRadius: 8, cursor: "pointer" };
