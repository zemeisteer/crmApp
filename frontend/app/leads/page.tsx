"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Select from "@/components/Select";
import Pagination from "@/components/Pagination";
import LeadFormModal from "@/components/leads/LeadFormModal";
import TelegramConnectCard from "@/components/telegram/TelegramConnectCard";
import {
  ApiError,
  leadsApi,
  type AssignableManager,
  type FollowUpSummary,
  type Lead,
  type LeadAnalytics,
  type LeadQuery,
  type LeadStatus,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import {
  ACCENT,
  LEAD_SOURCES,
  LEAD_STATUSES,
  OPEN_STATUSES,
  SIMPLE_MOVES,
  STATUS_STYLE,
  StatusBadge,
  card,
  formatDate,
  formatDateTime,
  ghostBtn,
  isOverdue,
  primaryBtn,
  sourceKey,
  statusKey,
  telHref,
} from "@/components/leads/lead-ui";

const PAGE_SIZE = 25;

function LeadsContent() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const canRead = can("admissions.read");

  const [view, setView] = useState<"list" | "pipeline">("list");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [manager, setManager] = useState("");
  const [followUp, setFollowUp] = useState<LeadQuery["followUp"] | "">("");
  const [sort, setSort] = useState<NonNullable<LeadQuery["sort"]>>("newest");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<{ items: Lead[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<LeadAnalytics | null>(null);
  const [followUps, setFollowUps] = useState<FollowUpSummary | null>(null);
  const [managers, setManagers] = useState<AssignableManager[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  // Debounce typing so every keystroke doesn't hit the server.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => setPage(1), [search, status, source, manager, followUp, sort, archived, view]);

  const query = useMemo<LeadQuery>(() => {
    const base: LeadQuery = {
      search: search || undefined,
      source: source || undefined,
      assignedManagerUserId: manager || undefined,
      followUp: followUp || undefined,
      includeArchived: archived ? "true" : undefined,
    };
    if (view === "pipeline") {
      // The board shows open stages only; closed leads live in the list.
      return { ...base, status: status || OPEN_STATUSES.join(","), sort: "next_follow_up", pageSize: 100 };
    }
    return { ...base, status: status || undefined, sort, page, pageSize: PAGE_SIZE };
  }, [search, status, source, manager, followUp, sort, archived, page, view]);

  const load = useCallback(() => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    leadsApi
      .list(query)
      .then((res) => setData({ items: res.items, total: res.total }))
      .catch((err) => setError(err instanceof ApiError ? err.message : t("adm.loadError")))
      .finally(() => setLoading(false));
  }, [query, canRead, t]);

  useEffect(load, [load]);

  const loadSummary = useCallback(() => {
    if (!canRead) return;
    leadsApi.followUpSummary().then(setFollowUps).catch(() => setFollowUps(null));
    if (can("admissions.analytics")) leadsApi.analytics().then(setAnalytics).catch(() => setAnalytics(null));
  }, [canRead, can]);

  useEffect(() => {
    loadSummary();
    if (canRead) leadsApi.managers().then(setManagers).catch(() => setManagers([]));
  }, [loadSummary, canRead]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  // Optimistic stage move on the board; the server stays authoritative and
  // the card snaps back if the move is rejected.
  async function quickMove(lead: Lead, to: LeadStatus) {
    const previous = data.items;
    setData((d) => ({ ...d, items: d.items.map((l) => (l.id === lead.id ? { ...l, status: to } : l)) }));
    try {
      await leadsApi.transition(lead.id, to);
      loadSummary();
    } catch (err) {
      setData((d) => ({ ...d, items: previous }));
      flash(`${t("adm.moveFailed")}: ${err instanceof ApiError ? err.message : ""}`);
    }
  }

  if (!canRead) {
    return (
      <div className="adm-page">
        <div style={{ ...card, color: "#8A8D96" }}>{t("adm.noPermission")}</div>
      </div>
    );
  }

  const openCount = analytics ? OPEN_STATUSES.reduce((sum, s) => sum + (analytics.snapshot.byStatus[s] || 0), 0) : null;
  const conversion = analytics?.cohort.rates.conversion;

  const managerOptions = [
    { value: "", label: t("adm.allManagers") },
    { value: "me", label: t("adm.mine") },
    { value: "unassigned", label: t("adm.unassigned") },
    ...managers.map((m) => ({ value: m.userId, label: m.fullName })),
  ];

  const stat = (labelText: string, value: React.ReactNode, color: string, onClick?: () => void, hint?: string) => (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      style={{ ...card, textAlign: "left", cursor: onClick ? "pointer" : "default", padding: 16 }}
    >
      <div style={{ fontSize: 12, color: "#8A8D96" }}>{labelText}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color }}>{value}</div>
    </button>
  );

  return (
    <>
      <div className="adm-page" style={{ borderBottom: "1px solid #EAE8E2", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("leads.title")}</h1>
          <p style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 2 }}>{t("leads.subtitle")}</p>
        </div>
        <div className="adm-actions">
          <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 9, padding: 3, gap: 2 }}>
            {(["list", "pipeline"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                style={{
                  border: "none",
                  background: view === v ? "#fff" : "transparent",
                  color: view === v ? "#181A1F" : "#8A8D96",
                  fontWeight: 700,
                  fontSize: 12.5,
                  padding: "6px 14px",
                  borderRadius: 7,
                  cursor: "pointer",
                }}
              >
                {v === "list" ? t("adm.viewList") : t("adm.viewPipeline")}
              </button>
            ))}
          </div>
          {can("admissions.export") && (
            <button type="button" className="btn" style={ghostBtn} onClick={() => leadsApi.exportCsv({ ...query, page: undefined, pageSize: undefined }).catch(() => flash(t("adm.loadError")))}>
              {t("adm.exportCsv")}
            </button>
          )}
          {can("admissions.create") && (
            <button type="button" className="btn" style={primaryBtn} onClick={() => setCreateOpen(true)}>
              {t("leads.newLead")}
            </button>
          )}
        </div>
      </div>

      <div className="adm-page" style={{ display: "grid", gap: 16 }}>
        {toast && (
          <div role="status" style={{ background: "#FEE2E2", color: "#B91C1C", fontWeight: 600, fontSize: 13, padding: "10px 14px", borderRadius: 10 }}>
            {toast}
          </div>
        )}

        <TelegramConnectCard />

        <div className="adm-stats">
          {stat(t("adm.statOpen"), openCount ?? "—", "#181A1F")}
          {stat(t("adm.statOverdue"), followUps?.overdue ?? "—", "#B91C1C", () => { setFollowUp("overdue"); setView("list"); })}
          {stat(t("adm.statToday"), followUps?.today ?? "—", "#B45309", () => { setFollowUp("today"); setView("list"); })}
          {stat(
            t("adm.statConversion"),
            conversion ? (conversion.rate === null ? "—" : `${conversion.rate}%`) : "—",
            ACCENT,
            undefined,
            conversion ? `${t("adm.statConversionHint")}: ${conversion.numerator}/${conversion.denominator}` : t("adm.statConversionHint"),
          )}
        </div>

        <div className="adm-toolbar">
          <input
            className="field-input"
            style={{ flex: "2 1 220px", padding: "9px 12px" }}
            placeholder={t("adm.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t("common.search")}
          />
          <Select
            value={status}
            onChange={setStatus}
            options={[{ value: "", label: t("leads.allStatuses") }, ...LEAD_STATUSES.map((s) => ({ value: s, label: t(statusKey(s)) }))]}
          />
          <Select
            value={source}
            onChange={setSource}
            options={[{ value: "", label: t("leads.allSources") }, ...LEAD_SOURCES.map((s) => ({ value: s, label: t(sourceKey(s)) }))]}
          />
          <Select value={manager} onChange={setManager} options={managerOptions} />
          <Select
            value={followUp || ""}
            onChange={(v) => setFollowUp(v as LeadQuery["followUp"] | "")}
            options={[
              { value: "", label: t("adm.followUpAny") },
              { value: "overdue", label: t("adm.followUpOverdue") },
              { value: "today", label: t("adm.followUpToday") },
              { value: "upcoming", label: t("adm.followUpUpcoming") },
              { value: "none", label: t("adm.followUpNone") },
            ]}
          />
          {view === "list" && (
            <Select
              value={sort}
              onChange={(v) => setSort(v as NonNullable<LeadQuery["sort"]>)}
              options={[
                { value: "newest", label: t("adm.sortNewest") },
                { value: "oldest", label: t("adm.sortOldest") },
                { value: "next_follow_up", label: t("adm.sortNextFollowUp") },
                { value: "recently_updated", label: t("adm.sortRecentlyUpdated") },
              ]}
            />
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, minWidth: 0 }}>
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            {t("adm.showArchived")}
          </label>
        </div>

        {error ? (
          <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ color: "#B91C1C", fontWeight: 600 }}>{error}</span>
            <button type="button" className="btn" style={ghostBtn} onClick={load}>{t("adm.retry")}</button>
          </div>
        ) : loading && data.items.length === 0 ? (
          <div style={{ ...card, color: "#8A8D96" }}>{t("common.loading")}</div>
        ) : data.items.length === 0 ? (
          <div style={{ ...card, color: "#8A8D96", textAlign: "center", padding: 32 }}>
            {search || status || source || manager || followUp ? t("leads.noSearchResults") : t("leads.noLeadsYet")}
          </div>
        ) : view === "list" ? (
          <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
            <div className="adm-table-wrap" style={{ ...card, padding: 0, overflowX: "auto" }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{t("leads.colFullName")}</th>
                    <th>{t("leads.colPhone")}</th>
                    <th>{t("leads.colStatus")}</th>
                    <th>{t("leads.colSource")}</th>
                    <th>{t("leads.colSubject")}</th>
                    <th>{t("adm.colManager")}</th>
                    <th>{t("adm.colFollowUp")}</th>
                    <th>{t("leads.colDate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id} style={{ opacity: l.archivedAt ? 0.55 : 1 }}>
                      <td><Link href={`/leads/${l.id}`} style={{ fontWeight: 700, color: "#181A1F" }}>{l.fullName}</Link></td>
                      <td><a href={telHref(l.phone)} style={{ color: ACCENT }}>{l.phone}</a></td>
                      <td><StatusBadge status={l.status} label={t(statusKey(l.status))} /></td>
                      <td>{t(sourceKey(l.source))}</td>
                      <td>{l.desiredCourse?.name ?? l.desiredSubject?.name ?? l.legacySubject ?? "—"}</td>
                      <td>{l.assignedManager?.fullName ?? <span style={{ color: "#8A8D96" }}>{t("adm.unassigned")}</span>}</td>
                      <td style={{ color: isOverdue(l.followUpAt) && OPEN_STATUSES.includes(l.status) ? "#B91C1C" : undefined, fontWeight: isOverdue(l.followUpAt) ? 700 : 400 }}>
                        {formatDateTime(l.followUpAt)}
                      </td>
                      <td>{formatDate(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="adm-cards">
              {data.items.map((l) => (
                <Link key={l.id} href={`/leads/${l.id}`} style={{ ...card, padding: 14, display: "grid", gap: 6, color: "inherit" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{l.fullName}</strong>
                    <StatusBadge status={l.status} label={t(statusKey(l.status))} />
                  </div>
                  <div style={{ fontSize: 13, color: "#5B5F6A" }}>{l.phone} · {t(sourceKey(l.source))}</div>
                  {l.followUpAt && (
                    <div style={{ fontSize: 12.5, color: isOverdue(l.followUpAt) ? "#B91C1C" : "#5B5F6A" }}>
                      {t("adm.colFollowUp")}: {formatDateTime(l.followUpAt)}
                    </div>
                  )}
                </Link>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ fontSize: 12.5, color: "#8A8D96" }}>{t("adm.pipelineHint")}</p>
            <div className="adm-pipeline">
              {OPEN_STATUSES.map((s) => {
                const items = data.items.filter((l) => l.status === s);
                const totalInStage = analytics?.snapshot.byStatus[s];
                return (
                  <section key={s} style={{ background: "#F7F6F2", borderRadius: 14, padding: 10, minHeight: 200 }} aria-label={t(statusKey(s))}>
                    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px 10px" }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: STATUS_STYLE[s].color }}>{t(statusKey(s))}</span>
                      <span style={{ fontSize: 12, color: "#8A8D96", fontWeight: 700 }}>{totalInStage ?? items.length}</span>
                    </header>
                    <div style={{ display: "grid", gap: 8 }}>
                      {items.map((l) => (
                        <div key={l.id} style={{ ...card, padding: 12, display: "grid", gap: 6 }}>
                          <Link href={`/leads/${l.id}`} style={{ fontWeight: 700, color: "#181A1F" }}>{l.fullName}</Link>
                          <a href={telHref(l.phone)} style={{ fontSize: 12.5, color: ACCENT }}>{l.phone}</a>
                          <div style={{ fontSize: 12, color: "#8A8D96" }}>
                            {t(sourceKey(l.source))}
                            {l.assignedManager ? ` · ${l.assignedManager.fullName}` : ""}
                          </div>
                          {l.followUpAt && (
                            <div style={{ fontSize: 12, color: isOverdue(l.followUpAt) ? "#B91C1C" : "#5B5F6A", fontWeight: isOverdue(l.followUpAt) ? 700 : 400 }}>
                              ⏰ {formatDateTime(l.followUpAt)}
                            </div>
                          )}
                          {can("admissions.update") && !l.archivedAt && (SIMPLE_MOVES[l.status] ?? []).map((to) => (
                            <button key={to} type="button" className="btn" style={{ ...ghostBtn, fontSize: 12, padding: "5px 10px" }} onClick={() => quickMove(l, to)}>
                              → {t(statusKey(to))}
                            </button>
                          ))}
                        </div>
                      ))}
                      {totalInStage !== undefined && totalInStage > items.length && (
                        <button type="button" className="btn" style={{ ...ghostBtn, fontSize: 12 }} onClick={() => { setStatus(s); setView("list"); }}>
                          +{totalInStage - items.length} {t("adm.moreInStage")}
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {createOpen && <LeadFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        managers={managers}
        onSaved={() => { load(); loadSummary(); }}
      />}
    </>
  );
}

export default function LeadsPage() {
  return (
    <DashboardShell>
      <LeadsContent />
    </DashboardShell>
  );
}
