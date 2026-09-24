"use client";

import type { LeadLostReason, LeadSource, LeadStatus, LeadTrialStatus } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

export const ACCENT = "#4F46E5";

export const LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_ATTENDED", "QUALIFIED", "ENROLLED", "LOST"];
export const OPEN_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_ATTENDED", "QUALIFIED"];
export const LEAD_SOURCES: LeadSource[] = ["INSTAGRAM", "TELEGRAM", "WEBSITE", "REFERRAL", "WALK_IN", "PHONE", "ADVERTISEMENT", "OTHER"];
export const LOST_REASONS: LeadLostReason[] = ["TOO_EXPENSIVE", "NO_RESPONSE", "CHOSE_COMPETITOR", "SCHEDULE_MISMATCH", "LOCATION", "NOT_INTERESTED", "OTHER"];

// Stage moves that need no extra data. Everything else (trial booking,
// attendance, loss, enrollment) has its own dialog with the details the
// backend requires.
export const SIMPLE_MOVES: Partial<Record<LeadStatus, LeadStatus[]>> = {
  NEW: ["CONTACTED"],
  CONTACTED: ["QUALIFIED"],
  TRIAL_ATTENDED: ["QUALIFIED"],
};

export const STATUS_STYLE: Record<LeadStatus, { color: string; bg: string; border: string }> = {
  NEW: { color: "#4F46E5", bg: "#EEF0FF", border: "#C7D2FE" },
  CONTACTED: { color: "#0284C7", bg: "#E0F2FE", border: "#BAE6FD" },
  TRIAL_BOOKED: { color: "#B45309", bg: "#FEF3C7", border: "#FDE68A" },
  TRIAL_ATTENDED: { color: "#92400E", bg: "#FEF3C7", border: "#FCD34D" },
  QUALIFIED: { color: "#0F766E", bg: "#CCFBF1", border: "#99F6E4" },
  ENROLLED: { color: "#15803D", bg: "#DCFCE7", border: "#BBF7D0" },
  LOST: { color: "#B91C1C", bg: "#FEE2E2", border: "#FECACA" },
};

export const TRIAL_STYLE: Record<LeadTrialStatus, { color: string; bg: string }> = {
  BOOKED: { color: "#B45309", bg: "#FEF3C7" },
  ATTENDED: { color: "#15803D", bg: "#DCFCE7" },
  MISSED: { color: "#B91C1C", bg: "#FEE2E2" },
  CANCELLED: { color: "#6B7280", bg: "#F3F4F6" },
  RESCHEDULED: { color: "#6B7280", bg: "#F3F4F6" },
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
        borderRadius: 999,
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

// Formats in the viewer's locale; the backend stores instants in UTC.
export function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Combines the DatePicker (YYYY-MM-DD) and TimePicker (HH:MM) values, read as
// the viewer's local time, into an ISO instant for the API.
export function toIsoFromParts(date: string, time: string) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "09:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

export function isOverdue(iso?: string | null) {
  return !!iso && new Date(iso).getTime() < Date.now();
}

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #EAE8E2",
  borderRadius: 14,
  padding: 18,
};

export const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#5B5F6A",
  marginBottom: 6,
};

export const primaryBtn: React.CSSProperties = {
  background: ACCENT,
  color: "#fff",
  border: "none",
  fontSize: 13,
  fontWeight: 700,
  padding: "9px 16px",
  borderRadius: 9,
};

export const ghostBtn: React.CSSProperties = {
  background: "#fff",
  color: "#181A1F",
  border: "1px solid #EAE8E2",
  fontSize: 13,
  fontWeight: 600,
  padding: "8px 14px",
  borderRadius: 9,
};

export const dangerBtn: React.CSSProperties = {
  ...ghostBtn,
  color: "#B91C1C",
  borderColor: "#FECACA",
};
