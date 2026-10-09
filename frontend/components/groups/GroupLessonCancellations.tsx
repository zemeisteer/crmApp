"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import LoadError from "@/components/LoadError";
import { lessonsApi, type LessonCancellation, type LessonOccurrence } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";
import { addDays } from "@/lib/makeups";
import { Notice, dayLabel, errorText, lbl } from "@/components/makeups/shared";

const ACCENT = "#4F46E5";
// Upcoming lessons offered for cancelling, and how far back cancelled days are listed.
const AHEAD_DAYS = 60;
const BACK_DAYS = 59;

/**
 * Calls off one dated lesson of this group (a holiday, the teacher is ill)
 * and lists the days already called off, with Restore. Students of a
 * called-off lesson may then get a make-up credit (Make-up lessons page).
 */
export default function GroupLessonCancellations({ groupId }: { groupId: string }) {
  const { t, lang } = useLanguage();
  const clock = useCenterClock();
  const today = clock.today();
  const [lessons, setLessons] = useState<LessonOccurrence[] | null>(null);
  const [cancelled, setCancelled] = useState<LessonCancellation[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      lessonsApi.list(today, addDays(today, AHEAD_DAYS), groupId),
      // One request covers at most 120 days.
      lessonsApi.cancellations(addDays(today, -BACK_DAYS), addDays(today, AHEAD_DAYS)),
    ])
      .then(([l, c]) => {
        if (!alive) return;
        setLessons(l);
        setCancelled(c.filter((x) => x.groupId === groupId).sort((a, b) => a.date.localeCompare(b.date)));
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [groupId, today, nonce]);
  const reload = () => setNonce((n) => n + 1);

  const upcoming = [...new Map((lessons ?? []).filter((l) => !l.cancelled && l.kind === "WEEKLY").map((l) => [l.date, l])).values()];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) {
      setFormError(t("mk.lc.pickLesson"));
      return;
    }
    if (!window.confirm(t("mk.lc.confirmCancelLesson").replace("{date}", dayLabel(date, lang, t)))) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await lessonsApi.cancel({ groupId, date, reason: reason.trim() || undefined });
      setOpen(false);
      setMessage({
        tone: "ok",
        text: `${t("mk.lc.lessonCancelled").replace("{date}", dayLabel(date, lang, t))}${res.releasedBookings > 0 ? ` ${t("mk.lc.releasedBookings").replace("{n}", String(res.releasedBookings))}` : ""}`,
      });
      setDate("");
      setReason("");
      reload();
    } catch (err) {
      setFormError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function restore(c: LessonCancellation) {
    if (!window.confirm(t("mk.lc.confirmRestore").replace("{date}", dayLabel(c.date, lang, t)))) return;
    setMessage(null);
    try {
      await lessonsApi.restore(c.id);
      setMessage({ tone: "ok", text: t("mk.lc.restored").replace("{date}", dayLabel(c.date, lang, t)) });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err, t) });
    } finally {
      reload();
    }
  }

  return (
    <section aria-labelledby="group-cancel-title" style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 id="group-cancel-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("mk.lc.cancelledLessons")}</h2>
        <button
          type="button"
          className="btn"
          disabled={lessons === null}
          onClick={() => { setOpen(true); setFormError(null); setMessage(null); }}
          style={{ background: "#FFF7E6", color: "#A15C00", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
        >
          {t("mk.lc.cancelLesson")}
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5, marginBottom: 12 }}>{t("mk.lc.cancelHint")}</div>
      {message && <div style={{ marginBottom: 12 }}><Notice tone={message.tone}>{message.text}</Notice></div>}
      {loadError ? (
        <LoadError compact message={t("mk.loadError")} onRetry={reload} />
      ) : cancelled === null ? (
        <div role="status" style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
      ) : cancelled.length === 0 ? (
        <div style={{ fontSize: 13, color: "#686B75" }}>{t("mk.lc.noCancelled")}</div>
      ) : (
        <ul aria-label={t("mk.lc.cancelledLessons")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {cancelled.map((c) => (
            <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: "1px solid #EAE8E2", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: c.date < today ? "#686B75" : "#181A1F" }}>{dayLabel(c.date, lang, t)}</div>
                {c.reason && <div style={{ fontSize: 12.5, color: "#686B75", overflowWrap: "anywhere" }}>{c.reason}</div>}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => restore(c)}
                aria-label={`${t("mk.lc.restore")}: ${dayLabel(c.date, lang, t)}`}
                style={{ background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
              >
                {t("mk.lc.restore")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t("mk.lc.cancelLessonTitle")} width={460}>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {formError && <Notice tone="error">{formError}</Notice>}
          {upcoming.length === 0 ? (
            <Notice tone="warn">{t("mk.lc.noUpcoming").replace("{n}", String(AHEAD_DAYS))}</Notice>
          ) : (
            <div role="group" aria-label={t("mk.lc.lessonToCancel")}>
              <span style={lbl}>{t("mk.lc.lessonToCancel")}</span>
              <Select
                ariaLabel={t("mk.lc.lessonToCancel")}
                sheetOnPhone
                sheetTitle={t("mk.lc.lessonToCancel")}
                placeholder={t("mk.chooseDate")}
                options={upcoming.map((l) => ({ value: l.date, label: `${dayLabel(l.date, lang, t)} · ${l.startTime}–${l.endTime}` }))}
                value={date}
                onChange={setDate}
              />
            </div>
          )}
          <label>
            <span style={lbl}>{t("mk.lc.reasonOptional")}</span>
            <input className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t("mk.lc.reasonPh")} style={{ width: "100%" }} />
          </label>
          <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t("mk.lc.cancelEffect")}</div>
          <button
            type="submit"
            className="btn"
            disabled={busy || upcoming.length === 0}
            style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 14, fontWeight: 700, padding: "11px 16px", borderRadius: 10 }}
          >
            {busy ? t("common.saving") : t("mk.lc.cancelConfirm")}
          </button>
        </form>
      </Modal>
    </section>
  );
}
