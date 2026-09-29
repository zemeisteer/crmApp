"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MonthPicker from "@/components/MonthPicker";
import { ApiError, reportsApi, type DirectorReportData } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { MONTH_KEYS, type TranslationKey } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";

// The director's page: money per month (collected vs still owed), debt that
// has built up over months, and who left and why.

const COLLECTED = "#4F46E5"; // validated pair (light): indigo + orange
const UNPAID = "#EB6834";
const card: React.CSSProperties = { background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 18 };
const money = (n: number) => new Intl.NumberFormat("uz-UZ").format(n);
const short = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10} mln` : n >= 1000 ? `${Math.round(n / 1000)} ming` : String(n));
export const LEFT_REASONS = ["PRICE", "SCHEDULE", "MOVED", "RESULTS", "TEACHER", "GOAL_REACHED", "OTHER"] as const;

export default function DirectorReport({ month, onMonth, onSms }: { month: string; onMonth: (m: string) => void; onSms: (s: { id: string; fullName: string; phone: string | null }) => void }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<DirectorReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyMulti, setOnlyMulti] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    reportsApi
      .director(month)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : t("common.errorGeneric")))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [month, t]);

  // Short month names; Uzbek Iyun/Iyul would both cut to "Iyu".
  const monthName = (m: string) => {
    const full = t(MONTH_KEYS[Number(m.slice(5, 7)) - 1]);
    return /^Iyu[nl]/i.test(full) ? `${full.slice(0, 2)}${full.slice(3, 4)}` : full.slice(0, 3);
  };
  const reasonLabel = (r: string) => t(`left.${r}` as TranslationKey);

  const debtors = useMemo(() => {
    const list = data?.debtors.items.filter((d) => !onlyMulti || d.monthsBehind >= 2) ?? [];
    return showAll ? list : list.slice(0, 15);
  }, [data, onlyMulti, showAll]);

  const now = data?.trend[data.trend.length - 1];
  const prev = data?.trend[data.trend.length - 2];
  const delta = now && prev && prev.collected > 0 ? Math.round(((now.collected - prev.collected) / prev.collected) * 100) : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <MonthPicker value={month} onChange={onMonth} style={{ width: 200 }} />
        {loading && <span style={{ fontSize: 12, color: "#8A8D96" }}>{t("common.loading")}</span>}
      </div>
      {error && <div style={{ background: "#FEE2E2", color: "#B91C1C", fontWeight: 600, fontSize: 13, padding: "12px 16px", borderRadius: 12 }}>{error}</div>}

      {data && now && (
        <>
          {/* Headline numbers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <Tile label={t("dir.collected")} value={`${money(now.collected)}`} sub={delta === null ? t("dir.sumUnit") : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% ${t("dir.vsPrev")}`} subColor={delta === null ? undefined : delta >= 0 ? "#1FA463" : "#DC2626"} />
            <Tile label={t("dir.expected")} value={money(now.expected)} sub={now.collectionRate === null ? "—" : `${t("dir.covered")} ${now.collectionRate}%`} />
            <Tile label={t("dir.debt")} value={money(data.debtors.totalDebt)} sub={t("dir.debtSub").replace("{n}", String(data.debtors.count)).replace("{m}", String(data.debtors.multiMonth))} subColor={data.debtors.multiMonth > 0 ? "#DC2626" : undefined} />
            {typeof now.net === "number" && <Tile label={t("dir.net")} value={money(now.net)} sub={`${t("dir.expenses")}: ${money((now.expenses ?? 0) + (now.salaries ?? 0))}`} valueColor={now.net < 0 ? "#DC2626" : undefined} />}
            <Tile label={t("dir.students")} value={`+${now.newStudents} / −${now.left}`} sub={now.churnRate !== null ? `${t("dir.churn")} ${now.churnRate}%` : now.left > 0 ? `${t("dir.churn")}: —` : t("dir.churnNone")} />
          </div>

          {/* 12-month money trend */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>{t("dir.trendTitle")}</div>
                <div style={{ fontSize: 12.5, color: "#8A8D96" }}>{t("dir.trendHint")}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12.5, color: "#4A4E58" }}>
                <Legend color={COLLECTED} label={t("dir.collected")} />
                <Legend color={UNPAID} label={t("dir.unpaid")} />
                <button type="button" onClick={() => setAsTable((v) => !v)} style={{ border: "1px solid #EAE8E2", background: "#fff", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {asTable ? `📊 ${t("dir.chart")}` : `☰ ${t("dir.table")}`}
                </button>
              </div>
            </div>
            {asTable ? <TrendTable data={data} monthName={monthName} t={t} /> : <TrendChart data={data} monthName={monthName} t={t} />}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))", gap: 16, alignItems: "start" }}>
            {/* Debtors */}
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 18px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>💸 {t("dir.debtorsTitle")}</div>
                  <div style={{ fontSize: 12.5, color: "#8A8D96" }}>{t("dir.debtorsHint")}</div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={onlyMulti} onChange={(e) => setOnlyMulti(e.target.checked)} style={{ accentColor: COLLECTED }} />
                  {t("dir.onlyMulti")}
                </label>
              </div>
              {debtors.length === 0 ? (
                <div style={{ padding: "8px 18px 20px", fontSize: 13.5, color: "#1FA463", fontWeight: 600 }}>✓ {t("dir.noDebtors")}</div>
              ) : (
                <div>
                  {debtors.map((d) => (
                    <div key={d.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderTop: "1px solid #F2F1EC" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Link href={`/students/${d.studentId}`} style={{ fontSize: 14, fontWeight: 700, color: "#181A1F", textDecoration: "none" }}>{d.fullName}</Link>
                        <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                          {d.groups.length > 0 && <span>{d.groups.join(", ")}</span>}
                          <span>{t("dir.lastPaid")}: {d.lastPaymentAt ? formatDate(d.lastPaymentAt, lang, "short") : "—"}</span>
                          {d.status !== "ACTIVE" && <span style={{ color: "#B45309" }}>{t(`stStatus.${d.status}` as TranslationKey)}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 15 }}>{money(d.totalDebt)}</div>
                        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 8px", borderRadius: 100, ...(d.monthsBehind >= 2 ? { background: "#FEE2E2", color: "#DC2626" } : { background: "#FEF3C7", color: "#B45309" }) }}>
                          {t("dir.months").replace("{n}", String(d.monthsBehind))}
                        </span>
                      </div>
                      <button type="button" title={t("dir.sms")} aria-label={t("dir.sms")} onClick={() => onSms({ id: d.studentId, fullName: d.fullName, phone: d.phone ?? d.parentPhone })} disabled={!d.phone && !d.parentPhone} style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, border: "1px solid #EAE8E2", background: "#fff", cursor: d.phone || d.parentPhone ? "pointer" : "default", opacity: d.phone || d.parentPhone ? 1 : 0.4 }}>
                        💬
                      </button>
                    </div>
                  ))}
                  {!showAll && (data.debtors.items.filter((d) => !onlyMulti || d.monthsBehind >= 2).length > 15) && (
                    <button type="button" onClick={() => setShowAll(true)} style={{ width: "100%", border: "none", borderTop: "1px solid #F2F1EC", background: "#FAFAF8", padding: 12, fontSize: 13, fontWeight: 700, color: COLLECTED, cursor: "pointer" }}>
                      {t("dir.showAll")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Churn */}
            <div style={card}>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15 }}>🚪 {t("dir.churnTitle")}</div>
              <div style={{ fontSize: 12.5, color: "#8A8D96", marginBottom: 12 }}>{t("dir.churnHint")}</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1, background: "#F7F6F2", borderRadius: 12, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11.5, color: "#8A8D96", fontWeight: 600 }}>{t("dir.leftThisMonth")}</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20 }}>{data.churn.left}</div>
                </div>
                <div style={{ flex: 1, background: "#F7F6F2", borderRadius: 12, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11.5, color: "#8A8D96", fontWeight: 600 }}>{t("dir.churn")}</div>
                  <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 20 }}>{data.churn.rate === null ? "—" : `${data.churn.rate}%`}</div>
                </div>
              </div>

              <ReasonBars reasons={data.churn.reasonsLast3Months} label={reasonLabel} title={t("dir.reasons3m")} />

              {data.churn.leavers.length > 0 && (
                <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
                  {data.churn.leavers.map((l) => (
                    <div key={l.studentId} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "8px 10px", background: "#FAFAF8", borderRadius: 10 }}>
                      <Link href={`/students/${l.studentId}`} style={{ fontWeight: 700, color: "#181A1F", textDecoration: "none", minWidth: 0 }}>{l.fullName}</Link>
                      <span style={{ color: l.reason ? "#4A4E58" : "#B45309", whiteSpace: "nowrap" }}>{l.reason ? reasonLabel(l.reason) : t("left.UNKNOWN")}</span>
                    </div>
                  ))}
                </div>
              )}
              {Object.keys(data.churn.reasonsLast3Months).includes("UNKNOWN") && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#8A8D96", lineHeight: 1.5 }}>{t("dir.reasonTip")}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, subColor, valueColor }: { label: string; value: string; sub?: string; subColor?: string; valueColor?: string }) {
  return (
    <div style={{ ...card, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "#8A8D96", fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 21, marginTop: 2, color: valueColor ?? "#181A1F", overflowWrap: "anywhere" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: subColor ?? "#8A8D96", marginTop: 2, fontWeight: subColor ? 700 : 500 }}>{sub}</div>}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

type T = (k: TranslationKey) => string;

// Stacked columns: collected + still unpaid = what was expected.
function TrendChart({ data, monthName, t }: { data: DirectorReportData; monthName: (m: string) => string; t: T }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.trend;
  const W = 720;
  const H = 220;
  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...rows.map((r) => Math.max(r.expected, r.collected)));
  const nice = niceMax(max);
  const bw = (W - pad.l - pad.r) / rows.length;
  const barW = Math.min(24, bw * 0.6);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const h = hover === null ? null : rows[hover];

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t("dir.trendTitle")} style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#EFEEE9" strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#8A8D96">{short(v)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = pad.l + i * bw + (bw - barW) / 2;
          const paidTop = y(Math.min(r.collected, Math.max(r.expected, r.collected)));
          const unpaid = Math.max(0, r.debt);
          const unpaidTop = y(r.collected + unpaid);
          const base = y(0);
          return (
            <g key={r.month} onMouseEnter={() => setHover(i)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={hover === i ? "#F7F6F2" : "transparent"} />
              {r.collected > 0 && <path d={roundTop(x, paidTop, barW, base - paidTop, unpaid > 0 ? 0 : 4)} fill={COLLECTED} />}
              {unpaid > 0 && <path d={roundTop(x, unpaidTop, barW, Math.max(0, paidTop - unpaidTop - (r.collected > 0 ? 2 : 0)), 4)} fill={UNPAID} />}
              <text x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill={i === rows.length - 1 ? "#181A1F" : "#8A8D96"} fontWeight={i === rows.length - 1 ? 700 : 400}>
                {monthName(r.month)}
              </text>
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div style={{ position: "absolute", top: 8, left: `${Math.min(70, Math.max(2, ((pad.l + hover * bw) / W) * 100))}%`, background: "#181A1F", color: "#fff", borderRadius: 10, padding: "8px 10px", fontSize: 12, lineHeight: 1.6, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 2 }}>
          <div style={{ fontWeight: 700 }}>{h.month}</div>
          <div>{t("dir.expected")}: {money(h.expected)}</div>
          <div>{t("dir.collected")}: {money(h.collected)}</div>
          <div>{t("dir.unpaid")}: {money(h.debt)}</div>
          {typeof h.net === "number" && <div>{t("dir.net")}: {money(h.net)}</div>}
        </div>
      )}
    </div>
  );
}

