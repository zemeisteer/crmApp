"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Select from "@/components/Select";
import { ApiError, classificationsApi, signalsApi, type Classification, type ClassificationReview, type Signal, type SignalRule } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format-date";

const ACCENT = "#4F46E5";
const RULES: SignalRule[] = ["ABSENCE_STREAK", "TRIAL_FOLLOW_UP", "PAYMENT_OVERDUE"];
const RULE_ICON: Record<SignalRule, string> = { ABSENCE_STREAK: "⚠️", TRIAL_FOLLOW_UP: "📞", PAYMENT_OVERDUE: "💳" };
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 14, padding: 14 };

function chip(active: boolean): React.CSSProperties {
  return { background: active ? ACCENT : "#fff", color: active ? "#fff" : "#4A4E58", border: `1px solid ${active ? ACCENT : "#EAE8E2"}`, borderRadius: 100, padding: "7px 14px", fontSize: 13, fontWeight: 700 };
}

function SignalsContent() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isAdmin = user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const [tab, setTab] = useState<"signals" | "messages">("signals");

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("sig.title")}</h1>
        <div style={{ fontSize: 13, color: "#686B75", marginTop: 2, lineHeight: 1.5, maxWidth: 760 }}>{t("sig.subtitle")}</div>
        {isAdmin && (
          <div role="tablist" style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" role="tab" aria-selected={tab === "signals"} className="btn" onClick={() => setTab("signals")} style={chip(tab === "signals")}>{t("sig.tabSignals")}</button>
            <button type="button" role="tab" aria-selected={tab === "messages"} className="btn" onClick={() => setTab("messages")} style={chip(tab === "messages")}>🧪 {t("sig.tabMessages")}</button>
          </div>
        )}
      </div>
      <div style={{ padding: "20px 32px" }}>{tab === "signals" || !isAdmin ? <SignalsList /> : <MessagesReview />}</div>
    </>
  );
}

