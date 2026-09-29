"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import MockTestEditor from "@/components/mock-tests/MockTestEditor";
import MockAttempts from "@/components/mock-tests/MockAttempts";
import ImportPanel from "@/components/mock-tests/ImportPanel";
import { levelKey } from "@/components/mock-tests/MockTestEditor";
import { ApiError, mockTestsApi, type MockTest, type MockTestSummary } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";

const ACCENT = "#4F46E5";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 16 };

// IELTS mock tests: build Listening / Reading / Writing / Speaking, publish
// them to the student cabinet, and review the sittings.
function MockTestsContent() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canDelete = ["OWNER", "ADMIN", "MANAGER", "SUPERADMIN"].includes(user?.role ?? "");
  const [tests, setTests] = useState<MockTestSummary[] | null>(null);
  const [open, setOpen] = useState<MockTest | null>(null);
  const [tab, setTab] = useState<"edit" | "results">("edit");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    mockTestsApi.list().then(setTests).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [t]);
  useEffect(load, [load]);

  async function create(sample: boolean) {
    setBusy(true);
    setError(null);
    try {
      const created = await mockTestsApi.create({ sample });
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
          <div style={{ display: "flex", gap: 4, background: "#F2F1EC", padding: 4, borderRadius: 12, marginLeft: "auto" }}>
            {(["edit", "results"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)} style={{ border: "none", cursor: "pointer", padding: "7px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700, background: tab === k ? "#fff" : "transparent", color: tab === k ? ACCENT : "#6B6E78" }}>
                {k === "edit" ? `✎ ${t("mock.editTab")}` : `📊 ${t("mock.resultsTab")}`}
              </button>
            ))}
          </div>
        </div>
        {tab === "edit" ? <MockTestEditor test={open} onSaved={setOpen} /> : <MockAttempts test={open} />}
      </div>
    );
  }

  return (
    <div className="adm-page" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{t("mock.title")}</h1>
          <p style={{ fontSize: 13, color: "#6B6E78", margin: "4px 0 0", maxWidth: 640 }}>{t("mock.intro")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setImporting(true)} style={{ background: "#181A1F", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>📥 {t("mimp.button")}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => create(true)} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>✨ {t("mock.fromSample")}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => create(false)} style={{ background: "#fff", color: "#181A1F", border: "1px solid #EAE8E2", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>+ {t("mock.blank")}</button>
        </div>
      </div>
      {error && <div style={{ background: "#FDEBEC", color: "#B23A47", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600 }}>{error}</div>}
      {importing && <ImportPanel onClose={() => { setImporting(false); load(); }} onOpenTest={(id) => { setImporting(false); load(); openTest(id); }} />}

      {tests === null ? (
        <div style={{ ...card, color: "#8A8D96" }}>{t("common.loading")}</div>
      ) : tests.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 20px", color: "#6B6E78" }}>
          <div style={{ fontSize: 36 }}>🎧📖✍️🎤</div>
          <div style={{ fontWeight: 700, marginTop: 8, color: "#181A1F" }}>{t("mock.none")}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{t("mock.noneHint")}</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {tests.map((x) => (
            <div key={x.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{x.title}</div>
                  <div style={{ fontSize: 12, color: "#8A8D96" }}>{x.kind}{x.module === "GENERAL" ? " GT" : ""} · {x.subject} · {x.level ? t(levelKey(x.level)) : t("mock.levelAll")}</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: x.status === "PUBLISHED" ? "#E9F8EF" : "#F2F1EC", color: x.status === "PUBLISHED" ? "#1FA463" : "#6B6E78", whiteSpace: "nowrap" }}>
                  {x.status === "PUBLISHED" ? t("mock.published") : t("mock.draft")}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, fontSize: 12, textAlign: "center" }}>
                {[["🎧", x.summary.listening], ["📖", x.summary.reading], ["✍️", x.summary.writing], ["🎤", x.summary.speaking]].map(([i, n]) => (
                  <div key={String(i)} style={{ background: "#F7F7F5", borderRadius: 10, padding: "6px 0" }}>
                    <div>{i}</div>
                    <div style={{ fontWeight: 800 }}>{n}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                <button type="button" className="btn" onClick={() => openTest(x.id)} style={btn}>✎ {t("mock.editTab")}</button>
                <button type="button" className="btn" onClick={() => openTest(x.id, "results")} style={btn}>📊 {t("mock.resultsTab")} ({x.attempts})</button>
                {canDelete && <button type="button" className="btn" onClick={() => remove(x)} style={{ ...btn, color: "#B23A47", marginLeft: "auto" }} title={t("common.delete")}>🗑</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

export default function MockTestsPage() {
  return (
    <DashboardShell>
      <MockTestsContent />
    </DashboardShell>
  );
}
