"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import MockTestEditor from "@/components/mock-tests/MockTestEditor";
import MockAttempts from "@/components/mock-tests/MockAttempts";
import ImportPanel from "@/components/mock-tests/ImportPanel";
import PracticeEditor from "@/components/mock-tests/PracticeEditor";
import PracticeAttempts from "@/components/mock-tests/PracticeAttempts";
import NewTestPanel, { type NewTestChoice } from "@/components/mock-tests/NewTestPanel";
import { levelKey } from "@/components/mock-tests/levels";
import { ApiError, isPracticeTest, mockTestsApi, type MockTest, type MockTestSummary, type PracticeTest } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/access";

const ACCENT = "var(--primary)";
const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16 };

// Mock and practice tests: IELTS (Listening / Reading / Writing / Speaking)
// and practice tests for any direction (SAT, math, programming...), published
// to the student cabinet, with the sittings to review.
function MockTestsContent() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canDelete = can(user, "mockTests.delete");
  const [tests, setTests] = useState<MockTestSummary[] | null>(null);
  const [open, setOpen] = useState<MockTest | null>(null);
  const [tab, setTab] = useState<"edit" | "results">("edit");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(() => {
    mockTestsApi.list().then(setTests).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [t]);
  useEffect(load, [load]);

  // The direction comes first; the starting point is one that fits it.
  async function create({ subject, sample, template }: NewTestChoice) {
    setBusy(true);
    setError(null);
    setPicking(false);
    try {
      const created = template
        ? await mockTestsApi.create({ kind: "PRACTICE", template, subject })
        : await mockTestsApi.create({ sample, subject });
      setOpen(created);
      setTab("edit");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function openTest(id: string, to: "edit" | "results" = "edit") {
    setError(null);
    try {
      setOpen(await mockTestsApi.get(id));
      setTab(to);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    }
  }

  async function remove(x: MockTestSummary) {
    if (!confirm(t("mock.deleteConfirm"))) return;
    try {
      await mockTestsApi.remove(x.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    }
    if (open?.id === x.id) setOpen(null);
    load();
  }

  if (open) {
    return (
      <div className="adm-page" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => { setOpen(null); load(); }} style={{ background: "none", border: "none", color: ACCENT, fontWeight: 700, cursor: "pointer", padding: 0 }}>← {t("mock.back")}</button>
          <div style={{ display: "flex", gap: 4, background: "var(--surface-muted)", padding: 4, borderRadius: "var(--radius-md)", marginLeft: "auto" }}>
            {(["edit", "results"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)} style={{ border: "none", cursor: "pointer", padding: "7px 14px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 700, background: tab === k ? "var(--surface)" : "transparent", color: tab === k ? ACCENT : "var(--text-muted)" }}>
                {k === "edit" ? `✎ ${t("mock.editTab")}` : `📊 ${t("mock.resultsTab")}`}
              </button>
            ))}
          </div>
        </div>
        {isPracticeTest(open)
          ? tab === "edit" ? <PracticeEditor key={open.id} test={open as unknown as PracticeTest} onSaved={setOpen} /> : <PracticeAttempts test={open as unknown as PracticeTest} />
          : tab === "edit" ? <MockTestEditor test={open} onSaved={setOpen} /> : <MockAttempts test={open} />}
      </div>
    );
  }

  return (
    <div className="adm-page" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t("mock.title")}</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0", maxWidth: 640 }}>{t("mock.intro")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setImporting(true)} style={{ background: "var(--ink)", color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>📥 {t("mimp.button")}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => setPicking((v) => !v)} aria-expanded={picking} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>+ {t("mock.newTest")}</button>
        </div>
      </div>
      {picking && <NewTestPanel busy={busy} onCreate={create} onClose={() => setPicking(false)} />}
      {error && <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "10px 14px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 600 }}>{error}</div>}
      {importing && <ImportPanel onClose={() => { setImporting(false); load(); }} onOpenTest={(id) => { setImporting(false); load(); openTest(id); }} />}

      {tests === null ? (
        <div style={{ ...card, color: "var(--text-muted)" }}>{t("common.loading")}</div>
      ) : tests.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 36 }}>🎧📖✍️🎤</div>
          <div style={{ fontWeight: 700, marginTop: 8, color: "var(--text)" }}>{t("mock.none")}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{t("mock.noneHint")}</div>
          {!picking && <button type="button" className="btn" onClick={() => setPicking(true)} style={{ marginTop: 14, background: ACCENT, color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>+ {t("mock.newTest")}</button>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {tests.map((x) => (
            <div key={x.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{x.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {isPracticeTest(x) ? `🎯 ${x.subject}` : `${x.kind}${x.module === "GENERAL" ? " GT" : ""} · ${x.subject} · ${x.level ? t(levelKey(x.level)) : t("mock.levelAll")}`}
                  </div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: "var(--radius-pill)", background: x.status === "PUBLISHED" ? "var(--success-soft)" : "var(--surface-muted)", color: x.status === "PUBLISHED" ? "var(--success)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {x.status === "PUBLISHED" ? t("mock.published") : t("mock.draft")}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${"sections" in x.summary ? 3 : 4}, 1fr)`, gap: 6, fontSize: 12, textAlign: "center" }}>
                {("sections" in x.summary
                  ? [["🗂", x.summary.sections], ["❓", x.summary.questions], ["✍️", x.summary.tasks]]
                  : [["🎧", x.summary.listening], ["📖", x.summary.reading], ["✍️", x.summary.writing], ["🎤", x.summary.speaking]]
                ).map(([i, n]) => (
                  <div key={String(i)} style={{ background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", padding: "6px 0" }}>
                    <div>{i}</div>
                    <div style={{ fontWeight: 800 }}>{n}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                <button type="button" className="btn" onClick={() => openTest(x.id)} style={btn}>✎ {t("mock.editTab")}</button>
                <button type="button" className="btn" onClick={() => openTest(x.id, "results")} style={btn}>📊 {t("mock.resultsTab")} ({x.attempts})</button>
                {canDelete && <button type="button" className="btn" onClick={() => remove(x)} style={{ ...btn, color: "var(--danger)", marginLeft: "auto" }} title={t("common.delete")}>🗑</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

export default function MockTestsPage() {
  return (
    <DashboardShell>
      <MockTestsContent />
    </DashboardShell>
  );
}
