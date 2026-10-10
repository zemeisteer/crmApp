"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import DatePicker from "@/components/DatePicker";
import LoadError from "@/components/LoadError";
import Modal from "@/components/Modal";
import Pagination from "@/components/Pagination";
import Select from "@/components/Select";
import { ApiError, plansApi, platformApi, type Plan, type PlatformPayment, type PlatformSubscription, type TenantStatus } from "@/lib/api";
import { centerHost } from "@/lib/domain";
import { formatDate } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { monthLabel, money, nextMonth, STATUS_COLORS, STATUS_LABEL_KEYS } from "@/lib/platform";

const ACCENT = "#4F46E5";
const PAGE_SIZE = 20;
const STATUSES = Object.keys(STATUS_LABEL_KEYS) as TenantStatus[];
const label: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "#4A4E58", marginBottom: 6 };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-block", fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: bg, color: fg, whiteSpace: "nowrap" });

function SubscriptionsContent() {
  const { t, lang } = useLanguage();
  const params = useSearchParams();
  // The overview links here with a filter already chosen.
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [plan, setPlan] = useState(params.get("plan") ?? "");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(search);
  const [data, setData] = useState<{ month: string; total: number; items: PlatformSubscription[] } | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<PlatformSubscription | null>(null);

  // Typing searches after a pause, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(() => {
    let current = true;
    setError(null);
    platformApi
      .subscriptions({ search: query || undefined, status: status || undefined, plan: plan || undefined, page, pageSize: PAGE_SIZE })
      .then((res) => { if (current) setData(res); })
      .catch((e) => { if (current) setError(e instanceof ApiError ? e.message : ""); });
    return () => { current = false; };
  }, [query, status, plan, page]);
  useEffect(() => load(), [load]);
  useEffect(() => { plansApi.listAll().then(setPlans).catch(() => setPlans([])); }, []);

  const n = (key: TranslationKey, value: number | string) => t(key).replace("{n}", String(value));
  const sum = (value: number) => `${money(value)} ${t("common.sumUnit")}`;

  function leftText(s: PlatformSubscription): { text: string; tone: "ok" | "warn" | "danger" | "muted" } {
    if (s.daysLeft === null) return { text: s.status === "TRIAL" ? t("pf.sub.noLimit") : t("pf.sub.freePlan"), tone: "muted" };
    if (s.daysLeft < 0) return { text: s.status === "TRIAL" ? n("pf.dash.daysAgo", -s.daysLeft) : n("pf.sub.overdue", -s.daysLeft), tone: "danger" };
    if (s.daysLeft === 0) return { text: s.status === "TRIAL" ? t("pf.dash.today") : n("pf.sub.overdue", 0), tone: "danger" };
    return { text: n("pf.dash.daysLeft", s.daysLeft), tone: s.daysLeft <= 7 ? "warn" : "ok" };
  }
  const toneColor = { ok: "#16794A", warn: "#8A5A00", danger: "#B23A47", muted: "#686B75" };

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("pf.sub.title")}</h1>
        <div style={{ fontSize: 13, color: "#686B75", marginTop: 2 }}>{t("pf.sub.subtitle")}{data ? ` · ${monthLabel(data.month, lang)}` : ""}</div>
      </div>

      <div style={{ padding: "22px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="adm-toolbar">
          <input className="field-input" placeholder={t("pf.sub.search")} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 280 }} aria-label={t("pf.sub.search")} />
          <Select ariaLabel={t("pf.sub.colStatus")} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "", label: t("sa.allStatuses") }, ...STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL_KEYS[s]) }))]} style={{ width: 200 }} />
          <Select ariaLabel={t("pf.sub.colPlan")} value={plan} onChange={(v) => { setPlan(v); setPage(1); }} options={[{ value: "", label: t("pf.sub.allPlans") }, ...plans.map((p) => ({ value: p.key, label: p.name }))]} style={{ width: 200 }} />
          {data && <span style={{ fontSize: 12.5, color: "#686B75", marginLeft: "auto" }}>{n("pf.sub.total", money(data.total))}</span>}
        </div>

        {error !== null ? (
          <LoadError message={error || t("adm.loadError")} onRetry={load} />
        ) : !data ? (
          <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
        ) : data.items.length === 0 ? (
          <div style={{ color: "#686B75", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>{t("pf.sub.empty")}</div>
        ) : (
          <>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>{t("pf.sub.colCenter")}</th>
                    <th>{t("pf.sub.colPlan")}</th>
                    <th>{t("pf.sub.colStatus")}</th>
                    <th>{t("pf.sub.colMonth")}</th>
                    <th>{t("pf.sub.colLeft")}</th>
                    <th style={{ textAlign: "right" }}>{t("pf.sub.colTotal")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => {
                    const left = leftText(s);
                    return (
                      <tr key={s.id}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{s.name}</div>
                          <div style={{ fontSize: 11.5, color: "#686B75" }}>{centerHost(s.subdomain)}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{s.planName}</div>
                          <div style={{ fontSize: 11.5, color: "#686B75" }}>{s.price > 0 ? `${sum(s.price)} / ${t("pf.sub.perMonth")}` : t("pf.dash.free")}</div>
                        </td>
                        <td><span style={pill(STATUS_COLORS[s.status].bg, STATUS_COLORS[s.status].fg)}>{t(STATUS_LABEL_KEYS[s.status])}</span></td>
                        <td>
                          {s.paidThisMonth === null ? <span style={{ color: "#686B75" }}>—</span>
                            : s.paidThisMonth ? <span style={pill("#E9F8EF", "#16794A")}>{t("pf.sub.paid")}</span>
                            : <span style={pill("#FDEBEC", "#B23A47")}>{t("pf.sub.unpaid")}</span>}
                        </td>
                        <td style={{ color: toneColor[left.tone], fontWeight: left.tone === "muted" ? 500 : 700 }}>{left.text}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{s.totalPaid > 0 ? sum(s.totalPaid) : <span style={{ color: "#686B75", fontWeight: 500 }}>—</span>}</td>
                        <td style={{ textAlign: "right" }}>
                          <button type="button" className="btn" onClick={() => setManaging(s)} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t("pf.sub.manage")}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
      </div>

      {managing && data && (
        <ManageSubscription
          key={managing.id}
          sub={managing}
          plans={plans}
          month={data.month}
          onClose={() => setManaging(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

function ManageSubscription({ sub, plans, month, onClose, onChanged }: { sub: PlatformSubscription; plans: Plan[]; month: string; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const [plan, setPlan] = useState(sub.plan);
  const [status, setStatus] = useState<TenantStatus>(sub.status);
  const [trialEndsAt, setTrialEndsAt] = useState(sub.trialEndsAt ? sub.trialEndsAt.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [history, setHistory] = useState<PlatformPayment[] | null>(null);

  // The month to pay next: the one after the last paid month, or this one.
  const firstUnpaid = sub.lastPaidMonth && sub.lastPaidMonth >= month ? nextMonth(sub.lastPaidMonth) : month;
  const [forMonth, setForMonth] = useState(firstUnpaid);
  const planPrice = plans.find((p) => p.key === plan)?.price ?? 0;
  const [amount, setAmount] = useState(String(planPrice || ""));
  useEffect(() => { setAmount(String(planPrice || "")); }, [planPrice]);
  const [paying, setPaying] = useState(false);

  const loadHistory = useCallback(() => {
    platformApi.payments(sub.id).then(setHistory).catch(() => setHistory([]));
  }, [sub.id]);
  useEffect(loadHistory, [loadHistory]);

  const monthOptions = useMemo(() => {
    const list: string[] = [];
    let m = month;
    // Two months back (a late payment) to five ahead (paid in advance).
    const [y, mm] = month.split("-").map(Number);
    m = new Date(Date.UTC(y, mm - 3, 1)).toISOString().slice(0, 7);
    for (let i = 0; i < 8; i++) { list.push(m); m = nextMonth(m); }
    return list.map((x) => ({ value: x, label: monthLabel(x, lang) }));
  }, [month, lang]);

  const changed = plan !== sub.plan || status !== sub.status || trialEndsAt !== (sub.trialEndsAt ? sub.trialEndsAt.slice(0, 10) : "");

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await platformApi.updateSubscription(sub.id, {
        ...(plan !== sub.plan ? { plan } : {}),
        ...(status !== sub.status ? { status } : {}),
        ...(trialEndsAt !== (sub.trialEndsAt ? sub.trialEndsAt.slice(0, 10) : "") ? { trialEndsAt: trialEndsAt ? `${trialEndsAt}T23:59:59.000Z` : null } : {}),
      });
      setMessage({ text: t("pf.sub.saved") });
      onChanged();
    } catch (e) {
      setMessage({ text: e instanceof ApiError ? e.message : t("common.errorGeneric"), error: true });
    } finally {
      setSaving(false);
    }
  }

  async function pay() {
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) return setMessage({ text: t("pf.sub.payAmount"), error: true });
    setPaying(true);
    setMessage(null);
    try {
      await platformApi.recordPayment(sub.id, { forMonth, plan, amount: value });
      setStatus("ACTIVE");
      setMessage({ text: `${t("pf.sub.paid")}: ${monthLabel(forMonth, lang)}` });
      setForMonth(nextMonth(forMonth));
      loadHistory();
      onChanged();
    } catch (e) {
      setMessage({ text: e instanceof ApiError ? e.message : t("common.errorGeneric"), error: true });
    } finally {
      setPaying(false);
    }
  }

  function extend(days: number) {
    const base = trialEndsAt && new Date(`${trialEndsAt}T00:00:00Z`).getTime() > Date.now() ? new Date(`${trialEndsAt}T00:00:00Z`) : new Date();
    setTrialEndsAt(new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10));
  }

  return (
    <Modal open onClose={onClose} title={`${t("pf.sub.manageTitle")}: ${sub.name}`} width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="adm-grid2">
          <div>
            <span style={label}>{t("pf.sub.plan")}</span>
            <Select ariaLabel={t("pf.sub.plan")} value={plan} onChange={setPlan} options={plans.map((p) => ({ value: p.key, label: `${p.name} · ${p.price > 0 ? money(p.price) : t("pf.dash.free")}` }))} />
          </div>
          <div>
            <span style={label}>{t("pf.sub.status")}</span>
            <Select ariaLabel={t("pf.sub.status")} value={status} onChange={(v) => setStatus(v as TenantStatus)} options={STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL_KEYS[s]) }))} />
          </div>
        </div>

        <div>
          <span style={label}>{t("pf.sub.trialEnds")}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ width: 200 }}><DatePicker value={trialEndsAt} onChange={setTrialEndsAt} /></div>
            {[7, 14, 30].map((d) => (
              <button key={d} type="button" onClick={() => extend(d)} style={{ fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 100, border: "1px solid #EAE8E2", background: "#fff", color: "#4A4E58", cursor: "pointer" }}>
                {t("pf.sub.extend").replace("{n}", String(d))}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn" disabled={!changed || saving} onClick={save} style={{ background: !changed || saving ? "#A9ABB3" : ACCENT, color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: !changed || saving ? "not-allowed" : "pointer" }}>
            {saving ? t("common.loading") : t("pf.sub.saveChanges")}
          </button>
        </div>

        <div style={{ borderTop: "1px solid #EAE8E2", paddingTop: 16 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>{t("pf.sub.payTitle")}</div>
          <div style={{ fontSize: 12.5, color: "#686B75", margin: "2px 0 12px", lineHeight: 1.5 }}>{t("pf.sub.payHint")}</div>
          {planPrice <= 0 ? (
            <div style={{ fontSize: 13, color: "#8A5A00", background: "#FFF7E6", border: "1px solid #F5DDA8", borderRadius: 10, padding: "10px 12px" }}>{t("pf.sub.payFree")}</div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ width: 190 }}>
                <span style={label}>{t("pf.sub.payMonth")}</span>
                <Select ariaLabel={t("pf.sub.payMonth")} value={forMonth} onChange={setForMonth} options={monthOptions} />
              </div>
              <div style={{ width: 160 }}>
                <span style={label}>{t("pf.sub.payAmount")}</span>
                <input className="field-input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} aria-label={t("pf.sub.payAmount")} />
              </div>
              <button type="button" className="btn" disabled={paying} onClick={pay} style={{ background: "#16794A", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, cursor: paying ? "wait" : "pointer" }}>
                {paying ? t("common.loading") : t("pf.sub.payRecord")}
              </button>
            </div>
          )}
        </div>

        {message && (
          <div role={message.error ? "alert" : "status"} style={{ fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 10, background: message.error ? "#FDEBEC" : "#E9F8EF", color: message.error ? "#B23A47" : "#16794A" }}>{message.text}</div>
        )}

        <div style={{ borderTop: "1px solid #EAE8E2", paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#686B75", marginBottom: 8 }}>{t("pf.sub.history")}</div>
          {history === null ? (
            <div style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
          ) : history.length === 0 ? (
            <div style={{ fontSize: 13, color: "#686B75" }}>{t("pf.sub.noHistory")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {history.map((h) => (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, background: "#FAF9F6", borderRadius: 10, padding: "8px 12px" }}>
                  <span>
                    <b>{monthLabel(h.forMonth, lang)}</b> · {h.plan} · {h.provider ?? t("pf.dash.manual")}
                    {h.paidAt ? <span style={{ color: "#686B75" }}> · {formatDate(h.paidAt, lang, "short")}</span> : null}
                  </span>
                  <span style={{ whiteSpace: "nowrap" }}>
                    <b>{money(h.amount)}</b>{" "}
                    <span style={pill(h.status === "PAID" ? "#E9F8EF" : "#F2F1EC", h.status === "PAID" ? "#16794A" : "#686B75")}>{t(`pf.sub.tx${h.status}`)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function PlatformSubscriptionsPage() {
  return (
    <DashboardShell>
      <Suspense fallback={null}>
        <SubscriptionsContent />
      </Suspense>
    </DashboardShell>
  );
}
