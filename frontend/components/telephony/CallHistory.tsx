"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, callsApi, type CallLogItem } from "@/lib/api";
import { formatDateTime } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";
import Badge from "@/components/ui/Badge";
import { prettyPhone, talkTime, useCallsMe } from "./useCallsMe";

/** ▶ for a recording: the provider's link is asked for at the press (links expire). */
export function RecordingPlay({ call }: { call: CallLogItem }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!call.hasRecording) return null;
  if (!call.canPlay) return <span title={t("tel.recordingAdminsOnly")} style={{ fontSize: 12, color: "var(--text-faint)" }}>🔒</span>;
  if (url) {
    return (
      <audio controls autoPlay src={url} preload="none" style={{ height: 32, maxWidth: 240 }} aria-label={t("tel.recording")} />
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="btn btn-sm"
        data-testid="play-recording"
        disabled={busy}
        aria-label={t("tel.play")}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setUrl((await callsApi.recording(call.id)).url);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : t("tel.recordingFailed"));
          } finally {
            setBusy(false);
          }
        }}
        style={{ background: "var(--surface-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "4px 10px", fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}
      >
        ▶ {t("tel.play")}
      </button>
      {error && <span role="status" style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
    </span>
  );
}

export function statusTone(c: Pick<CallLogItem, "status">) {
  return c.status === "ANSWERED" ? "success" : c.status === "MISSED" ? "danger" : "warning";
}

export function CallRow({ c, showContact }: { c: CallLogItem; showContact?: boolean }) {
  const { t, lang } = useLanguage();
  const contactName = c.leadName ?? c.studentName;
  const href = c.contactKind === "LEAD" && c.leadId ? `/leads/${c.leadId}` : c.studentId ? `/students/${c.studentId}` : null;
  return (
    <li data-testid="call-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      <span aria-hidden style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", background: c.direction === "INBOUND" ? "var(--info-soft)" : "var(--violet-soft)", color: c.direction === "INBOUND" ? "var(--info)" : "var(--violet)", fontSize: 14, flexShrink: 0 }}>
        {c.direction === "INBOUND" ? "↙" : "↗"}
      </span>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {showContact && href && contactName ? <Link href={href} style={{ color: "var(--text)" }}>{contactName}</Link> : <span>{prettyPhone(c.clientNumber)}</span>}
          <Badge tone={statusTone(c)}>{t(c.status === "ANSWERED" ? "tel.statusAnswered" : c.status === "MISSED" ? "tel.statusMissed" : "tel.statusRinging")}</Badge>
          {c.contactKind === "PARENT" && <Badge tone="violet">{t("tel.parent")}</Badge>}
          {c.createdLead && <Badge tone="accent">{t("tel.newLead")}</Badge>}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {t(c.direction === "INBOUND" ? "tel.inbound" : "tel.outbound")} · {formatDateTime(c.startedAt, lang)}
          {c.status === "ANSWERED" ? ` · ${talkTime(c.durationSec)}` : ""}
          {c.managerName ? ` · ${c.managerName}` : ""}
          {showContact && contactName && contactName !== prettyPhone(c.clientNumber) ? ` · ${prettyPhone(c.clientNumber)}` : ""}
        </div>
      </div>
      <RecordingPlay call={c} />
    </li>
  );
}

/** The "Calls" part of a lead's or a student's card. */
export default function CallHistory({ leadId, studentId }: { leadId?: string; studentId?: string }) {
  const { t } = useLanguage();
  const me = useCallsMe();
  const [items, setItems] = useState<CallLogItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (before?: string) => {
    try {
      const r = await callsApi.list({ leadId, studentId, limit: 20, before });
      setItems((prev) => (before && prev ? [...prev, ...r.items] : r.items));
      setHasMore(r.hasMore);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("tel.loadFailed"));
    }
  }, [leadId, studentId, t]);

  // The first page; "more" pages through load().
  useEffect(() => {
    if (!me.canView) return;
    let live = true;
    callsApi.list({ leadId, studentId, limit: 20 }).then(
      (r) => {
        if (!live) return;
        setItems(r.items);
        setHasMore(r.hasMore);
      },
      (e) => live && setError(e instanceof ApiError ? e.message : t("tel.loadFailed")),
    );
    return () => {
      live = false;
    };
  }, [me.canView, leadId, studentId, t]);

  if (!me.canView) return null;
  return (
    <section data-testid="call-history" aria-labelledby="call-history-title" style={{ background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "var(--radius-lg)", padding: "16px 20px" }}>
      <h2 id="call-history-title" style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{t("tel.historyTitle")}</h2>
      {error && <div role="alert" style={{ fontSize: 13, color: "var(--danger)" }}>{error}</div>}
      {items === null && !error && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>…</div>}
      {items && items.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "6px 0" }}>{t("tel.historyEmpty")}</div>}
      {items && items.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((c) => <CallRow key={c.id} c={c} />)}
        </ul>
      )}
      {hasMore && items && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => void load(items[items.length - 1].startedAt)}>
          {t("tel.more")}
        </button>
      )}
    </section>
  );
}
