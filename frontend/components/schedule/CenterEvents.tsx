"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import {
  ApiError,
  centerEventsApi,
  type CenterEvent,
  type CenterEventAudience,
  type CenterEventFormat,
  type CenterEventKind,
  type Room,
} from "@/lib/api";

export const EVENT_KINDS: CenterEventKind[] = ["MEETING", "COMPETITION", "EVENT", "OTHER"];
const AUDIENCES: CenterEventAudience[] = ["STAFF", "STUDENTS", "ALL"];

export const KIND_STYLE: Record<CenterEventKind, { color: string; bg: string; border: string; icon: string }> = {
  MEETING: { color: "#0369A1", bg: "#E0F2FE", border: "#7DD3FC", icon: "👥" },
  COMPETITION: { color: "#B45309", bg: "#FEF3C7", border: "#FCD34D", icon: "🏆" },
  EVENT: { color: "#BE185D", bg: "#FCE7F3", border: "#F9A8D4", icon: "🎉" },
  OTHER: { color: "#4B5563", bg: "#F3F4F6", border: "#D1D5DB", icon: "📌" },
};

export const kindKey = (k: CenterEventKind) => `ev.kind.${k}` as TranslationKey;
const audienceKey = (a: CenterEventAudience) => `ev.audience.${a}` as TranslationKey;

/** Where it happens, in one line: the link's host, a room, or the place written down. */
export function eventPlace(ev: CenterEvent, t: (k: TranslationKey) => string): string {
  if (ev.format === "ONLINE") {
    if (!ev.meetingUrl) return t("ev.online");
    try {
      return `${t("ev.online")} · ${new URL(ev.meetingUrl).host}`;
    } catch {
      return t("ev.online");
    }
  }
  return [ev.room?.name, ev.location].filter(Boolean).join(" · ") || t("ev.offline");
}

/** A small card for a day column of the timetable. */
export function EventCard({ ev, onOpen }: { ev: CenterEvent; onOpen?: () => void }) {
  const { t } = useLanguage();
  const s = KIND_STYLE[ev.kind] ?? KIND_STYLE.OTHER;
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: s.color, fontSize: 11.5 }}>
        <span aria-hidden>{s.icon}</span>
        <span>
          {ev.startTime}
          {ev.endTime ? `–${ev.endTime}` : ""} · {t(kindKey(ev.kind))}
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, color: "#111827", marginTop: 3 }}>{ev.title}</div>
      <div style={{ fontSize: 11.5, color: "#4B5563", marginTop: 2 }}>{eventPlace(ev, t)}</div>
    </>
  );
  const style: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: s.bg,
    border: `1px solid ${s.border}`,
    borderLeft: `4px solid ${s.color}`,
    borderRadius: 10,
    padding: "8px 10px",
    cursor: onOpen ? "pointer" : "default",
    font: "inherit",
  };
  return onOpen ? (
    <button type="button" data-testid="schedule-event" onClick={onOpen} style={style}>
      {body}
    </button>
  ) : (
    <div data-testid="schedule-event" style={style}>
      {body}
    </div>
  );
}

const label: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };

