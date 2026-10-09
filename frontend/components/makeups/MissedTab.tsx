"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import LoadError from "@/components/LoadError";
import { makeupsApi, type MakeupEligible } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useCenterClock } from "@/lib/use-center-clock";
import { addDays, rangeProblem } from "@/lib/makeups";
import { ACCENT, Badge, CREDIT_STATUS, DateRange, Empty, Loading, Notice, REASON_KEYS, card, dayLabel, lbl, muted, primaryBtn, errorText } from "./shared";

const keyOf = (r: MakeupEligible) => `${r.studentId}|${r.groupId}|${r.date}|${r.reason}`;

/**
 * Missed lessons: absences and lessons the center called off in a date
 * range, each with the credit already issued for it (if any). Issuing a
 * credit is a staff decision, with an optional note.
 */
export default function MissedTab({ canManage, onIssued }: { canManage: boolean; onIssued: () => void }) {
  const { t, lang } = useLanguage();
  const clock = useCenterClock();
  const [from, setFrom] = useState(() => addDays(clock.today(), -30));
  const [to, setTo] = useState(() => clock.today());
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Results are kept with the query they answer: a new query shows "loading".
  const query = `${from}|${to}|${nonce}`;
  const [result, setResult] = useState<{ query: string; rows: MakeupEligible[] | null; error: boolean } | null>(null);
  const rows = result?.query === query ? result.rows : null;
  const loadError = result?.query === query && result.error;
  const [issuing, setIssuing] = useState<MakeupEligible | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const badRange = rangeProblem(from, to) !== null;
  useEffect(() => {
    if (badRange) return;
    let alive = true;
    makeupsApi
      .eligible(from, to)
      .then((list) => alive && setResult({ query, rows: list, error: false }))
      .catch(() => alive && setResult({ query, rows: null, error: true }));
    return () => {
      alive = false;
    };
  }, [from, to, badRange, query]);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!issuing) return;
    setBusy(true);
    setFormError(null);
    try {
      await makeupsApi.issue({ studentId: issuing.studentId, groupId: issuing.groupId, date: issuing.date, reason: issuing.reason, note: note.trim() || undefined });
      setDone(t("mk.issued").replace("{name}", issuing.studentName));
      setIssuing(null);
      setNote("");
      setNonce((n) => n + 1);
      onIssued();
    } catch (err) {
      setFormError(errorText(err, t));
      // Someone else may have issued it meanwhile: show the current state.
      setNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const shown = (rows ?? []).filter((r) => !onlyOpen || !r.credit);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={muted}>{t("mk.missedHint")}</div>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} t={t} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "#4A4E58", cursor: "pointer" }}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          {t("mk.onlyWithoutCredit")}
        </label>
      </div>

      {done && <Notice tone="ok">{done}</Notice>}
      {loadError ? (
        <LoadError message={t("mk.loadError")} onRetry={() => setNonce((n) => n + 1)} />
      ) : badRange ? null : rows === null ? (
        <Loading t={t} />
      ) : shown.length === 0 ? (
        <Empty text={rows.length === 0 ? t("mk.noMissed") : t("mk.noMissedOpen")} />
      ) : (
        <ul aria-label={t("mk.tabMissed")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((r) => {
            const st = r.credit ? CREDIT_STATUS[r.credit.status] : null;
            return (
              <li key={keyOf(r)} style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <Link href={`/students/${r.studentId}`} style={{ fontSize: 14, fontWeight: 700, color: "#181A1F", overflowWrap: "anywhere" }}>{r.studentName}</Link>
                  <div style={{ ...muted, marginTop: 3, overflowWrap: "anywhere" }}>
                    {r.groupName} · {dayLabel(r.date, lang, t)}
                  </div>
                </div>
                <Badge text={t(REASON_KEYS[r.reason])} color={r.reason === "ABSENT" ? "#B23A47" : "#A15C00"} bg={r.reason === "ABSENT" ? "#FDEBEC" : "#FFF7E6"} />
                {st ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={muted}>{t("mk.credit")}:</span>
                    <Badge text={t(st.key)} color={st.color} bg={st.bg} />
                  </span>
                ) : canManage ? (
                  <button
                    type="button"
                    className="btn"
                    aria-label={`${t("mk.issueCredit")}: ${r.studentName}, ${dayLabel(r.date, lang, t)}`}
                    onClick={() => { setIssuing(r); setNote(""); setFormError(null); setDone(null); }}
                    style={primaryBtn}
                  >
                    {t("mk.issueCredit")}
                  </button>
                ) : (
                  <span style={muted}>{t("mk.noCredit")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={!!issuing} onClose={() => setIssuing(null)} title={t("mk.issueTitle")} width={460}>
        {issuing && (
          <form onSubmit={issue} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {formError && <Notice tone="error">{formError}</Notice>}
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px", fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700 }}>{issuing.studentName}</div>
              <div>{issuing.groupName} · {dayLabel(issuing.date, lang, t)}</div>
              <div style={{ color: "#686B75" }}>{t(REASON_KEYS[issuing.reason])}</div>
            </div>
            <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t("mk.issueExplain")}</div>
            <label>
              <span style={lbl}>{t("mk.noteOptional")}</span>
              <textarea className="field-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }} />
            </label>
            <button type="submit" className="btn" disabled={busy} style={{ ...primaryBtn, background: ACCENT, fontSize: 14, padding: "11px 16px", borderRadius: 10 }}>
              {busy ? t("common.saving") : t("mk.issueConfirm")}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