function TrendTable({ data, monthName, t }: { data: DirectorReportData; monthName: (m: string) => string; t: T }) {
  const profit = data.trend.some((r) => typeof r.net === "number");
  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 11.5, color: "#8A8D96", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 };
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: 12.5, textAlign: "right", whiteSpace: "nowrap", borderTop: "1px solid #F2F1EC" };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>{t("dir.month")}</th>
            <th style={th}>{t("dir.expected")}</th>
            <th style={th}>{t("dir.collected")}</th>
            <th style={th}>{t("dir.unpaid")}</th>
            <th style={th}>%</th>
            {profit && <th style={th}>{t("dir.expenses")}</th>}
            {profit && <th style={th}>{t("dir.net")}</th>}
            <th style={th}>{t("dir.newShort")}</th>
            <th style={th}>{t("dir.leftShort")}</th>
          </tr>
        </thead>
        <tbody>
          {[...data.trend].reverse().map((r) => (
            <tr key={r.month}>
              <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{monthName(r.month)} {r.month.slice(0, 4)}</td>
              <td style={td}>{money(r.expected)}</td>
              <td style={td}>{money(r.collected)}</td>
              <td style={{ ...td, color: r.debt > 0 ? "#B45309" : undefined }}>{money(r.debt)}</td>
              <td style={td}>{r.collectionRate === null ? "—" : `${r.collectionRate}%`}</td>
              {profit && <td style={td}>{money((r.expenses ?? 0) + (r.salaries ?? 0))}</td>}
              {profit && <td style={{ ...td, color: (r.net ?? 0) < 0 ? "#DC2626" : undefined, fontWeight: 700 }}>{money(r.net ?? 0)}</td>}
              <td style={td}>{r.newStudents}</td>
              <td style={td}>{r.left}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReasonBars({ reasons, label, title }: { reasons: Record<string, number>; label: (r: string) => string; title: string }) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#4A4E58", marginBottom: 8 }}>{title}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {entries.map(([r, n]) => (
          <div key={r} style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) 1fr 28px", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ color: "#4A4E58", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(r)}</span>
            <span style={{ height: 10, background: "#F2F1EC", borderRadius: 4, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${(n / max) * 100}%`, background: r === "UNKNOWN" ? "#C9C6BD" : COLLECTED, borderRadius: 4 }} />
            </span>
            <span style={{ textAlign: "right", fontWeight: 700 }}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// A column with a rounded top (data end) and a square base.
function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
