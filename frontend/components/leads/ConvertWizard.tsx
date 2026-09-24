"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import MultiSelect from "@/components/MultiSelect";
import DatePicker from "@/components/DatePicker";
import MonthPicker from "@/components/MonthPicker";
import {
  ApiError,
  branchesApi,
  groupsApi,
  leadsApi,
  type Branch,
  type ConvertLeadInput,
  type Gender,
  type Group,
  type Lead,
  type StudentMatchCandidate,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { ACCENT, ghostBtn, label, primaryBtn, sourceKey, statusKey, StatusBadge } from "./lead-ui";

type Resolution = { mode: "AUTO" } | { mode: "CREATE_NEW" } | { mode: "LINK_EXISTING"; studentId: string };

const STEPS: TranslationKey[] = ["adm.wiz.step1", "adm.wiz.step2", "adm.wiz.step3", "adm.wiz.step4", "adm.wiz.step5", "adm.wiz.step6"];

function nextMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ConvertWizard({ lead, open, onClose }: { lead: Lead; open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [candidates, setCandidates] = useState<StudentMatchCandidate[] | null>(null);
  const [resolution, setResolution] = useState<Resolution>({ mode: "AUTO" });
  const [fullName, setFullName] = useState(lead.fullName);
  const [gender, setGender] = useState<Gender | "">("");
  const [birthDate, setBirthDate] = useState("");
  const [address, setAddress] = useState("");
  const [guardianPhone, setGuardianPhone] = useState(lead.secondaryPhone ?? "");
  const [branchId, setBranchId] = useState(lead.preferredBranchId ?? "");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [createInvoice, setCreateInvoice] = useState(false);
  const [invoiceMonth, setInvoiceMonth] = useState(nextMonth());
  const [invoiceDue, setInvoiceDue] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setError(null);
    setCandidates(null);
    setResolution({ mode: "AUTO" });
    setFullName(lead.fullName);
    setGuardianPhone(lead.secondaryPhone ?? "");
    setBranchId(lead.preferredBranchId ?? "");
    setGroupIds([]);
    setCreateInvoice(false);
    groupsApi.list().then(setGroups).catch(() => setGroups([]));
    branchesApi.list().then(setBranches).catch(() => setBranches([]));
    leadsApi.studentMatch(lead.id).then((r) => {
      setCandidates(r.candidates);
      // Exactly one exact match: the server would link it automatically, so
      // pre-select it to make that visible.
      const exact = r.candidates.filter((c) => c.exact);
      if (r.candidates.length === 1 && exact.length === 1) setResolution({ mode: "LINK_EXISTING", studentId: exact[0].id });
      else if (r.candidates.length > 0) setResolution({ mode: "CREATE_NEW" });
    }).catch(() => setCandidates([]));
  }, [open, lead]);

  // Only groups that can still take students.
  const openGroups = useMemo(() => groups.filter((g) => g.status !== "ARCHIVED" && g.status !== "COMPLETED"), [groups]);
  const linking = resolution.mode === "LINK_EXISTING";
  const linkedName = linking ? candidates?.find((c) => c.id === resolution.studentId)?.fullName : null;
  const selectedGroups = openGroups.filter((g) => groupIds.includes(g.id));

  function canContinue() {
    if (step === 1 && candidates && candidates.length > 0 && resolution.mode === "AUTO") return false;
    if (step === 2 && !linking && fullName.trim().length < 2) return false;
    if (step === 4 && createInvoice && (!invoiceMonth || !invoiceDue || groupIds.length === 0)) return false;
    return true;
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const payload: ConvertLeadInput = {
      studentResolution: resolution.mode,
      existingStudentId: resolution.mode === "LINK_EXISTING" ? resolution.studentId : undefined,
      fullName: linking ? undefined : fullName.trim(),
      gender: linking || !gender ? undefined : gender,
      birthDate: linking || !birthDate ? undefined : birthDate,
      address: linking || !address.trim() ? undefined : address.trim(),
      guardianPhone: linking || !guardianPhone.trim() ? undefined : guardianPhone.trim(),
      branchId: linking || !branchId ? undefined : branchId,
      groupIds: groupIds.length ? groupIds : undefined,
      ...(createInvoice
        ? {
            createInvoice: true,
            invoiceForMonth: invoiceMonth,
            invoiceDueDate: new Date(`${invoiceDue}T00:00:00`).toISOString(),
            invoiceAmount: invoiceAmount ? Number(invoiceAmount) : undefined,
          }
        : {}),
    };
    try {
      const res = await leadsApi.convert(lead.id, payload);
      router.push(`/students/${res.student.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
      // Ambiguous match found at submit time: send the user back to choose.
      if (err instanceof ApiError && err.body?.code === "STUDENT_MATCH_AMBIGUOUS") {
        setCandidates((err.body.candidates as StudentMatchCandidate[]) ?? []);
        setResolution({ mode: "CREATE_NEW" });
        setStep(1);
      }
      setSubmitting(false);
    }
  }

  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #F2F1EC", fontSize: 13 }}>
      <span style={{ color: "#8A8D96" }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
    </div>
  );

  return (
    <Modal open={open} onClose={() => !submitting && onClose()} title={t("adm.wiz.title")} width={620}>
      <ol className="adm-steps" aria-label={t("adm.wiz.title")}>
        {STEPS.map((k, i) => (
          <li
            key={k}
            aria-current={i === step ? "step" : undefined}
            style={{
              listStyle: "none",
              fontSize: 12,
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: 999,
              background: i === step ? ACCENT : i < step ? "#EEF0FF" : "#F2F1EC",
              color: i === step ? "#fff" : i < step ? ACCENT : "#8A8D96",
            }}
          >
            {i + 1}. {t(k)}
          </li>
        ))}
      </ol>

      <div style={{ minHeight: 220 }}>
        {step === 0 && (
          <div>
            <p style={{ fontSize: 13, color: "#5B5F6A", marginBottom: 12 }}>{t("adm.wiz.reviewHint")}</p>
            {row(t("leads.fieldFullName"), lead.fullName)}
            {row(t("leads.fieldPhone"), lead.phone)}
            {row(t("leads.colStatus"), <StatusBadge status={lead.status} label={t(statusKey(lead.status))} />)}
            {row(t("leads.fieldSource"), t(sourceKey(lead.source)))}
            {row(t("adm.fieldCourse"), lead.desiredCourse?.name ?? lead.desiredSubject?.name ?? "—")}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "grid", gap: 10 }}>
            {candidates === null ? (
              <p style={{ color: "#8A8D96" }}>{t("adm.wiz.checking")}</p>
            ) : candidates.length === 0 ? (
              <p style={{ fontSize: 13.5 }}>{t("adm.wiz.noMatch")}</p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#92400E" }}>{t("adm.wiz.matchHint")}</p>
                {candidates.map((c) => (
                  <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: "1px solid #EAE8E2", borderRadius: 10, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="resolution"
                      checked={resolution.mode === "LINK_EXISTING" && resolution.studentId === c.id}
                      onChange={() => setResolution({ mode: "LINK_EXISTING", studentId: c.id })}
                    />
                    <span style={{ fontWeight: 700 }}>{c.fullName}</span>
                    <span style={{ fontSize: 12, color: "#8A8D96" }}>
                      {c.exact ? t("adm.wiz.exact") : c.matchedOn === "parentPhone" ? t("adm.wiz.viaParentPhone") : t("leads.fieldPhone")}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: ACCENT }}>{t("adm.wiz.linkExisting")}</span>
                  </label>
                ))}
                <label style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: "1px solid #EAE8E2", borderRadius: 10, cursor: "pointer" }}>
                  <input type="radio" name="resolution" checked={resolution.mode === "CREATE_NEW"} onChange={() => setResolution({ mode: "CREATE_NEW" })} />
                  <span style={{ fontWeight: 700 }}>{t("adm.wiz.createNew")}</span>
                </label>
              </>
            )}
          </div>
        )}

        {step === 2 && (linking ? (
          <p style={{ fontSize: 13.5 }}>{t("adm.wiz.detailsLinked")} <strong>{linkedName}</strong></p>
        ) : (
          <div className="adm-grid2">
            <div>
              <label style={label}>{t("leads.fieldFullName")} *</label>
              <input className="field-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label style={label}>{t("adm.wiz.gender")}</label>
              <Select
                value={gender}
                onChange={(v) => setGender(v as Gender | "")}
                options={[{ value: "", label: t("common.notSelected") }, { value: "MALE", label: t("adm.wiz.male") }, { value: "FEMALE", label: t("adm.wiz.female") }]}
              />
            </div>
            <div>
              <label style={label}>{t("adm.wiz.birthDate")}</label>
              <DatePicker value={birthDate} onChange={setBirthDate} />
            </div>
            <div>
              <label style={label}>{t("adm.wiz.guardianPhone")}</label>
              <input className="field-input" type="tel" value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} />
            </div>
            <div>
              <label style={label}>{t("leads.fieldBranch")}</label>
              <Select
                value={branchId}
                onChange={setBranchId}
                options={[{ value: "", label: t("common.notSelected") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </div>
            <div>
              <label style={label}>{t("adm.wiz.address")}</label>
              <input className="field-input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
        ))}

        {step === 3 && (
          <div>
            <label style={label}>{t("adm.wiz.groups")}</label>
            <MultiSelect
              selected={groupIds}
              onChange={(v) => { setGroupIds(v.slice(0, 5)); if (v.length === 0) setCreateInvoice(false); }}
              options={openGroups.map((g) => ({ value: g.id, label: `${g.name} (max ${g.maxStudents})` }))}
              placeholder={t("common.notSelected")}
            />
            <p style={{ fontSize: 12, color: "#8A8D96", marginTop: 8 }}>{t("adm.wiz.groupsHint")}</p>
          </div>
        )}

        {step === 4 && (
          groupIds.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "#8A8D96" }}>{t("adm.wiz.invoiceNeedsGroup")}</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, fontSize: 13.5 }}>
                <input type="checkbox" checked={createInvoice} onChange={(e) => setCreateInvoice(e.target.checked)} />
                {t("adm.wiz.invoiceToggle")}
              </label>
              {createInvoice && (
                <div className="adm-grid2">
                  <div>
                    <label style={label}>{t("adm.wiz.invoiceMonth")}</label>
                    <MonthPicker value={invoiceMonth} onChange={setInvoiceMonth} />
                  </div>
                  <div>
                    <label style={label}>{t("adm.wiz.invoiceDue")} *</label>
                    <DatePicker value={invoiceDue} onChange={setInvoiceDue} />
                  </div>
                  <div>
                    <label style={label}>{t("adm.wiz.invoiceAmount")}</label>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      placeholder={String(selectedGroups[0]?.monthlyPrice ?? "")}
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                </div>
              )}
              <p style={{ fontSize: 12, color: "#8A8D96" }}>{t("adm.wiz.invoiceHint")}</p>
            </div>
          )
        )}

        {step === 5 && (
          <div>
            {row(t("adm.wiz.summaryStudent"), linking ? `${linkedName} — ${t("adm.wiz.summaryLinked")}` : `${fullName} — ${t("adm.wiz.summaryNew")}`)}
            {row(t("adm.wiz.summaryGroups"), selectedGroups.length ? selectedGroups.map((g) => g.name).join(", ") : t("adm.wiz.none"))}
            {row(
              t("adm.wiz.summaryInvoice"),
              createInvoice ? `${invoiceMonth} · ${invoiceAmount || selectedGroups[0]?.monthlyPrice || 0} ${t("common.sumUnit")}` : t("adm.wiz.none"),
            )}
            <p style={{ fontSize: 12, color: "#8A8D96", marginTop: 12 }}>{t("adm.wiz.atomicHint")}</p>
          </div>
        )}
      </div>

      {error && <div role="alert" style={{ color: "#B91C1C", fontSize: 13, fontWeight: 600, marginTop: 10 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 18 }}>
        <button type="button" className="btn" style={ghostBtn} disabled={submitting} onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
          {step === 0 ? t("common.cancel") : t("adm.wiz.prev")}
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn" style={{ ...primaryBtn, opacity: canContinue() ? 1 : 0.5 }} disabled={!canContinue()} onClick={() => setStep(step + 1)}>
            {t("adm.wiz.next")}
          </button>
        ) : (
          <button type="button" className="btn" style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }} disabled={submitting} onClick={submit}>
            {submitting ? t("adm.wiz.converting") : t("adm.wiz.confirm")}
          </button>
        )}
      </div>
    </Modal>
  );
}
