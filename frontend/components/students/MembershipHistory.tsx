"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { studentsApi, type MembershipStay } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Every stay of the student in a group: when it began and ended, and why.
 * A stay taken over from before the history was kept is marked as such -
 * its start is the last joining that was known, and earlier stays may have
 * existed. `refreshKey` changes when the student or their groups change.
 */
export default function MembershipHistory({ studentId, refreshKey }: { studentId: string; refreshKey?: string | number }) {
  const { t, lang } = useLanguage();
  const [stays, setStays] = useState<MembershipStay[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    studentsApi
      .memberships(studentId)
      .then((list) => alive && setStays(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [studentId, refreshKey, nonce]);

  return (
    <section aria-label={t("mh.title")} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, minWidth: 0 }}>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t("mh.title")}</div>
      <div style={{ fontSize: 12.5, color: "#686B75", marginBottom: 12, lineHeight: 1.5 }}>{t("mh.hint")}</div>
      {failed ? (
        <div role="alert" style={{ fontSize: 13, fontWeight: 600, color: "#B23A47", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {t("mh.error")}
          <button type="button" className="btn" onClick={() => setNonce((n) => n + 1)} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 8, padding: "5px 10px", fontSize: 12.5, fontWeight: 700 }}>{t("err.retry")}</button>
        </div>
      ) : stays === null ? (
        <div style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
      ) : stays.length === 0 ? (
        <div style={{ fontSize: 13, color: "#686B75" }}>{t("mh.empty")}</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {stays.map((s) => (
            <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", background: "#FAF9F6", borderRadius: 10, padding: "9px 12px", fontSize: 13 }}>
              <span style={{ minWidth: 0 }}>
                <Link href={`/groups/${s.groupId}`} style={{ fontWeight: 700, color: "#181A1F" }}>{s.groupName}</Link>
                <span style={{ color: "#686B75" }}>
                  {" · "}
                  {formatDate(s.startedAt, lang, "short")} – {s.endedAt ? formatDate(s.endedAt, lang, "short") : t("mh.now")}
                  {s.endedAt && s.endReason ? ` · ${t(`mh.reason.${s.endReason}` as TranslationKey)}` : ""}
                </span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: 100, whiteSpace: "nowrap", background: s.endedAt ? "#F2F1EC" : "#E9F8EF", color: s.endedAt ? "#686B75" : "#16794A" }}>
                {s.endedAt ? t("mh.ended") : t("mh.current")}
                {s.source === "LEGACY" ? ` · ${t("mh.legacy")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
