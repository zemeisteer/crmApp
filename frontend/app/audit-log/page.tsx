"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import Pagination, { usePagedSlice } from "@/components/Pagination";
import Select from "@/components/Select";
import { auditApi, AuditLog } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

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
        const hay = `${l.user?.fullName || ""} ${l.user?.email || ""} ${l.entityId} ${l.meta || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, actionFilter, search]);

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
                    <td>{new Date(l.createdAt).toLocaleString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US")}</td>
                    <td style={{ fontWeight: 600 }}>{l.user?.fullName || "—"}</td>
                    <td>
                      <span className={`badge ${ACTION_CLASS[l.action] || "badge-neutral"}`}>{ACTION_LABEL_KEYS[l.action] ? t(ACTION_LABEL_KEYS[l.action]) : l.action}</span>
                    </td>
                    <td>{ENTITY_LABEL_KEYS[l.entityType] ? t(ENTITY_LABEL_KEYS[l.entityType]) : l.entityType}</td>
                    <td style={{ fontSize: 12, color: "#8A8D96", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {l.meta || "—"}
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
