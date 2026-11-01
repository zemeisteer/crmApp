"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { aiApi, ApiError, type TutorReport } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format-date";
import MarkdownLite from "@/components/MarkdownLite";

const ACCENT = "var(--primary)";
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
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>🤖 {t("tutorRep.title")}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{t("tutorRep.hint")}</div>
        </div>
        <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: 3 }}>
          {PERIODS.map((d) => (
            <button key={d} type="button" onClick={() => { setDays(d); setTopics(null); }} style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: "var(--radius-xs)", background: days === d ? "var(--surface)" : "transparent", color: days === d ? "var(--text)" : "var(--text-muted)" }}>
              {t("tutorRep.days").replace("{n}", String(d))}
            </button>
          ))}
        </div>
      </div>

      {!report ? (
        <div style={{ padding: "0 20px 18px", fontSize: 13, color: "var(--text-muted)" }}>{t("common.loading")}</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, padding: "0 20px 16px" }}>
            {[
              { label: t("tutorRep.questions"), value: report.totalQuestions, color: ACCENT },
              { label: t("tutorRep.active"), value: `${report.activeStudents}/${report.studentCount}`, color: "var(--text)" },
              { label: t("tutorRep.perStudent"), value: report.activeStudents ? Math.round((report.totalQuestions / report.activeStudents) * 10) / 10 : 0, color: "var(--text)" },
            ].map((c) => (
              <div key={c.label} style={{ background: "var(--surface-muted)", borderRadius: "var(--radius-md)", padding: "10px 14px", minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          {report.totalQuestions === 0 ? (
            <div style={{ padding: "4px 20px 20px", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
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
              <div style={{ margin: "0 20px 16px", border: "1px solid var(--primary-border)", background: "var(--primary-soft)", borderRadius: "var(--radius-md)", padding: 14 }}>
                {topics ? (
                  <MarkdownLite text={topics} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 13.5, color: "var(--primary)", flex: 1, minWidth: 200 }}>{t("tutorRep.topicsHint")}</div>
                    <button type="button" onClick={findTopics} disabled={topicsBusy} className="btn" style={{ background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: topicsBusy ? 0.7 : 1 }}>
                      {topicsBusy ? t("tutorRep.topicsBusy") : t("tutorRep.topicsBtn")}
                    </button>
                  </div>
                )}
                {topicsError && <div role="alert" style={{ marginTop: 8, fontSize: 13, color: "var(--danger)" }}>{topicsError}</div>}
              </div>

              <div>
                {asked.map((s) => (
                  <div key={s.studentId} style={{ borderTop: "1px solid var(--border)" }}>
                    <button type="button" onClick={() => setOpen(open === s.studentId ? null : s.studentId)} aria-expanded={open === s.studentId} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{s.fullName}</span>
                        {s.lastAt && <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>{t("tutorRep.last")}: {formatDate(s.lastAt, lang)}</span>}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: ACCENT, background: "var(--primary-soft)", padding: "4px 10px", borderRadius: "var(--radius-pill)", whiteSpace: "nowrap" }}>
                        {t("tutorRep.count").replace("{n}", String(s.questions))}
                      </span>
                      <span aria-hidden style={{ color: "var(--text-muted)" }}>{open === s.studentId ? "▴" : "▾"}</span>
                    </button>
                    {open === s.studentId && (
                      <div style={{ padding: "0 20px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                        {s.recent.map((q, i) => (
                          <div key={i} style={{ background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "8px 12px", fontSize: 13.5, color: "var(--text-soft)", overflowWrap: "anywhere" }}>
                            “{q.text}”
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {silent.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "12px 20px 16px", fontSize: 12.5, color: "var(--text-muted)" }}>
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
