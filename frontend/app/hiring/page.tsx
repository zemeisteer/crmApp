"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import PlacementTestModal from "@/components/students/PlacementTestModal";
import { ApiError, groupsApi, hiringApi, type Candidate, type CandidateDetail, type CandidateStage, type Group } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/format-date";

const ACCENT = "#4F46E5";
const LBL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#4A4E58" };
// The way through hiring, in order; HIRED and REJECTED are where it ends.
const STAGES: CandidateStage[] = ["NEW", "TEST", "INTERVIEW", "DEMO", "OFFER", "HIRED", "REJECTED"];
const STAGE_TONE: Record<CandidateStage, { bg: string; fg: string }> = {
  NEW: { bg: "#F2F1EC", fg: "#4A4E58" },
  TEST: { bg: "#E8F0FE", fg: "#1D4ED8" },
  INTERVIEW: { bg: "#F1EBFF", fg: "#5B21B6" },
  DEMO: { bg: "#FFF7E6", fg: "#8A5A00" },
  OFFER: { bg: "#E6F7F5", fg: "#0F766E" },
  HIRED: { bg: "#E9F8EF", fg: "#16794A" },
  REJECTED: { bg: "#FDEBEC", fg: "#B23A47" },
};
const stageKey = (s: CandidateStage) => `hire.stage.${s}` as TranslationKey;

function StageChip({ stage }: { stage: CandidateStage }) {
  const { t } = useLanguage();
  const tone = STAGE_TONE[stage];
  return <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 100, background: tone.bg, color: tone.fg, whiteSpace: "nowrap" }}>{t(stageKey(stage))}</span>;
}

const score = (n: number | null) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "—");

function HiringContent() {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [counts, setCounts] = useState<Record<CandidateStage, number> | null>(null);
  const [stage, setStage] = useState<CandidateStage | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [testsOpen, setTestsOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    hiringApi
      .list({ stage: stage === "ALL" ? undefined : stage, q: q.trim() || undefined })
      .then((r) => {
        setItems(r.items);
        setCounts(r.counts);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [stage, q, t]);

  useEffect(() => {
    const id = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);
  useEffect(() => {
    groupsApi.list().then(setGroups).catch(() => setGroups([]));
  }, []);

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const inProgress = counts ? counts.TEST + counts.INTERVIEW + counts.DEMO + counts.OFFER : 0;

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("hire.title")}</h1>
          <div style={{ fontSize: 13, color: "#686B75", marginTop: 2, lineHeight: 1.5, maxWidth: 640 }}>{t("hire.subtitle")}</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setTestsOpen(true)} style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 16px", borderRadius: 9 }}>
            🧭 {t("hire.tests")}
          </button>
          <button type="button" className="btn" onClick={() => setAdding(true)} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
            + {t("hire.add")}
          </button>
        </div>
      </div>

      <div style={{ padding: "20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div role="tablist" aria-label={t("hire.title")} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["ALL", ...STAGES] as const).map((s) => {
            const active = stage === s;
            const n = s === "ALL" ? total : counts?.[s] ?? 0;
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStage(s)}
                className="btn"
                style={{ background: active ? ACCENT : "#fff", color: active ? "#fff" : "#4A4E58", border: `1px solid ${active ? ACCENT : "#EAE8E2"}`, borderRadius: 100, padding: "7px 14px", fontSize: 13, fontWeight: 700 }}
              >
                {s === "ALL" ? t("hire.all") : t(stageKey(s))} <span style={{ opacity: 0.75 }}>{n}</span>
              </button>
            );
          })}
        </div>

        <input className="field-input" placeholder={t("hire.search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} aria-label={t("hire.search")} />

        {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13 }}>{error}</div>}

        {items && items.length === 0 && total === 0 ? (
          <div data-testid="hiring-empty" style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Manrope', sans-serif" }}>{t("hire.emptyTitle")}</div>
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5, color: "#3A3D45", lineHeight: 1.55 }}>
              <li>{t("hire.step1")}</li>
              <li>{t("hire.step2")}</li>
              <li>{t("hire.step3")}</li>
              <li>{t("hire.step4")}</li>
            </ol>
          </div>
        ) : items && items.length === 0 ? (
          <div style={{ color: "#686B75", fontSize: 14, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 32, textAlign: "center" }}>{t("hire.noMatch")}</div>
        ) : items ? (
          <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, overflowX: "auto" }}>
            <table className="adm-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{t("hire.col.name")}</th>
                  <th>{t("hire.col.subject")}</th>
                  <th>{t("hire.col.stage")}</th>
                  <th>{t("hire.col.test")}</th>
                  <th>{t("hire.col.interview")}</th>
                  <th>{t("hire.col.demo")}</th>
                  <th>{t("hire.col.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: "pointer" }} data-testid="candidate-row">
                    <td>
                      <button type="button" onClick={() => setOpenId(c.id)} style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "#181A1F", cursor: "pointer", textAlign: "left" }}>
                        {c.fullName}
                      </button>
                      {c.phone && <div style={{ fontSize: 12, color: "#686B75" }}>{c.phone}</div>}
                    </td>
                    <td>{c.subject || "—"}</td>
                    <td><StageChip stage={c.stage} /></td>
                    <td>{c.testPercent == null ? "—" : `${c.testPercent}%`}</td>
                    <td style={{ color: "#B45309" }}>{score(c.interviewScore)}</td>
                    <td style={{ color: "#B45309" }}>{score(c.demoScore)}</td>
                    <td style={{ fontSize: 12.5, color: "#686B75" }}>{formatDate(c.updatedAt, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {counts && total > 0 && (
          <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("hire.summary").replace("{n}", String(inProgress)).replace("{h}", String(counts.HIRED))}</div>
        )}
      </div>

      {adding && (
        <AddCandidate
          onClose={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false);
            load();
            setOpenId(c.id);
          }}
        />
      )}
      {openId && <CandidateModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {testsOpen && <PlacementTestModal groups={groups} audience="CANDIDATE" onClose={() => { setTestsOpen(false); load(); }} />}
    </>
  );
}

