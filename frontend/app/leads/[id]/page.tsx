"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
import LeadFormModal from "@/components/leads/LeadFormModal";
import ConvertWizard from "@/components/leads/ConvertWizard";
import {
  ApiError,
  groupsApi,
  leadsApi,
  notificationsApi,
  teachersApi,
  type AssignableManager,
  type Group,
  type Lead,
  type LeadActivity,
  type LeadLostReason,
  type LeadTrial,
  type Teacher,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import type { TranslationKey } from "@/lib/i18n";
import {
  ACCENT,
  LOST_REASONS,
  OPEN_STATUSES,
  SIMPLE_MOVES,
  StatusBadge,
  TRIAL_STYLE,
  card,
  dangerBtn,
  formatDateTime,
  ghostBtn,
  isOverdue,
  label,
  lostKey,
  primaryBtn,
  sourceKey,
  statusKey,
  telHref,
  toIsoFromParts,
  trialKey,
} from "@/components/leads/lead-ui";

type Dialog =
  | { kind: "lose" }
  | { kind: "reopen" }
  | { kind: "trial"; reschedule?: LeadTrial }
  | { kind: "sms" }
  | null;

// Human label for a timeline entry; system entries carry a metadata.kind.
function activityTitle(a: LeadActivity, t: (k: TranslationKey) => string) {
  const kind = a.metadata?.kind as string | undefined;
  const byKind: Record<string, TranslationKey> = {
    CREATED: "adm.activity.created",
    ASSIGNED: "adm.activity.assigned",
    ARCHIVED: "adm.activity.archived",
    RESTORED: "adm.activity.restored",
    TRIAL_MISSED: "adm.activity.trialMissed",
    TRIAL_CANCELLED: "adm.activity.trialCancelled",
    RESCHEDULED: "adm.activity.rescheduled",
    PUBLIC_REAPPLY: "adm.activity.reapply",
  };
  if (kind && byKind[kind]) return t(byKind[kind]);
  return t(`adm.activity.${a.type}` as TranslationKey);
}

function LeadProfile() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const { can } = useAuth();

  const [lead, setLead] = useState<Lead | null>(null);
  const [timeline, setTimeline] = useState<LeadActivity[]>([]);
  const [managers, setManagers] = useState<AssignableManager[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  // dialog fields
  const [lostReason, setLostReason] = useState<LeadLostReason>("NO_RESPONSE");
  const [note, setNote] = useState("");
  const [trialDate, setTrialDate] = useState("");
  const [trialTime, setTrialTime] = useState("10:00");
  const [trialDuration, setTrialDuration] = useState("60");
  const [trialGroup, setTrialGroup] = useState("");
  const [trialTeacher, setTrialTeacher] = useState("");
  const [conflicts, setConflicts] = useState<{ message: string }[]>([]);
  const [smsText, setSmsText] = useState("");

  const [followDate, setFollowDate] = useState("");
  const [followTime, setFollowTime] = useState("10:00");
  const [activityType, setActivityType] = useState<"NOTE" | "CALL" | "MESSAGE" | "MEETING">("CALL");
  const [activityBody, setActivityBody] = useState("");

  const load = useCallback(async () => {
    try {
      const [l, tl] = await Promise.all([leadsApi.get(id), leadsApi.timeline(id)]);
      setLead(l);
      setTimeline(tl);
      setLoadError(null);
    } catch (err) {
      setLoadError({ status: err instanceof ApiError ? err.status : 0, message: err instanceof ApiError ? err.message : t("adm.loadError") });
    }
  }, [id, t]);

  useEffect(() => {
    load();
    leadsApi.managers().then(setManagers).catch(() => setManagers([]));
    groupsApi.list().then(setGroups).catch(() => setGroups([]));
    teachersApi.list().then(setTeachers).catch(() => setTeachers([]));
  }, [load]);

  // Every mutating action: disable controls, run, reload the source of truth.
  async function run(action: () => Promise<unknown>, onDone?: () => void) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      onDone?.();
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.body?.code === "TRIAL_CONFLICT") {
        setConflicts((err.body.conflicts as { message: string }[]) ?? []);
      }
      setActionError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setBusy(false);
    }
  }

  function openDialog(d: Dialog) {
    setNote("");
    setConflicts([]);
    setActionError(null);
    if (d?.kind === "trial") {
      setTrialDate("");
      setTrialTime("10:00");
      setTrialDuration(String(d.reschedule?.durationMinutes ?? 60));
      setTrialGroup(d.reschedule?.groupId ?? "");
      setTrialTeacher(d.reschedule?.teacherId ?? "");
    }
    if (d?.kind === "sms" && lead) {
      setSmsText(`Assalomu alaykum, ${lead.fullName}! `);
    }
    setDialog(d);
  }

  if (loadError) {
    return (
      <div className="adm-page">
        <Link href="/leads" style={{ color: ACCENT, fontWeight: 600 }}>← {t("adm.back")}</Link>
        <div style={{ ...card, marginTop: 14, color: "#B91C1C" }}>
          {loadError.status === 404 ? t("adm.notFound") : loadError.status === 403 ? t("adm.noPermission") : loadError.message}
          {loadError.status !== 404 && loadError.status !== 403 && (
            <button type="button" className="btn" style={{ ...ghostBtn, marginLeft: 12 }} onClick={load}>{t("adm.retry")}</button>
          )}
        </div>
      </div>
    );
  }
  if (!lead) return <div className="adm-page" style={{ color: "#8A8D96" }}>{t("common.loading")}</div>;

  const archived = !!lead.archivedAt;
  const editable = !archived && can("admissions.update");
  const allowed = lead.allowedTransitions ?? [];
  const simpleMoves = (SIMPLE_MOVES[lead.status] ?? []).filter((s) => allowed.includes(s));
  const bookedTrial = lead.trials?.find((tr) => tr.status === "BOOKED");
  const canBookTrial = editable && !bookedTrial && (lead.status === "CONTACTED" || lead.status === "TRIAL_BOOKED");
  const isOpen = OPEN_STATUSES.includes(lead.status);

  const detail = (k: string, v: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr)", gap: 10, padding: "8px 0", borderBottom: "1px solid #F2F1EC", fontSize: 13 }}>
      <span style={{ color: "#8A8D96" }}>{k}</span>
      <span style={{ fontWeight: 600, wordBreak: "break-word" }}>{v}</span>
    </div>
  );

  return (
    <>
      <div className="adm-page" style={{ borderBottom: "1px solid #EAE8E2", display: "grid", gap: 12 }}>
        <Link href="/leads" style={{ color: ACCENT, fontWeight: 600, fontSize: 13 }}>← {t("adm.back")}</Link>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>{lead.fullName}</h1>
            <StatusBadge status={lead.status} label={t(statusKey(lead.status))} />
          </div>
          <div className="adm-actions">
            {/* A plain tel: link: dialing is not logged automatically; staff log the call below. */}
            <a href={telHref(lead.phone)} className="btn" style={{ ...ghostBtn, textDecoration: "none" }}>📞 {t("adm.call")}</a>
            {editable && can("notifications.send") && (
              <button type="button" className="btn" style={ghostBtn} onClick={() => openDialog({ kind: "sms" })}>💬 {t("adm.sms")}</button>
            )}
            {editable && <button type="button" className="btn" style={ghostBtn} onClick={() => setEditOpen(true)}>{t("common.edit")}</button>}
          </div>
        </div>

        {editable && (
          <div className="adm-actions">
            {simpleMoves.map((to) => (
              <button key={to} type="button" className="btn" style={primaryBtn} disabled={busy} onClick={() => run(() => leadsApi.transition(lead.id, to))}>
                → {t(statusKey(to))}
              </button>
            ))}
            {canBookTrial && (
              <button type="button" className="btn" style={primaryBtn} onClick={() => openDialog({ kind: "trial" })}>{t("adm.bookTrial")}</button>
            )}
            {lead.status === "QUALIFIED" && can("admissions.convert") && (
              <button type="button" className="btn" style={{ ...primaryBtn, background: "#15803D" }} onClick={() => setConvertOpen(true)}>{t("adm.convert")}</button>
            )}
            {allowed.includes("LOST") && (
              <button type="button" className="btn" style={dangerBtn} onClick={() => openDialog({ kind: "lose" })}>{t("adm.markLost")}</button>
            )}
            {lead.status === "LOST" && can("admissions.manage") && (
              <button type="button" className="btn" style={ghostBtn} onClick={() => openDialog({ kind: "reopen" })}>{t("adm.reopen")}</button>
            )}
            {can("admissions.manage") && (
              <button
                type="button"
                className="btn"
                style={{ ...dangerBtn, marginLeft: "auto" }}
                disabled={busy}
                onClick={() => { if (confirm(t("adm.archiveConfirm"))) run(() => leadsApi.archive(lead.id)); }}
              >
                {t("adm.archive")}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="adm-page" style={{ display: "grid", gap: 14 }}>
        {actionError && !dialog && (
          <div role="alert" style={{ background: "#FEE2E2", color: "#B91C1C", fontWeight: 600, fontSize: 13, padding: "10px 14px", borderRadius: 10 }}>{actionError}</div>
        )}
        {archived && (
          <div style={{ ...card, background: "#F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>{t("adm.archivedBanner")}</span>
            {can("admissions.manage") && (
              <button type="button" className="btn" style={ghostBtn} disabled={busy} onClick={() => run(() => leadsApi.restore(lead.id))}>{t("common.restore")}</button>
            )}
          </div>
        )}
        {lead.convertedStudent && (
          <div style={{ ...card, background: "#F0FDF4", borderColor: "#BBF7D0", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span>{t("adm.convertedBanner")}: <strong>{lead.convertedStudent.fullName}</strong> · {formatDateTime(lead.convertedAt, lang)}</span>
            <Link href={`/students/${lead.convertedStudent.id}`} style={{ color: "#15803D", fontWeight: 700 }}>{t("adm.viewStudent")} →</Link>
          </div>
        )}
        {lead.duplicateOfLeadId && (
          <div style={{ ...card, background: "#FFFBEB", borderColor: "#FDE68A", fontSize: 13 }}>
            {t("adm.duplicateOf")} <Link href={`/leads/${lead.duplicateOfLeadId}`} style={{ color: ACCENT, fontWeight: 700 }}>{lead.duplicateOfLeadId}</Link>
          </div>
        )}

        <div className="adm-profile">
          <div style={{ display: "grid", gap: 14 }}>
            <section style={card}>
              <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{t("adm.details")}</h2>
              {detail(t("leads.fieldPhone"), <a href={telHref(lead.phone)} style={{ color: ACCENT }}>{lead.phone}</a>)}
              {lead.secondaryPhone && detail(t("adm.fieldSecondaryPhone"), <a href={telHref(lead.secondaryPhone)} style={{ color: ACCENT }}>{lead.secondaryPhone}</a>)}
              {lead.email && detail(t("adm.fieldEmail"), <a href={`mailto:${lead.email}`} style={{ color: ACCENT }}>{lead.email}</a>)}
              {detail(t("leads.fieldSource"), t(sourceKey(lead.source)))}
              {detail(t("adm.fieldSubject"), lead.desiredSubject?.name ?? "—")}
              {detail(t("adm.fieldCourse"), lead.desiredCourse?.name ?? "—")}
              {lead.legacySubject && detail(t("adm.legacySubject"), lead.legacySubject)}
              {detail(t("leads.fieldBranch"), lead.preferredBranch?.name ?? "—")}
              {detail(
                t("adm.fieldManager"),
                editable && can("admissions.assign") ? (
                  <Select
                    value={lead.assignedManagerUserId ?? ""}
                    onChange={(v) => run(() => leadsApi.assign(lead.id, v || null))}
                    options={[
                      { value: "", label: t("adm.unassigned") },
                      // Keep a departed owner visible so the history reads correctly.
                      ...(lead.assignedManager && !managers.some((m) => m.userId === lead.assignedManager!.id)
                        ? [{ value: lead.assignedManager.id, label: lead.assignedManager.fullName }]
                        : []),
                      ...managers.map((m) => ({ value: m.userId, label: m.fullName })),
                    ]}
                  />
                ) : (
                  lead.assignedManager?.fullName ?? t("adm.unassigned")
                ),
              )}
              {lead.assignedManagerActive === false && (
                <div style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>⚠ {t("adm.managerInactive")}</div>
              )}
              {lead.status === "LOST" && detail(t("adm.lostReason"), <>{lead.lostReason ? t(lostKey(lead.lostReason)) : "—"}{lead.lostNote ? ` — ${lead.lostNote}` : ""}</>)}
              {detail(t("leads.fieldNotes"), <span style={{ whiteSpace: "pre-wrap", fontWeight: 400 }}>{lead.notes || "—"}</span>)}
              {detail(t("adm.createdBy"), formatDateTime(lead.createdAt, lang))}
              {detail(t("adm.lastUpdated"), formatDateTime(lead.updatedAt, lang))}
            </section>

            <section style={card}>
              <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{t("adm.followUp")}</h2>
              <div style={{ fontSize: 13.5, marginBottom: 10, color: isOverdue(lead.followUpAt) && isOpen ? "#B91C1C" : undefined, fontWeight: 600 }}>
                {lead.followUpAt ? formatDateTime(lead.followUpAt, lang) : t("adm.noFollowUp")}
                {lead.followUpAt && isOverdue(lead.followUpAt) && isOpen ? ` (${t("adm.overdue")})` : ""}
              </div>
              {editable && isOpen && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <DatePicker value={followDate} onChange={setFollowDate} style={{ flex: "1 1 140px" }} />
                  <TimePicker value={followTime} onChange={setFollowTime} style={{ width: 110 }} />
                  <button
                    type="button"
                    className="btn"
                    style={primaryBtn}
                    disabled={!followDate || busy}
                    onClick={() => run(() => leadsApi.followUp(lead.id, toIsoFromParts(followDate, followTime)), () => setFollowDate(""))}
                  >
                    {t("adm.setFollowUp")}
                  </button>
                  {lead.followUpAt && (
                    <button type="button" className="btn" style={ghostBtn} disabled={busy} onClick={() => run(() => leadsApi.followUp(lead.id, null))}>
                      {t("adm.clearFollowUp")}
                    </button>
                  )}
                </div>
              )}
            </section>

            <section style={card}>
              <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{t("adm.trials")}</h2>
              {(lead.trials ?? []).length === 0 ? (
                <p style={{ fontSize: 13, color: "#8A8D96" }}>{t("adm.noTrials")}</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                  {lead.trials!.map((tr) => (
                    <li key={tr.id} style={{ border: "1px solid #F2F1EC", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 13.5 }}>{formatDateTime(tr.scheduledAt, lang)} · {tr.durationMinutes}′</strong>
                        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, ...TRIAL_STYLE[tr.status] }}>{t(trialKey(tr.status))}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: "#5B5F6A" }}>
                        {[tr.group?.name, tr.teacher?.fullName, tr.room?.name].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {tr.outcomeNote && <div style={{ fontSize: 12.5, color: "#8A8D96" }}>{tr.outcomeNote}</div>}
                      {editable && tr.status === "BOOKED" && (
                        <div className="adm-actions">
                          <button type="button" className="btn" style={{ ...primaryBtn, padding: "6px 12px", fontSize: 12 }} disabled={busy} onClick={() => run(() => leadsApi.attendTrial(lead.id, tr.id))}>{t("adm.trialAttend")}</button>
                          <button type="button" className="btn" style={{ ...ghostBtn, padding: "6px 12px", fontSize: 12 }} disabled={busy} onClick={() => run(() => leadsApi.missTrial(lead.id, tr.id))}>{t("adm.trialMiss")}</button>
                          <button type="button" className="btn" style={{ ...ghostBtn, padding: "6px 12px", fontSize: 12 }} onClick={() => openDialog({ kind: "trial", reschedule: tr })}>{t("adm.trialReschedule")}</button>
                          <button type="button" className="btn" style={{ ...dangerBtn, padding: "6px 12px", fontSize: 12 }} disabled={busy} onClick={() => run(() => leadsApi.cancelTrial(lead.id, tr.id))}>{t("adm.trialCancel")}</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section style={card}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{t("adm.timeline")}</h2>
            {editable && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!activityBody.trim()) return;
                  run(() => leadsApi.addActivity(lead.id, activityType, activityBody.trim()), () => setActivityBody(""));
                }}
                style={{ display: "grid", gap: 8, marginBottom: 14 }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["CALL", "MESSAGE", "MEETING", "NOTE"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={activityType === k}
                      onClick={() => setActivityType(k)}
                      className="btn"
                      style={{ ...ghostBtn, padding: "5px 12px", fontSize: 12, ...(activityType === k ? { background: "#EEF0FF", borderColor: "#C7D2FE", color: ACCENT } : {}) }}
                    >
                      {t(`adm.activity.${k}` as TranslationKey)}
                    </button>
                  ))}
                </div>
                <textarea className="field-input" rows={2} placeholder={t("adm.activityBody")} value={activityBody} onChange={(e) => setActivityBody(e.target.value)} maxLength={5000} />
                <div>
                  <button type="submit" className="btn" style={primaryBtn} disabled={busy || !activityBody.trim()}>{t("adm.addActivity")}</button>
                </div>
              </form>
            )}
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 0 }}>
              {timeline.map((a) => (
                <li key={a.id} style={{ borderLeft: "2px solid #EAE8E2", padding: "0 0 14px 14px", position: "relative" }}>
                  <span style={{ position: "absolute", left: -6, top: 3, width: 10, height: 10, borderRadius: 999, background: a.toStatus ? ACCENT : "#C9C7C0" }} />
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {activityTitle(a, t)}
                    {a.fromStatus && a.toStatus && (
                      <span style={{ fontWeight: 500, color: "#5B5F6A" }}> · {t(statusKey(a.fromStatus))} → {t(statusKey(a.toStatus))}</span>
                    )}
                    {a.type === "LOST" && typeof a.metadata?.reason === "string" && (
                      <span style={{ fontWeight: 500, color: "#B91C1C" }}> · {t(lostKey(a.metadata.reason as LeadLostReason))}</span>
                    )}
                  </div>
                  {a.body && <div style={{ fontSize: 13, whiteSpace: "pre-wrap", marginTop: 3 }}>{a.body}</div>}
                  <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 3 }}>
                    {formatDateTime(a.occurredAt, lang)} · {a.actor?.fullName ?? t("adm.system")}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {editOpen && <LeadFormModal open={editOpen} lead={lead} onClose={() => setEditOpen(false)} onSaved={() => load()} />}
      {convertOpen && <ConvertWizard lead={lead} open={convertOpen} onClose={() => setConvertOpen(false)} />}

      <Modal
        open={dialog !== null}
        onClose={() => !busy && setDialog(null)}
        title={
          dialog?.kind === "lose" ? t("adm.markLost")
            : dialog?.kind === "reopen" ? t("adm.reopen")
            : dialog?.kind === "sms" ? t("adm.sendSms")
            : dialog?.kind === "trial" ? (dialog.reschedule ? t("adm.trialReschedule") : t("adm.bookTrial"))
            : ""
        }
        width={520}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const close = () => setDialog(null);
            if (dialog?.kind === "lose") run(() => leadsApi.lose(lead.id, lostReason, note.trim()), close);
            if (dialog?.kind === "reopen") run(() => leadsApi.reopen(lead.id, note.trim()), close);
            if (dialog?.kind === "sms") {
              run(async () => {
                await notificationsApi.sendTest({ recipient: lead.phone, channel: "SMS", content: smsText.trim(), title: "Lid" });
                await leadsApi.addActivity(lead.id, "MESSAGE", `SMS: ${smsText.trim()}`);
              }, close);
            }
            if (dialog?.kind === "trial") {
              const scheduledAt = toIsoFromParts(trialDate, trialTime);
              setConflicts([]);
              if (dialog.reschedule) {
                run(() => leadsApi.rescheduleTrial(lead.id, dialog.reschedule!.id, { scheduledAt, note: note.trim() || undefined }), close);
              } else {
                run(() => leadsApi.bookTrial(lead.id, {
                  scheduledAt,
                  durationMinutes: Number(trialDuration) || 60,
                  groupId: trialGroup || undefined,
                  teacherId: trialTeacher || undefined,
                  note: note.trim() || undefined,
                }), close);
              }
            }
          }}
          style={{ display: "grid", gap: 12 }}
        >
          {dialog?.kind === "lose" && (
            <>
              <div>
                <label style={label}>{t("adm.lostReason")} *</label>
                <Select value={lostReason} onChange={(v) => setLostReason(v as LeadLostReason)} options={LOST_REASONS.map((r) => ({ value: r, label: t(lostKey(r)) }))} />
              </div>
              <div>
                <label style={label}>{lostReason === "OTHER" ? t("adm.lostNoteRequired") : t("adm.noteOptional")}</label>
                <textarea className="field-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required={lostReason === "OTHER"} minLength={lostReason === "OTHER" ? 3 : undefined} />
              </div>
            </>
          )}
          {dialog?.kind === "reopen" && (
            <div>
              <label style={label}>{t("adm.reopenNote")} *</label>
              <textarea className="field-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} />
            </div>
          )}
          {dialog?.kind === "sms" && (
            <textarea className="field-input" rows={4} value={smsText} onChange={(e) => setSmsText(e.target.value)} required maxLength={480} />
          )}
          {dialog?.kind === "trial" && (
            <>
              <div className="adm-grid2">
                <div>
                  <label style={label}>{t("adm.trialDate")} *</label>
                  <DatePicker value={trialDate} onChange={setTrialDate} />
                </div>
                <div>
                  <label style={label}>{t("adm.trialTime")} *</label>
                  <TimePicker value={trialTime} onChange={setTrialTime} />
                </div>
                {!dialog.reschedule && (
                  <>
                    <div>
                      <label style={label}>{t("adm.trialGroup")}</label>
                      <Select
                        value={trialGroup}
                        onChange={setTrialGroup}
                        options={[{ value: "", label: t("common.notSelected") }, ...groups.filter((g) => g.status !== "ARCHIVED" && g.status !== "COMPLETED").map((g) => ({ value: g.id, label: g.name }))]}
                      />
                    </div>
                    <div>
                      <label style={label}>{t("adm.trialTeacher")}</label>
                      <Select
                        value={trialTeacher}
                        onChange={setTrialTeacher}
                        options={[{ value: "", label: t("common.notSelected") }, ...teachers.map((tc) => ({ value: tc.id, label: tc.fullName }))]}
                      />
                    </div>
                    <div>
                      <label style={label}>{t("adm.trialDuration")}</label>
                      <input className="field-input" inputMode="numeric" value={trialDuration} onChange={(e) => setTrialDuration(e.target.value.replace(/\D/g, ""))} />
                    </div>
                  </>
                )}
              </div>
              <div>
                <label style={label}>{t("adm.noteOptional")}</label>
                <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {conflicts.length > 0 && (
                <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 700, color: "#B91C1C", fontSize: 13 }}>{t("adm.conflictTitle")}</div>
                  <ul style={{ margin: "6px 0 0 16px", fontSize: 12.5, color: "#7F1D1D" }}>
                    {conflicts.map((c, i) => <li key={i}>{c.message}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
          {actionError && conflicts.length === 0 && <div role="alert" style={{ color: "#B91C1C", fontSize: 13, fontWeight: 600 }}>{actionError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn" style={ghostBtn} disabled={busy} onClick={() => setDialog(null)}>{t("common.cancel")}</button>
            <button
              type="submit"
              className="btn"
              style={{ ...(dialog?.kind === "lose" ? { ...primaryBtn, background: "#B91C1C" } : primaryBtn), opacity: busy ? 0.7 : 1 }}
              disabled={busy || (dialog?.kind === "trial" && !trialDate)}
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export default function LeadProfilePage() {
  return (
    <DashboardShell>
      <LeadProfile />
    </DashboardShell>
  );
}
