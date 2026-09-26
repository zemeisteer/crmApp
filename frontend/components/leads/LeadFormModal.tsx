"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import {
  ApiError,
  leadsApi,
  subjectsApi,
  branchesApi,
  type AssignableManager,
  type Branch,
  type Course,
  type Lead,
  type LeadDuplicate,
  type LeadSource,
  type Subject,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";
import { LEAD_SOURCES, label, primaryBtn, ghostBtn, sourceKey, statusKey, StatusBadge, toIsoFromParts } from "./lead-ui";

// Same rules as the server (backend/src/leads/phone.ts), plus a length
// check for Uzbek numbers: +998 followed by exactly 9 digits.
function phoneValid(raw: string) {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 9 && !trimmed.startsWith("+")) return true;
  if (digits.startsWith("998")) return digits.length === 12;
  return digits.length >= 8 && digits.length <= 15;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type FieldErrors = Partial<Record<"fullName" | "phone" | "secondaryPhone" | "email" | "overrideReason", string>>;

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <div role="alert" style={{ marginTop: 5, fontSize: 12, fontWeight: 600, color: "#B91C1C", display: "flex", alignItems: "center", gap: 5 }}>
      <span aria-hidden style={{ display: "inline-flex", width: 14, height: 14, borderRadius: 7, background: "#B91C1C", color: "#fff", fontSize: 10, alignItems: "center", justifyContent: "center" }}>!</span>
      {msg}
    </div>
  );
}

const errBorder = (on: boolean): React.CSSProperties | undefined => (on ? { borderColor: "#DC2626", boxShadow: "0 0 0 3px rgba(220,38,38,0.12)" } : undefined);

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (lead: Lead) => void;
  // When set, the modal edits this lead's profile instead of creating one.
  lead?: Lead | null;
  managers?: AssignableManager[];
}