function AddCandidate({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Candidate) => void }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", subject: "", source: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal open onClose={onClose} title={t("hire.add")}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || undefined])) as typeof form;
            onCreated(await hiringApi.create({ ...clean, fullName: form.fullName.trim() }));
          } catch (err) {
            setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
          } finally {
            setBusy(false);
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <label style={LBL}>{t("hire.f.name")}<input className="field-input" required minLength={2} value={form.fullName} onChange={set("fullName")} /></label>
        <label style={LBL}>{t("hire.f.phone")}<input className="field-input" value={form.phone} onChange={set("phone")} placeholder="+998 90 123 45 67" /></label>
        <label style={LBL}>Email<input className="field-input" type="email" value={form.email} onChange={set("email")} /></label>
        <label style={LBL}>{t("hire.f.subject")}<input className="field-input" value={form.subject} onChange={set("subject")} /></label>
        <label style={LBL}>{t("hire.f.source")}<input className="field-input" value={form.source} onChange={set("source")} placeholder={t("hire.f.sourceHint")} /></label>
        <label style={LBL}>{t("hire.f.notes")}<textarea className="field-input" rows={3} value={form.notes} onChange={set("notes")} /></label>
        {error && <div role="alert" style={{ color: "#B23A47", fontSize: 12.5 }}>{error}</div>}
        <button className="btn" type="submit" disabled={busy} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9, alignSelf: "flex-start" }}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </Modal>
  );
}

