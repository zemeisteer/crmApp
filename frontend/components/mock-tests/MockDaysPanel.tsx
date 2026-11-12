"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, groupsApi, mockTestsApi, MOCK_SECTIONS, type Group, type MockProgress, type MockSessionRow, type MockSessionTable, type MockTestSummary } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { bandColor } from "@/components/mock-tests/FeedbackView";
import { sectionKey } from "@/components/mock-tests/sections";
import ProgressChart from "@/components/mock-tests/ProgressChart";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16 };
const ACCENT = "var(--primary)";
const btn: React.CSSProperties = { background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "9px 14px", fontWeight: 700, cursor: "pointer" };
const ghost: React.CSSProperties = { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 12px", fontWeight: 700, cursor: "pointer" };

// "datetime-local" value for a time one day ahead at 10:00, local time.
function tomorrowAt10() {
  const d = new Date(Date.now() + 86400_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

// Mock days: a whole group sits one published IELTS test at a set time;
// the group's results come in one table, a student's progress one click away.
export default function MockDaysPanel({ tests, onClose }: { tests: MockTestSummary[]; onClose: () => void }) {
  const { t } = useLanguage();
  const [list, setList] = useState<MockSessionRow[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const published = tests.filter((x) => x.status === "PUBLISHED" && x.kind !== "PRACTICE");
  const [testId, setTestId] = useState(published[0]?.id ?? "");
  const [groupId, setGroupId] = useState("");
  const [when, setWhen] = useState(tomorrowAt10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<MockSessionTable | null>(null);
  const [progress, setProgress] = useState<{ name: string; data: MockProgress } | null>(null);

  const fail = useCallback((e: unknown) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")), [t]);
  const load = useCallback(() => { mockTestsApi.sessions().then(setList).catch(fail); }, [fail]);
  useEffect(() => {
    load();
    groupsApi.list({ status: "ACTIVE" }).then((g) => { setGroups(g); setGroupId((v) => v || g[0]?.id || ""); }).catch(() => setGroups([]));
  }, [load]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!testId || !groupId || !when) return;
    setBusy(true);
    setError(null);
    try {
      await mockTestsApi.createSession({ testId, groupId, startsAt: new Date(when).toISOString() });
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function openTable(id: string) {
    setError(null);
    setProgress(null);
    try { setTable(await mockTestsApi.session(id)); } catch (err) { fail(err); }
  }

  async function remove(id: string) {
    if (!confirm(t("mock.dayRemove") + "?")) return;
    try {
      await mockTestsApi.removeSession(id);
      if (table?.id === id) setTable(null);
      load();
    } catch (err) {
      fail(err);
    }
  }

  async function showProgress(studentId: string, name: string) {
    try { setProgress({ name, data: await mockTestsApi.studentProgress(studentId) }); } catch (err) { fail(err); }
  }

  const fmt = (d: string) => new Date(d).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const statusLabel = (s: string) => (s === "COMPLETED" ? t("mock.dayDone") : s === "IN_PROGRESS" ? t("mock.dayInProgress") : t("mock.dayNotStarted"));

  return (
    <section data-testid="mock-days" style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>🗓 {t("mock.days")}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("mock.daysHint")}</div>
        </div>
        <button type="button" onClick={onClose} style={ghost} aria-label={t("common.close")}>×</button>
      </div>
      {error && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: "var(--radius-sm)", fontSize: 13 }}>{error}</div>}

      <form onSubmit={book} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-soft)" }}>{t("mock.dayTest")}
          <select className="field-input" value={testId} onChange={(e) => setTestId(e.target.value)} required style={{ marginTop: 4 }}>
            {published.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-soft)" }}>{t("mock.dayGroup")}
          <select className="field-input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required style={{ marginTop: 4 }}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-soft)" }}>{t("mock.dayWhen")}
          <input className="field-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required style={{ marginTop: 4 }} />
        </label>
        <button type="submit" disabled={busy || !testId || !groupId} style={btn}>+ {t("mock.dayNew")}</button>
      </form>

      {list === null ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</div>
      ) : list.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("mock.dayNone")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: table?.id === s.id ? "var(--primary-soft)" : "transparent" }}>
              <button type="button" onClick={() => openTable(s.id)} style={{ flex: 1, minWidth: 200, textAlign: "left", background: "none", border: "none", cursor: "pointer", color: "var(--text)", padding: 0 }}>
                <b>{s.groupName}</b> · {s.testTitle}
                <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{fmt(s.startsAt)}</div>
              </button>
              <button type="button" onClick={() => remove(s.id)} style={{ ...ghost, color: "var(--danger)", padding: "6px 10px" }}>{t("mock.dayRemove")}</button>
            </div>
          ))}
        </div>
      )}

      {table && (
        <div data-testid="mock-day-table" style={{ overflowX: "auto" }}>
          <div style={{ fontWeight: 800, margin: "4px 0 8px" }}>{table.groupName} · {table.testTitle} · {fmt(table.startsAt)}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
                <th style={{ padding: "6px 8px" }}>{t("mock.student")}</th>
                <th style={{ padding: "6px 8px" }} />
                {MOCK_SECTIONS.map((s) => <th key={s} style={{ padding: "6px 8px", textAlign: "center" }}>{t(sectionKey(s))}</th>)}
                <th style={{ padding: "6px 8px", textAlign: "center" }}>{t("mock.overall")}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.studentId} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px" }}>
                    <button type="button" onClick={() => showProgress(r.studentId, r.fullName)} style={{ background: "none", border: "none", padding: 0, color: ACCENT, fontWeight: 700, cursor: "pointer" }}>{r.fullName}</button>
                  </td>
                  <td style={{ padding: "8px", fontSize: 12.5, color: r.status === "COMPLETED" ? "var(--success)" : r.status === "IN_PROGRESS" ? "var(--warning)" : "var(--text-muted)" }}>{statusLabel(r.status)}</td>
                  {MOCK_SECTIONS.map((s) => {
                    const c = r.sections[s];
                    return <td key={s} style={{ padding: "8px", textAlign: "center", fontWeight: 800, color: bandColor(c.band) }}>{c.band ?? (c.done ? (c.status === "PENDING" ? "⏳" : "✓") : "—")}</td>;
                  })}
                  <td style={{ padding: "8px", textAlign: "center", fontWeight: 800, color: bandColor(r.overall) }}>{r.overall ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {progress && (
        <div>
          <div style={{ fontWeight: 800, margin: "6px 0" }}>{progress.name}</div>
          <ProgressChart data={progress.data} card={{ ...card, padding: 12 }} />
        </div>
      )}
    </section>
  );
}
