"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/components/DashboardShell";
import Modal from "@/components/Modal";
import Select from "@/components/Select";
import PlacementTestModal from "@/components/students/PlacementTestModal";
import DatePicker from "@/components/DatePicker";
import PhoneInput from "@/components/PhoneInput";
import { ApiError, groupsApi, hiringApi, subjectsApi, type Candidate, type CandidateDetail, type CandidateStage, type Group } from "@/lib/api";
import { NAME_PATTERN, NAME_TITLE, PHONE_PATTERN, PHONE_TITLE, phoneOrEmpty } from "@/lib/validation";
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
      .catch((e) => setError(errorText(e, t)));
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

// Common Uzbek sources of candidates; anything else is typed under "Boshqa".
const SOURCES = ["Telegram", "Instagram", "hh.uz / OLX", "REFERRAL", "OTHER"] as const;
// Interview and demo times: every half hour of the working day.
const TIMES = Array.from({ length: 28 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

function errorText(e: unknown, t: (k: TranslationKey) => string) {
  if (e instanceof ApiError) return e.message;
  // A failed fetch (the server restarting, no connection) says so plainly.
  return t("hire.netError");
}

function SubjectField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  const [subjects, setSubjects] = useState<string[] | null>(null);
  useEffect(() => {
    subjectsApi.list("ACTIVE").then((s) => setSubjects(s.map((x) => x.name))).catch(() => setSubjects([]));
  }, []);
  // The center's subjects when it has them; a free field otherwise.
  if (subjects && subjects.length > 0) {
    const options = [...new Set([...subjects, ...(value ? [value] : [])])];
    return <Select value={value} onChange={onChange} placeholder={t("hire.f.subjectPick")} options={options.map((s) => ({ value: s, label: s }))} />;
  }
  return <input className="field-input" value={value} onChange={(e) => onChange(e.target.value)} maxLength={100} />;
}

function SourceField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  const known = SOURCES.map((s) => (s === "REFERRAL" ? t("hire.src.referral") : s === "OTHER" ? t("hire.src.other") : s));
  const isOther = value !== "" && !known.includes(value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Select value={isOther ? t("hire.src.other") : value} onChange={(v) => onChange(v === t("hire.src.other") ? " " : v)} placeholder="—" options={known.map((s) => ({ value: s, label: s }))} />
      {isOther && <input className="field-input" value={value.trim()} onChange={(e) => onChange(e.target.value || " ")} placeholder={t("hire.f.sourceHint")} maxLength={100} />}
    </div>
  );
}

