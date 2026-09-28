"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { tenantsApi, plansApi, Plan, ApiError, type TenantsOverview } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { centerHost } from "@/lib/domain";

const ACCENT = "#4F46E5";

const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  TRIAL: "admin.statusTrial",
  ACTIVE: "admin.statusActive",
  PAST_DUE: "admin.statusPastDue",
  SUSPENDED: "admin.statusSuspended",
};

function AdminContent() {
  const { user, selectWorkspace } = useAuth();
  const router = useRouter();

  // Opens a center as the superadmin (logged in the center's audit log).
  async function onOpen(id: string) {
    setSavingId(id);
    try {
      await selectWorkspace(id);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
      setSavingId(null);
    }
  }
  const { t, lang } = useLanguage();
  const [overview, setOverview] = useState<TenantsOverview | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [page, setPage] = useState(1);
  const tenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (overview?.items ?? []).filter((x) => {
      if (statusFilter && x.status !== statusFilter) return false;
      if (!q) return true;
      return [x.name, x.subdomain, x.owner?.email ?? "", x.owner?.fullName ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [overview, search, statusFilter]);
  useEffect(() => setPage(1), [search, statusFilter]);
  const pageItems = usePagedSlice(tenants, page);
  const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
  const daysLeft = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

  function load() {
    setLoading(true);
    setError(null);
    tenantsApi
      .overview()
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    plansApi.listAll().then(setPlans).catch(() => undefined);
  }, []);

  async function onChangeStatus(id: string, status: string) {
    setSavingId(id);
    try {
      await tenantsApi.updateStatus(id, { status });
      load();
    } finally {
      setSavingId(null);
    }
  }

  async function onChangePlan(id: string, plan: string) {
    setSavingId(id);
    try {
      await tenantsApi.updateStatus(id, { plan });
      load();
    } finally {
      setSavingId(null);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`"${name}" ${t("admin.confirmDeletePrefix")}`)) return;
    setSavingId(id);
    try {
      await tenantsApi.remove(id);
      load();
    } finally {
      setSavingId(null);
    }
  }

  function resetCreateForm() {
    setName("");
    setSubdomain("");
    setAdminEmail("");
    setAdminPassword("");
    setAdminFullName("");
    setCreateError(null);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await tenantsApi.create({ name, subdomain, adminEmail, adminPassword, adminFullName });
      setCreateOpen(false);
      resetCreateForm();
      load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setCreating(false);
    }
  }

  if (user && user.role !== "SUPERADMIN") {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
          {t("admin.superadminOnly")}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("admin.title")}</h1>
          <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>{t("admin.subtitle")}</div>
        </div>
        <button
          className="btn"
          onClick={() => setCreateOpen(true)}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          {t("admin.newCenter")}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {error && (
          <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 16 }}>
            {error}
          </div>
        )}
        {overview && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16, marginBottom: 16 }}>
            {[
              { label: t("sa.centers"), value: String(overview.totals.centers), sub: `${overview.totals.active} ${t("sa.activeShort")} · ${overview.totals.trial} ${t("sa.trialShort")}` },
              { label: t("sa.suspended"), value: String(overview.totals.suspended), danger: overview.totals.suspended > 0 },
              { label: t("sa.students"), value: money(overview.totals.students) },
              { label: t("sa.revenue"), value: `${money(overview.totals.monthRevenue)} ${t("common.sumUnit")}`, sub: t("sa.revenueHint") },
            ].map((c) => (
              <div key={c.label} style={{ background: c.danger ? "#FDEBEC" : "#fff", border: `1px solid ${c.danger ? "#F6D2D6" : "#EAE8E2"}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 12, color: c.danger ? "#B23A47" : "#8A8D96" }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: c.danger ? "#B23A47" : "#181A1F" }}>{c.value}</div>
                {c.sub && <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 2 }}>{c.sub}</div>}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <input className="field-input" placeholder={t("sa.search")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
          <select className="field-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
            <option value="">{t("sa.allStatuses")}</option>
            {Object.keys(STATUS_LABEL_KEYS).map((v) => (
              <option key={v} value={v}>{t(STATUS_LABEL_KEYS[v])}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : tenants.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {t("admin.noCentersYet")}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("admin.colCenter")}</th>
                  <th style={{ paddingTop: 16 }}>{t("sa.colSize")}</th>
                  <th style={{ paddingTop: 16 }}>{t("sa.colRevenue")}</th>
                  <th style={{ paddingTop: 16 }}>{t("admin.colPlan")}</th>
                  <th style={{ paddingTop: 16 }}>{t("admin.colStatus")}</th>
                  <th style={{ paddingTop: 16 }}>{t("sa.colActivity")}</th>
                  <th style={{ paddingTop: 16 }}></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((tn) => {
                  const left = tn.status === "TRIAL" ? daysLeft(tn.trialEndsAt) : null;
                  return (
                    <tr key={tn.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{tn.name}</div>
                        <div style={{ fontSize: 12, color: "#8A8D96" }}>{centerHost(tn.subdomain)}</div>
                        {tn.owner && <div style={{ fontSize: 12, color: "#4A4E58" }}>{tn.owner.fullName} · {tn.owner.email}</div>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        <div><b>{tn.students}</b> {t("sa.studentsShort")}</div>
                        <div style={{ color: "#8A8D96" }}>{tn.groups} {t("sa.groupsShort")} · {tn.teachers} {t("sa.teachersShort")}</div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{tn.monthRevenue ? `${money(tn.monthRevenue)} ${t("common.sumUnit")}` : "—"}</td>
                      <td>
                        <select className="field-input" style={{ padding: "6px 8px", fontSize: 12.5, width: "auto" }} value={tn.plan} disabled={savingId === tn.id} onChange={(e) => onChangePlan(tn.id, e.target.value)}>
                          {plans.map((p) => (
                            <option key={p.key} value={p.key}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select className="field-input" style={{ padding: "6px 8px", fontSize: 12.5, width: "auto" }} value={tn.status} disabled={savingId === tn.id} onChange={(e) => onChangeStatus(tn.id, e.target.value)}>
                          {Object.keys(STATUS_LABEL_KEYS).map((v) => (
                            <option key={v} value={v}>{t(STATUS_LABEL_KEYS[v])}</option>
                          ))}
                        </select>
                        {left !== null && (
                          <div style={{ fontSize: 11.5, marginTop: 4, fontWeight: 600, color: left <= 3 ? "#B23A47" : "#8A8D96" }}>
                            {left > 0 ? t("sa.trialLeft").replace("{n}", String(left)) : t("sa.trialEnded")}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12.5, color: "#4A4E58", whiteSpace: "nowrap" }}>
                        <div>{tn.lastActivityAt ? formatDate(tn.lastActivityAt, lang, "short") : "—"}</div>
                        <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{t("sa.since")} {formatDate(tn.createdAt, lang, "short")}</div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn" onClick={() => onOpen(tn.id)} disabled={savingId === tn.id} style={{ background: "#EEF0FF", color: ACCENT, border: "none", fontSize: 12, fontWeight: 700, padding: "6px 10px", borderRadius: 8, marginRight: 4 }}>
                          👁 {t("sa.open")}
                        </button>
                        <button className="btn" onClick={() => onDelete(tn.id, tn.name)} disabled={savingId === tn.id} style={{ background: "transparent", color: "#B23A47", fontSize: 12, fontWeight: 600, padding: "4px 8px", borderRadius: 8 }}>
                          {t("admin.delete")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} total={tenants.length} onChange={setPage} />
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => { setCreateOpen(false); resetCreateForm(); }} title={t("admin.modalTitle")}>
        <form onSubmit={onCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {createError && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{createError}</div>
          )}
          <Field label={t("admin.fieldCenterName")}>
            <input className="field-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ilm Markazi" />
          </Field>
          <Field label={t("admin.fieldSubdomain")}>
            <input className="field-input" required value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="ilmmarkazi" />
          </Field>
          <Field label={t("admin.fieldAdminName")}>
            <input className="field-input" required value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} placeholder="Aziz Karimov" />
          </Field>
          <Field label={t("admin.fieldAdminEmail")}>
            <input className="field-input" type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@markaz.uz" />
          </Field>
          <Field label={t("admin.fieldAdminPassword")}>
            <input className="field-input" type="password" required minLength={6} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder={t("admin.minChars")} />
          </Field>
          <button
            className="btn"
            type="submit"
            disabled={creating}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {creating ? t("admin.creating") : t("admin.createCenter")}
          </button>
        </form>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

export default function AdminPage() {
  return (
    <DashboardShell>
      <AdminContent />
    </DashboardShell>
  );
}
