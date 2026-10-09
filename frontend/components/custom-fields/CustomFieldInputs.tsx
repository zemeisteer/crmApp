"use client";

import { useEffect, useState } from "react";
import Select from "@/components/Select";
import MultiSelect from "@/components/MultiSelect";
import DatePicker from "@/components/DatePicker";
import { ApiError, customFieldsApi, type CustomFieldDef, type CustomFieldEntity } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { dict, type TranslationKey } from "@/lib/i18n";
import { activeDefs, cfServerErrors, CF_LONG_TEXT_MAX, CF_TEXT_MAX, type CfDraft, type CfDraftValue, type CfErrors } from "@/lib/custom-fields";

const ACCENT = "#4F46E5";

/** The center's field definitions of one kind; `defs` is null while loading. */
export function useCustomFieldDefs(entityType: CustomFieldEntity, opts: { includeArchived?: boolean; enabled?: boolean } = {}) {
  const { includeArchived = false, enabled = true } = opts;
  const [state, setState] = useState<{ defs: CustomFieldDef[] | null; error: boolean }>({ defs: null, error: false });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    customFieldsApi
      .list(entityType, includeArchived)
      .then((defs) => alive && setState({ defs, error: false }))
      .catch(() => alive && setState({ defs: [], error: true }));
    return () => {
      alive = false;
    };
  }, [entityType, includeArchived, enabled, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** A form's custom-field drafts and their errors; editing a field clears its error. */
export function useCfDraft(initial: CfDraft = {}) {
  const [draft, setDraft] = useState<CfDraft>(initial);
  const [errors, setErrors] = useState<CfErrors>({});
  function change(id: string, v: CfDraftValue) {
    setDraft((d) => ({ ...d, [id]: v }));
    setErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function reset(next: CfDraft = {}) {
    setDraft(next);
    setErrors({});
  }
  return { draft, setDraft, errors, setErrors, change, reset };
}

/**
 * A refused submit: the per-field errors of a 400 CUSTOM_FIELDS_INVALID
 * (null otherwise) and the message for the form's banner - a pointer to
 * the marked fields when every error is on a field the form shows.
 */
export function cfSubmitError(err: unknown, shownDefs: CustomFieldDef[], t: (k: TranslationKey) => string): { fields: CfErrors | null; message: string } {
  const fields = err instanceof ApiError ? cfServerErrors(err.body) : null;
  const fallback = err instanceof ApiError ? err.message : t("common.errorGeneric");
  if (!fields) return { fields: null, message: fallback };
  const shown = new Set(activeDefs(shownDefs).map((d) => d.id));
  return { fields, message: Object.keys(fields).every((id) => shown.has(id)) ? t("cf.formError") : fallback };
}

/** A field error code (the server's or the form's own) as a sentence. */
export function cfErrorText(t: (k: TranslationKey) => string, code: string): string {
  const key = `cf.err.${code}`;
  return key in dict ? t(key as TranslationKey) : t("cf.err.INVALID");
}

const labelStyle: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const srOnly: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };
const errStyle: React.CSSProperties = { marginTop: 5, fontSize: 12, fontWeight: 600, color: "#B91C1C" };
const errBorder: React.CSSProperties = { borderColor: "#DC2626", boxShadow: "0 0 0 3px rgba(220,38,38,0.12)" };

/**
 * Inputs for the active fields of `defs`, in their order. Values are form
 * drafts (see lib/custom-fields.ts); `errors` maps a field id to an error
 * code. Renders nothing when the center has no active fields.
 */
export default function CustomFieldInputs({
  defs,
  values,
  onChange,
  errors = {},
  idPrefix,
  title,
  carried,
  notes,
}: {
  defs: CustomFieldDef[];
  values: CfDraft;
  onChange: (fieldId: string, value: CfDraftValue) => void;
  errors?: CfErrors;
  idPrefix: string;
  // A heading above the fields (only shown when there are fields).
  title?: string;
  // Fields whose value came from somewhere else (a lead being converted).
  carried?: Set<string>;
  // A hint under a field (e.g. why a value could not be carried).
  notes?: Record<string, string>;
}) {
  const { t } = useLanguage();
  const list = activeDefs(defs);
  if (list.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {title && <div style={{ fontSize: 13.5, fontWeight: 800, color: "#181A1F", paddingTop: 14, borderTop: "1px solid #EAE8E2", marginTop: 2 }}>{title}</div>}
      {list.map((def) => {
        const id = `${idPrefix}-${def.id}`;
        const labelId = `${id}-label`;
        const errId = `${id}-err`;
        const noteId = `${id}-note`;
        const error = errors[def.id];
        const note = notes?.[def.id];
        const describedBy = [error ? errId : null, note ? noteId : null].filter(Boolean).join(" ") || undefined;
        const value = values[def.id];
        const native = def.fieldType === "TEXT" || def.fieldType === "LONG_TEXT" || def.fieldType === "NUMBER";
        const LabelTag = native ? "label" : "div";
        const common = {
          id,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy,
          "aria-required": def.required || undefined,
        } as const;
        const str = typeof value === "string" ? value : "";
        let input: React.ReactNode;
        switch (def.fieldType) {
          case "TEXT":
            input = <input {...common} className="field-input" style={error ? errBorder : undefined} value={str} maxLength={CF_TEXT_MAX} onChange={(e) => onChange(def.id, e.target.value)} />;
            break;
          case "LONG_TEXT":
            input = <textarea {...common} className="field-input" rows={3} style={{ resize: "vertical", ...(error ? errBorder : {}) }} value={str} maxLength={CF_LONG_TEXT_MAX} onChange={(e) => onChange(def.id, e.target.value)} />;
            break;
          case "NUMBER":
            input = <input {...common} className="field-input" style={error ? errBorder : undefined} inputMode="decimal" value={str} onChange={(e) => onChange(def.id, e.target.value)} />;
            break;
          case "DATE":
            input = <DatePicker value={str} onChange={(v) => onChange(def.id, v)} style={error ? { borderRadius: 10, ...errBorder } : undefined} />;
            break;
          case "BOOLEAN": {
            const choices: Array<{ v: boolean | null; label: string }> = [
              { v: true, label: t("cf.yes") },
              { v: false, label: t("cf.no") },
              ...(def.required ? [] : [{ v: null, label: t("cf.unanswered") }]),
            ];
            input = (
              <div role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy} aria-required={def.required || undefined} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {choices.map((c) => {
                  const on = (value ?? null) === c.v;
                  return (
                    <label
                      key={String(c.v)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13.5, fontWeight: on ? 700 : 500,
                        padding: "9px 14px", borderRadius: 10, border: `1px solid ${on ? ACCENT : error ? "#DC2626" : "#EAE8E2"}`,
                        background: on ? "#EEF0FF" : "#fff", color: on ? ACCENT : "#181A1F",
                      }}
                    >
                      <input type="radio" name={id} checked={on} onChange={() => onChange(def.id, c.v)} style={{ accentColor: ACCENT, margin: 0 }} />
                      {c.label}
                    </label>
                  );
                })}
              </div>
            );
            break;
          }
          case "SELECT": {
            const opts = def.options.filter((o) => !o.archived || o.id === str);
            const selected = opts.find((o) => o.id === str);
            input = (
              <Select
                value={str}
                onChange={(v) => onChange(def.id, v)}
                ariaLabel={`${def.label}: ${selected ? selected.label : t("cf.notSelected")}`}
                placeholder={t("cf.notSelected")}
                style={error ? { borderRadius: 10, ...errBorder } : undefined}
                options={[
                  { value: "", label: t("cf.notSelected") },
                  ...opts.map((o) => ({ value: o.id, label: o.archived ? `${o.label} ${t("cf.archivedSuffix")}` : o.label })),
                ]}
              />
            );
            break;
          }
          case "MULTI_SELECT": {
            const picked = Array.isArray(value) ? value : [];
            const opts = def.options.filter((o) => !o.archived || picked.includes(o.id));
            input = (
              <MultiSelect
                selected={picked}
                onChange={(v) => onChange(def.id, v)}
                ariaLabel={def.label}
                placeholder={t("cf.notSelected")}
                style={error ? { borderRadius: 10, ...errBorder } : undefined}
                options={opts.map((o) => ({ value: o.id, label: o.archived ? `${o.label} ${t("cf.archivedSuffix")}` : o.label }))}
              />
            );
            break;
          }
        }
        return (
          <div key={def.id} role="group" aria-labelledby={labelId} style={{ minWidth: 0 }}>
            <LabelTag id={labelId} {...(native ? { htmlFor: id } : {})} style={labelStyle}>
              <span>
                {def.label}
                {def.required && <span aria-hidden style={{ color: "#B91C1C" }}> *</span>}
                {def.required && <span style={srOnly}> ({t("cf.requiredSr")})</span>}
              </span>
              {carried?.has(def.id) && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#0F766E", background: "#CCFBF1", padding: "2px 8px", borderRadius: 999 }}>{t("cf.carried")}</span>
              )}
            </LabelTag>
            {input}
            {note && <div id={noteId} style={{ marginTop: 5, fontSize: 12, color: "#B45309" }}>{note}</div>}
            {error && <div id={errId} role="alert" style={errStyle}>{cfErrorText(t, error)}</div>}
          </div>
        );
      })}
    </div>
  );
}
