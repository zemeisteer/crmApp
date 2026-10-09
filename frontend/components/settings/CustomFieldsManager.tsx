"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import {
  ApiError,
  CUSTOM_FIELD_TYPES,
  customFieldsApi,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldInput,
  type CustomFieldType,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { activeDefs } from "@/lib/custom-fields";

const ACCENT = "#4F46E5";
const MAX_ACTIVE = 30;
const MAX_OPTIONS = 50;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const isChoice = (type: CustomFieldType) => type === "SELECT" || type === "MULTI_SELECT";
const typeKey = (type: CustomFieldType) => `cf.type.${type}` as TranslationKey;

const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 };
const small: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, cursor: "pointer" };
const iconBtn: React.CSSProperties = { ...small, padding: "6px 9px", minWidth: 32 };
const badge = (color: string, bg: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, color, background: bg, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" });
const fieldErr: React.CSSProperties = { marginTop: 5, fontSize: 12, fontWeight: 600, color: "#B91C1C" };

type Defs = Record<CustomFieldEntity, CustomFieldDef[]>;

/**
 * Settings > Custom fields: the center's own fields on students and leads.
 * List with order, create/edit (options, portal flag, lead -> student
 * mapping), archive and restore. Owner and admins only (the server checks).
 */
export default function CustomFieldsManager() {
  const { t } = useLanguage();
  const [entity, setEntity] = useState<CustomFieldEntity>("STUDENT");
  const [defs, setDefs] = useState<Defs | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // null: closed; { def: null }: a new field.
  const [editor, setEditor] = useState<{ def: CustomFieldDef | null } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([customFieldsApi.list("STUDENT", true), customFieldsApi.list("LEAD", true)])
      .then(([STUDENT, LEAD]) => {
        if (!alive) return;
        setDefs({ STUDENT, LEAD });
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [nonce]);
  const reload = () => setNonce((n) => n + 1);

  const list = defs?.[entity] ?? [];
  const active = activeDefs(list);
  const archived = list.filter((d) => d.archivedAt);
  const studentDefs = defs?.STUDENT ?? [];
  const labelOf = (id: string | null) => studentDefs.find((d) => d.id === id)?.label;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
      reload();
    }
  }

  // Moves a field one place; every active field gets its position as its order.
  function move(index: number, dir: -1 | 1) {
    const order = active.slice();
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    const changed = order.map((d, i) => ({ d, i })).filter(({ d, i }) => d.sortOrder !== i);
    setDefs((prev) => (prev ? { ...prev, [entity]: prev[entity].map((d) => { const at = order.indexOf(d); return at >= 0 ? { ...d, sortOrder: at } : d; }) } : prev));
    void act(async () => {
      for (const { d, i } of changed) await customFieldsApi.update(d.id, { sortOrder: i });
    });
  }

  function archive(d: CustomFieldDef) {
    if (!window.confirm(t("cf.confirmArchive"))) return;
    void act(() => customFieldsApi.archive(d.id));
  }

  const tabBtn = (e: CustomFieldEntity, label: string) => (
    <button
      type="button"
      className="btn"
      aria-pressed={entity === e}
      onClick={() => { setEntity(e); setActionError(null); }}
      style={{ border: "none", fontSize: 13, fontWeight: 700, padding: "8px 14px", borderRadius: 8, background: entity === e ? "#fff" : "transparent", color: entity === e ? "#181A1F" : "#686B75", boxShadow: entity === e ? "0 1px 3px rgba(18,19,26,0.08)" : "none" }}
    >
      {label}
    </button>
  );

  const full = active.length >= MAX_ACTIVE;

  return (
    <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 22, maxWidth: 760, minWidth: 0 }}>
      <h2 style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t("cf.title")}</h2>
      <div style={{ fontSize: 12.5, color: "#686B75", marginBottom: 16, lineHeight: 1.5 }}>{t("cf.hint")}</div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div role="group" aria-label={t("cf.title")} style={{ display: "inline-flex", background: "#F2F1EC", padding: 4, borderRadius: 10, gap: 2 }}>
          {tabBtn("STUDENT", t("cf.entityStudent"))}
          {tabBtn("LEAD", t("cf.entityLead"))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {defs && <span style={{ fontSize: 12, color: "#686B75" }}>{t("cf.activeCount").replace("{n}", String(active.length)).replace("{max}", String(MAX_ACTIVE))}</span>}
          <button
            type="button"
            className="btn"
            disabled={!defs || full}
            onClick={() => setEditor({ def: null })}
            style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 9, opacity: !defs || full ? 0.5 : 1 }}
          >
            {t("cf.add")}
          </button>
        </div>
      </div>
      {full && <div style={{ fontSize: 12.5, color: "#B45309", marginBottom: 12 }}>{t("cf.limitReached")}</div>}
      {actionError && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, marginBottom: 12 }}>{actionError}</div>}

      {loadError && !defs ? (
        <div role="alert" style={{ fontSize: 13, color: "#B23A47", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {t("cf.loadError")}
          <button type="button" style={small} onClick={reload}>{t("cf.retry")}</button>
        </div>
      ) : !defs ? (
        <div style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
      ) : active.length === 0 ? (
        <div style={{ fontSize: 13, color: "#686B75", border: "1px dashed #EAE8E2", borderRadius: 12, padding: 16, textAlign: "center" }}>{t("cf.empty")}</div>
      ) : (
        <ul aria-label={entity === "STUDENT" ? t("cf.entityStudent") : t("cf.entityLead")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {active.map((d, i) => (
            <li key={d.id} style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <div style={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{d.label}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
                  <code style={{ fontSize: 11.5, color: "#686B75" }}>{d.key}</code>
                  <span style={badge("#4F46E5", "#EEF0FF")}>{t(typeKey(d.fieldType))}</span>
                  {d.required && <span style={badge("#B91C1C", "#FEE2E2")}>{t("cf.required")}</span>}
                  {d.entityType === "STUDENT" && d.portalVisible && <span style={badge("#0F766E", "#CCFBF1")}>{t("cf.portalBadge")}</span>}
                  {d.entityType === "LEAD" && d.studentFieldId && (
                    <span style={badge("#92400E", "#FEF3C7")}>{t("cf.mappedTo").replace("{label}", labelOf(d.studentFieldId) ?? "?")}</span>
                  )}
                  {isChoice(d.fieldType) && <span style={{ fontSize: 11.5, color: "#686B75" }}>{d.options.filter((o) => !o.archived).map((o) => o.label).join(", ")}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={{ ...iconBtn, opacity: i === 0 ? 0.4 : 1 }} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`${t("cf.moveUp")}: ${d.label}`} title={t("cf.moveUp")}>↑</button>
                <button type="button" style={{ ...iconBtn, opacity: i === active.length - 1 ? 0.4 : 1 }} disabled={busy || i === active.length - 1} onClick={() => move(i, 1)} aria-label={`${t("cf.moveDown")}: ${d.label}`} title={t("cf.moveDown")}>↓</button>
                <button type="button" style={small} disabled={busy} onClick={() => setEditor({ def: d })} aria-label={`${t("common.edit")}: ${d.label}`}>{t("common.edit")}</button>
                <button type="button" style={{ ...small, color: "#B23A47" }} disabled={busy} onClick={() => archive(d)} aria-label={`${t("cf.archive")}: ${d.label}`}>{t("cf.archive")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {defs && archived.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 12, fontWeight: 800, color: "#8A8D96", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{t("cf.archivedTitle")}</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {archived.map((d) => (
              <li key={d.id} style={{ border: "1px dashed #EAE8E2", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", color: "#686B75" }}>
                <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                  <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{d.label}</span>{" "}
                  <span style={{ fontSize: 12 }}>· {t(typeKey(d.fieldType))}</span>
                </div>
                <button type="button" style={small} disabled={busy || full} onClick={() => void act(() => customFieldsApi.restore(d.id))} aria-label={`${t("cf.restore")}: ${d.label}`}>{t("cf.restore")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editor && (
        <FieldEditor
          entity={entity}
          def={editor.def}
          studentDefs={studentDefs}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            setActionError(message ?? null);
            reload();
          }}
        />
      )}
    </div>
  );
}

type OptionRow = { k: string; id?: string; label: string };
let tempKey = 0;
const newRow = (): OptionRow => ({ k: `new-${++tempKey}`, label: "" });

function FieldEditor({
  entity,
  def,
  studentDefs,
  onClose,
  onSaved,
}: {
  entity: CustomFieldEntity;
  def: CustomFieldDef | null;
  studentDefs: CustomFieldDef[];
  onClose: () => void;
  // `message`: saved, but a follow-up step failed (shown on the list).
  onSaved: (message?: string) => void;
}) {
  const { t } = useLanguage();
  const editing = !!def;
  const [label, setLabel] = useState(def?.label ?? "");
  const [key, setKey] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>(def?.fieldType ?? "TEXT");
  const [required, setRequired] = useState(def?.required ?? false);
  const [portalVisible, setPortalVisible] = useState(def?.portalVisible ?? false);
  const [options, setOptions] = useState<OptionRow[]>(() =>
    def ? def.options.filter((o) => !o.archived).map((o) => ({ k: o.id, id: o.id, label: o.label })) : [],
  );
  const [archivedOpts, setArchivedOpts] = useState(() => (def ? def.options.filter((o) => o.archived) : []));
  const [target, setTarget] = useState(def?.studentFieldId ?? "");
  // Lead option (row key) -> student option id.
  const [optionMap, setOptionMap] = useState<Record<string, string>>(() => ({ ...(def?.optionMap ?? {}) }));
  const [errors, setErrors] = useState<{ label?: string; key?: string; type?: string; options?: string; general?: string }>({});
  const [saving, setSaving] = useState(false);

  const choice = isChoice(fieldType);
  // Active student fields of the same type (and the current link, even if that field was archived since).
  const targets = studentDefs
    .filter((d) => d.fieldType === fieldType && (!d.archivedAt || d.id === def?.studentFieldId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const targetDef = targets.find((d) => d.id === target) ?? null;
  const targetOptions = targetDef ? targetDef.options.filter((o) => !o.archived) : [];

  function changeType(next: CustomFieldType) {
    setFieldType(next);
    setErrors((e) => ({ ...e, type: undefined, options: undefined }));
    if (isChoice(next) && options.length === 0) setOptions([newRow(), newRow()]);
    const still = studentDefs.find((d) => d.id === target);
    if (!still || still.fieldType !== next) {
      setTarget("");
      setOptionMap({});
    }
  }

  function changeTarget(next: string) {
    setTarget(next);
    setOptionMap({});
  }

  function setOption(i: number, value: string) {
    setOptions((list) => list.map((o, j) => (j === i ? { ...o, label: value } : o)));
    setErrors((e) => ({ ...e, options: undefined }));
  }
  function moveOption(i: number, dir: -1 | 1) {
    setOptions((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = list.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeOption(i: number) {
    setOptions((list) => list.filter((_, j) => j !== i));
  }
  function restoreOption(id: string) {
    const o = archivedOpts.find((x) => x.id === id);
    if (!o) return;
    setArchivedOpts((list) => list.filter((x) => x.id !== id));
    setOptions((list) => [...list, { k: o.id, id: o.id, label: o.label }]);
  }

  function validate() {
    const errs: typeof errors = {};
    if (!label.trim()) errs.label = t("cf.errLabel");
    if (!editing && key.trim() && !KEY_RE.test(key.trim())) errs.key = t("cf.keyInvalid");
    if (choice) {
      const labels = options.map((o) => o.label.trim());
      if (labels.length === 0) errs.options = t("cf.errOptions");
      else if (labels.some((l) => !l)) errs.options = t("cf.errOptionEmpty");
      else if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) errs.options = t("cf.errOptionDuplicate");
      else if (labels.length > MAX_OPTIONS) errs.options = t("cf.errTooManyOptions");
    }
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const errs = validate();
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    const lead = entity === "LEAD";
    const optionsPayload = choice
      ? [...options.map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label.trim() })), ...archivedOpts.map((o) => ({ id: o.id, label: o.label, archived: true }))]
      : undefined;
    const targetId = lead && targetDef ? targetDef.id : null;
    // Mappings of options that already have ids (kept ones; archived ones keep theirs).
    const knownMap: Record<string, string> = {};
    if (choice && targetId) {
      const live = new Set(targetOptions.map((o) => o.id));
      for (const o of options) if (o.id && optionMap[o.k] && live.has(optionMap[o.k])) knownMap[o.id] = optionMap[o.k];
      if (targetId === def?.studentFieldId) for (const o of archivedOpts) if (def?.optionMap?.[o.id]) knownMap[o.id] = def.optionMap[o.id];
    }

    setSaving(true);
    let saved: CustomFieldDef;
    try {
      if (!editing) {
        const body: CustomFieldInput = {
          entityType: entity,
          label: label.trim(),
          ...(key.trim() ? { key: key.trim() } : {}),
          fieldType,
          required,
          ...(optionsPayload ? { options: optionsPayload } : {}),
          ...(entity === "STUDENT" ? { portalVisible } : {}),
          ...(targetId ? { studentFieldId: targetId } : {}),
        };
        saved = await customFieldsApi.create(body);
      } else {
        const typeChanged = fieldType !== def.fieldType;
        const targetChanged = (targetId ?? null) !== (def.studentFieldId ?? null);
        saved = await customFieldsApi.update(def.id, {
          label: label.trim(),
          ...(typeChanged ? { fieldType } : {}),
          required,
          ...(optionsPayload ? { options: optionsPayload } : {}),
          ...(entity === "STUDENT" ? { portalVisible } : {}),
          ...(lead && (targetChanged || typeChanged) ? { studentFieldId: targetId } : {}),
          ...(lead && choice && targetId ? { optionMap: knownMap } : {}),
        });
      }
    } catch (err) {
      setSaving(false);
      const code = err instanceof ApiError ? err.body?.code : undefined;
      if (code === "TYPE_LOCKED") setErrors({ type: t("cf.errTypeLocked") });
      else if (code === "KEY_TAKEN") setErrors({ key: t("cf.errKeyTaken") });
      else setErrors({ general: err instanceof ApiError ? err.message : t("common.errorGeneric") });
      return;
    }

    // Options added just now get their ids from the server (in the order
    // sent): their mappings are saved in a second step.
    const pending = choice && targetId ? options.map((o, i) => ({ o, i })).filter(({ o }) => !o.id && optionMap[o.k]) : [];
    if (pending.length > 0) {
      const fullMap = { ...knownMap };
      for (const { o, i } of pending) {
        const created = saved.options[i];
        if (created && created.label === o.label.trim()) fullMap[created.id] = optionMap[o.k];
      }
      try {
        await customFieldsApi.update(saved.id, { optionMap: fullMap });
      } catch (err) {
        setSaving(false);
        onSaved(err instanceof ApiError ? err.message : t("common.errorGeneric"));
        return;
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={editing ? t("cf.editField") : t("cf.newField")} width={600}>
      <form onSubmit={onSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {errors.general && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{errors.general}</div>}

        <div>
          <label htmlFor="cf-def-label" style={lbl}>{t("cf.label")} *</label>
          <input
            id="cf-def-label"
            className="field-input"
            value={label}
            maxLength={80}
            placeholder={t("cf.labelPh")}
            aria-invalid={!!errors.label}
            aria-describedby={errors.label ? "cf-def-label-err" : undefined}
            onChange={(e) => { setLabel(e.target.value); setErrors((x) => ({ ...x, label: undefined })); }}
          />
          {errors.label && <div id="cf-def-label-err" role="alert" style={fieldErr}>{errors.label}</div>}
        </div>

        {editing ? (
          <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("cf.key")}: <code>{def.key}</code></div>
        ) : (
          <div>
            <label htmlFor="cf-def-key" style={lbl}>{t("cf.key")}</label>
            <input
              id="cf-def-key"
              className="field-input"
              value={key}
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="maktab_nomi"
              aria-invalid={!!errors.key}
              aria-describedby={`cf-def-key-hint${errors.key ? " cf-def-key-err" : ""}`}
              onChange={(e) => { setKey(e.target.value); setErrors((x) => ({ ...x, key: undefined })); }}
            />
            <div id="cf-def-key-hint" style={{ marginTop: 5, fontSize: 12, color: "#686B75" }}>{t("cf.keyHint")}</div>
            {errors.key && <div id="cf-def-key-err" role="alert" style={fieldErr}>{errors.key}</div>}
          </div>
        )}

        <div>
          <div id="cf-def-type-label" style={lbl}>{t("cf.type")}</div>
          <Select
            value={fieldType}
            onChange={(v) => changeType(v as CustomFieldType)}
            ariaLabel={`${t("cf.type")}: ${t(typeKey(fieldType))}`}
            options={CUSTOM_FIELD_TYPES.map((x) => ({ value: x, label: t(typeKey(x)) }))}
          />
          {editing && <div style={{ marginTop: 5, fontSize: 12, color: "#686B75" }}>{t("cf.typeChangeHint")}</div>}
          {errors.type && <div role="alert" style={fieldErr}>{errors.type}</div>}
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} style={{ marginTop: 3, accentColor: ACCENT }} />
          <span>
            <span style={{ fontWeight: 700 }}>{t("cf.required")}</span>
            <span style={{ display: "block", fontSize: 12, color: "#686B75", marginTop: 2 }}>{t("cf.requiredHint")}</span>
          </span>
        </label>

        {entity === "STUDENT" && (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" checked={portalVisible} onChange={(e) => setPortalVisible(e.target.checked)} style={{ marginTop: 3, accentColor: ACCENT }} />
            <span>
              <span style={{ fontWeight: 700 }}>{t("cf.portalVisible")}</span>
              <span style={{ display: "block", fontSize: 12, color: "#686B75", marginTop: 2 }}>{t("cf.portalHint")}</span>
            </span>
          </label>
        )}

        {choice && (
          <fieldset style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: "12px 14px", margin: 0, minWidth: 0 }}>
            <legend style={{ fontSize: 12.5, fontWeight: 700, color: "#4A4E58", padding: "0 6px" }}>{t("cf.options")}</legend>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((o, i) => {
                const name = t("cf.optionN").replace("{n}", String(i + 1));
                return (
                  <li key={o.k} style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                    <input
                      className="field-input"
                      value={o.label}
                      maxLength={80}
                      placeholder={t("cf.optionPh")}
                      aria-label={name}
                      onChange={(e) => setOption(i, e.target.value)}
                      style={{ flex: 1, minWidth: 0, padding: "9px 12px" }}
                    />
                    <button type="button" style={{ ...iconBtn, opacity: i === 0 ? 0.4 : 1 }} disabled={i === 0} onClick={() => moveOption(i, -1)} aria-label={`${t("cf.moveUp")}: ${name}`}>↑</button>
                    <button type="button" style={{ ...iconBtn, opacity: i === options.length - 1 ? 0.4 : 1 }} disabled={i === options.length - 1} onClick={() => moveOption(i, 1)} aria-label={`${t("cf.moveDown")}: ${name}`}>↓</button>
                    <button type="button" style={{ ...iconBtn, color: "#B23A47" }} onClick={() => removeOption(i)} aria-label={`${t("cf.removeOption")}: ${name}`}>✕</button>
                  </li>
                );
              })}
            </ol>
            <button type="button" style={{ ...small, marginTop: 10 }} disabled={options.length >= MAX_OPTIONS} onClick={() => setOptions((list) => [...list, newRow()])}>
              {t("cf.addOption")}
            </button>
            {editing && <div style={{ marginTop: 8, fontSize: 12, color: "#686B75" }}>{t("cf.optionRemoveHint")}</div>}
            {errors.options && <div role="alert" style={fieldErr}>{errors.options}</div>}
            {archivedOpts.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#8A8D96", marginBottom: 6 }}>{t("cf.archivedOptions")}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {archivedOpts.map((o) => (
                    <span key={o.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#686B75", border: "1px dashed #D9D6CE", borderRadius: 999, padding: "3px 4px 3px 10px" }}>
                      {o.label}
                      <button type="button" style={{ ...small, padding: "2px 8px", borderRadius: 999 }} onClick={() => restoreOption(o.id)} aria-label={`${t("cf.restoreOption")}: ${o.label}`}>
                        {t("cf.restoreOption")}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </fieldset>
        )}

        {entity === "LEAD" && (
          <div style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
            <div id="cf-def-target-label" style={lbl}>{t("cf.carryTo")}</div>
            {targets.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("cf.noTargetOfType")}</div>
            ) : (
              <Select
                value={targetDef ? target : ""}
                onChange={changeTarget}
                ariaLabel={`${t("cf.carryTo")}: ${targetDef ? targetDef.label : t("cf.carryNone")}`}
                options={[{ value: "", label: t("cf.carryNone") }, ...targets.map((d) => ({ value: d.id, label: d.archivedAt ? `${d.label} ${t("cf.archivedSuffix")}` : d.label }))]}
              />
            )}
            <div style={{ marginTop: 6, fontSize: 12, color: "#686B75", lineHeight: 1.5 }}>{t("cf.carryHint")}</div>
            {choice && targetDef && (
              <div style={{ marginTop: 12 }}>
                <div style={{ ...lbl, marginBottom: 4 }}>{t("cf.optionMap")}</div>
                <div style={{ fontSize: 12, color: "#686B75", marginBottom: 8 }}>{t("cf.optionMapHint")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {options.map((o, i) => {
                    const name = o.label.trim() || t("cf.optionN").replace("{n}", String(i + 1));
                    const to = targetOptions.find((x) => x.id === optionMap[o.k]);
                    return (
                      <div key={o.k} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span style={{ flex: "1 1 140px", minWidth: 0, fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{name} →</span>
                        <Select
                          value={to ? to.id : ""}
                          onChange={(v) => setOptionMap((m) => ({ ...m, [o.k]: v }))}
                          ariaLabel={`${name} → ${to ? to.label : t("cf.notMapped")}`}
                          style={{ flex: "1 1 180px", minWidth: 0 }}
                          options={[{ value: "", label: t("cf.notMapped") }, ...targetOptions.map((x) => ({ value: x.id, label: x.label }))]}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={onClose} style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 13.5, fontWeight: 700, padding: "11px 18px", borderRadius: 10 }}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn" disabled={saving} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "11px 18px", borderRadius: 10, opacity: saving ? 0.7 : 1 }}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
