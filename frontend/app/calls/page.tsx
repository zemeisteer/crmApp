"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import BarChart from "@/components/BarChart";
import { CallRow } from "@/components/telephony/CallHistory";
import { talkTime, useCallsMe } from "@/components/telephony/useCallsMe";
import { Card, EmptyState, PageHeader, PillTabs, Stat } from "@/components/ui";
import { ApiError, callsApi, type CallDirection, type CallLogItem, type CallStats, type CallStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";

type Tab = "log" | "stats";

/** The call log and the call statistics (telephony). */
export default function CallsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const me = useCallsMe();
  const [tab, setTab] = useState<Tab>("log");
  const isAdmin = user?.role === "OWNER" || user?.role === "ADMIN";

  return (
    <DashboardShell>
      <div className="page-pad" style={{ display: "grid", gap: 16 }}>
        <PageHeader title={t("tel.pageTitle")} eyebrow={me.extension ? `${t("tel.yourExtension")}: ${me.extension}` : undefined} />
        {!me.available ? (
          <Card>
            <EmptyState
              icon="📞"
              title={t("tel.notConnectedTitle")}
              text={t(isAdmin ? "tel.notConnectedAdmin" : "tel.notConnectedStaff")}
              action={isAdmin ? <Link href="/settings" className="btn btn-primary btn-sm">{t("tel.openSettings")}</Link> : undefined}
            />
          </Card>
        ) : (
          <>
            {me.canStats && (
              <PillTabs<Tab>
                label={t("tel.pageTitle")}
                value={tab}
                onChange={setTab}
                tabs={[{ id: "log", label: t("tel.tabLog") }, { id: "stats", label: t("tel.tabStats"), testId: "calls-tab-stats" }]}
              />
            )}
            {tab === "log" || !me.canStats ? <CallLog /> : <CallStatsView />}
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function CallLog() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<CallStatus | "">("");
  const [direction, setDirection] = useState<CallDirection | "">("");
  const [items, setItems] = useState<CallLogItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (before?: string) => {
    try {
      const r = await callsApi.list({ status: status || undefined, direction: direction || undefined, limit: 50, before });
      setItems((prev) => (before && prev ? [...prev, ...r.items] : r.items));
      setHasMore(r.hasMore);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("tel.loadFailed"));
    }
  }, [status, direction, t]);

  // The first page for the chosen filters; "more" pages through load().
  useEffect(() => {
    let live = true;
    callsApi.list({ status: status || undefined, direction: direction || undefined, limit: 50 }).then(
      (r) => {
        if (!live) return;
        setItems(r.items);
        setHasMore(r.hasMore);
        setError("");
      },
      (e) => live && setError(e instanceof ApiError ? e.message : t("tel.loadFailed")),
    );
    return () => {
      live = false;
    };
  }, [status, direction, t]);

  return (
    <Card>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <select className="field-input" style={{ maxWidth: 200 }} aria-label={t("tel.filterStatus")} value={status} onChange={(e) => setStatus(e.target.value as CallStatus | "")}>
          <option value="">{t("tel.allStatuses")}</option>
          <option value="ANSWERED">{t("tel.statusAnswered")}</option>
          <option value="MISSED">{t("tel.statusMissed")}</option>
        </select>
        <select className="field-input" style={{ maxWidth: 200 }} aria-label={t("tel.filterDirection")} value={direction} onChange={(e) => setDirection(e.target.value as CallDirection | "")}>
          <option value="">{t("tel.allDirections")}</option>
          <option value="INBOUND">{t("tel.inbound")}</option>
          <option value="OUTBOUND">{t("tel.outbound")}</option>
        </select>
      </div>
      {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
      {items && items.length === 0 && <EmptyState compact icon="📞" text={t("tel.historyEmpty")} />}
      {items && items.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((c) => <CallRow key={c.id} c={c} showContact />)}
        </ul>
      )}
      {hasMore && items && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => void load(items[items.length - 1].startedAt)}>{t("tel.more")}</button>
      )}
    </Card>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function CallStatsView() {
  const { t } = useLanguage();
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [to, setTo] = useState(() => iso(new Date()));
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 86_400_000)));
  const [data, setData] = useState<CallStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    callsApi.stats({ from, to, period }).then((d) => {
      if (!live) return;
      setData(d);
      setError("");
    }, (e) => live && setError(e instanceof ApiError ? e.message : t("tel.loadFailed")));
    return () => {
      live = false;
    };
  }, [from, to, period, t]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)" }}>
            {t("tel.from")}
            <input type="date" className="field-input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5, fontWeight: 700, color: "var(--text-soft)" }}>
            {t("tel.to")}
            <input type="date" className="field-input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <PillTabs<"day" | "week"> size="sm" label={t("tel.period")} value={period} onChange={setPeriod} tabs={[{ id: "day", label: t("tel.byDay") }, { id: "week", label: t("tel.byWeek") }]} />
        </div>
        {error && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{error}</div>}
      </Card>

      {data && (
        <>
          <div className="dash-grid">
            <div className="c3"><Card index={0}><Stat label={t("tel.statTotal")} value={data.totals.total} /></Card></div>
            <div className="c3"><Card index={1}><Stat label={t("tel.statAnswered")} value={data.totals.answered} /></Card></div>
            <div className="c3"><Card index={2}><Stat label={t("tel.statMissed")} value={data.totals.missed} tone={data.totals.missed > 0 ? "danger" : undefined} testId="calls-stat-missed" /></Card></div>
            <div className="c3"><Card index={3}><Stat label={t("tel.statAvgTalk")} value={talkTime(data.totals.avgTalkSec)} /></Card></div>
          </div>

          <Card>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{t("tel.chartTitle")}</h2>
            <BarChart data={data.series.map((s) => ({ label: s.bucket.slice(5), value: s.total, title: s.bucket }))} emptyText={t("tel.historyEmpty")} />
          </Card>

          <Card>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>{t("tel.byManager")}</h2>
            <div style={{ overflowX: "auto" }}>
              <table data-testid="calls-by-manager" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>{t("tel.manager")}</th>
                    <th style={{ textAlign: "right" }}>{t("tel.statTotal")}</th>
                    <th style={{ textAlign: "right" }}>{t("tel.inbound")}</th>
                    <th style={{ textAlign: "right" }}>{t("tel.outbound")}</th>
                    <th style={{ textAlign: "right" }}>{t("tel.statAnswered")}</th>
                    <th style={{ textAlign: "right" }}>{t("tel.statMissed")}</th>
                    <th style={{ textAlign: "right" }}>{t("tel.statAvgTalk")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byManager.map((m) => (
                    <tr key={m.userId ?? "none"}>
                      <td>{m.fullName ?? t("tel.noManager")}</td>
                      <td style={{ textAlign: "right" }}>{m.total}</td>
                      <td style={{ textAlign: "right" }}>{m.inbound}</td>
                      <td style={{ textAlign: "right" }}>{m.outbound}</td>
                      <td style={{ textAlign: "right" }}>{m.answered}</td>
                      <td style={{ textAlign: "right", color: m.missed ? "var(--danger)" : undefined }}>{m.missed}</td>
                      <td style={{ textAlign: "right" }}>{talkTime(m.avgTalkSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