/** Name, phone, email, subject, source: checked as they are typed. */
function ContactFields({
  form,
  set,
}: {
  form: { fullName: string; phone: string; email: string; subject: string; source: string };
  set: (k: "fullName" | "phone" | "email" | "subject" | "source", v: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
      <label style={LBL}>
        {t("hire.f.name")} *
        <input className="field-input" required pattern={NAME_PATTERN} title={NAME_TITLE} value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
      </label>
      <label style={LBL}>
        {t("hire.f.phone")} *
        <PhoneInput className="field-input" required pattern={PHONE_PATTERN} title={PHONE_TITLE} value={form.phone} onChange={(v) => set("phone", v)} />
      </label>
      <label style={LBL}>
        Email
        <input className="field-input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="nomzod@gmail.com" maxLength={160} />
      </label>
      <div style={LBL}>
        {t("hire.f.subject")}
        <SubjectField value={form.subject} onChange={(v) => set("subject", v)} />
      </div>
      <div style={LBL}>
        {t("hire.f.source")}
        <SourceField value={form.source} onChange={(v) => set("source", v)} />
      </div>
    </div>
  );
}

const contactBody = (f: { fullName: string; phone: string; email: string; subject: string; source: string }) => ({
  fullName: f.fullName.trim(),
  phone: phoneOrEmpty(f.phone) || undefined,
  email: f.email.trim() || undefined,
  subject: f.subject.trim() || undefined,
  source: f.source.trim() || undefined,
});

function AddCandidate({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Candidate) => void }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", subject: "", source: "" });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title={t("hire.add")} width={560}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onCreated(await hiringApi.create({ ...contactBody(form), notes: notes.trim() || undefined }));
          } catch (err) {
            setError(errorText(err, t));
          } finally {
            setBusy(false);
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ fontSize: 12.5, color: "#686B75", lineHeight: 1.5 }}>{t("hire.addHint")}</div>
        <ContactFields form={form} set={(k, v) => setForm({ ...form, [k]: v })} />
        <label style={LBL}>
          {t("hire.f.notes")}
          <textarea className="field-input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("hire.f.notesHint")} maxLength={4000} />
        </label>
        {error && <div role="alert" style={{ color: "#B23A47", fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
        <button className="btn" type="submit" disabled={busy} style={{ background: ACCENT, color: "#fff", border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9, alignSelf: "flex-start" }}>
          {busy ? t("common.saving") : t("hire.addSubmit")}
        </button>
      </form>
    </Modal>
  );
}

// ---- The candidate's card: one step at a time ----

type Step = 0 | 1 | 2 | 3; // test, interview, demo lesson, decision
const STEP_KEYS: TranslationKey[] = ["hire.step.test", "hire.step.interview", "hire.step.demo", "hire.step.decision"];
const stepOf = (s: CandidateStage): Step => (s === "NEW" || s === "TEST" ? 0 : s === "INTERVIEW" ? 1 : s === "DEMO" ? 2 : 3);
// Where "next" leads from each step.
const NEXT_STAGE: Record<0 | 1 | 2, CandidateStage> = { 0: "INTERVIEW", 1: "DEMO", 2: "OFFER" };

function Stars({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  const { t } = useLanguage();
  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n}/5`}
          onClick={() => onChange(value === n ? null : n)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: "0 2px", color: value && n <= value ? "#F59E0B" : "#D9D7D0" }}
        >
          ★
        </button>
      ))}
      <span style={{ fontSize: 12.5, color: "#686B75", marginLeft: 6 }}>{value ? t(`hire.score.${value}` as TranslationKey) : t("hire.score.none")}</span>
    </div>
  );
}

// An ISO moment as the center-free pair the pickers show: "YYYY-MM-DD" and "HH:MM".
function splitWhen(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function WhenField({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const { t } = useLanguage();
  const { date, time } = splitWhen(value);
  const join = (d: string, tm: string) => (d ? new Date(`${d}T${tm || "10:00"}:00`).toISOString() : null);
  const times = time && !TIMES.includes(time) ? [...TIMES, time].sort() : TIMES;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 8 }}>
      <DatePicker value={date} onChange={(d) => onChange(join(d, time))} placeholder={t("hire.f.pickDate")} />
      <Select value={time} onChange={(tm) => onChange(join(date || new Date().toISOString().slice(0, 10), tm))} placeholder={t("hire.f.pickTime")} options={times.map((x) => ({ value: x, label: x }))} />
    </div>
  );
}

function CandidateModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const canHire = user?.role === "OWNER" || user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const [c, setC] = useState<CandidateDetail | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Partial<CandidateDetail>>({});
  const [editContact, setEditContact] = useState(false);
  const [contact, setContact] = useState({ fullName: "", phone: "", email: "", subject: "", source: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(
    (moveTo?: Step) => {
      hiringApi
        .get(id)
        .then((x) => {
          setC(x);
          setDraft({});
          setStep(moveTo ?? stepOf(x.stage));
          setContact({ fullName: x.fullName, phone: x.phone ?? "", email: x.email ?? "", subject: x.subject ?? "", source: x.source ?? "" });
        })
        .catch((e) => setError(errorText(e, t)));
    },
    [id, t],
  );
  useEffect(() => reload(), [reload]);

  if (!c) return null;
  const v = <K extends keyof CandidateDetail>(k: K) => (k in draft ? draft[k] : c[k]) as CandidateDetail[K];
  const put = <K extends keyof CandidateDetail>(k: K, value: CandidateDetail[K]) => setDraft({ ...draft, [k]: value });
  const closed = c.stage === "HIRED" || c.stage === "REJECTED";
  const reached = stepOf(c.stage);

  async function run(fn: () => Promise<unknown>, done: string, moveTo?: Step) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      onChanged();
      reload(moveTo);
      setNotice(done);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  // This step's fields (only what was changed), and the next stage when moving on.
  function stepBody(advance: boolean) {
    const body: Record<string, unknown> = {};
    const fields: Record<Step, (keyof CandidateDetail)[]> = {
      0: ["testPercent"],
      1: ["interviewAt", "interviewScore", "interviewNotes"],
      2: ["demoAt", "demoScore", "demoNotes"],
      3: ["decisionNote"],
    };
    for (const k of fields[step]) if (k in draft && draft[k] != null) body[k] = draft[k];
    for (const k of ["interviewNotes", "demoNotes", "decisionNote"] as const) if (k in draft && draft[k] == null) body[k] = "";
    if (step === 0 && c!.stage === "NEW" && body.testPercent != null) body.stage = "TEST";
    if (advance && step < 3) body.stage = NEXT_STAGE[step as 0 | 1 | 2];
    return body;
  }

  const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({ background: bg, color: fg, border: "none", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 });
  const dirty = Object.keys(draft).length > 0;

  return (
    <Modal open onClose={onClose} title={c.fullName} width={680}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="candidate-modal">
        {/* Who: one line, editable on demand. */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "#4A4E58" }}>
            <StageChip stage={c.stage} />
            {[c.phone, c.email, c.subject, c.source].filter(Boolean).join(" · ") || t("hire.noContact")}
          </div>
          <button type="button" className="btn" onClick={() => setEditContact(!editContact)} style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}>
            ✏️ {t("hire.editContact")}
          </button>
        </div>
        {editContact && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => hiringApi.update(id, { ...contactBody(contact), phone: phoneOrEmpty(contact.phone), email: contact.email.trim() }), t("hire.saved")).then(() => setEditContact(false));
            }}
            style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
          >
            <ContactFields form={contact} set={(k, val) => setContact({ ...contact, [k]: val })} />
            <button className="btn" type="submit" disabled={busy} style={{ ...btn(ACCENT), alignSelf: "flex-start" }}>{t("common.save")}</button>
          </form>
        )}

        {/* Where they are: four steps, the reached ones can be opened. */}
        <ol aria-label={t("hire.steps")} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {STEP_KEYS.map((key, i) => {
            const done = i < reached || c.stage === "HIRED";
            const open = i === step;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-current={open ? "step" : undefined}
                  onClick={() => setStep(i as Step)}
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    padding: "8px 4px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1.5px solid ${open ? ACCENT : "#EAE8E2"}`,
                    background: open ? "#EEF0FF" : "#fff",
                  }}
                >
                  <span style={{ width: 26, height: 26, borderRadius: 100, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800, background: done ? "#16794A" : open ? ACCENT : "#F2F1EC", color: done || open ? "#fff" : "#686B75" }}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: open ? ACCENT : "#4A4E58", textAlign: "center" }}>{t(key)}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* The open step. */}
        <section style={{ border: "1px solid #EAE8E2", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#686B75", lineHeight: 1.55 }}>{t(`hire.step.${["test", "interview", "demo", "decision"][step]}.hint` as TranslationKey)}</div>

          {step === 0 && (
            <>
              {c.attempts.map((a) => (
                <div key={a.id} style={{ fontSize: 13, background: "#F8F8FF", borderRadius: 8, padding: "8px 12px" }}>
                  🧭 <b>{a.testTitle}</b>: {a.percent}% ({a.correct}/{a.total}){a.reviewStatus === "PENDING" ? ` · ${t("hire.pendingReview")}` : ""} · {formatDateTime(a.createdAt, lang)}
                </div>
              ))}
              <label style={{ ...LBL, maxWidth: 220 }}>
                {t("hire.f.testPercent")}
                <input className="field-input" type="number" inputMode="numeric" min={0} max={100} value={v("testPercent") ?? ""} onChange={(e) => put("testPercent", e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))))} />
              </label>
            </>
          )}

          {(step === 1 || step === 2) && (
            <>
              <div style={LBL}>
                {t("hire.f.when")}
                <WhenField value={v(step === 1 ? "interviewAt" : "demoAt")} onChange={(iso) => put(step === 1 ? "interviewAt" : "demoAt", iso)} />
              </div>
              <div style={LBL}>
                {t("hire.f.score")}
                <Stars label={t("hire.f.score")} value={v(step === 1 ? "interviewScore" : "demoScore")} onChange={(n) => put(step === 1 ? "interviewScore" : "demoScore", n)} />
              </div>
              <label style={LBL}>
                {t("hire.f.notes")}
                <textarea
                  className="field-input"
                  rows={3}
                  maxLength={4000}
                  placeholder={t(step === 1 ? "hire.f.interviewNotesHint" : "hire.f.demoNotesHint")}
                  value={v(step === 1 ? "interviewNotes" : "demoNotes") ?? ""}
                  onChange={(e) => put(step === 1 ? "interviewNotes" : "demoNotes", e.target.value)}
                />
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, fontSize: 13 }}>
                <div style={{ background: "#F8F8FF", borderRadius: 8, padding: "8px 12px" }}>{t("hire.step.test")}: <b>{c.testPercent == null ? "—" : `${c.testPercent}%`}</b></div>
                <div style={{ background: "#F8F8FF", borderRadius: 8, padding: "8px 12px" }}>{t("hire.step.interview")}: <b style={{ color: "#B45309" }}>{score(c.interviewScore)}</b></div>
                <div style={{ background: "#F8F8FF", borderRadius: 8, padding: "8px 12px" }}>{t("hire.step.demo")}: <b style={{ color: "#B45309" }}>{score(c.demoScore)}</b></div>
              </div>
              <label style={LBL}>
                {t("hire.f.decisionNote")}
                <textarea className="field-input" rows={3} maxLength={4000} value={v("decisionNote") ?? ""} onChange={(e) => put("decisionNote", e.target.value)} />
              </label>
              {c.stage === "HIRED" && c.teacherId && (
                <div role="status" style={{ background: "#E9F8EF", color: "#16794A", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>
                  ✅ {t("hire.isTeacher")} <Link href={`/teachers/${c.teacherId}`} style={{ color: "#16794A", textDecoration: "underline" }}>{t("hire.openTeacher")} →</Link>
                </div>
              )}
              {c.stage === "REJECTED" && <div role="status" style={{ background: "#FDEBEC", color: "#B23A47", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{t("hire.isRejected")}</div>}
            </>
          )}

          {error && <div role="alert" style={{ color: "#B23A47", fontSize: 13, fontWeight: 600 }}>{error}</div>}
          {notice && <div role="status" style={{ color: "#16794A", fontSize: 13, fontWeight: 600 }}>{notice}</div>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(dirty || step === 3) && c.stage !== "HIRED" && (
              <button type="button" className="btn" disabled={busy || !dirty} onClick={() => run(() => hiringApi.update(id, stepBody(false)), t("hire.saved"), step)} style={btn(dirty ? ACCENT : "#C7C9D1")}>
                {busy ? t("common.saving") : t("common.save")}
              </button>
            )}
            {step < 3 && !closed && (
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => hiringApi.update(id, stepBody(true)), t("hire.moved"))} style={btn("#16794A")}>
                {t("hire.next").replace("{step}", t(STEP_KEYS[step + 1]))} →
              </button>
            )}
            {step === 3 && !closed && canHire && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("hire.confirmHire").replace("{name}", c.fullName))) {
                    void run(async () => {
                      if (dirty) await hiringApi.update(id, stepBody(false));
                      await hiringApi.hire(id);
                    }, t("hire.hiredNotice"));
                  }
                }}
                style={btn("#16794A")}
              >
                👩‍🏫 {t("hire.makeTeacher")}
              </button>
            )}
            {step === 3 && !closed && (
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => hiringApi.update(id, { ...stepBody(false), stage: "REJECTED" }), t("hire.saved"))} style={btn("#FDEBEC", "#B23A47")}>
                ✕ {t("hire.reject")}
              </button>
            )}
            {c.stage === "REJECTED" && (
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => hiringApi.update(id, { stage: "DEMO" }), t("hire.saved"))} style={btn("#F2F1EC", "#181A1F")}>
                ↺ {t("hire.reopen")}
              </button>
            )}
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#686B75" }}>
            {c.history.map((h, i) => (
              <span key={i}>{i > 0 && " → "}{t(stageKey(h.stage))} ({formatDate(h.at, lang)})</span>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("hire.confirmArchive"))) {
                void hiringApi.archive(id).then(() => {
                  onChanged();
                  onClose();
                }).catch((e) => setError(errorText(e, t)));
              }
            }}
            style={{ background: "transparent", color: "#B23A47", border: "none", fontSize: 12.5, fontWeight: 700, padding: "6px 8px" }}
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
