"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import MonthPicker from "@/components/MonthPicker";
import DirectorReport from "@/components/reports/DirectorReport";
import { ApiError, exportApi, reportsApi, type ReportsOverview as ReportsOverviewData } from "@/lib/api";
import ReportsOverviewView from "@/components/reports/ReportsOverview";
import { centerToday, centerTimeZone } from "@/lib/center-time";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";

type ReportsTab = "director" | "overview" | "retention";
const TABS: ReportsTab[] = ["director", "overview", "retention"];

function ReportsContent() {
  const { t } = useLanguage();
  // A link can open a tab directly (/reports?tab=retention).
  const tabParam = useSearchParams().get("tab");
  const [activeTab, setActiveTab] = useState<ReportsTab>(() => (TABS.includes(tabParam as ReportsTab) ? (tabParam as ReportsTab) : "director"));

  // Server-computed monthly report (replaces downloading every student,
  // payment and attendance row and aggregating in the browser).
  // Months start on the center's clock (the server reports in its timezone),
  // not the browser's: near midnight on the 1st they differ.
  const { tenant } = useAuth();
  const [reportMonth, setReportMonth] = useState(() => centerToday(centerTimeZone(tenant?.timezone)).slice(0, 7));
  const [report, setReport] = useState<ReportsOverviewData | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);


  useEffect(() => {
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    reportsApi
      .overview(reportMonth)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((err) => { if (!cancelled) setReportError(err instanceof ApiError ? err.message : t("adm.loadError")); })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [reportMonth, t]);


  // Overview and retention render the server-computed monthly report.
  function reportBody(view: "overview" | "retention") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <MonthPicker value={reportMonth} onChange={setReportMonth} style={{ width: 200 }} />
          {reportLoading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("common.loading")}</span>}
        </div>
        {reportError ? (
          <div style={{ background: "var(--danger-soft)", color: "var(--danger)", fontWeight: 600, fontSize: 13, padding: "12px 16px", borderRadius: "var(--radius-md)" }}>{reportError}</div>
        ) : report ? (
          <ReportsOverviewView report={report} view={view} />
        ) : null}
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div
        style={{
          padding: "var(--page-head-pad)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 className="page-title">{t("reports.title")}</h1>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
            {t("rep3.subtitle")}
          </p>
        </div>

        {/* Tab switchers */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 3, gap: 2, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setActiveTab("director")}
              style={{
                border: "none",
                background: activeTab === "director" ? "var(--ink)" : "transparent",
                color: activeTab === "director" ? "var(--on-ink)" : "var(--text-muted)",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                boxShadow: "none",
              }}
            >
              {t("dir.tab")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              style={{
                border: "none",
                background: activeTab === "overview" ? "var(--ink)" : "transparent",
                color: activeTab === "overview" ? "var(--on-ink)" : "var(--text-muted)",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                boxShadow: "none",
              }}
            >
              {t("rep3.tabOverview")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("retention")}
              style={{
                border: "none",
                background: activeTab === "retention" ? "var(--ink)" : "transparent",
                color: activeTab === "retention" ? "var(--on-ink)" : "var(--text-muted)",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                boxShadow: "none",
              }}
            >
              {t("rep3.tabRetention")} ({report?.atRisk.length ?? 0})
            </button>
          </div>

          <button
            className="btn"
            onClick={() => exportApi.paymentsXlsx()}
            style={{
              background: "var(--surface-muted)",
              color: "var(--text)",
              border: "none",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 16px",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {t("reports.exportExcel")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "var(--page-pad)", display: "flex", flexDirection: "column", gap: 20, overflow: "auto", boxSizing: "border-box" }}>
        
        {/* ========================================================================= */}
        {/* TAB 1: OVERVIEW & GENERAL FINANCE                                         */}
        {/* ========================================================================= */}
        {activeTab === "director" && <DirectorReport month={reportMonth} onMonth={setReportMonth} />}
        {activeTab === "overview" && reportBody("overview")}


        {/* ========================================================================= */}
        {/* TAB 3: RETENTION & CHURN PREDICTION ENGINE (Spec §38)                     */}
        {/* ========================================================================= */}
        {activeTab === "retention" && reportBody("retention")}
      </div>

    </>
  );
}


export default function ReportsPage() {
  return (
    <DashboardShell>
      <Suspense fallback={null}>
        <ReportsContent />
      </Suspense>
    </DashboardShell>
  );
}
