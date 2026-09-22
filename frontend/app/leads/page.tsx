"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import MultiSelect from "@/components/MultiSelect";
import DatePicker from "@/components/DatePicker";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import {
  leadsApi,
  groupsApi,
  branchesApi,
  notificationsApi,
  Lead,
  LeadStatus,
  LeadSource,
  Group,
  Branch,
  FunnelStats,
  Gender,
  ApiError,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { matchesSubject, extractUniqueSubjects } from "@/lib/subject";

const ACCENT = "#4F46E5";

const STATUS_CONFIG: Record<
  LeadStatus,
  { labelUz: string; color: string; bg: string; border: string }
> = {
  NEW: { labelUz: "Yangi", color: "#4F46E5", bg: "#EEF0FF", border: "#C7D2FE" },
  CONTACTED: { labelUz: "Bog'lanildi", color: "#0284C7", bg: "#E0F2FE", border: "#BAE6FD" },
  TRIAL_BOOKED: { labelUz: "Sinov darsi", color: "#D97706", bg: "#FEF3C7", border: "#FDE68A" },
  TRIAL_ATTENDED: { labelUz: "Sinovda qatnashdi", color: "#B45309", bg: "#FEF3C7", border: "#FCD34D" },
  QUALIFIED: { labelUz: "Tayyor", color: "#0D9488", bg: "#CCFBF1", border: "#99F6E4" },
  ENROLLED: { labelUz: "Qabul qilindi", color: "#16A34A", bg: "#DCFCE7", border: "#BBF7D0" },
  LOST: { labelUz: "Rad etildi", color: "#DC2626", bg: "#FEE2E2", border: "#FECACA" },
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  INSTAGRAM: "Instagram",
  TELEGRAM: "Telegram",
  WEBSITE: "Sayt",
  RECOMMENDATION: "Tavsiya",
  BANNER: "Banner / Reklama",
  WALK_IN: "Kelib ketdi",
  OTHER: "Boshqa",
};

const KANBAN_STAGES: { status: LeadStatus; title: string; color: string }[] = [
  { status: "NEW", title: "🆕 Yangi murojaat", color: "#4F46E5" },
  { status: "CONTACTED", title: "📞 Bog'lanildi", color: "#0284C7" },
  { status: "TRIAL_BOOKED", title: "🎓 Sinov darsi", color: "#D97706" },
  { status: "ENROLLED", title: "✅ Talaba bo'ldi", color: "#16A34A" },
  { status: "LOST", title: "❌ Rad etildi", color: "#DC2626" },
];

function formatPhoneInput(val: string) {
  const digits = val.replace(/\D/g, "");
  if (!digits) return "";
  let d = digits;
  if (d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  let res = "+998";
  if (d.length > 0) res += ` ${d.slice(0, 2)}`;
  if (d.length > 2) res += ` ${d.slice(2, 5)}`;
  if (d.length > 5) res += ` ${d.slice(5, 7)}`;
  if (d.length > 7) res += ` ${d.slice(7, 9)}`;
  return res;
}

function LeadsContent() {
  const { t } = useLanguage();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [funnel, setFunnel] = useState<FunnelStats | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [page, setPage] = useState(1);

  // Modal states
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [leadToConvert, setLeadToConvert] = useState<Lead | null>(null);

  // Form states
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [status, setStatus] = useState<LeadStatus>("NEW");
  const [source, setSource] = useState<LeadSource>("INSTAGRAM");
  const [subject, setSubject] = useState("");
  const [branchId, setBranchId] = useState("");
  const [trialDate, setTrialDate] = useState("");
  const [trialGroupId, setTrialGroupId] = useState("");
  const [notes, setNotes] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert form states
  const [convertGroupIds, setConvertGroupIds] = useState<string[]>([]);
  const [convertGender, setConvertGender] = useState<Gender | "">("");
  const [convertBirthDate, setConvertBirthDate] = useState("");
  const [convertAddress, setConvertAddress] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertSuccessMsg, setConvertSuccessMsg] = useState<string | null>(null);

  // SMS Follow-up states
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [smsLead, setSmsLead] = useState<Lead | null>(null);
  const [smsText, setSmsText] = useState("");
  const [sendingSms, setSendingSms] = useState(false);

  function openSmsModal(lead: Lead) {
    setSmsLead(lead);
    setSmsText(`Assalomu alaykum ${lead.fullName}! Bizning o'quv markazimiz darslari haqida ma'lumot olishni istaysizmi?`);
    setSmsModalOpen(true);
  }

  async function handleSendSms(e: React.FormEvent) {
    e.preventDefault();
    if (!smsLead || !smsText.trim()) return;
    setSendingSms(true);
    try {
      await notificationsApi.sendTest({
        recipient: smsLead.phone,
        channel: "SMS",
        content: smsText.trim(),
        title: "Lidga murojaat",
      });
      alert("SMS xabar muvaffaqiyatli yuborildi!");
      setSmsModalOpen(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "SMS yuborishda xatolik yuz berdi");
    } finally {
      setSendingSms(false);
    }
  }

  function getNextStatus(curr: LeadStatus): LeadStatus | null {
    if (curr === "NEW") return "CONTACTED";
    if (curr === "CONTACTED") return "TRIAL_BOOKED";
    if (curr === "TRIAL_BOOKED") return "TRIAL_ATTENDED";
    if (curr === "TRIAL_ATTENDED") return "QUALIFIED";
    return null;
  }

  function loadData() {
    setLoading(true);
    Promise.all([leadsApi.list(), leadsApi.funnel(), groupsApi.list(), branchesApi.list()])
      .then(([l, f, g, b]) => {
        setLeads(l);
        setFunnel(f);
        setGroups(g);
        setBranches(b);
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadData, []);

  const subjects = useMemo(() => {
    const list = [...groups, ...leads.map((l) => ({ subject: l.subject }))];
    return extractUniqueSubjects(list);
  }, [groups, leads]);

  function resetLeadForm() {
    setFullName("");
    setPhone("");
    setParentPhone("");
    setStatus("NEW");
    setSource("INSTAGRAM");
    setSubject("");
    setBranchId("");
    setTrialDate("");
    setTrialGroupId("");
    setNotes("");
    setLostReason("");
    setEditingLead(null);
    setError(null);
  }

  function openCreateModal() {
    resetLeadForm();
    setLeadModalOpen(true);
  }

  function openEditModal(lead: Lead) {
    setEditingLead(lead);
    setFullName(lead.fullName);
    setPhone(lead.phone);
    setParentPhone(lead.parentPhone || "");
    setStatus(lead.status);
    setSource(lead.source);
    setSubject(lead.subject || "");
    setBranchId(lead.branchId || "");
    setTrialDate(lead.trialDate ? lead.trialDate.slice(0, 10) : "");
    setTrialGroupId(lead.trialGroupId || "");
    setNotes(lead.notes || "");
    setLostReason(lead.lostReason || "");
    setError(null);
    setLeadModalOpen(true);
  }

  function openConvertModal(lead: Lead) {
    setLeadToConvert(lead);
    setConvertGroupIds(lead.trialGroupId ? [lead.trialGroupId] : []);
    setConvertGender("");
    setConvertBirthDate("");
    setConvertAddress("");
    setError(null);
    setConvertModalOpen(true);
  }

  async function onSaveLead(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editingLead) {
        await leadsApi.update(editingLead.id, {
          fullName,
          phone,
          parentPhone: parentPhone || null,
          status,
          source,
          subject: subject || null,
          branchId: branchId || null,
          trialDate: trialDate || null,
          trialGroupId: trialGroupId || null,
          notes: notes || null,
          lostReason: status === "LOST" ? lostReason || null : null,
        });
      } else {
        await leadsApi.create({
          fullName,
          phone,
          parentPhone: parentPhone || undefined,
          status,
          source,
          subject: subject || undefined,
          branchId: branchId || undefined,
          trialDate: trialDate || undefined,
          trialGroupId: trialGroupId || undefined,
          notes: notes || undefined,
        });
      }
      setLeadModalOpen(false);
      resetLeadForm();
      loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmConvert(e: React.FormEvent) {
    e.preventDefault();
    if (!leadToConvert) return;
    setError(null);
    setConverting(true);
    try {
      await leadsApi.convert(leadToConvert.id, {
        groupIds: convertGroupIds.length > 0 ? convertGroupIds : undefined,
        gender: convertGender || undefined,
        birthDate: convertBirthDate || undefined,
        address: convertAddress || undefined,
      });
      setConvertModalOpen(false);
      setConvertSuccessMsg(t("leads.convertedSuccess"));
      setTimeout(() => setConvertSuccessMsg(null), 4000);
      loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setConverting(false);
    }
  }

  async function onQuickStatusChange(leadId: string, newStatus: LeadStatus) {
    try {
      await leadsApi.update(leadId, { status: newStatus });
      loadData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Statusni o'zgartirishda xatolik");
    }
  }

  async function onDeleteLead(id: string) {
    if (!confirm(t("leads.deleteConfirm"))) return;
    try {
      await leadsApi.remove(id);
      loadData();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "O'chirishda xatolik");
    }
  }

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (sourceFilter && l.source !== sourceFilter) return false;
      if (directionFilter && !matchesSubject(l.subject, directionFilter)) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        l.fullName.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        (l.parentPhone || "").includes(q) ||
        (l.subject || "").toLowerCase().includes(q)
      );
    });
  }, [leads, search, statusFilter, sourceFilter, directionFilter]);

  useEffect(() => setPage(1), [search, statusFilter, sourceFilter, directionFilter]);
  const pageItems = usePagedSlice(filtered, page);

  return (
    <>
      {/* Header */}
      <div
        style={{
          padding: "22px 32px",
          borderBottom: "1px solid #EAE8E2",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("leads.title")}</h1>
          <p style={{ fontSize: 12.5, color: "#8A8D96", marginTop: 2 }}>{t("leads.subtitle")}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              background: "#F2F1EC",
              borderRadius: 9,
              padding: 3,
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("board")}
              style={{
                border: "none",
                background: viewMode === "board" ? "#fff" : "transparent",
                color: viewMode === "board" ? "#181A1F" : "#8A8D96",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
                boxShadow: viewMode === "board" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>📋</span>
              <span>{t("leads.viewBoard")}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              style={{
                border: "none",
                background: viewMode === "table" ? "#fff" : "transparent",
                color: viewMode === "table" ? "#181A1F" : "#8A8D96",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
                boxShadow: viewMode === "table" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>📄</span>
              <span>{t("leads.viewTable")}</span>
            </button>
          </div>
          <button
            className="btn"
            onClick={openCreateModal}
            style={{
              background: ACCENT,
              color: "#fff",
              border: "none",
              fontSize: 13.5,
              fontWeight: 700,
              padding: "10px 18px",
              borderRadius: 9,
            }}
          >
            {t("leads.newLead")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        {convertSuccessMsg && (
          <div
            style={{
              background: "#DCFCE7",
              color: "#16A34A",
              fontSize: 13,
              fontWeight: 700,
              padding: "12px 18px",
              borderRadius: 12,
              marginBottom: 16,
              border: "1px solid #BBF7D0",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>✅</span>
            <span>{convertSuccessMsg}</span>
          </div>
        )}

        {/* Funnel Metrics Cards */}
        {funnel && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("leads.statTotal")}</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4 }}>
                {funnel.total}
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("leads.statTrial")}</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#D97706" }}>
                {(funnel.counts.TRIAL_BOOKED || 0) + (funnel.counts.TRIAL_ATTENDED || 0)}
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("leads.statEnrolled")}</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: "#16A34A" }}>
                {funnel.counts.ENROLLED || 0}
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 18 }}>
              <div style={{ fontSize: 12, color: "#8A8D96" }}>{t("leads.statConversion")}</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif", marginTop: 4, color: ACCENT }}>
                {funnel.conversionRate}%
              </div>
            </div>
          </div>
        )}

        {/* Source ROI Breakdown */}
        {funnel?.bySource && Object.keys(funnel.bySource).length > 0 && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #EAE8E2",
              borderRadius: 14,
              padding: "12px 18px",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "#8A8D96",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Manbalar ROI & Konversiya:
            </span>
            {Object.entries(funnel.bySource).map(([src, stat]) => (
              <div
                key={src}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#F8F8F6",
                  border: "1px solid #EAE8E2",
                  padding: "4px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 700, color: "#181A1F" }}>
                  {SOURCE_LABELS[src as LeadSource] || src}:
                </span>
                <span style={{ color: "#4A4E58" }}>{stat.total} lid</span>
                <span
                  style={{
                    background: stat.conversionRate > 0 ? "#DCFCE7" : "#F2F1EC",
                    color: stat.conversionRate > 0 ? "#16A34A" : "#8A8D96",
                    padding: "2px 6px",
                    borderRadius: 5,
                    fontWeight: 800,
                    fontSize: 11,
                  }}
                >
                  {stat.conversionRate}% ({stat.enrolled})
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Filters bar */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="field-input"
            placeholder={t("leads.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260, maxWidth: "100%", flexShrink: 0 }}
          />
          <Select
            options={[
              { value: "", label: t("leads.allSources") },
              ...Object.entries(SOURCE_LABELS).map(([k, v]) => ({ value: k, label: v })),
            ]}
            value={sourceFilter}
            onChange={setSourceFilter}
            style={{ width: 170 }}
          />
          {viewMode === "table" && (
            <Select
              options={[
                { value: "", label: t("leads.allStatuses") },
                ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({ value: k, label: v.labelUz })),
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 170 }}
            />
          )}
          <Select
            options={[{ value: "", label: t("groups.allDirections") }, ...subjects.map((s) => ({ value: s, label: s }))]}
            value={directionFilter}
            onChange={setDirectionFilter}
            style={{ width: 180 }}
          />
        </div>

        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14, padding: 32 }}>{t("common.loading")}</div>
        ) : leads.length === 0 ? (
          <div
            style={{
              color: "#8A8D96",
              fontSize: 14,
              background: "#fff",
              border: "1px solid #EAE8E2",
              borderRadius: 16,
              padding: 40,
              textAlign: "center",
            }}
          >
            {t("leads.noLeadsYet")}
          </div>
        ) : viewMode === "board" ? (
          /* Kanban Board View */
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, minmax(250px, 1fr))",
              gap: 16,
              alignItems: "start",
              overflowX: "auto",
              paddingBottom: 20,
            }}
          >
            {KANBAN_STAGES.map((stage) => {
              const stageLeads = filtered.filter((l) => {
                if (stage.status === "TRIAL_BOOKED") {
                  return l.status === "TRIAL_BOOKED" || l.status === "TRIAL_ATTENDED" || l.status === "QUALIFIED";
                }
                return l.status === stage.status;
              });

              return (
                <div
                  key={stage.status}
                  style={{
                    background: "#F8F8F6",
                    borderRadius: 14,
                    padding: 14,
                    minHeight: 400,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingBottom: 8,
                      borderBottom: "2px solid #EAE8E2",
                    }}
                  >
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: stage.color }}>{stage.title}</div>
                    <span
                      style={{
                        background: "#fff",
                        color: "#4A4E58",
                        fontSize: 11.5,
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: 10,
                        border: "1px solid #EAE8E2",
                      }}
                    >
                      {stageLeads.length}
                    </span>
                  </div>

                  {stageLeads.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#A0A3AB", textAlign: "center", padding: "24px 0" }}>
                      Lidlar yo&apos;q
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        style={{
                          background: "#fff",
                          border: "1px solid #EAE8E2",
                          borderRadius: 12,
                          padding: 14,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                          position: "relative",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                          <div
                            onClick={() => openEditModal(lead)}
                            style={{ fontSize: 14, fontWeight: 700, color: "#181A1F", cursor: "pointer" }}
                            title="Tahrirlash"
                          >
                            {lead.fullName}
                          </div>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: "#4A4E58",
                              background: "#F2F1EC",
                              padding: "2px 6px",
                              borderRadius: 6,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {SOURCE_LABELS[lead.source]}
                          </span>
                        </div>

                        <a
                          href={`tel:${lead.phone}`}
                          style={{ fontSize: 12, color: ACCENT, textDecoration: "none", fontWeight: 600 }}
                        >
                          📞 {lead.phone}
                        </a>

                        {lead.subject && (
                          <div style={{ fontSize: 11.5, color: "#4A4E58" }}>
                            📚 <strong>{lead.subject}</strong>
                          </div>
                        )}

                        {lead.trialDate && (
                          <div style={{ fontSize: 11, color: "#D97706", fontWeight: 600 }}>
                            📅 Sinov: {new Date(lead.trialDate).toLocaleDateString("uz-UZ")}
                          </div>
                        )}

                        {lead.notes && (
                          <div style={{ fontSize: 11.5, color: "#8A8D96", lineHeight: 1.4, maxHeight: 40, overflow: "hidden" }}>
                            {lead.notes}
                          </div>
                        )}

                        {/* Stage actions */}
                        <div
                          style={{
                            marginTop: 4,
                            paddingTop: 8,
                            borderTop: "1px solid #F2F1EC",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          {lead.status !== "ENROLLED" ? (
                            <button
                              type="button"
                              onClick={() => openConvertModal(lead)}
                              style={{
                                background: "#DCFCE7",
                                color: "#16A34A",
                                border: "1px solid #BBF7D0",
                                borderRadius: 7,
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: "4px 8px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <span>🎓</span>
                              <span>{t("leads.convertToStudent")}</span>
                            </button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: "#16A34A", fontWeight: 700 }}>
                              ✅ Talaba bo&apos;ldi
                            </span>
                          )}

                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                            <button
                              type="button"
                              onClick={() => openSmsModal(lead)}
                              title="SMS yuborish"
                              style={{
                                background: "#F2F1EC",
                                border: "none",
                                borderRadius: 6,
                                padding: "4px 7px",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 700,
                                color: "#4A4E58",
                                display: "flex",
                                alignItems: "center",
                                gap: 3,
                              }}
                            >
                              <span>💬</span>
                              <span>SMS</span>
                            </button>

                            {getNextStatus(lead.status) && (
                              <button
                                type="button"
                                onClick={() => onQuickStatusChange(lead.id, getNextStatus(lead.status)!)}
                                title="Keyingi bosqichga o'tkazish"
                                style={{
                                  background: "#EEF0FF",
                                  border: "1px solid #C7D2FE",
                                  borderRadius: 6,
                                  padding: "4px 8px",
                                  cursor: "pointer",
                                  fontSize: 11,
                                  color: ACCENT,
                                  fontWeight: 800,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 2,
                                }}
                              >
                                <span>Keyingi</span>
                                <span>➔</span>
                              </button>
                            )}

                            {lead.status !== "LOST" && lead.status !== "ENROLLED" && (
                              <button
                                type="button"
                                onClick={() => onQuickStatusChange(lead.id, "LOST")}
                                title="Rad etildi"
                                style={{ background: "#FEE2E2", border: "none", borderRadius: 6, padding: "4px 7px", cursor: "pointer", fontSize: 11, color: "#DC2626", fontWeight: 700 }}
                              >
                                ✕
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditModal(lead)}
                              title="Tahrirlash"
                              style={{ background: "#F2F1EC", border: "none", borderRadius: 6, padding: "4px 7px", cursor: "pointer", fontSize: 11 }}
                            >
                              ✏️
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Table View */
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("leads.colFullName")}</th>
                  <th style={{ paddingTop: 16 }}>{t("leads.colPhone")}</th>
                  <th style={{ paddingTop: 16 }}>{t("leads.colSubject")}</th>
                  <th style={{ paddingTop: 16 }}>{t("leads.colSource")}</th>
                  <th style={{ paddingTop: 16 }}>{t("leads.colStatus")}</th>
                  <th style={{ paddingTop: 16 }}>{t("leads.colDate")}</th>
                  <th style={{ paddingTop: 16, textAlign: "right" }}>{t("leads.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => {
                  const cfg = STATUS_CONFIG[l.status] || STATUS_CONFIG.NEW;
                  return (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 600 }}>{l.fullName}</td>
                      <td>
                        <a href={`tel:${l.phone}`} style={{ color: ACCENT, textDecoration: "none" }}>
                          {l.phone}
                        </a>
                      </td>
                      <td>{l.subject || "—"}</td>
                      <td>
                        <span style={{ fontSize: 11.5, background: "#F2F1EC", padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>
                          {SOURCE_LABELS[l.source]}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            padding: "3px 9px",
                            borderRadius: 100,
                            color: cfg.color,
                            background: cfg.bg,
                            border: `1px solid ${cfg.border}`,
                          }}
                        >
                          {cfg.labelUz}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: "#8A8D96" }}>
                        {new Date(l.createdAt).toLocaleDateString("uz-UZ")}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          {l.status !== "ENROLLED" ? (
                            <button
                              type="button"
                              onClick={() => openConvertModal(l)}
                              className="btn"
                              style={{
                                background: "#DCFCE7",
                                color: "#16A34A",
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: "6px 10px",
                                borderRadius: 8,
                                border: "none",
                              }}
                            >
                              🎓 {t("leads.convertToStudent")}
                            </button>
                          ) : (
                            <Link
                              href={`/students/${l.convertedStudentId || ""}`}
                              className="btn"
                              style={{
                                background: "#F2F1EC",
                                color: "#181A1F",
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: "6px 10px",
                                borderRadius: 8,
                                textDecoration: "none",
                              }}
                            >
                              Profil
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditModal(l)}
                            className="btn"
                            style={{
                              background: "#F2F1EC",
                              color: "#181A1F",
                              fontSize: 11.5,
                              fontWeight: 700,
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "none",
                            }}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteLead(l.id)}
                            className="btn"
                            style={{
                              background: "#FDEBEC",
                              color: "#B23A47",
                              fontSize: 11.5,
                              fontWeight: 700,
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "none",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} total={filtered.length} onChange={setPage} />
          </div>
        )}
      </div>

      {/* Add / Edit Lead Modal */}
      <Modal
        open={leadModalOpen}
        onClose={() => {
          setLeadModalOpen(false);
          resetLeadForm();
        }}
        title={editingLead ? t("leads.editLead") : t("leads.modalTitle")}
      >
        <form onSubmit={onSaveLead} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
              {error}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldFullName")}</div>
            <input
              className="field-input"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Dilshod Karimov"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldPhone")}</div>
              <input
                className="field-input"
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                placeholder="+998 90 123 45 67"
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldParentPhone")}</div>
              <input
                className="field-input"
                type="tel"
                value={parentPhone}
                onChange={(e) => setParentPhone(formatPhoneInput(e.target.value))}
                placeholder="+998 90 987 65 43"
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldSource")}</div>
              <Select
                options={Object.entries(SOURCE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                value={source}
                onChange={(v) => setSource(v as LeadSource)}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldStatus")}</div>
              <Select
                options={Object.entries(STATUS_CONFIG).map(([k, v]) => ({ value: k, label: v.labelUz }))}
                value={status}
                onChange={(v) => setStatus(v as LeadStatus)}
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldSubject")}</div>
            <input
              className="field-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ingliz tili (IELTS)"
            />
          </div>

          {branches.length > 0 && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldBranch")}</div>
              <Select
                options={[{ value: "", label: "Tanlanmagan" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                value={branchId}
                onChange={setBranchId}
              />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldTrialDate")}</div>
              <DatePicker value={trialDate} onChange={setTrialDate} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldTrialGroup")}</div>
              <Select
                options={[{ value: "", label: "Tanlanmagan" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
                value={trialGroupId}
                onChange={setTrialGroupId}
              />
            </div>
          </div>

          {status === "LOST" && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#DC2626", marginBottom: 6 }}>Rad etilish sababi</div>
              <input
                className="field-input"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="Narx qimmatlik qildi / Boshqa vaqt to'g'ri kelmadi"
              />
            </div>
          )}

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.fieldNotes")}</div>
            <textarea
              className="field-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mijoz bilan suhbat tafsilotlari..."
              style={{ resize: "vertical" }}
            />
          </div>

          <button
            className="btn"
            type="submit"
            disabled={saving}
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: 12,
              borderRadius: 10,
              marginTop: 6,
            }}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </Modal>

      {/* Convert Lead to Student Modal */}
      <Modal
        open={convertModalOpen}
        onClose={() => setConvertModalOpen(false)}
        title={t("leads.convertModalTitle")}
      >
        <form onSubmit={onConfirmConvert} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
              {error}
            </div>
          )}

          <div style={{ background: "#F8F8F6", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#181A1F" }}>{leadToConvert?.fullName}</div>
            <div style={{ fontSize: 13, color: ACCENT, fontWeight: 600, marginTop: 4 }}>📞 {leadToConvert?.phone}</div>
            {leadToConvert?.subject && (
              <div style={{ fontSize: 12, color: "#4A4E58", marginTop: 2 }}>Fan: {leadToConvert.subject}</div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("leads.assignGroup")}</div>
            <MultiSelect
              options={groups.map((g) => ({ value: g.id, label: `${g.name} (${g.subject})` }))}
              selected={convertGroupIds}
              onChange={setConvertGroupIds}
              placeholder={t("students.selectGroups")}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("students.fieldGender")}</div>
              <Select
                options={[
                  { value: "", label: "Tanlanmagan" },
                  { value: "MALE", label: t("students.male") },
                  { value: "FEMALE", label: t("students.female") },
                ]}
                value={convertGender}
                onChange={(v) => setConvertGender(v as Gender | "")}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("students.fieldBirthDate")}</div>
              <DatePicker value={convertBirthDate} onChange={setConvertBirthDate} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>Manzil (ixtiyoriy)</div>
            <input
              className="field-input"
              value={convertAddress}
              onChange={(e) => setConvertAddress(e.target.value)}
              placeholder="Toshkent sh., Yunusobod tumani"
            />
          </div>

          <button
            className="btn"
            type="submit"
            disabled={converting}
            style={{
              background: "#16A34A",
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: 13,
              borderRadius: 10,
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>🎓</span>
            <span>{converting ? "Ro'yxatga olinmoqda..." : t("leads.confirmConvert")}</span>
          </button>
        </form>
      </Modal>

      {/* SMS Follow-up Modal */}
      <Modal
        open={smsModalOpen}
        onClose={() => setSmsModalOpen(false)}
        title="Lidga SMS xabar yuborish"
      >
        <form onSubmit={handleSendSms} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#F8F8F6", borderRadius: 10, padding: 12, border: "1px solid #EAE8E2" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#181A1F" }}>{smsLead?.fullName}</div>
            <div style={{ fontSize: 13, color: ACCENT, fontWeight: 600, marginTop: 2 }}>📞 {smsLead?.phone}</div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>SMS matni</div>
            <textarea
              className="field-input"
              rows={4}
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              placeholder="SMS xabar matnini kiriting..."
              style={{ resize: "vertical" }}
              required
            />
          </div>

          <button
            className="btn"
            type="submit"
            disabled={sendingSms || !smsText.trim()}
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              padding: 12,
              borderRadius: 10,
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>💬</span>
            <span>{sendingSms ? "Yuborilmoqda..." : "SMS yuborish"}</span>
          </button>
        </form>
      </Modal>
    </>
  );
}

export default function LeadsPage() {
  return (
    <DashboardShell>
      <LeadsContent />
    </DashboardShell>
  );
}