/** Adds or edits an event; deleting is offered when editing. */
export function EventFormModal({
  event,
  rooms,
  defaultDate,
  canManage,
  onClose,
  onSaved,
}: {
  event: CenterEvent | null;
  rooms: Room[];
  defaultDate: string;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(event?.title ?? "");
  const [kind, setKind] = useState<CenterEventKind>(event?.kind ?? "MEETING");
  const [format, setFormat] = useState<CenterEventFormat>(event?.format ?? "OFFLINE");
  const [date, setDate] = useState(event?.date ?? defaultDate);
  const [startTime, setStartTime] = useState(event?.startTime ?? "10:00");
  const [endTime, setEndTime] = useState(event?.endTime ?? "11:00");
  const [roomId, setRoomId] = useState(event?.roomId ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(event?.meetingUrl ?? "");
  const [audience, setAudience] = useState<CenterEventAudience>(event?.audience ?? "STAFF");
  const [description, setDescription] = useState(event?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readOnly = !canManage;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setError(null);
    if (title.trim().length < 2) return setError(t("ev.errTitle"));
    if (!date) return setError(t("ev.errDate"));
    if (!startTime) return setError(t("ev.errTime"));
    if (endTime && endTime <= startTime) return setError(t("ev.errEnd"));
    if (format === "ONLINE" && meetingUrl.trim() && !/^https?:\/\//i.test(meetingUrl.trim())) return setError(t("ev.errUrl"));
    const data = {
      title: title.trim(),
      kind,
      format,
      date,
      startTime,
      endTime: endTime || null,
      roomId: format === "OFFLINE" ? roomId || null : null,
      location: format === "OFFLINE" ? location.trim() || null : null,
      meetingUrl: format === "ONLINE" ? meetingUrl.trim() || null : null,
      audience,
      description: description.trim() || null,
    };
    setBusy(true);
    try {
      if (event) await centerEventsApi.update(event.id, data);
      else await centerEventsApi.create(data);
      onSaved(t(event ? "ev.updated" : "ev.added").replace("{title}", data.title));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event || !confirm(t("ev.deleteConfirm"))) return;
    setBusy(true);
    try {
      await centerEventsApi.remove(event.id);
      onSaved(t("ev.deleted").replace("{title}", event.title));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
      setBusy(false);
    }
  }

  const segBtn = (on: boolean): React.CSSProperties => ({
    flex: 1,
    fontSize: 12.5,
    fontWeight: 700,
    padding: "8px 10px",
    borderRadius: 8,
    border: "none",
    cursor: readOnly ? "default" : "pointer",
    background: on ? "#fff" : "transparent",
    color: on ? "#181A1F" : "#686B75",
    boxShadow: on ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
  });

  return (
    <Modal open onClose={onClose} title={event ? (readOnly ? event.title : t("ev.editTitle")) : t("ev.addTitle")} width={560}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
        {error && (
          <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
            {error}
          </div>
        )}
        <fieldset disabled={readOnly || busy} style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={label} htmlFor="ev-title">{t("ev.fieldTitle")} *</label>
            <input id="ev-title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("ev.titlePlaceholder")} />
          </div>
          <div>
            <span style={label}>{t("ev.fieldKind")}</span>
            <div role="group" aria-label={t("ev.fieldKind")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EVENT_KINDS.map((k) => {
                const on = kind === k;
                const s = KIND_STYLE[k];
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setKind(k)}
                    style={{ padding: "7px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? s.color : "#E2E0DA"}`, background: on ? s.bg : "#fff", color: on ? s.color : "#3A3D45" }}
                  >
                    {s.icon} {t(kindKey(k))}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <span style={label}>{t("ev.fieldFormat")}</span>
            <div role="group" aria-label={t("ev.fieldFormat")} style={{ display: "flex", gap: 2, background: "#F2F1EC", borderRadius: 10, padding: 4 }}>
              <button type="button" aria-pressed={format === "OFFLINE"} onClick={() => setFormat("OFFLINE")} style={segBtn(format === "OFFLINE")}>
                🏫 {t("ev.offline")}
              </button>
              <button type="button" aria-pressed={format === "ONLINE"} onClick={() => setFormat("ONLINE")} style={segBtn(format === "ONLINE")}>
                💻 {t("ev.online")}
              </button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <div>
              <span style={label}>{t("ev.fieldDate")} *</span>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div>
              <span style={label}>{t("ev.fieldStart")} *</span>
              <TimePicker value={startTime} onChange={setStartTime} />
            </div>
            <div>
              <span style={label}>{t("ev.fieldEnd")}</span>
              <TimePicker value={endTime} onChange={setEndTime} />
            </div>
          </div>
          {format === "ONLINE" ? (
            <div>
              <label style={label} htmlFor="ev-url">{t("ev.fieldUrl")}</label>
              <input id="ev-url" className="field-input" type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/..." />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {rooms.length > 0 && (
                <div>
                  <span style={label}>{t("ev.fieldRoom")}</span>
                  <Select
                    ariaLabel={t("ev.fieldRoom")}
                    value={roomId}
                    onChange={setRoomId}
                    options={[{ value: "", label: t("common.notSelected") }, ...rooms.map((r) => ({ value: r.id, label: r.name }))]}
                  />
                </div>
              )}
              <div>
                <label style={label} htmlFor="ev-place">{t("ev.fieldPlace")}</label>
                <input id="ev-place" className="field-input" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder={t("ev.placePlaceholder")} />
              </div>
            </div>
          )}
          <div>
            <span style={label}>{t("ev.fieldAudience")}</span>
            <Select
              ariaLabel={t("ev.fieldAudience")}
              value={audience}
              onChange={(v) => setAudience(v as CenterEventAudience)}
              options={AUDIENCES.map((a) => ({ value: a, label: t(audienceKey(a)) }))}
            />
          </div>
          <div>
            <label style={label} htmlFor="ev-desc">{t("ev.fieldDescription")}</label>
            <textarea id="ev-desc" className="field-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} style={{ resize: "vertical" }} />
          </div>
        </fieldset>
        {event?.format === "ONLINE" && event.meetingUrl && (
          <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>
            {t("ev.join")} ↗
          </a>
        )}
        {!readOnly && (
          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            {event ? (
              <button type="button" className="btn" onClick={remove} disabled={busy} style={{ background: "#FDEBEC", color: "#B23A47", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13.5 }}>
                {t("ev.delete")}
              </button>
            ) : (
              <span />
            )}
            <button type="submit" className="btn" disabled={busy} style={{ background: "#4F46E5", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 10, fontWeight: 700, fontSize: 13.5 }}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
