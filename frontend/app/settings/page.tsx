"use client";

import { useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Select from "@/components/Select";
import TagListInput from "@/components/TagListInput";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import {
  tenantsApi, telegramApi, branchesApi, authApi, webhooksApi, staffApi,
  Branch, Session, Webhook, StaffMember, ApiError, Role, TenantCategory, fileUrl,
} from "@/lib/api";
import { PHONE_PATTERN, PHONE_TITLE, NAME_PATTERN, NAME_TITLE } from "@/lib/validation";

const ACCENT = "#4F46E5";
const CATEGORY_OPTIONS: TenantCategory[] = ["TIL_MARKAZI", "MATEMATIKA", "IT", "BOSHQA"];
const CATEGORY_LABEL_KEYS: Record<TenantCategory, TranslationKey> = {
  TIL_MARKAZI: "category.tilMarkazi",
  MATEMATIKA: "category.matematika",
  IT: "category.it",
  BOSHQA: "category.boshqa",
};
const ROLE_LABEL_KEYS: Record<Role, TranslationKey> = {
  SUPERADMIN: "role.superadmin", ADMIN: "role.admin", TEACHER: "role.teacher", ACCOUNTANT: "role.accountant",
};

function splitList(s: string | null | undefined): string[] {
  return s ? s.split(",").map((v) => v.trim()).filter(Boolean) : [];
}
function joinList(arr: string[]): string {
  return arr.map((v) => v.trim()).filter(Boolean).join(",");
}

type Tab = "profile" | "branches" | "staff" | "security" | "integrations" | "data";

const TAB_DEFS: { key: Tab; labelKey: TranslationKey; icon: React.ReactNode }[] = [
  {
    key: "profile", labelKey: "settings.tabProfile",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" /></svg>,
  },
  {
    key: "branches", labelKey: "settings.tabBranches",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>,
  },
  {
    key: "staff", labelKey: "settings.tabStaff",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  },
  {
    key: "security", labelKey: "settings.tabSecurity",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>,
  },
  {
    key: "integrations", labelKey: "settings.tabIntegrations",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="9" height="9" rx="2" /><rect x="13" y="2" width="9" height="9" rx="2" /><rect x="2" y="13" width="9" height="9" rx="2" /><rect x="13" y="13" width="9" height="9" rx="2" /></svg>,
  },
  {
    key: "data", labelKey: "settings.tabData",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>,
  },
];

function SettingsContent() {
  const { tenant, user, logout, refreshMe } = useAuth();
  const { t, lang } = useLanguage();
  const [tab, setTab] = useState<Tab>("profile");

  const ROLE_OPTIONS = [
    { value: "ADMIN", label: t("role.admin") },
    { value: "TEACHER", label: t("role.teacher") },
    { value: "ACCOUNTANT", label: t("role.accountant") },
  ];
  const LANGUAGE_OPTIONS = [
    { value: "UZ", label: "O'zbek tili" },
    { value: "RU", label: "Русский язык" },
    { value: "EN", label: "English" },
  ];
  const CURRENCY_OPTIONS = [
    { value: "UZS", label: "UZS — so'm" },
    { value: "USD", label: "USD — dollar" },
    { value: "RUB", label: "RUB — рубль" },
  ];

  // Profile tab
  const [name, setName] = useState("");
  const [accentColor, setAccentColor] = useState("#4F46E5");
  const [category, setCategory] = useState<TenantCategory>("BOSHQA");
  const [phones, setPhones] = useState<string[]>([""]);
  const [address, setAddress] = useState("");
  const [emails, setEmails] = useState<string[]>([""]);
  const [telegramUsernames, setTelegramUsernames] = useState<string[]>([""]);
  const [website, setWebsite] = useState("");
  const [websiteLabel, setWebsiteLabel] = useState("");
  const [language, setLanguage] = useState<"UZ" | "RU" | "EN">("UZ");
  const [currency, setCurrency] = useState<"UZS" | "USD" | "RUB">("UZS");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [telegramStatus, setTelegramStatus] = useState<{ configured: boolean; botUsername: string | null } | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [savingBranch, setSavingBranch] = useState(false);

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setAccentColor(tenant.accentColor);
      setCategory(tenant.category);
      setPhones(splitList(tenant.phone).length ? splitList(tenant.phone) : [""]);
      setAddress(tenant.address || "");
      setEmails(splitList(tenant.email).length ? splitList(tenant.email) : [""]);
      setTelegramUsernames(splitList(tenant.telegramUsername).length ? splitList(tenant.telegramUsername) : [""]);
      setWebsite(tenant.website || "");
      setWebsiteLabel(tenant.websiteLabel || "");
      setLanguage(tenant.language);
      setCurrency(tenant.currency);
    }
  }, [tenant]);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [twoFaQr, setTwoFaQr] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [twoFaMsg, setTwoFaMsg] = useState<string | null>(null);
  const [twoFaBusy, setTwoFaBusy] = useState(false);

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvent, setWebhookEvent] = useState("payment.created");
  const [savingWebhook, setSavingWebhook] = useState(false);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffRole, setStaffRole] = useState<Role>("TEACHER");
  const [staffError, setStaffError] = useState<string | null>(null);
  const [savingStaff, setSavingStaff] = useState(false);

  const [gdprPassword, setGdprPassword] = useState("");
  const [gdprError, setGdprError] = useState<string | null>(null);
  const [gdprBusy, setGdprBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    telegramApi.status().then(setTelegramStatus).catch(() => setTelegramStatus(null));
    loadBranches();
    loadSessions();
    loadWebhooks();
    loadStaff();
  }, []);

  function loadBranches() {
    branchesApi.list().then(setBranches);
  }
  function loadSessions() {
    authApi.sessions().then(setSessions).catch(() => undefined);
  }
  function loadWebhooks() {
    webhooksApi.list().then(setWebhooks).catch(() => undefined);
  }
  function loadStaff() {
    staffApi.list().then(setStaff).catch(() => undefined);
  }

  async function onRevokeSession(id: string) {
    await authApi.revokeSession(id);
    loadSessions();
  }

  async function onStart2FA() {
    setTwoFaError(null);
    setTwoFaMsg(null);
    const res = await authApi.setupTwoFactor();
    setTwoFaQr(res.qrDataUrl);
  }

  async function onConfirm2FA(e: React.FormEvent) {
    e.preventDefault();
    setTwoFaError(null);
    setTwoFaBusy(true);
    try {
      await authApi.confirmTwoFactor(twoFaCode);
      setTwoFaMsg(t("settings.enabled") + ".");
      setTwoFaQr(null);
      setTwoFaCode("");
      await refreshMe();
    } catch (err) {
      setTwoFaError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setTwoFaBusy(false);
    }
  }

  async function onDisable2FA(e: React.FormEvent) {
    e.preventDefault();
    setTwoFaError(null);
    setTwoFaBusy(true);
    try {
      await authApi.disableTwoFactor(twoFaCode);
      setTwoFaMsg(t("settings.disabled") + ".");
      setTwoFaCode("");
      await refreshMe();
    } catch (err) {
      setTwoFaError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setTwoFaBusy(false);
    }
  }

  async function onAddWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim()) return;
    setSavingWebhook(true);
    try {
      await webhooksApi.create({ url: webhookUrl, event: webhookEvent });
      setWebhookUrl("");
      loadWebhooks();
    } finally {
      setSavingWebhook(false);
    }
  }

  async function onRemoveWebhook(id: string) {
    await webhooksApi.remove(id);
    loadWebhooks();
  }

  async function onAddStaff(e: React.FormEvent) {
    e.preventDefault();
    setStaffError(null);
    setSavingStaff(true);
    try {
      await staffApi.create({ fullName: staffName, email: staffEmail, password: staffPassword, role: staffRole });
      setStaffName("");
      setStaffEmail("");
      setStaffPassword("");
      setStaffRole("TEACHER");
      loadStaff();
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSavingStaff(false);
    }
  }

  async function onChangeStaffRole(id: string, role: Role) {
    await staffApi.updateRole(id, role);
    loadStaff();
  }

  async function onRemoveStaff(id: string) {
    if (!confirm(t("settings.confirmRemoveStaff"))) return;
    try {
      await staffApi.remove(id);
      loadStaff();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    }
  }

  async function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      await tenantsApi.uploadLogo(file);
      await refreshMe();
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function onExportData() {
    const data = await tenantsApi.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `talimcrm-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onDeleteMyTenant(e: React.FormEvent) {
    e.preventDefault();
    setGdprError(null);
    setGdprBusy(true);
    try {
      await tenantsApi.deleteMe(gdprPassword);
      logout();
    } catch (err) {
      setGdprError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
      setGdprBusy(false);
    }
  }

  async function onAddBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!branchName.trim()) return;
    setSavingBranch(true);
    try {
      await branchesApi.create({ name: branchName, address: branchAddress || undefined });
      setBranchName("");
      setBranchAddress("");
      loadBranches();
    } finally {
      setSavingBranch(false);
    }
  }

  async function onRemoveBranch(id: string) {
    if (!confirm(t("settings.confirmRemoveBranch"))) return;
    await branchesApi.remove(id);
    loadBranches();
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await tenantsApi.updateMe({
        name, accentColor, category,
        phone: joinList(phones) || undefined,
        address: address || undefined,
        email: joinList(emails) || undefined,
        telegramUsername: joinList(telegramUsernames) || undefined,
        website: website || undefined,
        websiteLabel: websiteLabel || undefined,
        language,
        currency,
      });
      setSaved(true);
      await refreshMe();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  const BRAND_COLORS = ["#4F46E5", "#0D9488", "#EA7A3A", "#B23A47", "#1FA463"];

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("settings.title")}</h1>
        <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2 }}>{t("settings.subtitle")}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid #EAE8E2", padding: 18, display: "flex", flexDirection: "column", gap: 4, overflow: "auto" }}>
          {TAB_DEFS.map((td) => (
            <button
              key={td.key}
              onClick={() => setTab(td.key)}
              className="btn"
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: "none",
                textAlign: "left", fontSize: 13.5, fontWeight: 600,
                background: tab === td.key ? ACCENT : "transparent",
                color: tab === td.key ? "#fff" : "#4A4E58",
              }}
            >
              {td.icon}
              {t(td.labelKey)}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
          {tab === "profile" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640 }}>
              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 18 }}>{t("settings.centerInfo")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                  {tenant?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(tenant.logoUrl) || ""} alt="Logo" style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover", border: "1px solid #EAE8E2" }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 14, background: accentColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 22 }}>
                      {(tenant?.name || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                      style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
                    >
                      {logoUploading ? t("common.loading") : t("settings.changeLogo")}
                    </button>
                    <div style={{ fontSize: 11, color: "#8A8D96", marginTop: 6 }}>{t("settings.logoHint")}</div>
                    <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={onLogoChange} style={{ display: "none" }} />
                  </div>
                </div>

                <form onSubmit={onSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {error && (
                    <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
                  )}
                  {saved && (
                    <div style={{ background: "#E9F8EF", color: "#1FA463", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{t("common.saved")}</div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.centerName")}</div>
                      <input className="field-input" required value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.subdomain")}</div>
                      <input className="field-input" value={tenant?.subdomain ? `${tenant.subdomain}.talimcrm.uz` : ""} disabled style={{ opacity: 0.6 }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.phones")}</div>
                    <TagListInput values={phones} onChange={setPhones} type="tel" placeholder="+998 90 123 45 67" pattern={PHONE_PATTERN} title={PHONE_TITLE} addLabel={t("settings.addPhone")} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.emails")}</div>
                    <TagListInput values={emails} onChange={setEmails} type="email" placeholder="info@markaz.uz" addLabel={t("settings.addEmail")} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.telegramUsernames")}</div>
                    <TagListInput values={telegramUsernames} onChange={setTelegramUsernames} placeholder="markaz_bot" prefix="@" addLabel={t("settings.addTelegramUsername")} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.loginEmail")}</div>
                    <input className="field-input" value={user?.email || ""} disabled style={{ opacity: 0.6 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.address")}</div>
                    <input className="field-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Toshkent sh., Chilonzor tumani..." />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.locationUrl")}</div>
                      <input className="field-input" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://maps.google.com/..." />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.linkLabel")}</div>
                      <input className="field-input" value={websiteLabel} onChange={(e) => setWebsiteLabel(e.target.value)} placeholder={t("settings.linkLabelPlaceholder")} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.interfaceLanguage")}</div>
                      <Select options={LANGUAGE_OPTIONS} value={language} onChange={(v) => setLanguage(v as "UZ" | "RU" | "EN")} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.currency")}</div>
                      <Select options={CURRENCY_OPTIONS} value={currency} onChange={(v) => setCurrency(v as "UZS" | "USD" | "RUB")} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("settings.direction")}</div>
                    <Select
                      options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: t(CATEGORY_LABEL_KEYS[c]) }))}
                      value={category}
                      onChange={(v) => setCategory(v as TenantCategory)}
                    />
                  </div>
                  <button
                    className="btn"
                    type="submit"
                    disabled={saving}
                    style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10, marginTop: 6, alignSelf: "flex-end", minWidth: 160 }}
                  >
                    {saving ? t("common.saving") : t("settings.saveChanges")}
                  </button>
                </form>
              </div>

              <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22 }}>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("settings.brandColor")}</div>
                <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 4, marginBottom: 16 }}>{t("settings.brandColorHint")}</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {BRAND_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={async () => {
                        setAccentColor(c);
                        await tenantsApi.updateMe({ accentColor: c });
                        await refreshMe();
                      }}
                      style={{
                        width: 34, height: 34, borderRadius: 10, background: c, cursor: "pointer",
                        border: accentColor === c ? "2.5px solid #181A1F" : "2.5px solid transparent",
                        boxShadow: accentColor === c ? "0 0 0 2px #fff inset" : "none",
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={accentColor}
                    onChange={async (e) => {
                      setAccentColor(e.target.value);
                      await tenantsApi.updateMe({ accentColor: e.target.value });
                      await refreshMe();
                    }}
                    style={{ width: 34, height: 34, border: "1px solid #EAE8E2", borderRadius: 10, padding: 2, cursor: "pointer" }}
                  />
                </div>
              </div>
            </div>
          )}

          {tab === "branches" && (
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22, maxWidth: 640 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("settings.branches")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {branches.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("settings.noBranches")}</div>
                ) : (
                  branches.map((b) => (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #EAE8E2", borderRadius: 10, padding: "8px 12px" }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{b.name}</div>
                        {b.address && <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{b.address}</div>}
                      </div>
                      <button
                        className="btn"
                        onClick={() => onRemoveBranch(b.id)}
                        style={{ background: "transparent", color: "#B23A47", fontSize: 12, fontWeight: 600, padding: "4px 8px", borderRadius: 8 }}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={onAddBranch} style={{ display: "flex", gap: 8 }}>
                <input className="field-input" placeholder={t("settings.branchName")} value={branchName} onChange={(e) => setBranchName(e.target.value)} style={{ flex: 1 }} />
                <input className="field-input" placeholder={t("settings.branchAddressOptional")} value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} style={{ flex: 1 }} />
                <button
                  className="btn"
                  type="submit"
                  disabled={savingBranch}
                  style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "0 16px", borderRadius: 9, whiteSpace: "nowrap" }}
                >
                  {t("common.add")}
                </button>
              </form>
            </div>
          )}

          {tab === "staff" && (
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22, maxWidth: 720 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t("settings.staffTitle")}</div>
              <div style={{ fontSize: 12.5, color: "#8A8D96", marginBottom: 16 }}>{t("settings.staffHint")}</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                {staff.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("common.loading")}</div>
                ) : (
                  staff.map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #EAE8E2", borderRadius: 10, padding: "10px 12px", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.fullName}</div>
                        <div style={{ fontSize: 11.5, color: "#8A8D96" }}>{s.email}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {s.id === user?.id || s.role === "SUPERADMIN" ? (
                          <span className="badge badge-neutral">{t(ROLE_LABEL_KEYS[s.role])}</span>
                        ) : (
                          <Select
                            options={ROLE_OPTIONS}
                            value={s.role}
                            onChange={(v) => onChangeStaffRole(s.id, v as Role)}
                            style={{ width: 150 }}
                          />
                        )}
                        {s.id !== user?.id && s.role !== "SUPERADMIN" && (
                          <button className="btn" onClick={() => onRemoveStaff(s.id)} style={{ background: "transparent", color: "#B23A47", fontSize: 11.5, fontWeight: 600, padding: "4px 8px", borderRadius: 8 }}>
                            {t("common.delete")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t("settings.newStaff")}</div>
              {staffError && (
                <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 8, marginBottom: 10 }}>{staffError}</div>
              )}
              <form onSubmit={onAddStaff} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input className="field-input" required placeholder={t("settings.fullName")} value={staffName} onChange={(e) => setStaffName(e.target.value)} pattern={NAME_PATTERN} title={NAME_TITLE} />
                <input className="field-input" required type="email" placeholder={t("auth.email")} value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} />
                <input className="field-input" required type="password" minLength={6} placeholder={t("settings.tempPassword")} value={staffPassword} onChange={(e) => setStaffPassword(e.target.value)} />
                <Select
                  options={ROLE_OPTIONS}
                  value={staffRole}
                  onChange={(v) => setStaffRole(v as Role)}
                />
                <button
                  className="btn"
                  type="submit"
                  disabled={savingStaff}
                  style={{ gridColumn: "1 / -1", background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: 11, borderRadius: 9 }}
                >
                  {savingStaff ? t("settings.addingStaff") : t("settings.addStaffBtn")}
                </button>
              </form>
            </div>
          )}

          {tab === "security" && (
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22, maxWidth: 640 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("settings.security")}</div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("settings.twoFa")}</div>
                  <span className={`badge ${user?.twoFactorEnabled ? "badge-success" : "badge-neutral"}`}>
                    {user?.twoFactorEnabled ? t("settings.enabled") : t("settings.disabled")}
                  </span>
                </div>
                {twoFaError && (
                  <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 8, marginBottom: 8 }}>{twoFaError}</div>
                )}
                {twoFaMsg && !twoFaQr && (
                  <div style={{ background: "#E9F8EF", color: "#1FA463", fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 8, marginBottom: 8 }}>{twoFaMsg}</div>
                )}
                {user?.twoFactorEnabled ? (
                  <form onSubmit={onDisable2FA} style={{ display: "flex", gap: 8 }}>
                    <input className="field-input" placeholder={t("settings.currentTwoFaCode")} value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn" type="submit" disabled={twoFaBusy} style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 12.5, fontWeight: 700, padding: "0 14px", borderRadius: 8, whiteSpace: "nowrap" }}>
                      {t("common.delete")}
                    </button>
                  </form>
                ) : twoFaQr ? (
                  <form onSubmit={onConfirm2FA} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("settings.scanQr")}</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={twoFaQr} alt="2FA QR" width={160} height={160} style={{ alignSelf: "center", border: "1px solid #EAE8E2", borderRadius: 8 }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="field-input" placeholder="000000" value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value)} style={{ flex: 1, textAlign: "center" }} />
                      <button className="btn" type="submit" disabled={twoFaBusy} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "0 14px", borderRadius: 8 }}>
                        {t("twofa.confirm")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    className="btn"
                    onClick={onStart2FA}
                    style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}
                  >
                    {t("settings.enable2fa")}
                  </button>
                )}
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{t("settings.activeSessions")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sessions.map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #EAE8E2", borderRadius: 10, padding: "8px 12px" }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.userAgent || t("settings.unknownDevice")}</div>
                        <div style={{ fontSize: 11, color: "#8A8D96" }}>{s.ip} · {new Date(s.lastUsedAt).toLocaleString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US")}</div>
                      </div>
                      <button className="btn" onClick={() => onRevokeSession(s.id)} style={{ background: "transparent", color: "#B23A47", fontSize: 11.5, fontWeight: 600, padding: "4px 8px", borderRadius: 8 }}>
                        {t("settings.revoke")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{t("settings.webhooks")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                  {webhooks.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#8A8D96" }}>{t("settings.noWebhooks")}</div>
                  ) : (
                    webhooks.map((w) => (
                      <div key={w.id} style={{ border: "1px solid #EAE8E2", borderRadius: 10, padding: "8px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, wordBreak: "break-all" }}>{w.url}</div>
                          <button className="btn" onClick={() => onRemoveWebhook(w.id)} style={{ background: "transparent", color: "#B23A47", fontSize: 11.5, fontWeight: 600, padding: "4px 8px", borderRadius: 8, flexShrink: 0 }}>
                            {t("common.delete")}
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: "#8A8D96", marginTop: 2 }}>
                          {t("settings.eventLabel")}: {w.event} · {t("settings.secretLabel")}: <code>{w.secret.slice(0, 12)}...</code>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={onAddWebhook} style={{ display: "flex", gap: 8 }}>
                  <input className="field-input" placeholder="https://sizning-tizim.uz/webhook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} style={{ flex: 2 }} />
                  <Select
                    options={[
                      { value: "*", label: t("settings.eventAll") },
                      { value: "payment.created", label: t("settings.eventPaymentCreated") },
                      { value: "attendance.marked", label: t("settings.eventAttendanceMarked") },
                      { value: "student.created", label: t("settings.eventStudentCreated") },
                    ]}
                    value={webhookEvent}
                    onChange={setWebhookEvent}
                    style={{ flex: 1 }}
                  />
                  <button className="btn" type="submit" disabled={savingWebhook} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "0 16px", borderRadius: 9, whiteSpace: "nowrap" }}>
                    {t("common.add")}
                  </button>
                </form>
              </div>
            </div>
          )}

          {tab === "integrations" && (
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22, maxWidth: 640 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t("settings.integrations")}</div>
              <div style={{ fontSize: 12.5, color: "#8A8D96", marginBottom: 16 }}>{t("settings.integrationsHint")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5 }}>
                <IntegrationRow
                  label={t("settings.telegramBotLabel")}
                  active={!!telegramStatus?.configured}
                  hint={
                    telegramStatus?.configured
                      ? `${t("settings.enabled")}: @${telegramStatus.botUsername}`
                      : t("settings.telegramInactiveHint")
                  }
                  activeLabel={t("settings.enabled")}
                  inactiveLabel={t("settings.disabled")}
                />
                <IntegrationRow label={t("settings.clickPaymentLabel")} active={false} hint="backend/.env: CLICK_MERCHANT_ID, CLICK_SERVICE_ID, CLICK_SECRET_KEY" activeLabel={t("settings.enabled")} inactiveLabel={t("settings.disabled")} />
                <IntegrationRow label={t("settings.paymePaymentLabel")} active={false} hint="backend/.env: PAYME_MERCHANT_ID, PAYME_KEY" activeLabel={t("settings.enabled")} inactiveLabel={t("settings.disabled")} />
                <IntegrationRow label={t("settings.aiAssistantLabel")} active={false} hint="backend/.env: ANTHROPIC_API_KEY" activeLabel={t("settings.enabled")} inactiveLabel={t("settings.disabled")} />
              </div>
              {telegramStatus?.configured && (
                <div style={{ marginTop: 16, background: "#ECEBFB", borderRadius: 12, padding: "14px 18px", fontSize: 12.5, color: "#4A4E58", lineHeight: 1.6 }}>
                  {t("settings.telegramLinkHint")}
                </div>
              )}
            </div>
          )}

          {tab === "data" && (
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22, maxWidth: 640 }}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{t("settings.myData")}</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={onExportData}
                  style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 9 }}
                >
                  {t("settings.exportJson")}
                </button>
                <button
                  className="btn"
                  onClick={() => setDeleteOpen(true)}
                  style={{ background: "#FDEBEC", color: "#B23A47", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 9 }}
                >
                  {t("settings.deleteCenter")}
                </button>
              </div>
              {deleteOpen && (
                <form onSubmit={onDeleteMyTenant} style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, border: "1px solid #F6D2D6", background: "#FDEBEC", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12.5, color: "#B23A47", lineHeight: 1.5 }}>
                    {t("settings.deleteWarning")}
                  </div>
                  {gdprError && <div style={{ color: "#B23A47", fontSize: 12.5, fontWeight: 600 }}>{gdprError}</div>}
                  <input className="field-input" type="password" required placeholder={t("settings.yourPassword")} value={gdprPassword} onChange={(e) => setGdprPassword(e.target.value)} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" type="submit" disabled={gdprBusy} style={{ background: "#B23A47", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 9 }}>
                      {gdprBusy ? t("settings.deleting") : t("settings.confirmDeleteYes")}
                    </button>
                    <button type="button" className="btn" onClick={() => setDeleteOpen(false)} style={{ background: "transparent", color: "#4A4E58", fontSize: 13, fontWeight: 600, padding: "10px 16px", borderRadius: 9 }}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function IntegrationRow({ label, active, hint, activeLabel, inactiveLabel }: { label: string; active: boolean; hint: string; activeLabel: string; inactiveLabel: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #EAE8E2", borderRadius: 10, padding: "10px 14px" }}>
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 2 }}>{hint}</div>
      </div>
      <span className={`badge ${active ? "badge-success" : "badge-neutral"}`}>{active ? activeLabel : inactiveLabel}</span>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <DashboardShell>
      <SettingsContent />
    </DashboardShell>
  );
}
