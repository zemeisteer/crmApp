"use client";

import DatePicker from "@/components/DatePicker";
import { ApiError, type MakeupBookingStatus, type MakeupCreditStatus, type MakeupReason } from "@/lib/api";
import type { Lang, TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { localDate, makeupErrorCode, rangeProblem, weekdayIndex, type MakeupErrorCode } from "@/lib/makeups";

export const ACCENT = "#4F46E5";
export const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 16, minWidth: 0 };
export const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
export const smallBtn: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 };
export const primaryBtn: React.CSSProperties = { background: ACCENT, border: "none", color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 };
export const dangerBtn: React.CSSProperties = { background: "#FDEBEC", border: "none", color: "#B23A47", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 };
export const muted: React.CSSProperties = { fontSize: 12.5, color: "#686B75" };

export function Notice({ tone, children }: { tone: "error" | "ok" | "info" | "warn"; children: React.ReactNode }) {
  const tones = {
    error: { background: "#FDEBEC", color: "#B23A47" },
    ok: { background: "#E9F8EF", color: "#167A48" },
    info: { background: "#EEF0FF", color: "#3730A3" },
    warn: { background: "#FFF7E6", color: "#A15C00" },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} style={{ ...tones, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, lineHeight: 1.5 }}>
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
  ISSUED: { key: "mk.status.ISSUED", color: "#3730A3", bg: "#EEF0FF" },
  BOOKED: { key: "mk.status.BOOKED", color: "#A15C00", bg: "#FFF7E6" },
  USED: { key: "mk.status.USED", color: "#167A48", bg: "#E9F8EF" },
  FORFEITED: { key: "mk.status.FORFEITED", color: "#B23A47", bg: "#FDEBEC" },
  CANCELLED: { key: "mk.status.CANCELLED", color: "#686B75", bg: "#F2F1EC" },
};

export const BOOKING_STATUS: Record<MakeupBookingStatus, { key: TranslationKey; color: string; bg: string }> = {
  BOOKED: { key: "mk.bstatus.BOOKED", color: "#3730A3", bg: "#EEF0FF" },
  ATTENDED: { key: "mk.bstatus.ATTENDED", color: "#167A48", bg: "#E9F8EF" },
  MISSED: { key: "mk.bstatus.MISSED", color: "#B23A47", bg: "#FDEBEC" },
  CANCELLED: { key: "mk.bstatus.CANCELLED", color: "#686B75", bg: "#F2F1EC" },
};

export const REASON_KEYS: Record<MakeupReason, TranslationKey> = {
  ABSENT: "mk.reason.ABSENT",
  LESSON_CANCELLED: "mk.reason.LESSON_CANCELLED",
};

export function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, color, background: bg, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{text}</span>;
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
        <div role="alert" style={{ flexBasis: "100%", fontSize: 12.5, fontWeight: 600, color: "#B23A47" }}>
          {problem === "TOO_LONG" ? t("mk.rangeTooLong") : t("mk.rangeInvalid")}
        </div>
      )}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div style={{ ...card, color: "#686B75", fontSize: 13.5, textAlign: "center", padding: "28px 16px" }}>{text}</div>;
}

export function Loading({ t }: { t: (k: TranslationKey) => string }) {
  return <div role="status" style={{ color: "#686B75", fontSize: 13.5, padding: "12px 2px" }}>{t("common.loading")}</div>;
}
