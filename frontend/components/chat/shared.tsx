"use client";

import type { ChatConversation, ChatKind } from "@/lib/api";
import type { Lang, TranslationKey } from "@/lib/i18n";
import { formatDateTime, formatTime } from "@/lib/format-date";

export const CHAT_ACCENT = "#4F46E5";

/** Hidden on screen, read by screen readers. */
export const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

type T = (k: TranslationKey) => string;

/** Who the conversation is with, as this side sees it. */
export function conversationTitle(c: Pick<ChatConversation, "kind" | "studentName" | "teacherName" | "groupName" | "oversight">, side: "staff" | "cabinet", t: T): string {
  if (c.kind === "GROUP") return c.groupName ?? t("chat.groupFallback");
  if (side === "cabinet") return c.kind === "STUDENT_CENTER" ? t("chat.centerName") : c.teacherName ?? t("chat.teacherFallback");
  const student = c.studentName ?? t("chat.studentFallback");
  // An owner reading a teacher's conversation: both sides in the title.
  return c.kind === "STUDENT_TEACHER" && c.oversight && c.teacherName ? `${student} — ${c.teacherName}` : student;
}

const KIND_KEYS: Record<"staff" | "cabinet", Record<ChatKind, TranslationKey>> = {
  staff: { STUDENT_CENTER: "chat.kind.centerStaff", STUDENT_TEACHER: "chat.kind.teacherStaff", GROUP: "chat.kind.group" },
  cabinet: { STUDENT_CENTER: "chat.kind.centerCabinet", STUDENT_TEACHER: "chat.kind.teacherCabinet", GROUP: "chat.kind.group" },
};

export function kindLabel(kind: ChatKind, side: "staff" | "cabinet", t: T) {
  return t(KIND_KEYS[side][kind]);
}

/** "14:35" today, "26 sen 2026, 14:35" before. */
export function messageTime(iso: string, lang: Lang, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return today ? formatTime(d, lang) : formatDateTime(d, lang);
}

export function UnreadBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span style={{ background: "#DC2626", color: "#fff", fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 100, lineHeight: 1.6, flexShrink: 0 }}>
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span style={srOnly}>{label.replace("{n}", String(count))}</span>
    </span>
  );
}
