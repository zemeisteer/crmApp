"use client";

import { useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import { useAuth } from "@/lib/auth-context";
import { platformBillingApi, plansApi, Plan, ApiError } from "@/lib/api";
import { useCenterClock } from "@/lib/use-center-clock";
import { formatDate } from "@/lib/format-date";
import { useLanguage } from "@/lib/i18n-context";
import { planFeatureLines } from "@/lib/plans";

const ACCENT = "#4F46E5";

function formatMoney(n: number) {
  return new Intl.NumberFormat("uz-UZ").format(n);
}

// ---- Tenant-facing: pick and pay for a plan ----

function TenantPricing() {
  const { tenant } = useAuth();
  const clock = useCenterClock();
  const { t, lang } = useLanguage();
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
      const res = await api({ plan: selectedPlan, forMonth: clock.month() });
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
        <div style={{ fontSize: 13, color: "#686B75", marginTop: 2 }}>
          {t("pricing.currentPlan")}: <strong>{tenant?.plan}</strong> · {t("pricing.status")}: <strong>{tenant?.status}</strong>
          {tenant?.billing?.paidUntil && <> · <span data-testid="paid-until">{t("billing.paidUntil").replace("{date}", formatDate(tenant.billing.paidUntil, lang))}</span></>}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {loading ? (
          <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
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
                    {p.price > 0 && <span style={{ fontSize: 13, color: "#686B75" }}> {t("pricing.perMonth")}</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {planFeatureLines(p, lang).map((f) => (
                      <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#4A4E58" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16794A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {f}
                      </div>
                    ))}
                  </div>
                  {isCurrent ? null : p.price === 0 ? (
                    <span style={{ fontSize: 12, color: "#686B75" }}>{t("pricing.autoOnSignup")}</span>
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
            <div style={{ background: "#E9F8EF", color: "#167A48", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
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
              <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
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
  const { t, lang } = useLanguage();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [features, setFeatures] = useState("");
  const [featuresRu, setFeaturesRu] = useState("");
  const [featuresEn, setFeaturesEn] = useState("");
  const [popular, setPopular] = useState(false);
  // SMS (through the platform's provider) is part of the plan.
  const [smsIncluded, setSmsIncluded] = useState(true);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  // The Russian and English lists are translated from the Uzbek one: a
  // moment after it is typed, by the button, or on save when either is
  // still empty or was translated from an older Uzbek text.
  const [translating, setTranslating] = useState(false);
  const [translateNote, setTranslateNote] = useState<{ text: string; error?: boolean } | null>(null);
  // What an answer is checked against when it comes back - read then, not
  // when the request left: the edit window it was asked from (a new number
  // each time the window opens or closes), the Uzbek text it was for, and
  // whether the admin has typed into a list since (theirs: never replaced,
  // except by the button). `ruFor`/`enFor`: the Uzbek text each list was
  // translated from ("" once typed by hand).
  const session = useRef(0);
  const uzText = useRef("");
  const byHand = useRef({ ru: false, en: false });
  const translatedFor = useRef({ ru: "", en: "" });
  const pending = useRef(0);

  const setUz = (v: string) => {
    uzText.current = v;
    setFeatures(v);
  };
  const typeRu = (v: string) => {
    byHand.current.ru = true;
    translatedFor.current.ru = "";
    setFeaturesRu(v);
  };
  const typeEn = (v: string) => {
    byHand.current.en = true;
    translatedFor.current.en = "";
    setFeaturesEn(v);
  };

  /**
   * Asks for the translation of `text` and puts it into the lists that are
   * still the translator's - if the window is the same one and the Uzbek text
   * is still `text` when the answer comes. Answers that come back late or out
   * of order change nothing. Returns what was applied (null: dropped).
   */
  async function requestTranslation(text: string): Promise<{ ru: string; en: string } | null> {
    const asked = session.current;
    const ticket = ++pending.current;
    setTranslating(true);
    try {
      const res = await plansApi.translate(text);
      if (session.current !== asked || uzText.current !== text) return null;
      if (!byHand.current.ru) {
        setFeaturesRu(res.featuresRu);
        translatedFor.current.ru = text;
      }
      if (!byHand.current.en) {
        setFeaturesEn(res.featuresEn);
        translatedFor.current.en = text;
      }
      setTranslateNote({ text: t(res.provider === "ai" ? "pr.translatedBy.ai" : "pr.translatedBy.google") });
      return { ru: res.featuresRu, en: res.featuresEn };
    } catch (err) {
      if (session.current === asked && uzText.current === text) setTranslateNote({ text: err instanceof ApiError ? err.message : t("common.errorGeneric"), error: true });
      throw err;
    } finally {
      if (ticket === pending.current) setTranslating(false);
    }
  }

  // A moment after the Uzbek list stops changing, the other two follow it.
  useEffect(() => {
    if (!editOpen || !features.trim() || (byHand.current.ru && byHand.current.en)) return;
    const text = features;
    const timer = setTimeout(() => {
      requestTranslation(text).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, editOpen]);

  async function onTranslate() {
    if (!features.trim()) return setTranslateNote({ text: t("pr.translateFirst"), error: true });
    // The button redoes both lists, typed or not.
    byHand.current = { ru: false, en: false };
    setTranslateNote(null);
    await requestTranslation(features).catch(() => undefined);
  }

  /** A new edit window: answers asked from the previous one are dropped. */
  function begin(uz: string, ru: string, en: string, ruTyped: boolean, enTyped: boolean) {
    session.current += 1;
    uzText.current = uz;
    byHand.current = { ru: ruTyped, en: enTyped };
    // Saved translations belong to the saved Uzbek text.
    translatedFor.current = { ru: ru.trim() ? uz : "", en: en.trim() ? uz : "" };
    setFeatures(uz);
    setFeaturesRu(ru);
    setFeaturesEn(en);
    setTranslating(false);
    setTranslateNote(null);
  }

  function closeEdit() {
    session.current += 1;
    setTranslating(false);
    setEditOpen(false);
  }

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
    begin("", "", "", false, false);
    setPopular(false);
    setSmsIncluded(true);
    setActive(true);
    setEditOpen(true);
  }

  function openEdit(p: Plan) {
    setEditing(p);
    setKey(p.key);
    setName(p.name);
    setPrice(String(p.price));
    // Saved translations stay unless the button is pressed.
    begin(p.features, p.featuresRu ?? "", p.featuresEn ?? "", !!p.featuresRu?.trim(), !!p.featuresEn?.trim());
    setPopular(p.popular);
    setSmsIncluded(p.smsIncluded ?? true);
    setActive(p.active);
    setEditOpen(true);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // What is saved is the form as it is now. A list that is empty, or was
      // translated from another Uzbek text than this one, is translated for
      // this text first; a list typed by hand is saved as typed. When the
      // translator does not answer the tariff is still saved (the site then
      // shows the Uzbek list where none fits).
      const uz = features;
      const fits = (lang: "ru" | "en", value: string) => !!value.trim() && (byHand.current[lang] || translatedFor.current[lang] === uz);
      let ru = fits("ru", featuresRu) ? featuresRu : "";
      let en = fits("en", featuresEn) ? featuresEn : "";
      if (uz.trim() && (!ru || !en)) {
        try {
          const fresh = await requestTranslation(uz);
          if (fresh) {
            if (!ru) ru = fresh.ru;
            if (!en) en = fresh.en;
          }
        } catch {
          /* saved without a translation */
        }
      }
      if (editing) {
        await plansApi.update(editing.id, { name, price: Number(price), features: uz, featuresRu: ru, featuresEn: en, popular, active, smsIncluded });
      } else {
        await plansApi.create({ key, name, price: Number(price), features: uz, featuresRu: ru, featuresEn: en, popular, active, smsIncluded });
      }
      closeEdit();
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
          <div style={{ fontSize: 13, color: "#686B75", marginTop: 2 }}>
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
          <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 16 }}>{error}</div>
        )}
        {loading ? (
          <div style={{ color: "#686B75", fontSize: 14 }}>{t("common.loading")}</div>
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
                    <span className={`badge ${p.smsIncluded === false ? "badge-neutral" : "badge-success"}`}>{p.smsIncluded === false ? t("pricing.noSms") : "SMS"}</span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>
                    {p.price === 0 ? t("pricing.free") : formatMoney(p.price)}
                    {p.price > 0 && <span style={{ fontSize: 12, color: "#686B75", fontWeight: 500 }}> {t("pricing.perMonth")}</span>}
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 9 }}>
                    {planFeatureLines(p, lang).map((f) => (
                      <li key={f} style={{ fontSize: 13, color: "#4A4E58", display: "flex", alignItems: "center", gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16794A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid #F1F0EC", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12.5, color: "#686B75" }}>
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

      <Modal open={editOpen} onClose={closeEdit} title={editing ? t("pricing.editPlanTitle") : t("pricing.newPlanTitle")}>
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
            <label htmlFor="plan-features" style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.fieldFeatures")}</label>
            <textarea id="plan-features" className="field-input" rows={4} value={features} onChange={(e) => setUz(e.target.value)} placeholder={"Cheksiz o'quvchi\nAI tahlil"} style={{ resize: "vertical" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={onTranslate}
                disabled={translating || saving}
                style={{ background: "#EEF0FF", color: ACCENT, border: "1px solid #D9DBFA", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 9, cursor: translating ? "wait" : "pointer" }}
              >
                {translating ? t("pr.translating") : t("pr.autoTranslate")}
              </button>
              <span style={{ fontSize: 11.5, color: "#686B75", lineHeight: 1.5, flex: 1, minWidth: 180 }}>{t("pr.translateHint")}</span>
            </div>
            {translateNote && (
              <div role={translateNote.error ? "alert" : "status"} style={{ fontSize: 12, fontWeight: 600, marginTop: 8, padding: "7px 10px", borderRadius: 8, background: translateNote.error ? "#FDEBEC" : "#E9F8EF", color: translateNote.error ? "#B23A47" : "#16794A" }}>
                {translateNote.text}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="plan-features-ru" style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.fieldFeaturesRu")}</label>
            <textarea id="plan-features-ru" className="field-input" rows={4} value={featuresRu} onChange={(e) => typeRu(e.target.value)} placeholder={"Без ограничения учеников\nИИ-аналитика"} style={{ resize: "vertical" }} />
          </div>
          <div>
            <label htmlFor="plan-features-en" style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("pricing.fieldFeaturesEn")}</label>
            <textarea id="plan-features-en" className="field-input" rows={4} value={featuresEn} onChange={(e) => typeEn(e.target.value)} placeholder={"Unlimited students\nAI analysis"} style={{ resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} /> {t("pricing.markPopular")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t("pricing.activeVisible")}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={smsIncluded} onChange={(e) => setSmsIncluded(e.target.checked)} /> {t("pricing.smsIncluded")}
            </label>
          </div>
          <div style={{ fontSize: 12, color: "#686B75", marginTop: -4, lineHeight: 1.5 }}>{t("pricing.smsIncludedHint")}</div>
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
