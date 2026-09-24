"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
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

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [secondaryPhone, setSecondaryPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<LeadSource>("INSTAGRAM");
  const [subjectId, setSubjectId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [followDate, setFollowDate] = useState("");
  const [followTime, setFollowTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [duplicates, setDuplicates] = useState<LeadDuplicate[]>([]);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  // Reset every time the modal opens so no stale input leaks between leads.
  useEffect(() => {
    if (!open) return;
    setFullName(lead?.fullName ?? "");
    setPhone(lead?.phone ?? "");
    setSecondaryPhone(lead?.secondaryPhone ?? "");
    setEmail(lead?.email ?? "");
    setSource(lead?.source ?? "INSTAGRAM");
    setSubjectId(lead?.desiredSubjectId ?? "");
    setCourseId(lead?.desiredCourseId ?? "");
    setBranchId(lead?.preferredBranchId ?? "");
    setManagerId("");
    setFollowDate("");
    setFollowTime("10:00");
    setNotes(lead?.notes ?? "");
    setDuplicates([]);
    setOverride(false);
    setOverrideReason("");
    setError(null);
  }, [open, lead]);

  const courseOptions = useMemo(
    () => courses.filter((c) => !subjectId || c.subjectId === subjectId),
    [courses, subjectId],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
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
          followUpAt: followDate ? toIsoFromParts(followDate, followTime) : undefined,
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
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  const canOverride = !editing && can("admissions.manage") && duplicates.length > 0;

  return (
    <Modal open={open} onClose={onClose} title={editing ? t("leads.editLead") : t("leads.modalTitle")} width={640}>
      <form onSubmit={onSubmit} className="adm-form">
        <div className="adm-grid2">
          <div>
            <label style={label}>{t("leads.fieldFullName")} *</label>
            <input className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={200} />
          </div>
          <div>
            <label style={label}>{t("leads.fieldPhone")} *</label>
            <input className="field-input" type="tel" inputMode="tel" placeholder="+998 90 123 45 67" value={phone} onChange={(e) => { setPhone(e.target.value); setDuplicates([]); }} required />
          </div>
          <div>
            <label style={label}>{t("adm.fieldSecondaryPhone")}</label>
            <input className="field-input" type="tel" inputMode="tel" value={secondaryPhone} onChange={(e) => setSecondaryPhone(e.target.value)} />
          </div>
          <div>
            <label style={label}>{t("adm.fieldEmail")}</label>
            <input className="field-input" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setDuplicates([]); }} />
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
          </div>
          <div>
            <label style={label}>{t("adm.fieldCourse")}</label>
            <Select
              value={courseId}
              onChange={setCourseId}
              placeholder={t("common.notSelected")}
              options={[{ value: "", label: t("common.notSelected") }, ...courseOptions.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>
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
              <div style={{ display: "flex", gap: 8 }}>
                <DatePicker value={followDate} onChange={setFollowDate} style={{ flex: 1 }} />
                <TimePicker value={followTime} onChange={setFollowTime} style={{ width: 110 }} />
              </div>
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
                    onChange={(e) => setOverrideReason(e.target.value)}
                    minLength={3}
                    required
                  />
                )}
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