function SignalsList() {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<"OPEN" | "DONE" | "DISMISSED">("OPEN");
  const [rule, setRule] = useState<SignalRule | "">("");
  const [data, setData] = useState<{ open: Partial<Record<SignalRule, number>>; items: Signal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    signalsApi
      .list({ status, rule: rule || undefined })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [status, rule, t]);
  useEffect(load, [load]);

  async function resolve(id: string, next: "DONE" | "DISMISSED" | "OPEN") {
    try {
      await signalsApi.resolve(id, next);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    }
  }

  const link = (s: Signal) => (s.subjectType === "student" ? `/students/${s.subjectId}` : `/leads/${s.subjectId}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        {RULES.map((r) => (
          <button key={r} type="button" onClick={() => setRule(rule === r ? "" : r)} style={{ ...card, textAlign: "left", cursor: "pointer", font: "inherit", borderColor: rule === r ? ACCENT : "#EAE8E2" }}>
            <div style={{ fontSize: 12.5, color: "#686B75" }}>{RULE_ICON[r]} {t(`sig.rule.${r}` as TranslationKey)}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{data?.open[r] ?? 0}</div>
            <div style={{ fontSize: 11.5, color: "#686B75" }}>{t("sig.openNow")}</div>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["OPEN", "DONE", "DISMISSED"] as const).map((s) => (
          <button key={s} type="button" className="btn" onClick={() => setStatus(s)} style={chip(status === s)}>{t(`sig.status.${s}` as TranslationKey)}</button>
        ))}
      </div>
      {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13 }}>{error}</div>}
      {data && data.items.length === 0 && (
        <div style={{ ...card, padding: 28, textAlign: "center", color: "#686B75", fontSize: 14 }}>
          {status === "OPEN" ? t("sig.noneOpen") : t("sig.none")}
          <div style={{ fontSize: 12.5, marginTop: 6 }}>
            {t("sig.settingsHint")} <Link href="/settings" style={{ color: ACCENT, fontWeight: 700 }}>{t("sig.settingsLink")}</Link>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data?.items.map((s) => (
          <div key={s.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }} data-testid="signal">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: "#F1EBFF", color: "#5B21B6" }}>
                  {RULE_ICON[s.rule]} {t(`sig.rule.${s.rule}` as TranslationKey)}
                </span>
                <Link href={link(s)} style={{ fontWeight: 800, color: "#181A1F" }}>{s.subjectName ?? "—"}</Link>
              </div>
              <span style={{ fontSize: 12, color: "#686B75" }}>{formatDateTime(s.createdAt, lang)}</span>
            </div>
            <div style={{ fontSize: 13.5, color: "#3A3D45" }}>
              <b>{t("sig.why")}:</b> {s.reason}
            </div>
            <div style={{ fontSize: 12.5, color: "#686B75" }}>
              <b>{t("sig.done")}:</b> {t(`sig.action.${s.action}` as TranslationKey)}
            </div>
            <details style={{ fontSize: 12 }}>
              <summary style={{ cursor: "pointer", color: ACCENT, fontWeight: 700 }}>{t("sig.facts")}</summary>
              <pre style={{ margin: "6px 0 0", background: "#F7F6F2", borderRadius: 8, padding: 10, whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(s.facts, null, 2)}</pre>
            </details>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {s.status === "OPEN" ? (
                <>
                  <button type="button" className="btn" onClick={() => resolve(s.id, "DONE")} style={{ background: "#16794A", color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}>✓ {t("sig.markDone")}</button>
                  <button type="button" className="btn" onClick={() => resolve(s.id, "DISMISSED")} style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}>{t("sig.dismiss")}</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 12, color: "#686B75" }}>{t(`sig.status.${s.status}` as TranslationKey)}{s.resolvedBy ? ` · ${s.resolvedBy}` : ""}</span>
                  <button type="button" className="btn" onClick={() => resolve(s.id, "OPEN")} style={{ background: "transparent", color: ACCENT, border: "none", fontSize: 12.5, fontWeight: 700, padding: "4px 8px" }}>{t("sig.reopen")}</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessagesReview() {
  const { t, lang } = useLanguage();
  const [labeled, setLabeled] = useState<"no" | "yes" | "">("no");
  const [data, setData] = useState<ClassificationReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    classificationsApi
      .list(labeled || undefined)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [labeled, t]);
  useEffect(load, [load]);

  async function label(c: Classification, finalLabel: string) {
    try {
      await classificationsApi.label(c.id, finalLabel);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    }
  }

  if (!data) return error ? <div role="alert" style={{ color: "#B23A47" }}>{error}</div> : null;
  const s = data.stats;
  const optionKeys = Object.keys(data.options);
  const optionLabel = (k: string | null) => (k ? t(`cls.opt.${k}` as TranslationKey) : "—");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "#F8F8FF", borderColor: "#E0E7FF", fontSize: 13, lineHeight: 1.6 }}>
        {t("cls.hint")}
        <div style={{ marginTop: 6, fontSize: 12.5, color: "#4A4E58" }}>
          {t("cls.model")}: <b>{data.settings.provider === "off" ? t("cls.off") : `${data.settings.provider} · ${data.settings.modelVersion}`}</b> · {t("cls.threshold")}: <b>{Math.round(data.settings.threshold * 100)}%</b>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {[
          { l: t("cls.labelled"), v: String(s.labelled) },
          { l: t("cls.accuracy"), v: pct(s.accuracy) },
          { l: t("cls.confidentAccuracy"), v: pct(s.confidentAccuracy) },
          { l: t("cls.needsHuman"), v: String(s.needsHuman) },
        ].map((x) => (
          <div key={x.l} style={card}>
            <div style={{ fontSize: 12, color: "#686B75" }}>{x.l}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{x.v}</div>
          </div>
        ))}
      </div>

      {s.labelled > 0 && (
        <div style={{ ...card, overflowX: "auto" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("cls.matrix")}</div>
          <table className="adm-table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>{t("cls.truth")} ↓ / {t("cls.guess")} →</th>
                {[...optionKeys, "none"].map((k) => <th key={k}>{k === "none" ? t("cls.noAnswer") : optionLabel(k)}</th>)}
              </tr>
            </thead>
            <tbody>
              {optionKeys.map((r) => (
                <tr key={r}>
                  <td style={{ fontWeight: 700 }}>{optionLabel(r)}</td>
                  {[...optionKeys, "none"].map((c) => (
                    <td key={c} style={{ fontWeight: r === c ? 800 : 400, color: r === c ? "#16794A" : s.matrix[r]?.[c] ? "#B23A47" : "#B0ADA5" }}>{s.matrix[r]?.[c] ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {([["no", "cls.toLabel"], ["yes", "cls.labelledList"], ["", "cls.all"]] as const).map(([v, k]) => (
          <button key={v} type="button" className="btn" onClick={() => setLabeled(v)} style={chip(labeled === v)}>{t(k)}</button>
        ))}
      </div>
      {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13 }}>{error}</div>}
      {data.items.length === 0 && <div style={{ ...card, padding: 24, textAlign: "center", color: "#686B75", fontSize: 13.5 }}>{data.settings.provider === "off" ? t("cls.emptyOff") : t("cls.empty")}</div>}
      {data.items.map((c) => (
        <div key={c.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }} data-testid="classification">
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>💬 {c.inputText}</div>
          <div style={{ fontSize: 12.5, color: "#4A4E58", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{t("cls.suggested")}: <b>{optionLabel(c.chosen)}</b>{c.probability != null ? ` (${Math.round(c.probability * 100)}%)` : ""}</span>
            <span style={{ fontWeight: 700, color: c.status === "SUGGESTED" ? "#16794A" : "#B45309" }}>{c.status === "SUGGESTED" ? t("cls.sure") : t("cls.needsPerson")}{c.error && c.error !== "LOW_CONFIDENCE" ? ` · ${c.error}` : ""}</span>
            <span style={{ color: "#686B75" }}>{c.source} · {formatDateTime(c.createdAt, lang)}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("cls.yourAnswer")}:</span>
            <div style={{ width: 220 }}>
              <Select value={c.finalLabel ?? ""} onChange={(v) => v && label(c, v)} placeholder={t("cls.pick")} options={optionKeys.map((k) => ({ value: k, label: optionLabel(k) }))} />
            </div>
            {c.finalLabel && <span style={{ fontSize: 12.5, fontWeight: 700, color: c.finalLabel === c.chosen ? "#16794A" : "#B23A47" }}>{c.finalLabel === c.chosen ? `✓ ${t("cls.match")}` : `✕ ${t("cls.mismatch")}`}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SignalsPage() {
  return (
    <DashboardShell>
      <SignalsContent />
    </DashboardShell>
  );
}
