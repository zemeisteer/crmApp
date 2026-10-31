"use client";

import DatePicker from "@/components/DatePicker";
import { ApiError, type MakeupBookingStatus, type MakeupCreditStatus, type MakeupReason } from "@/lib/api";
import type { Lang, TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { localDate, makeupErrorCode, rangeProblem, weekdayIndex, type MakeupErrorCode } from "@/lib/makeups";

export const ACCENT = "var(--primary)";
export const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, minWidth: 0 };
export const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 };
export const smallBtn: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: "var(--radius-xs)" };
export const primaryBtn: React.CSSProperties = { background: ACCENT, border: "none", color: "var(--on-ink)", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-xs)" };
export const dangerBtn: React.CSSProperties = { background: "var(--danger-soft)", border: "none", color: "var(--danger)", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: "var(--radius-xs)" };
export const muted: React.CSSProperties = { fontSize: 12.5, color: "var(--text-muted)" };

export function Notice({ tone, children }: { tone: "error" | "ok" | "info" | "warn"; children: React.ReactNode }) {
  const tones = {
    error: { background: "var(--danger-soft)", color: "var(--danger)" },
    ok: { background: "var(--success-soft)", color: "var(--success)" },
    info: { background: "var(--primary-soft)", color: "var(--primary)" },
    warn: { background: "var(--warning-soft)", color: "var(--warning)" },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} style={{ ...tones, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

const ERROR_KEYS: Record<MakeupErrorCode, TranslationKey> = {
  NOT_ELIGIBLE: "mk.err.NOT_ELIGIBLE",
  DUPLICATE_CREDIT: "mk.err.DUPLICATE_CREDIT",
  CREDIT_NOT_OPEN: "mk.err.CREDIT_NOT_OPEN",
  CREDIT_NOT_FORFEITED: "mk.err.CREDIT_NOT_FORFEITED",
  CREDIT_EXPIRED: "mk.err.CREDIT_EXPIRED",
  LESSON_FULL: "mk.err.LESSON_FULL",
  SLOT_TAKEN: "mk.err.SLOT_TAKEN",
  STUDENT_BUSY: "mk.err.STUDENT_BUSY",
  NO_LESSON: "mk.err.NO_LESSON",
  ALREADY_IN_GROUP: "mk.err.ALREADY_IN_GROUP",
  BOOKING_CLOSED: "mk.err.BOOKING_CLOSED",
  ALREADY_MARKED: "mk.err.ALREADY_MARKED",
  ALREADY_CANCELLED: "mk.err.ALREADY_CANCELLED",
  CREDITS_ISSUED: "mk.err.CREDITS_ISSUED",
};

/** An error from the make-up or lesson routes, in the reader's language when the server named it. */
export function errorText(err: unknown, t: (k: TranslationKey) => string): string {
  const code = makeupErrorCode(err);
  if (code) return t(ERROR_KEYS[code]);
  if (err instanceof ApiError && err.status === 403) return t("mk.err.forbidden");
  if (err instanceof ApiError && err.status < 500 && err.message) return err.message;
  return t("common.errorGeneric");
}

const WEEKDAYS: TranslationKey[] = [
  "weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday", "weekday.short.thursday",
  "weekday.short.friday", "weekday.short.saturday", "weekday.short.sunday",
];

/** "Du, 12 okt 2026" for a center-local YYYY-MM-DD. */
export function dayLabel(date: string, lang: Lang, t: (k: TranslationKey) => string): string {
  const d = localDate(date);
  if (!d) return date;
  return `${t(WEEKDAYS[weekdayIndex(date)])}, ${formatDate(d, lang, "short")}`;
}

export const CREDIT_STATUS: Record<MakeupCreditStatus, { key: TranslationKey; color: string; bg: string }> = {
  ISSUED: { key: "mk.status.ISSUED", color: "var(--primary)", bg: "var(--primary-soft)" },
  BOOKED: { key: "mk.status.BOOKED", color: "var(--warning)", bg: "var(--warning-soft)" },
  USED: { key: "mk.status.USED", color: "var(--success)", bg: "var(--success-soft)" },
  FORFEITED: { key: "mk.status.FORFEITED", color: "var(--danger)", bg: "var(--danger-soft)" },
  CANCELLED: { key: "mk.status.CANCELLED", color: "var(--text-muted)", bg: "var(--surface-muted)" },
};

export const BOOKING_STATUS: Record<MakeupBookingStatus, { key: TranslationKey; color: string; bg: string }> = {
  BOOKED: { key: "mk.bstatus.BOOKED", color: "var(--primary)", bg: "var(--primary-soft)" },
  ATTENDED: { key: "mk.bstatus.ATTENDED", color: "var(--success)", bg: "var(--success-soft)" },
  MISSED: { key: "mk.bstatus.MISSED", color: "var(--danger)", bg: "var(--danger-soft)" },
  CANCELLED: { key: "mk.bstatus.CANCELLED", color: "var(--text-muted)", bg: "var(--surface-muted)" },
};

export const REASON_KEYS: Record<MakeupReason, TranslationKey> = {
  ABSENT: "mk.reason.ABSENT",
  LESSON_CANCELLED: "mk.reason.LESSON_CANCELLED",
};

export function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, color, background: bg, padding: "3px 9px", borderRadius: "var(--radius-pill)", whiteSpace: "nowrap" }}>{text}</span>;
}

/** From/to pickers; tells when the range is longer than the server accepts. */
export function DateRange({
  from, to, onChange, t,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  t: (k: TranslationKey) => string;
}) {
  const problem = rangeProblem(from, to);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
      <div role="group" aria-label={t("mk.from")} style={{ minWidth: 0, flex: "1 1 150px", maxWidth: 200 }}>
        <span style={lbl}>{t("mk.from")}</span>
        <DatePicker value={from} onChange={(v) => onChange(v, to)} />
      </div>
      <div role="group" aria-label={t("mk.to")} style={{ minWidth: 0, flex: "1 1 150px", maxWidth: 200 }}>
        <span style={lbl}>{t("mk.to")}</span>
        <DatePicker value={to} onChange={(v) => onChange(from, v)} />
      </div>
      {problem && (
        <div role="alert" style={{ flexBasis: "100%", fontSize: 12.5, fontWeight: 600, color: "var(--danger)" }}>
          {problem === "TOO_LONG" ? t("mk.rangeTooLong") : t("mk.rangeInvalid")}
        </div>
      )}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div style={{ ...card, color: "var(--text-muted)", fontSize: 13.5, textAlign: "center", padding: "28px 16px" }}>{text}</div>;
}

export function Loading({ t }: { t: (k: TranslationKey) => string }) {
  return <div role="status" style={{ color: "var(--text-muted)", fontSize: 13.5, padding: "12px 2px" }}>{t("common.loading")}</div>;
}
