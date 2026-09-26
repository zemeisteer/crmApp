"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import { auditApi, AuditLog } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { describeAudit } from "@/lib/audit-format";
import { formatDateTime } from "@/lib/format-date";

const ACTION_LABEL_KEYS: Record<string, TranslationKey> = {
  create: "auditLog.actionCreate",
  update: "auditLog.actionUpdate",
  delete: "auditLog.actionDelete",
  restore: "auditLog.actionRestore",
};

const ACTION_CLASS: Record<string, string> = {
  create: "badge-success",
  update: "badge-neutral",
  delete: "badge-danger",
  restore: "badge-success",
  complete: "badge-success",
  convert: "badge-success",
  cancel: "badge-danger",
  archive: "badge-neutral",
};

// Labels for actions/objects beyond the four basic ones, per language.
const EXTRA_ACTIONS: Record<string, Record<"UZ" | "RU" | "EN", string>> = {
  convert: { UZ: "O'quvchiga aylantirildi", RU: "Конвертирован", EN: "Converted" },
  archive: { UZ: "Arxivlandi", RU: "В архив", EN: "Archived" },
  assign: { UZ: "Biriktirildi", RU: "Назначен", EN: "Assigned" },
  reassign: { UZ: "Qayta biriktirildi", RU: "Переназначен", EN: "Reassigned" },
  reopen: { UZ: "Qayta ochildi", RU: "Открыт заново", EN: "Reopened" },
  duplicate_override: { UZ: "Dublikat", RU: "Дубликат", EN: "Duplicate" },
  export: { UZ: "Eksport", RU: "Экспорт", EN: "Export" },
  complete: { UZ: "To'landi", RU: "Оплачено", EN: "Paid" },
  cancel: { UZ: "Bekor qilindi", RU: "Отменено", EN: "Cancelled" },
  trial_reschedule: { UZ: "Ko'chirildi", RU: "Перенесён", EN: "Rescheduled" },
  trial_missed: { UZ: "Kelmadi", RU: "Не пришёл", EN: "Missed" },
  trial_cancel: { UZ: "Bekor qilindi", RU: "Отменено", EN: "Cancelled" },
  switch_workspace: { UZ: "Markaz almashtirildi", RU: "Смена центра", EN: "Switched center" },
};
const EXTRA_ENTITIES: Record<string, Record<"UZ" | "RU" | "EN", string>> = {
  payment: { UZ: "To'lov", RU: "Платёж", EN: "Payment" },
  invoice: { UZ: "Hisob-faktura", RU: "Счёт", EN: "Invoice" },
  invoices_batch: { UZ: "Hisob-fakturalar", RU: "Счета", EN: "Invoices" },
  lead: { UZ: "Lid", RU: "Лид", EN: "Lead" },
  lead_trial: { UZ: "Sinov darsi", RU: "Пробный урок", EN: "Trial lesson" },
  gateway_transaction: { UZ: "Onlayn to'lov", RU: "Онлайн-платёж", EN: "Online payment" },
};

const ENTITY_LABEL_KEYS: Record<string, TranslationKey> = {
  group: "auditLog.entityGroup",
  student: "auditLog.entityStudent",
  teacher: "auditLog.entityTeacher",
};

function AuditLogContent() {
  const { t, lang } = useLanguage();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    auditApi
      .list(entityFilter || undefined)
      .then(setLogs)
      .finally(() => setLoading(false));
  }, [entityFilter]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (actionFilter && l.action !== actionFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${l.user?.fullName || ""} ${l.user?.email || ""} ${l.entityId} ${describeAudit(l, lang)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, actionFilter, search, lang]);

  useEffect(() => setPage(1), [entityFilter, actionFilter, search]);
  const pageItems = usePagedSlice(filtered, page);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("auditLog.title")}</h1>
        <div style={{ fontSize: 13, color: "#8A8D96", marginTop: 2, maxWidth: 640, lineHeight: 1.5 }}>
          {t("auditLog.subtitle")}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "26px 32px", overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            className="field-input"
            placeholder={t("auditLog.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <Select
            options={[
              { value: "", label: t("auditLog.allObjects") },
              { value: "group", label: t("auditLog.groups") },
              { value: "student", label: t("auditLog.students") },
              { value: "teacher", label: t("auditLog.teachers") },
            ]}
            value={entityFilter}
            onChange={setEntityFilter}
            style={{ width: 190 }}
          />
          <Select
            options={[
              { value: "", label: t("auditLog.allActions") },
              { value: "create", label: t("auditLog.actionCreate") },
              { value: "update", label: t("auditLog.actionUpdate") },
              { value: "delete", label: t("auditLog.actionDelete") },
              { value: "restore", label: t("auditLog.actionRestore") },
            ]}
            value={actionFilter}
            onChange={setActionFilter}
            style={{ width: 170 }}
          />
        </div>

        {loading ? (
          <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>
            {logs.length === 0 ? t("auditLog.noRecords") : t("auditLog.noFilterResults")}
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflow: "hidden" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ paddingTop: 16 }}>{t("auditLog.colTime")}</th>
                  <th style={{ paddingTop: 16 }}>{t("auditLog.colWho")}</th>
                  <th style={{ paddingTop: 16 }}>{t("auditLog.colAction")}</th>
                  <th style={{ paddingTop: 16 }}>{t("auditLog.colObject")}</th>
                  <th style={{ paddingTop: 16 }}>{t("auditLog.colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDateTime(l.createdAt, lang)}</td>
                    <td style={{ fontWeight: 600 }}>{l.user?.fullName || "—"}</td>
                    <td>
                      <span className={`badge ${ACTION_CLASS[l.action] || "badge-neutral"}`}>
                        {ACTION_LABEL_KEYS[l.action] ? t(ACTION_LABEL_KEYS[l.action]) : EXTRA_ACTIONS[l.action]?.[lang] ?? l.action}
                      </span>
                    </td>
                    <td>{ENTITY_LABEL_KEYS[l.entityType] ? t(ENTITY_LABEL_KEYS[l.entityType]) : EXTRA_ENTITIES[l.entityType]?.[lang] ?? l.entityType}</td>
                    <td style={{ fontSize: 12.5, color: "#4A4E58", maxWidth: 360 }}>
                      {describeAudit(l, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} total={filtered.length} onChange={setPage} />
          </div>
        )}
      </div>
    </>
  );
}

export default function AuditLogPage() {
  return (
    <DashboardShell>
      <AuditLogContent />
    </DashboardShell>
  );
}
