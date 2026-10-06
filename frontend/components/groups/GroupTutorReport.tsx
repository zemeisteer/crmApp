"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { aiApi, ApiError, type TutorReport } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format-date";
import MarkdownLite from "@/components/MarkdownLite";

const ACCENT = "#4F46E5";
const PERIODS = [7, 14, 30] as const;

// What the group's students asked the AI tutor (Telegram bot and web
// cabinet): who asks and what about, plus topics grouped by AI on request.
export default function GroupTutorReport({ groupId }: { groupId: string }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(14);
  const [report, setReport] = useState<TutorReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [topics, setTopics] = useState<string | null>(null);
  const [topicsBusy, setTopicsBusy] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    aiApi
      .tutorReport(groupId, days)
      .then((r) => live && (setReport(r), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [groupId, days]);

  async function findTopics() {
    setTopicsBusy(true);
    setTopicsError(null);
    try {
      const res = await aiApi.tutorTopics(groupId, days);
      setTopics(res.summary);
    } catch (err) {
      setTopicsError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setTopicsBusy(false);
    }
  }

  if (failed) return null; // e.g. no access: the rest of the page still works

  const asked = report?.students.filter((s) => s.questions > 0) ?? [];
  const silent = report?.students.filter((s) => s.questions === 0) ?? [];

  return (
    <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>🤖 {t("tutorRep.title")}</div>
          <div style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 2 }}>{t("tutorRep.hint")}</div>
        </div>
        <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 9, padding: 3 }}>
          {PERIODS.map((d) => (
            <button key={d} type="button" onClick={() => { setDays(d); setTopics(null); }} style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 7, background: days === d ? "#fff" : "transparent", color: days === d ? "#181A1F" : "#8A8D96" }}>
              {t("tutorRep.days").replace("{n}", String(d))}
            </button>
          ))}
        </div>
      </div>

      {!report ? (
        <div style={{ padding: "0 20px 18px", fontSize: 13, color: "#8A8D96" }}>{t("common.loading")}</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, padding: "0 20px 16px" }}>
            {[
              { label: t("tutorRep.questions"), value: report.totalQuestions, color: ACCENT },
              { label: t("tutorRep.active"), value: `${report.activeStudents}/${report.studentCount}`, color: "#181A1F" },
              { label: t("tutorRep.perStudent"), value: report.activeStudents ? Math.round((report.totalQuestions / report.activeStudents) * 10) / 10 : 0, color: "#181A1F" },
            ].map((c) => (
              <div key={c.label} style={{ background: "#F7F6F2", borderRadius: 12, padding: "10px 14px", minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "#8A8D96", fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20, color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          {report.totalQuestions === 0 ? (
            <div style={{ padding: "4px 20px 20px", fontSize: 13.5, color: "#6B6E78", lineHeight: 1.55 }}>
              {t("tutorRep.none")}
              {/* Settings open only for the owner and admins. */}
              {user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN" ? (
                <>
                  {" "}{t("tutorRep.limitHint")}{" "}
                  <Link href="/settings" style={{ color: ACCENT, fontWeight: 700, textDecoration: "none" }}>{t("tutorRep.settings")}</Link>
                </>
              ) : null}
            </div>
          ) : (
            <>
              <div style={{ margin: "0 20px 16px", border: "1px solid #E0E7FF", background: "#F8F8FF", borderRadius: 12, padding: 14 }}>
                {topics ? (
                  <MarkdownLite text={topics} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13.5, color: "#3730A3", flex: 1, minWidth: 200 }}>{t("tutorRep.topicsHint")}</div>
                    <button type="button" onClick={findTopics} disabled={topicsBusy} className="btn" style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: topicsBusy ? 0.7 : 1 }}>
                      {topicsBusy ? t("tutorRep.topicsBusy") : `✨ ${t("tutorRep.topicsBtn")}`}
                    </button>
                  </div>
                )}
                {topicsError && <div role="alert" style={{ marginTop: 8, fontSize: 13, color: "#B91C1C" }}>{topicsError}</div>}
              </div>

              <div>
                {asked.map((s) => (
                  <div key={s.studentId} style={{ borderTop: "1px solid #F0EEE8" }}>
                    <button type="button" onClick={() => setOpen(open === s.studentId ? null : s.studentId)} aria-expanded={open === s.studentId} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#181A1F" }}>{s.fullName}</span>
                        {s.lastAt && <span style={{ display: "block", fontSize: 12, color: "#8A8D96" }}>{t("tutorRep.last")}: {formatDate(s.lastAt, lang)}</span>}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: ACCENT, background: "#EEF0FF", padding: "4px 10px", borderRadius: 100, whiteSpace: "nowrap" }}>
                        {t("tutorRep.count").replace("{n}", String(s.questions))}
                      </span>
                      <span aria-hidden style={{ color: "#8A8D96" }}>{open === s.studentId ? "▴" : "▾"}</span>
                    </button>
                    {open === s.studentId && (
                      <div style={{ padding: "0 20px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                        {s.recent.map((q, i) => (
                          <div key={i} style={{ background: "#F7F7F5", borderRadius: 10, padding: "8px 12px", fontSize: 13.5, color: "#33363D", overflowWrap: "anywhere" }}>
                            “{q.text}”
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {silent.length > 0 && (
                  <div style={{ borderTop: "1px solid #F0EEE8", padding: "12px 20px 16px", fontSize: 12.5, color: "#8A8D96" }}>
                    {t("tutorRep.silent")}: {silent.map((s) => s.fullName).join(", ")}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
