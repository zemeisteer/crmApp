"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import { useAuth } from "@/lib/auth-context";
import { platformBillingApi, plansApi, Plan, ApiError } from "@/lib/api";
import { localMonthStr } from "@/lib/date";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

// ---- Tenant-facing: pick and pay for a plan ----

function TenantPricing() {
  const { tenant } = useAuth();
  const { t } = useLanguage();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [provider, setProvider] = useState<"CLICK" | "PAYME">("CLICK");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);

  useEffect(() => {
    plansApi.listPublic().then(setPlans).finally(() => setLoading(false));
  }, []);

  function openPay(plan: string) {
    setSelectedPlan(plan);
    setLink(null);
    setError(null);
    setPayOpen(true);
  }

  async function onGenerate() {
    if (!selectedPlan) return;
    setGenLoading(true);
    setError(null);
    try {
      const api = provider === "CLICK" ? platformBillingApi.clickLink : platformBillingApi.paymeLink;
      const res = await api({ plan: selectedPlan, forMonth: localMonthStr() });
      setLink(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setGenLoading(false);
    }
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("pricing.title")}</h1>
        <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
          {t("pricing.currentPlan")}: <strong>{tenant?.plan}</strong> · {t("pricing.status")}: <strong>{tenant?.status}</strong>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, maxWidth: 960 }}>
            {plans.map((p) => {
              const isCurrent = tenant?.plan === p.key;
              return (
                <div
                  key={p.id}
                  style={{
                    background: "#fff",
                    border: p.popular ? `2px solid ${ACCENT}` : "1px solid #EAE8E2",
                    borderRadius: 16,
                    padding: 24,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    position: "relative",
                  }}
                >
                  {p.popular && (
                    <span style={{ position: "absolute", top: -12, left: 24, background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 100 }}>
                      {t("pricing.mostPopular")}
                    </span>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{p.name}</div>
                    {isCurrent && <span className="badge badge-success">{t("pricing.currentPlanBadge")}</span>}
                  </div>
                  <div>
                    <span style={{ fontSize: 28, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>
                      {p.price === 0 ? t("pricing.free") : formatMoney(p.price)}
                    </span>
                    {p.price > 0 && <span style={{ fontSize: 13, color: "#8A8D96" }}> {t("pricing.perMonth")}</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {p.features.split("\n").filter(Boolean).map((f) => (
                      <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#4A4E58" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1FA463" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {f}
                      </div>
                    ))}
                  </div>
                  {isCurrent ? null : p.price === 0 ? (
                    <span style={{ fontSize: 12, color: "#8A8D96" }}>{t("pricing.autoOnSignup")}</span>
                  ) : (
                    <button
                      className="btn"
                      onClick={() => openPay(p.key)}
                      style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 9 }}
                    >
                      {t("pricing.activate")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={t("pricing.choosePaymentModal")}>
        {link ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#E9F8EF", color: "#1FA463", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
              {t("pricing.linkCreated")}
            </div>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="btn"
              style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, textAlign: "center" }}
            >
              {t("pricing.goToPaymentPage")}
            </a>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {error && (
              <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
            )}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.paymentMethod")}</div>
              <Select
                options={[{ value: "CLICK", label: t("payment.methodClick") }, { value: "PAYME", label: t("payment.methodPayme") }]}
                value={provider}
                onChange={(v) => setProvider(v as "CLICK" | "PAYME")}
              />
            </div>
            <button
              className="btn"
              onClick={onGenerate}
              disabled={genLoading}
              style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}
            >
              {genLoading ? t("pricing.generatingLink") : t("pricing.getLink")}
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}

// ---- Superadmin-facing: manage plans platform-wide ----

function SuperadminPlans() {
  const { t } = useLanguage();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [features, setFeatures] = useState("");
  const [popular, setPopular] = useState(false);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    plansApi.listAll().then(setPlans).catch((err) => setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi")).finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setKey("");
    setName("");
    setPrice("");
    setFeatures("");
    setPopular(false);
    setActive(true);
    setEditOpen(true);
  }

  function openEdit(p: Plan) {
    setEditing(p);
    setKey(p.key);
    setName(p.name);
    setPrice(String(p.price));
    setFeatures(p.features);
    setPopular(p.popular);
    setActive(p.active);
    setEditOpen(true);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await plansApi.update(editing.id, { name, price: Number(price), features, popular, active });
      } else {
        await plansApi.create({ key, name, price: Number(price), features, popular, active });
      }
      setEditOpen(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(id: string) {
    if (!confirm(t("pricing.confirmDeletePlan"))) return;
    await plansApi.remove(id);
    load();
  }

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("pricing.title")}</h1>
          <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>
            {t("pricing.superadminHint")}
          </div>
        </div>
        <button
          className="btn"
          onClick={openNew}
          style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
        >
          {t("pricing.addPlan")}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {error && (
          <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 16 }}>{error}</div>
        )}
        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              {plans.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: "#fff", border: `1.5px solid ${p.popular ? ACCENT : "#EAE8E2"}`, borderRadius: 16, padding: 24,
                    display: "flex", flexDirection: "column", gap: 14, position: "relative",
                  }}
                >
                  {p.popular && (
                    <span
                      style={{
                        position: "absolute", top: -12, left: 24, background: ACCENT, color: "#fff", fontSize: 11,
                        fontWeight: 800, padding: "4px 12px", borderRadius: 100,
                      }}
                    >
                      {t("pricing.mostPopular")}
                    </span>
                  )}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{p.name}</div>
                    <span className={`badge ${p.active ? "badge-success" : "badge-neutral"}`}>{p.active ? t("pricing.active") : t("pricing.hidden")}</span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>
                    {p.price === 0 ? t("pricing.free") : formatMoney(p.price)}
                    {p.price > 0 && <span style={{ fontSize: 12, color: "#8A8D96", fontWeight: 500 }}> {t("pricing.perMonth")}</span>}
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 9 }}>
                    {p.features.split("\n").filter(Boolean).map((f) => (
                      <li key={f} style={{ fontSize: 13, color: "#4A4E58", display: "flex", alignItems: "center", gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1FA463" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid #F1F0EC", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12.5, color: "#8A8D96" }}>
                      {t("pricing.onThisPlan")} <strong style={{ color: "#181A1F" }}>{p.tenantCount ?? 0} {t("pricing.centersUnit")}</strong>
                    </div>
                    <button
                      className="btn"
                      onClick={() => openEdit(p)}
                      style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8, flexShrink: 0 }}
                    >
                      {t("pricing.edit")}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, background: "#ECEBFB", borderRadius: 12, padding: "14px 18px", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              <span style={{ fontSize: 12.5, color: "#4A4E58", lineHeight: 1.5 }}>
                {t("pricing.autoUpdateHint")}
              </span>
            </div>
          </>
        )}
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={editing ? t("pricing.editPlanTitle") : t("pricing.newPlanTitle")}>
        <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!editing && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.fieldKey")}</div>
              <input className="field-input" required value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="GOLD" />
            </div>
          )}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.fieldName")}</div>
            <input className="field-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Gold" />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.fieldPrice")}</div>
            <input className="field-input" type="number" min={0} required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="900000" />
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.fieldFeatures")}</div>
            <textarea className="field-input" rows={4} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder={"Cheksiz o'quvchi\nAI tahlil"} style={{ resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} /> {t("pricing.markPopular")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t("pricing.activeVisible")}
            </label>
          </div>
          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6 }}
          >
            {saving ? t("pricing.saving") : t("pricing.save")}
          </button>
          {editing && (
            <button
              type="button"
              className="btn"
              onClick={() => onRemove(editing.id)}
              style={{ background: "transparent", color: "#B23A47", fontSize: 12.5, fontWeight: 600, padding: 6 }}
            >
              {t("pricing.deletePlan")}
            </button>
          )}
        </form>
      </Modal>
    </>
  );
}

function PricingContent() {
  const { user } = useAuth();
  if (user?.role === "SUPERADMIN") return <SuperadminPlans />;
  return <TenantPricing />;
}

export default function PricingPage() {
  return (
    <DashboardShell>
      <PricingContent />
    </DashboardShell>
  );
}
