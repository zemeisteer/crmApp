"use client";

import { useEffect, useState } from "react";
import { ApiError, branchesApi, type Branch } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import PhoneInput from "@/components/PhoneInput";
import { isCompleteUzPhone, phoneOrEmpty } from "@/lib/validation";

const ACCENT = "var(--primary)";
const empty = { name: "", address: "", phone: "", mapUrl: "" };

// Branches with their own address, phone and map link (the center profile
// no longer carries an address: each branch has its own).
export default function BranchesManager() {
  const { t } = useLanguage();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => branchesApi.list().then(setBranches).catch(() => setBranches([]));
  useEffect(() => {
    load();
  }, []);

  function edit(b: Branch) {
    setEditingId(b.id);
    setForm({ name: b.name, address: b.address ?? "", phone: b.phone ?? "", mapUrl: b.mapUrl ?? "" });
    setError(null);
  }

  function reset() {
    setEditingId(null);
    setForm(empty);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t("br.nameRequired"));
      return;
    }
    // An Uzbek number: +998 and all 9 digits, or nothing.
    if (phoneOrEmpty(form.phone) && !isCompleteUzPhone(form.phone)) {
      setError(t("br.badPhone"));
      return;
    }
    if (form.mapUrl.trim() && !/^https?:\/\//i.test(form.mapUrl.trim())) {
      setError(t("br.badUrl"));
      return;
    }
    setSaving(true);
    setError(null);
    const data = { name: form.name.trim(), address: form.address.trim(), phone: phoneOrEmpty(form.phone), mapUrl: form.mapUrl.trim() };
    try {
      if (editingId) await branchesApi.update(editingId, data);
      else await branchesApi.create(data);
      reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("settings.confirmRemoveBranch"))) return;
    try {
      await branchesApi.remove(id);
      if (editingId === id) reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    }
  }

  const input = (key: keyof typeof empty, label: string, placeholder: string, type = "text") => (
    <div>
      <div style={lbl}>{label}</div>
      <input className="field-input" type={type} value={form[key]} placeholder={placeholder} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 22, maxWidth: 760 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t("settings.branches")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 16 }}>{t("br.hint")}</div>

      {branches === null ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("common.loading")}</div>
      ) : branches.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: "var(--radius-md)", padding: 16, textAlign: "center" }}>{t("settings.noBranches")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 16 }}>
          {branches.map((b) => (
            <div key={b.id} style={{ border: `1px solid ${editingId === b.id ? ACCENT : "var(--border)"}`, borderRadius: "var(--radius-md)", padding: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>📍 {b.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-soft)", marginTop: 6, lineHeight: 1.6 }}>
                {b.address || <span style={{ color: "var(--text-faint)" }}>{t("br.noAddress")}</span>}
                {b.phone && <div>📞 {b.phone}</div>}
                {b.mapUrl && (
                  <a href={b.mapUrl} target="_blank" rel="noreferrer" style={{ color: ACCENT, fontWeight: 600 }}>
                    🗺 {t("br.openMap")}
                  </a>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button type="button" onClick={() => edit(b)} style={small}>{t("common.edit")}</button>
                <button type="button" onClick={() => remove(b.id)} style={{ ...small, color: "var(--danger)" }}>{t("common.delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={save} noValidate style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, background: editingId ? "var(--primary-soft)" : "var(--surface-muted)", marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{editingId ? `✏️ ${t("br.edit")}` : `+ ${t("br.add")}`}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          {input("name", `${t("settings.branchName")} *`, t("onb.branchNamePh"))}
          <div>
            <div style={lbl}>{t("onb.branchPhone")}</div>
            <PhoneInput className="field-input" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="+998 71 123 45 67" aria-label={t("onb.branchPhone")} />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>{input("address", t("onb.address"), t("set.addressPh"))}</div>
        <div style={{ marginTop: 10 }}>{input("mapUrl", t("settings.locationUrl"), "https://maps.google.com/...", "url")}</div>
        {error && <div role="alert" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, color: "var(--danger)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          {editingId && <button type="button" onClick={reset} style={small}>{t("common.cancel")}</button>}
          <button type="submit" disabled={saving} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: "var(--radius-sm)", cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
            {saving ? t("common.saving") : editingId ? t("common.save") : t("common.add")}
          </button>
        </div>
      </form>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 };
const small: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: "var(--radius-xs)", cursor: "pointer" };