// "2026-11-03T10:00:00.000Z" -> the value a datetime-local input shows (local time).
function toLocalInput(v: string | null) {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Section({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, display: "flex", gap: 8, alignItems: "center" }}>
        <span aria-hidden="true">{done ? "✅" : "⬜"}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function CandidateModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const canHire = user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const [c, setC] = useState<CandidateDetail | null>(null);
  const [draft, setDraft] = useState<Partial<CandidateDetail>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    hiringApi.get(id).then((x) => {
      setC(x);
      setDraft({});
    }).catch((e) => setError(e instanceof ApiError ? e.message : t("common.errorGeneric")));
  }, [id, t]);
  useEffect(reload, [reload]);

  if (!c) return null;
  const v = <K extends keyof CandidateDetail>(k: K) => (k in draft ? draft[k] : c[k]) as CandidateDetail[K];
  const put = <K extends keyof CandidateDetail>(k: K, value: CandidateDetail[K]) => setDraft({ ...draft, [k]: value });
  const hired = c.stage === "HIRED";

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      onChanged();
      reload();
      if (done) setNotice(done);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const d = draft;
    const body: Record<string, unknown> = {};
    for (const k of ["fullName", "phone", "email", "subject", "source", "notes", "interviewNotes", "demoNotes", "decisionNote"] as const) {
      if (k in d) body[k] = (d[k] as string | null) ?? "";
    }
    for (const k of ["testPercent", "interviewScore", "demoScore"] as const) {
      if (k in d && d[k] != null) body[k] = d[k];
    }
    for (const k of ["interviewAt", "demoAt"] as const) {
      if (k in d && d[k]) body[k] = new Date(d[k] as string).toISOString();
    }
    if (d.stage && d.stage !== c!.stage) body.stage = d.stage;
    return act(() => hiringApi.update(id, body), t("hire.saved"));
  }

  const scoreSelect = (k: "interviewScore" | "demoScore") => (
    <Select
      value={v(k) ? String(v(k)) : ""}
      onChange={(x) => put(k, x ? Number(x) : null)}
      options={[{ value: "", label: "—" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${"★".repeat(n)} ${n}/5` }))]}
    />
  );

  return (
    <Modal open onClose={onClose} title={c.fullName} width={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="candidate-modal">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <StageChip stage={c.stage} />
          {!hired && (
            <div style={{ width: 220 }}>
              <Select
                value={v("stage")}
                onChange={(x) => put("stage", x as CandidateStage)}
                options={STAGES.filter((s) => s !== "HIRED").map((s) => ({ value: s, label: `${t("hire.moveTo")} ${t(stageKey(s))}` }))}
              />
            </div>
          )}
          {hired && c.teacherId && (
            <Link href={`/teachers/${c.teacherId}`} style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>{t("hire.openTeacher")} →</Link>
          )}
        </div>

        <Section title={t("hire.sec.contact")} done>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            <label style={LBL}>{t("hire.f.name")}<input className="field-input" value={v("fullName")} onChange={(e) => put("fullName", e.target.value)} /></label>
            <label style={LBL}>{t("hire.f.phone")}<input className="field-input" value={v("phone") ?? ""} onChange={(e) => put("phone", e.target.value)} /></label>
            <label style={LBL}>Email<input className="field-input" value={v("email") ?? ""} onChange={(e) => put("email", e.target.value)} /></label>
            <label style={LBL}>{t("hire.f.subject")}<input className="field-input" value={v("subject") ?? ""} onChange={(e) => put("subject", e.target.value)} /></label>
            <label style={LBL}>{t("hire.f.source")}<input className="field-input" value={v("source") ?? ""} onChange={(e) => put("source", e.target.value)} /></label>
          </div>
          <label style={LBL}>{t("hire.f.notes")}<textarea className="field-input" rows={2} value={v("notes") ?? ""} onChange={(e) => put("notes", e.target.value)} /></label>
        </Section>

        <Section title={t("hire.sec.test")} done={c.testPercent != null}>
          <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t("hire.testHint")}</div>
          {c.attempts.map((a) => (
            <div key={a.id} style={{ fontSize: 13 }}>
              🧭 <b>{a.testTitle}</b> — {a.percent}% ({a.correct}/{a.total}){a.reviewStatus === "PENDING" ? ` · ${t("hire.pendingReview")}` : ""} · {formatDateTime(a.createdAt, lang)}
            </div>
          ))}
          <label style={{ ...LBL, maxWidth: 200 }}>
            {t("hire.f.testPercent")}
            <input className="field-input" type="number" min={0} max={100} value={v("testPercent") ?? ""} onChange={(e) => put("testPercent", e.target.value === "" ? null : Number(e.target.value))} />
          </label>
        </Section>

        <Section title={t("hire.sec.interview")} done={c.interviewScore != null}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            <label style={LBL}>{t("hire.f.when")}<input className="field-input" type="datetime-local" value={toLocalInput(v("interviewAt"))} onChange={(e) => put("interviewAt", e.target.value || null)} /></label>
            <div style={LBL}>{t("hire.f.score")}{scoreSelect("interviewScore")}</div>
          </div>
          <label style={LBL}>{t("hire.f.notes")}<textarea className="field-input" rows={2} value={v("interviewNotes") ?? ""} onChange={(e) => put("interviewNotes", e.target.value)} /></label>
        </Section>

        <Section title={t("hire.sec.demo")} done={c.demoScore != null}>
          <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("hire.demoHint")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            <label style={LBL}>{t("hire.f.when")}<input className="field-input" type="datetime-local" value={toLocalInput(v("demoAt"))} onChange={(e) => put("demoAt", e.target.value || null)} /></label>
            <div style={LBL}>{t("hire.f.score")}{scoreSelect("demoScore")}</div>
          </div>
          <label style={LBL}>{t("hire.f.notes")}<textarea className="field-input" rows={2} value={v("demoNotes") ?? ""} onChange={(e) => put("demoNotes", e.target.value)} /></label>
        </Section>

        <Section title={t("hire.sec.decision")} done={["OFFER", "HIRED", "REJECTED"].includes(c.stage)}>
          <label style={LBL}>{t("hire.f.decisionNote")}<textarea className="field-input" rows={2} value={v("decisionNote") ?? ""} onChange={(e) => put("decisionNote", e.target.value)} /></label>
        </Section>

        {c.history.length > 0 && (
          <div style={{ fontSize: 12, color: "#686B75", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {c.history.map((h, i) => (
              <span key={i}>{i > 0 && "→ "}{t(stageKey(h.stage))} ({formatDate(h.at, lang)})</span>
            ))}
          </div>
        )}

        {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {notice && <div role="status" style={{ color: "#16794A", fontSize: 13, fontWeight: 600 }}>{notice}</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={busy || Object.keys(draft).length === 0} onClick={save} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
          {canHire && !hired && c.stage !== "REJECTED" && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("hire.confirmHire").replace("{name}", c.fullName))) void act(() => hiringApi.hire(id), t("hire.hiredNotice"));
              }}
              style={{ background: "#16794A", color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}
            >
              👩‍🏫 {t("hire.makeTeacher")}
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("hire.confirmArchive"))) {
                void hiringApi.archive(id).then(() => {
                  onChanged();
                  onClose();
                });
              }
            }}
            style={{ background: "transparent", color: "#B23A47", border: "1px solid #F3C6CB", fontSize: 13, fontWeight: 700, padding: "10px 16px", borderRadius: 9, marginLeft: "auto" }}
          >
            {t("hire.archive")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function HiringPage() {
  return (
    <DashboardShell>
      <HiringContent />
    </DashboardShell>
  );
}
