"use client";

import { useEffect, useId, useState } from "react";
import { ApiError, type ChatClient, type ChatContacts, type ChatConversation, type ChatOpenDto } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { CHAT_ACCENT as ACCENT } from "./shared";

/**
 * Whom one may start a conversation with - only who the server offers
 * (/chat/contacts): a cabinet writes to the center, its current teachers and
 * its groups; a teacher to the students of their groups and their groups;
 * the center's inbox staff find a student by name (two letters or more).
 */
export default function NewConversation({
  client,
  teacher,
  onOpened,
  onClose,
}: {
  client: ChatClient;
  /** The staff member teaches (their contacts are their own students). */
  teacher: boolean;
  onOpened: (c: ChatConversation) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const uid = useId();
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<ChatContacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const cabinet = client.side === "cabinet";
  // The inbox search needs two letters (shorter asks only what is offered);
  // a teacher's own students filter as typed.
  const term = q.trim();
  const needsMore = !cabinet && !teacher && term.length < 2;
  const query = cabinet || needsMore ? "" : term;

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      client
        .contacts(query || undefined)
        .then((c) => {
          if (!alive) return;
          setContacts(c);
          setLoadFailed(false);
        })
        .catch(() => alive && setLoadFailed(true))
        .finally(() => alive && setLoading(false));
    }, query ? 300 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [client, query]);

  async function open(key: string, dto: ChatOpenDto) {
    setOpening(key);
    setError(null);
    try {
      onOpened(await client.open(dto));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("chat.openError"));
    } finally {
      setOpening(null);
    }
  }

  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: "1px solid #EAE8E2", background: "#fff", minWidth: 0 };
  const action: React.CSSProperties = { background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "6px 10px", borderRadius: 8, flexShrink: 0 };
  const heading: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, color: "#4A4E58", textTransform: "uppercase", letterSpacing: "0.04em", margin: "10px 0 6px" };
  // Staff who answer the center's inbox or teach search their students.
  const searchable = !cabinet && (teacher || contacts?.center === true);
  const students = needsMore ? [] : contacts?.students ?? [];
  const groups = contacts?.groups ?? [];
  const teachers = contacts?.teachers ?? [];
  const nothing = contacts && !loading && !(cabinet && contacts.center) && students.length === 0 && groups.length === 0 && teachers.length === 0 && !(searchable && needsMore);

  return (
    <div role="region" aria-labelledby={`${uid}-h`} style={{ padding: "12px 12px 14px", borderBottom: "1px solid #EAE8E2", background: "#F7F7F5", overflowY: "auto", maxHeight: "60%", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h3 id={`${uid}-h`} style={{ fontSize: 14, fontWeight: 800 }}>{t("chat.newTitle")}</h3>
        <button type="button" className="btn" onClick={onClose} aria-label={t("chat.closeNew")} style={{ background: "transparent", color: "#4A4E58", fontSize: 16, width: 30, height: 30, borderRadius: 8 }}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      {searchable && (
        <div style={{ marginTop: 8 }}>
          <label htmlFor={`${uid}-q`} style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#4A4E58", marginBottom: 4 }}>{t("chat.searchStudent")}</label>
          <input id={`${uid}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} className="field-input" autoComplete="off" placeholder={t("chat.searchPlaceholder")} style={{ padding: "9px 12px", fontSize: 14 }} />
          {needsMore && <div style={{ fontSize: 12, color: "#686B75", marginTop: 4 }}>{t("chat.searchHint")}</div>}
        </div>
      )}

      {loadFailed && <div role="alert" style={{ color: "#B23A47", fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>{t("chat.contactsError")}</div>}
      {error && <div role="alert" style={{ color: "#B23A47", fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>{error}</div>}
      {loading && !contacts && <div role="status" style={{ color: "#686B75", fontSize: 13, marginTop: 8 }}>{t("common.loading")}</div>}

      {cabinet && contacts?.center && (
        <>
          <div style={heading}>{t("chat.kind.centerCabinet")}</div>
          <div style={row}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700 }}>{t("chat.centerName")}</span>
            <button type="button" className="btn" style={action} disabled={opening !== null} onClick={() => open("center", { kind: "STUDENT_CENTER" })} aria-label={`${t("chat.write")}: ${t("chat.centerName")}`}>
              {t("chat.write")}
            </button>
          </div>
        </>
      )}

      {teachers.length > 0 && (
        <>
          <div style={heading}>{t("chat.teachers")}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {teachers.map((x) => (
              <li key={x.userId} style={row}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{x.name}</span>
                <button type="button" className="btn" style={action} disabled={opening !== null} onClick={() => open(`t:${x.userId}`, { kind: "STUDENT_TEACHER", teacherUserId: x.userId })} aria-label={`${t("chat.write")}: ${x.name}`}>
                  {t("chat.write")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {students.length > 0 && (
        <>
          <div style={heading}>{t("chat.students")}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {students.map((s) => (
              <li key={s.id} style={{ ...row, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 120px", minWidth: 0, fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{s.name}</span>
                {teacher && (
                  <button type="button" className="btn" style={action} disabled={opening !== null} onClick={() => open(`s:${s.id}`, { kind: "STUDENT_TEACHER", studentId: s.id })} aria-label={`${t("chat.write")}: ${s.name}`}>
                    {t("chat.write")}
                  </button>
                )}
                {contacts?.center && (
                  <button
                    type="button"
                    className="btn"
                    style={teacher ? { ...action, background: "#fff", color: ACCENT, border: `1px solid ${ACCENT}` } : action}
                    disabled={opening !== null}
                    onClick={() => open(`c:${s.id}`, { kind: "STUDENT_CENTER", studentId: s.id })}
                    aria-label={`${teacher ? t("chat.writeAsCenter") : t("chat.write")}: ${s.name}`}
                  >
                    {teacher ? t("chat.writeAsCenter") : t("chat.write")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {groups.length > 0 && (
        <>
          <div style={heading}>{t("chat.groups")}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {groups.map((g) => (
              <li key={g.id} style={row}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{g.name}</span>
                <button type="button" className="btn" style={action} disabled={opening !== null} onClick={() => open(`g:${g.id}`, { kind: "GROUP", groupId: g.id })} aria-label={`${t("chat.write")}: ${g.name}`}>
                  {t("chat.write")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {nothing && <div style={{ color: "#686B75", fontSize: 13, marginTop: 10 }}>{searchable && term ? t("chat.noMatches") : t("chat.noContacts")}</div>}
    </div>
  );
}
