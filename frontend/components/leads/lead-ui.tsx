"use client";

import type { LeadLostReason, LeadSource, LeadStatus, LeadTrialStatus } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { formatDate as fmtDate, formatDateTime as fmtDateTime } from "@/lib/format-date";
import type { Lang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { centerTimeToIso, centerTimeZone, centerWallClock } from "@/lib/center-time";

export const ACCENT = "var(--primary)";

export const LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_ATTENDED", "QUALIFIED", "ENROLLED", "LOST"];
export const OPEN_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_ATTENDED", "QUALIFIED"];
// The board: the open stages, then where leads end up (a student, or lost).
export const BOARD_STATUSES: LeadStatus[] = [...OPEN_STATUSES, "ENROLLED", "LOST"];
export const LEAD_SOURCES: LeadSource[] = ["INSTAGRAM", "TELEGRAM", "WEBSITE", "REFERRAL", "WALK_IN", "PHONE", "ADVERTISEMENT", "OTHER"];
export const LOST_REASONS: LeadLostReason[] = ["TOO_EXPENSIVE", "NO_RESPONSE", "CHOSE_COMPETITOR", "SCHEDULE_MISMATCH", "LOCATION", "NOT_INTERESTED", "OTHER"];

// Stage moves that need no extra data. Everything else (trial booking,
// attendance, loss, enrollment) has its own dialog with the details the
// backend requires. A contacted lead moves on by booking a trial lesson;
// only a lead who took the level test may be qualified straight away (the
// detail page offers that when the backend allows it).
export const SIMPLE_MOVES: Partial<Record<LeadStatus, LeadStatus[]>> = {
  NEW: ["CONTACTED"],
  TRIAL_ATTENDED: ["QUALIFIED"],
};

export const STATUS_STYLE: Record<LeadStatus, { color: string; bg: string; border: string }> = {
  NEW: { color: "var(--primary)", bg: "var(--primary-soft)", border: "var(--primary-border)" },
  CONTACTED: { color: "var(--info)", bg: "var(--info-soft)", border: "var(--info-border)" },
  TRIAL_BOOKED: { color: "var(--warning)", bg: "var(--warning-soft)", border: "var(--warning-border)" },
  TRIAL_ATTENDED: { color: "var(--warning)", bg: "var(--warning-soft)", border: "var(--warning-border)" },
  QUALIFIED: { color: "var(--teal)", bg: "var(--teal-soft)", border: "var(--teal-soft)" },
  ENROLLED: { color: "var(--success)", bg: "var(--success-soft)", border: "var(--success-border)" },
  LOST: { color: "var(--danger)", bg: "var(--danger-soft)", border: "var(--danger-border)" },
};

export const TRIAL_STYLE: Record<LeadTrialStatus, { color: string; bg: string }> = {
  BOOKED: { color: "var(--warning)", bg: "var(--warning-soft)" },
  ATTENDED: { color: "var(--success)", bg: "var(--success-soft)" },
  MISSED: { color: "var(--danger)", bg: "var(--danger-soft)" },
  CANCELLED: { color: "var(--text-muted)", bg: "var(--surface-muted)" },
  RESCHEDULED: { color: "var(--text-muted)", bg: "var(--surface-muted)" },
};

export const statusKey = (s: LeadStatus) => `adm.status.${s}` as TranslationKey;
export const sourceKey = (s: LeadSource) => `adm.source.${s}` as TranslationKey;
export const lostKey = (r: LeadLostReason) => `adm.lost.${r}` as TranslationKey;
export const trialKey = (s: LeadTrialStatus) => `adm.trial.${s}` as TranslationKey;

export function StatusBadge({ status, label }: { status: LeadStatus; label: string }) {
  const st = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: "var(--radius-pill)",
        fontSize: 11.5,
        fontWeight: 700,
        color: st.color,
        background: st.bg,
        border: `1px solid ${st.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// Lead dates and times are the center's wall clock (lib/center-time.ts):
// typed in the center's timezone, sent as UTC instants, shown back in the
// center's timezone - not the browser's.
export function useCenterTimeZone() {
  const { tenant } = useAuth();
  return centerTimeZone(tenant?.timezone);
}

export function formatDateTime(iso: string | null | undefined, lang: Lang, tz: string) {
  const d = iso ? centerWallClock(iso, tz) : null;
  return d ? fmtDateTime(d, lang) : "—";
}

export function formatDate(iso: string | null | undefined, lang: Lang, tz: string) {
  const d = iso ? centerWallClock(iso, tz) : null;
  return d ? fmtDate(d, lang, "short") : "—";
}

// Said next to date and time inputs when the browser's clock is not the
// center's, so nobody types their own local time by mistake.
export function CenterTimeNote({ tz, text }: { tz: string; text: string }) {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (browser === tz) return null;
  return <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>{text.replace("{tz}", tz)}</div>;
}

// DatePicker (YYYY-MM-DD) + TimePicker (HH:MM), on the center's clock -> the
// ISO instant for the API ("" without a date).
export function toIsoFromParts(date: string, time: string, tz: string) {
  if (!date) return "";
  return centerTimeToIso(date, time || "09:00", tz);
}

export function isOverdue(iso?: string | null) {
  return !!iso && new Date(iso).getTime() < Date.now();
}

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 18,
};

export const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 6,
};

export const primaryBtn: React.CSSProperties = {
  background: ACCENT,
  color: "var(--on-ink)",
  border: "none",
  fontSize: 13,
  fontWeight: 700,
  padding: "9px 16px",
  borderRadius: "var(--radius-sm)",
};

export const ghostBtn: React.CSSProperties = {
  background: "var(--surface)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  fontSize: 13,
  fontWeight: 600,
  padding: "8px 14px",
  borderRadius: "var(--radius-sm)",
};

export const dangerBtn: React.CSSProperties = {
  ...ghostBtn,
  color: "var(--danger)",
  border: "1px solid var(--danger-border)",
};
