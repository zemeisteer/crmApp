"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { scheduleApi, type ScheduleItem } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

type DayState = "checking" | "free" | "busy" | "unknown";

/**
 * Moving a lesson to another day without dragging: a phone has no drag, and
 * a keyboard has none either. Every other day is listed with whether the
 * lesson fits there (room, teacher, group and students free at its time),
 * so the choice is made knowing the answer.
 */
export default function MoveLessonDialog({
  item,
  days,
  onClose,
  onPick,
}: {
  item: ScheduleItem;
  days: Array<{ day: number; label: string }>;
  onClose: () => void;
  /** The day that was chosen; the page moves the lesson (and checks once more). */
  onPick: (day: number) => void;
}) {
  const { t } = useLanguage();
  const current = item.dayOfWeek ?? 1;
  const [states, setStates] = useState<Record<number, DayState>>({});

  // Asked once per lesson, not on every redraw of the page behind.
  const { id, groupId, teacherId, roomId, startTime, endTime } = item;
  const dayKey = days.map((d) => d.day).join(",");
  useEffect(() => {
    let alive = true;
    for (const day of dayKey.split(",").map(Number)) {
      if (day === current) continue;
      scheduleApi
        .checkConflicts({
          groupId,
          teacherId: teacherId || undefined,
          roomId: roomId || undefined,
          dayOfWeek: day,
          startTime,
          endTime,
          excludeScheduleId: id,
        })
        .then((res) => { if (alive) setStates((prev) => ({ ...prev, [day]: res.conflicts.length ? "busy" : "free" })); })
        // Not knowing is not a reason to hide the day: the move itself checks again.
        .catch(() => { if (alive) setStates((prev) => ({ ...prev, [day]: "unknown" })); });
    }
    return () => { alive = false; };
  }, [id, groupId, teacherId, roomId, startTime, endTime, dayKey, current]);

  const chip = (state: DayState | "current"): { text: string; bg: string; fg: string } =>
    state === "current" ? { text: t("sch.move.currentDay"), bg: "#F2F1EC", fg: "#686B75" }
      : state === "free" ? { text: t("sch.move.free"), bg: "#E9F8EF", fg: "#16794A" }
      : state === "busy" ? { text: t("sch.move.busy"), bg: "#FDEBEC", fg: "#B23A47" }
      : state === "unknown" ? { text: "?", bg: "#F2F1EC", fg: "#686B75" }
      : { text: "…", bg: "#F2F1EC", fg: "#686B75" };

  return (
    <Modal open onClose={onClose} title={t("sch.move.dialogTitle")} width={420}>
      <div style={{ fontSize: 13, color: "#686B75", marginBottom: 12, lineHeight: 1.5 }}>
        <b style={{ color: "#181A1F" }}>{item.group?.name}</b> · {item.startTime}–{item.endTime}
        <div>{t("sch.move.pickDay")}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {days.map(({ day, label }) => {
          const isCurrent = day === current;
          const c = chip(isCurrent ? "current" : states[day] ?? "checking");
          return (
            <button
              key={day}
              type="button"
              disabled={isCurrent}
              onClick={() => onPick(day)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                // A full-width row, tall enough for a thumb.
                minHeight: 48, padding: "10px 14px", borderRadius: 12, textAlign: "left",
                border: `1px solid ${states[day] === "free" ? "#BFE6CF" : "#EAE8E2"}`,
                background: isCurrent ? "#FAF9F6" : "#fff",
                color: isCurrent ? "#A9ABB3" : "#181A1F",
                cursor: isCurrent ? "default" : "pointer",
                fontSize: 14.5, fontWeight: 700,
              }}
            >
              <span>{label}</span>
              <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>{c.text}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: "#686B75", marginTop: 12, lineHeight: 1.5 }}>
        <span style={{ color: ACCENT, fontWeight: 700 }}>{t("sch.move.busy")}</span>: {t("sch.move.busyHint")}
      </div>
    </Modal>
  );
}