export default function LeadFormModal({ open, onClose, onSaved, lead, managers = [] }: Props) {
  const { t } = useLanguage();
  const { can } = useAuth();
  const editing = !!lead;

  // Initial values come straight from props: parents mount this component
  // fresh for every opening, so no stale input can survive between uses.
  const [fullName, setFullName] = useState(lead?.fullName ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [secondaryPhone, setSecondaryPhone] = useState(lead?.secondaryPhone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [source, setSource] = useState<LeadSource>(lead?.source ?? "INSTAGRAM");
  const [subjectId, setSubjectId] = useState(lead?.desiredSubjectId ?? "");
  const [courseId, setCourseId] = useState(lead?.desiredCourseId ?? "");
  const [branchId, setBranchId] = useState(lead?.preferredBranchId ?? "");
  const [managerId, setManagerId] = useState("");
  const [followDate, setFollowDate] = useState("");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [duplicates, setDuplicates] = useState<LeadDuplicate[]>([]);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    if (!open) return;
    subjectsApi.list("ACTIVE").then(setSubjects).catch(() => setSubjects([]));
    subjectsApi.listCourses(undefined, "ACTIVE").then(setCourses).catch(() => setCourses([]));
    branchesApi.list().then(setBranches).catch(() => setBranches([]));
  }, [open]);

  const courseOptions = useMemo(
    () => courses.filter((c) => !subjectId || c.subjectId === subjectId),
    [courses, subjectId],
  );

  // Our own messages instead of the browser's "please fill out this field".
  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (fullName.trim().length < 2) errs.fullName = t("leadForm.errName");
    if (!phone.trim()) errs.phone = t("leadForm.errPhoneRequired");
    else if (!phoneValid(phone)) errs.phone = t("leadForm.errPhone");
    if (secondaryPhone.trim() && !phoneValid(secondaryPhone)) errs.secondaryPhone = t("leadForm.errPhone");
    if (email.trim() && !EMAIL_RE.test(email.trim())) errs.email = t("leadForm.errEmail");
    if (override && overrideReason.trim().length < 3) errs.overrideReason = t("leadForm.errReason");
    return errs;
  }
  const clearErr = (k: keyof FieldErrors) => setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setSaving(true);
    try {
      let saved: Lead;
      if (editing && lead) {
        saved = await leadsApi.update(lead.id, {
          fullName: fullName.trim(),
          phone: phone.trim(),
          secondaryPhone: secondaryPhone.trim() || null,
          email: email.trim() || null,
          source,
          desiredSubjectId: subjectId || null,
          desiredCourseId: courseId || null,
          preferredBranchId: branchId || null,
          notes: notes.trim() || null,
        });
      } else {
        saved = await leadsApi.create({
          fullName: fullName.trim(),
          phone: phone.trim(),
          secondaryPhone: secondaryPhone.trim() || undefined,
          email: email.trim() || undefined,
          source,
          desiredSubjectId: subjectId || undefined,
          desiredCourseId: courseId || undefined,
          preferredBranchId: branchId || undefined,
          assignedManagerUserId: managerId || undefined,
          followUpAt: followDate ? toIsoFromParts(followDate, "10:00") : undefined,
          notes: notes.trim() || undefined,
          ...(override ? { allowDuplicate: true, duplicateReason: overrideReason.trim() } : {}),
        });
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.body?.code === "DUPLICATE_LEAD") {
        setDuplicates((err.body.duplicates as LeadDuplicate[]) ?? []);
      }
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  const canOverride = !editing && can("admissions.manage") && duplicates.length > 0;

  return (
    <Modal open={open} onClose={onClose} title={editing ? t("leads.editLead") : t("leads.modalTitle")} width={640}>
      <form onSubmit={onSubmit} className="adm-form" noValidate>
        <div className="adm-grid2">
          <div>
            <label style={label}>{t("leads.fieldFullName")} *</label>
            <input className="field-input" style={errBorder(!!fieldErrors.fullName)} value={fullName} onChange={(e) => { setFullName(e.target.value); clearErr("fullName"); }} maxLength={200} aria-invalid={!!fieldErrors.fullName} />
            <FieldError msg={fieldErrors.fullName} />
          </div>
          <div>
            <label style={label}>{t("leads.fieldPhone")} *</label>
            <input className="field-input" style={errBorder(!!fieldErrors.phone)} type="tel" inputMode="tel" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => { setPhone(e.target.value); setDuplicates([]); clearErr("phone"); }} aria-invalid={!!fieldErrors.phone} />
            <FieldError msg={fieldErrors.phone} />
          </div>
          <div>
            <label style={label}>{t("adm.fieldSecondaryPhone")}</label>
            <input className="field-input" style={errBorder(!!fieldErrors.secondaryPhone)} type="tel" inputMode="tel" placeholder="+998 __ ___ __ __" value={secondaryPhone} onChange={(e) => { setSecondaryPhone(e.target.value); clearErr("secondaryPhone"); }} />
            <FieldError msg={fieldErrors.secondaryPhone} />
          </div>
          <div>
            <label style={label}>{t("adm.fieldEmail")}</label>
            <input className="field-input" style={errBorder(!!fieldErrors.email)} type="email" placeholder="ism@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setDuplicates([]); clearErr("email"); }} />
            <FieldError msg={fieldErrors.email} />
          </div>
          <div>
            <label style={label}>{t("leads.fieldSource")}</label>
            <Select
              value={source}
              onChange={(v) => setSource(v as LeadSource)}
              options={LEAD_SOURCES.map((s) => ({ value: s, label: t(sourceKey(s)) }))}
            />
          </div>
          <div>
            <label style={label}>{t("leads.fieldBranch")}</label>
            <Select
              value={branchId}
              onChange={setBranchId}
              placeholder={t("common.notSelected")}
              options={[{ value: "", label: t("common.notSelected") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            />
          </div>
          <div>
            <label style={label}>{t("adm.fieldSubject")}</label>
            <Select
              value={subjectId}
              onChange={(v) => { setSubjectId(v); setCourseId(""); }}
              placeholder={t("common.notSelected")}
              options={[{ value: "", label: t("common.notSelected") }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]}
            />
            {subjects.length === 0 && <div style={{ marginTop: 5, fontSize: 12, color: "#8A8D96" }}>{t("leadForm.noSubjectsHint")}</div>}
          </div>
          {courses.length > 0 && (
            <div>
              <label style={label}>{t("adm.fieldCourse")}</label>
              <Select
                value={courseId}
                onChange={setCourseId}
                placeholder={t("common.notSelected")}
                options={[{ value: "", label: t("common.notSelected") }, ...courseOptions.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
          )}
          {!editing && can("admissions.assign") && (
            <div>
              <label style={label}>{t("adm.fieldManager")}</label>
              <Select
                value={managerId}
                onChange={setManagerId}
                placeholder={t("adm.unassigned")}
                options={[{ value: "", label: t("adm.unassigned") }, ...managers.map((m) => ({ value: m.userId, label: m.fullName }))]}
              />
            </div>
          )}
          {!editing && (
            <div>
              <label style={label}>{t("adm.fieldFollowUp")}</label>
              <DatePicker value={followDate} onChange={setFollowDate} />
              <div style={{ marginTop: 5, fontSize: 12, color: "#8A8D96" }}>{t("leadForm.followUpHint")}</div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={label}>{t("leads.fieldNotes")}</label>
          <textarea className="field-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </div>

        {duplicates.length > 0 && (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: "#92400E" }}>{t("adm.duplicateTitle")}</div>
            <div style={{ fontSize: 12.5, color: "#92400E", marginTop: 4 }}>{t("adm.duplicateHint")}</div>
            <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {duplicates.map((d) => (
                <li key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Link href={`/leads/${d.id}`} style={{ fontWeight: 700, color: "#4F46E5" }}>{d.fullName}</Link>
                  <StatusBadge status={d.status} label={t(statusKey(d.status))} />
                  <span style={{ fontSize: 12, color: "#8A8D96" }}>({d.matchedOn === "phone" ? t("leads.fieldPhone") : t("adm.fieldEmail")})</span>
                </li>
              ))}
            </ul>
            {canOverride && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  {t("adm.duplicateOverride")}
                </label>
                {override && (
                  <input
                    className="field-input"
                    style={{ marginTop: 8 }}
                    placeholder={t("adm.duplicateReason")}
                    value={overrideReason}
                    onChange={(e) => { setOverrideReason(e.target.value); clearErr("overrideReason"); }}
                  />
                )}
                {override && <FieldError msg={fieldErrors.overrideReason} />}
              </div>
            )}
          </div>
        )}

        {error && duplicates.length === 0 && (
          <div role="alert" style={{ marginTop: 14, color: "#B91C1C", fontSize: 13, fontWeight: 600 }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button type="button" className="btn" style={ghostBtn} onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn" style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }} disabled={saving || (duplicates.length > 0 && !override)}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
