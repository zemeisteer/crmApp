"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import CustomFieldInputs, { cfSubmitError, useCfDraft } from "@/components/custom-fields/CustomFieldInputs";
import type { CustomFieldDef, CustomFieldPayload, CustomFieldValue } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { activeDefs, cfPayload, cfValidate, draftFrom } from "@/lib/custom-fields";

const ACCENT = "#4F46E5";

/**
 * Edits a record's custom fields. Sends only the fields that changed; the
 * server's per-field errors are shown next to their fields. Parents mount
 * it fresh for each opening.
 */
export default function CustomFieldsEditModal({
  defs,
  values,
  onClose,
  onSave,
  idPrefix = "cf-edit",
}: {
  defs: CustomFieldDef[];
  values: Record<string, CustomFieldValue> | null | undefined;
  onClose: () => void;
  // Saves the changed fields; throws an ApiError when refused.
  onSave: (payload: CustomFieldPayload) => Promise<void>;
  idPrefix?: string;
}) {
  const { t } = useLanguage();
  const { draft, errors, setErrors, change } = useCfDraft(draftFrom(activeDefs(defs), values));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    const errs = cfValidate(defs, draft, "update", values);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setError(t("cf.formError"));
      return;
    }
    const payload = cfPayload(defs, draft, "update", values);
    if (!payload) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(payload);
      onClose();
    } catch (err) {
      const { fields, message } = cfSubmitError(err, defs, t);
      if (fields) setErrors(fields);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("cf.editTitle")} width={560}>
      <form onSubmit={onSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
        <CustomFieldInputs
          defs={defs}
          values={draft}
          errors={errors}
          idPrefix={idPrefix}
          onChange={change}
        />
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
