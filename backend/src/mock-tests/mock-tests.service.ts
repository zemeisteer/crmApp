import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { enrollments, mockAttempts, mockTests, students, tenants } from '../db/schema';
import { AiService } from '../ai/ai.service';
import {
  normalizeContent,
  overallBand,
  publicContent,
  scoreObjective,
  sectionQuestions,
  SECTIONS,
  wordCount,
  writingBand,
  roundBand,
  type MockContent,
  type Section,
} from './ielts';
import { parseExaminerReply, speakingPrompt, writingPrompt, type ExaminerFeedback } from './examiner-prompts';
import { SAMPLE_IELTS } from './sample-test';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// Answers per section: Listening/Reading { "0": "B", ... }; Writing
// { "0": text, "1": text }; Speaking { "p.q": { audio, transcript, seconds } }.
export interface SpeakingAnswer { audio: string | null; transcript: string; seconds: number | null }
export interface Answers {
  listening?: Record<string, string>;
  reading?: Record<string, string>;
  writing?: Record<string, string>;
  speaking?: Record<string, SpeakingAnswer>;
}

// Results per section. `status`: DONE (band set), PENDING (AI is marking),
// REVIEW (waiting for the teacher: no AI, or the AI failed).
export interface SectionResult {
  status: 'DONE' | 'PENDING' | 'REVIEW';
  band: number | null;
  raw?: number;
  max?: number;
  marks?: boolean[];
  tasks?: Array<{ band: number | null; words: number; feedback: ExaminerFeedback | null }>;
  feedback?: ExaminerFeedback | null;
  teacherComment?: string | null;
  gradedBy?: 'AUTO' | 'AI' | 'TEACHER';
  late?: boolean;
}
export type Results = Partial<Record<Section, SectionResult>> & { overall?: number | null };

// Grace after a section's time runs out (slow network, the auto-submit).
const GRACE_MS = 3 * 60_000;
const MAX_TEXT = 20_000;

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const isEnglish = (s: string) => /ingliz|english|ielts|cefr|англ/i.test(s);
const sameDirection = (a: string, b: string) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return !!x && !!y && (x.includes(y) || y.includes(x) || (isEnglish(x) && isEnglish(y)));
};

@Injectable()
export class MockTestsService {
  private readonly logger = new Logger(MockTestsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
  ) {}

  // ---------------------------------------------------------------- staff

  async list(tenantId: string) {
    const rows = await this.db.select().from(mockTests).where(eq(mockTests.tenantId, tenantId)).orderBy(desc(mockTests.createdAt));
    const counts = rows.length === 0 ? [] : await this.db.select({ testId: mockAttempts.testId, n: count() }).from(mockAttempts)
      .where(inArray(mockAttempts.testId, rows.map((r) => r.id))).groupBy(mockAttempts.testId);
    return rows.map(({ content, ...r }) => {
      const c = normalizeContent(parse(content, {}));
      return {
        ...r,
        attempts: Number(counts.find((x) => x.testId === r.id)?.n ?? 0),
        summary: {
          listening: sectionQuestions(c, 'listening').length,
          reading: sectionQuestions(c, 'reading').length,
          writing: c.writing.tasks.length,
          speaking: c.speaking.parts.reduce((s, p) => s + p.questions.length, 0),
        },
      };
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.row(tenantId, id);
    return { ...row, content: normalizeContent(parse(row.content, {})) };
  }

  async create(tenantId: string, dto: { title?: string; subject?: string; sample?: boolean; content?: unknown }) {
    const content = normalizeContent(dto.sample ? SAMPLE_IELTS.content : dto.content ?? {});
    const title = dto.title?.trim() || (dto.sample ? SAMPLE_IELTS.title : 'IELTS mock test');
    const [row] = await this.db.insert(mockTests).values({
      tenantId, title: title.slice(0, 200), subject: dto.subject?.trim().slice(0, 120) || 'Ingliz tili', content: JSON.stringify(content),
    }).returning();
    return { ...row, content };
  }

  async update(tenantId: string, id: string, dto: { title?: string; subject?: string; status?: string; content?: unknown }) {
    await this.row(tenantId, id);
    const set: Partial<typeof mockTests.$inferInsert> = { updatedAt: new Date() };
    if (dto.title !== undefined) {
      if (!dto.title.trim()) throw new BadRequestException('Nom kiriting');
      set.title = dto.title.trim().slice(0, 200);
    }
    if (dto.subject !== undefined) set.subject = dto.subject.trim().slice(0, 120) || 'Ingliz tili';
    if (dto.content !== undefined) set.content = JSON.stringify(normalizeContent(dto.content));
    if (dto.status !== undefined) {
      if (!['DRAFT', 'PUBLISHED'].includes(dto.status)) throw new BadRequestException("Holat noto'g'ri");
      if (dto.status === 'PUBLISHED') {
        const c = normalizeContent(dto.content ?? parse((await this.row(tenantId, id)).content, {}));
        const empty = sectionQuestions(c, 'listening').length + sectionQuestions(c, 'reading').length + c.writing.tasks.length + c.speaking.parts.length === 0;
        if (empty) throw new BadRequestException("Bo'sh testni e'lon qilib bo'lmaydi");
      }
      set.status = dto.status;
    }
    const [row] = await this.db.update(mockTests).set(set).where(and(eq(mockTests.id, id), eq(mockTests.tenantId, tenantId))).returning();
    return { ...row, content: normalizeContent(parse(row.content, {})) };
  }

  async remove(tenantId: string, id: string) {
    await this.row(tenantId, id);
    await this.db.delete(mockTests).where(and(eq(mockTests.id, id), eq(mockTests.tenantId, tenantId)));
    return { success: true };
  }

  async attempts(tenantId: string, testId: string) {
    await this.row(tenantId, testId);
    const rows = await this.db.select({
      id: mockAttempts.id, status: mockAttempts.status, results: mockAttempts.results, sectionDone: mockAttempts.sectionDone,
      createdAt: mockAttempts.createdAt, completedAt: mockAttempts.completedAt, studentId: students.id, studentName: students.fullName,
    }).from(mockAttempts).innerJoin(students, eq(students.id, mockAttempts.studentId))
      .where(and(eq(mockAttempts.tenantId, tenantId), eq(mockAttempts.testId, testId)))
      .orderBy(desc(mockAttempts.createdAt));
    return rows.map((r) => ({ ...r, results: parse<Results>(r.results, {}), sectionDone: parse<Record<string, string>>(r.sectionDone, {}) }));
  }

  // Everything a teacher needs to review one sitting.
  async attemptDetail(tenantId: string, attemptId: string) {
    const [a] = await this.db.select().from(mockAttempts).where(and(eq(mockAttempts.id, attemptId), eq(mockAttempts.tenantId, tenantId)));
    if (!a) throw new NotFoundException('Urinish topilmadi');
    const test = await this.get(tenantId, a.testId);
    const [student] = await this.db.select({ id: students.id, fullName: students.fullName }).from(students).where(eq(students.id, a.studentId));
    return {
      id: a.id, status: a.status, student, test,
      answers: parse<Answers>(a.answers, {}), results: parse<Results>(a.results, {}),
      sectionDone: parse<Record<string, string>>(a.sectionDone, {}), createdAt: a.createdAt, completedAt: a.completedAt,
    };
  }

  // The teacher sets (or corrects) the Writing/Speaking band.
  async review(tenantId: string, attemptId: string, dto: { section: 'writing' | 'speaking'; band: number; comment?: string; task1?: number; task2?: number }) {
    if (!['writing', 'speaking'].includes(dto.section)) throw new BadRequestException("Bo'lim noto'g'ri");
    const valid = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 9 && Number.isFinite(n);
    if (!valid(dto.band)) throw new BadRequestException("Band 0-9 oralig'ida bo'lsin");
    return this.mutate(attemptId, tenantId, null, (a) => {
      const results = parse<Results>(a.results, {});
      const prev = results[dto.section] ?? { status: 'REVIEW', band: null };
      const tasks = dto.section === 'writing' && prev.tasks
        ? prev.tasks.map((t, i) => ({ ...t, band: [dto.task1, dto.task2][i] !== undefined && valid([dto.task1, dto.task2][i]) ? roundBand([dto.task1, dto.task2][i]!) : t.band }))
        : prev.tasks;
      results[dto.section] = { ...prev, tasks, status: 'DONE', band: roundBand(dto.band), gradedBy: 'TEACHER', teacherComment: dto.comment?.trim().slice(0, 2000) || prev.teacherComment || null };
      results.overall = overallBand(Object.fromEntries(SECTIONS.map((s) => [s, results[s]?.band ?? null])));
      return { results };
    });
  }

  // Runs the AI examiner again for a section waiting for review.
  async regrade(tenantId: string, attemptId: string, section: 'writing' | 'speaking') {
    const [a] = await this.db.select().from(mockAttempts).where(and(eq(mockAttempts.id, attemptId), eq(mockAttempts.tenantId, tenantId)));
    if (!a) throw new NotFoundException('Urinish topilmadi');
    if (!(await this.aiAvailable(tenantId))) throw new ConflictException({ code: 'AI_OFF', message: 'AI baholash markazda yoqilmagan' });
    await this.gradeWithAi(a.id, section);
    return this.attemptDetail(tenantId, attemptId);
  }

  // --------------------------------------------------------------- portal

  // AI marking needs an AI key on the server and the student AI switched on
  // by the center (a daily limit above 0).
  async aiAvailable(tenantId: string) {
    if (!this.ai.isConfigured) return false;
    const [t] = await this.db.select({ limit: tenants.studentAiDailyLimit }).from(tenants).where(eq(tenants.id, tenantId));
    return (t?.limit ?? 0) > 0;
  }

  // The practice area: the student's directions (their groups' subjects),
  // each with the published mock tests for it and the student's sittings.
  async forStudent(studentId: string, tenantId: string) {
    const enrolls = await this.db.query.enrollments.findMany({ where: eq(enrollments.studentId, studentId), with: { group: true } });
    const subjects = [...new Set(enrolls.filter((e) => e.group?.tenantId === tenantId && !e.group.deletedAt && e.status === 'ACTIVE').map((e) => e.group.subject.trim()).filter(Boolean))];
    const tests = await this.db.select({ id: mockTests.id, title: mockTests.title, kind: mockTests.kind, subject: mockTests.subject, content: mockTests.content })
      .from(mockTests).where(and(eq(mockTests.tenantId, tenantId), eq(mockTests.status, 'PUBLISHED'))).orderBy(desc(mockTests.createdAt));
    const mine = tests.length === 0 ? [] : await this.db.select().from(mockAttempts)
      .where(and(eq(mockAttempts.studentId, studentId), inArray(mockAttempts.testId, tests.map((t) => t.id)))).orderBy(desc(mockAttempts.createdAt));
    const view = (t: (typeof tests)[number]) => {
      const c = normalizeContent(parse(t.content, {}));
      return {
        id: t.id, title: t.title, kind: t.kind, subject: t.subject,
        sections: { listening: sectionQuestions(c, 'listening').length, reading: sectionQuestions(c, 'reading').length, writing: c.writing.tasks.length, speaking: c.speaking.parts.length },
        durations: { listening: c.listening.durationMin, reading: c.reading.durationMin, writing: c.writing.durationMin },
        attempts: mine.filter((a) => a.testId === t.id).map((a) => ({
          id: a.id, status: a.status, createdAt: a.createdAt, completedAt: a.completedAt,
          sectionDone: parse<Record<string, string>>(a.sectionDone, {}), results: this.studentResults(parse<Results>(a.results, {})),
        })),
      };
    };
    const directions = subjects.map((subject) => ({ subject, english: isEnglish(subject), tests: tests.filter((t) => sameDirection(t.subject, subject)).map(view) }));
    return { directions, aiFeedback: await this.aiAvailable(tenantId) };
  }

  // Opens the unfinished sitting of this test, or starts a new one.
  async start(studentId: string, tenantId: string, testId: string) {
    const [test] = await this.db.select().from(mockTests)
      .where(and(eq(mockTests.id, testId), eq(mockTests.tenantId, tenantId), eq(mockTests.status, 'PUBLISHED')));
    if (!test) throw new NotFoundException('Test topilmadi');
    const [open] = await this.db.select({ id: mockAttempts.id }).from(mockAttempts)
      .where(and(eq(mockAttempts.testId, testId), eq(mockAttempts.studentId, studentId), eq(mockAttempts.status, 'IN_PROGRESS')));
    if (open) return this.attemptForStudent(studentId, tenantId, open.id);
    const [row] = await this.db.insert(mockAttempts).values({ tenantId, testId, studentId }).returning();
    return this.attemptForStudent(studentId, tenantId, row.id);
  }

  async attemptForStudent(studentId: string, tenantId: string, attemptId: string) {
    const a = await this.ownAttempt(studentId, tenantId, attemptId);
    const [test] = await this.db.select().from(mockTests).where(eq(mockTests.id, a.testId));
    const content = normalizeContent(parse(test.content, {}));
    const done = parse<Record<string, string>>(a.sectionDone, {});
    // Keys are shown only for finished Listening/Reading (to learn from).
    const keys: Partial<Record<'listening' | 'reading', string[]>> = {};
    for (const s of ['listening', 'reading'] as const) {
      if (done[s]) keys[s] = sectionQuestions(content, s).map((q) => (q.type === 'MATCHING' ? (q.pairs ?? []).map((p) => `${p.left} → ${p.right}`).join('; ') : q.options?.find((o) => o.id === q.correctAnswer)?.text ?? q.correctAnswer.split('|')[0]));
    }
    return {
      id: a.id,
      status: a.status,
      test: { id: test.id, title: test.title, kind: test.kind, subject: test.subject, content: publicContent(content) },
      answers: parse<Answers>(a.answers, {}),
      sectionStarted: parse<Record<string, string>>(a.sectionStarted, {}),
      sectionDone: done,
      results: this.studentResults(parse<Results>(a.results, {})),
      keys,
      serverNow: new Date().toISOString(),
      aiFeedback: await this.aiAvailable(tenantId),
    };
  }

  // Starts a section's clock (once).
  async startSection(studentId: string, tenantId: string, attemptId: string, section: Section) {
    this.assertSection(section);
    await this.mutate(attemptId, tenantId, studentId, (a) => {
      const done = parse<Record<string, string>>(a.sectionDone, {});
      if (done[section]) throw new ConflictException({ code: 'SECTION_DONE', message: "Bu bo'lim topshirilgan" });
      const started = parse<Record<string, string>>(a.sectionStarted, {});
      if (started[section]) return null;
      started[section] = new Date().toISOString();
      return { sectionStarted: started };
    });
    return this.attemptForStudent(studentId, tenantId, attemptId);
  }

  // Autosave while the student works; the last save wins.
  async saveAnswers(studentId: string, tenantId: string, attemptId: string, section: Section, answers: unknown) {
    this.assertSection(section);
    if (section === 'speaking') throw new BadRequestException('Speaking javoblari ovoz bilan yuboriladi');
    await this.mutate(attemptId, tenantId, studentId, (a) => {
      if (parse<Record<string, string>>(a.sectionDone, {})[section]) throw new ConflictException({ code: 'SECTION_DONE', message: "Bu bo'lim topshirilgan" });
      const all = parse<Answers>(a.answers, {});
      (all as Record<string, unknown>)[section] = this.cleanTextAnswers(answers);
      return { answers: all };
    });
    return { saved: true };
  }

  // One recorded Speaking answer (audio file and/or the browser transcript).
  async saveSpeaking(studentId: string, tenantId: string, attemptId: string, key: string, data: { audio?: string; transcript?: string; seconds?: number }) {
    if (!/^\d{1,2}\.\d{1,2}$/.test(key)) throw new BadRequestException("Savol raqami noto'g'ri");
    await this.mutate(attemptId, tenantId, studentId, (a) => {
      if (parse<Record<string, string>>(a.sectionDone, {}).speaking) throw new ConflictException({ code: 'SECTION_DONE', message: "Bu bo'lim topshirilgan" });
      const all = parse<Answers>(a.answers, {});
      const prev = all.speaking?.[key];
      all.speaking = {
        ...(all.speaking ?? {}),
        [key]: {
          audio: data.audio ?? prev?.audio ?? null,
          transcript: (data.transcript ?? prev?.transcript ?? '').trim().slice(0, 5000),
          seconds: Number.isFinite(data.seconds) ? Math.max(0, Math.min(600, Math.round(data.seconds!))) : prev?.seconds ?? null,
        },
      };
      return { answers: all };
    });
    return { saved: true };
  }

  // Hands in a section: Listening/Reading are scored at once, Writing and
  // Speaking go to the AI examiner (or wait for the teacher).
  async submitSection(studentId: string, tenantId: string, attemptId: string, section: Section, answers?: unknown) {
    this.assertSection(section);
    const aiOn = await this.aiAvailable(tenantId);
    await this.mutate(attemptId, tenantId, studentId, async (a, tx) => {
      const done = parse<Record<string, string>>(a.sectionDone, {});
      if (done[section]) throw new ConflictException({ code: 'SECTION_DONE', message: "Bu bo'lim topshirilgan" });
      const all = parse<Answers>(a.answers, {});
      if (answers !== undefined && section !== 'speaking') (all as Record<string, unknown>)[section] = this.cleanTextAnswers(answers);
      const [test] = await tx.select().from(mockTests).where(eq(mockTests.id, a.testId));
      const content = normalizeContent(parse(test.content, {}));
      const started = parse<Record<string, string>>(a.sectionStarted, {});
      const minutes = section === 'speaking' ? null : content[section].durationMin;
      const late = !!(minutes && started[section] && Date.now() > Date.parse(started[section]) + minutes * 60_000 + GRACE_MS);

      const results = parse<Results>(a.results, {});
      if (section === 'listening' || section === 'reading') {
        const r = scoreObjective(content, section, all[section] ?? {});
        results[section] = { status: 'DONE', band: r.band, raw: r.raw, max: r.max, marks: r.marks, gradedBy: 'AUTO', late };
      } else if (section === 'writing') {
        const tasks = content.writing.tasks.map((_, i) => ({ band: null, words: wordCount(all.writing?.[String(i)] ?? ''), feedback: null }));
        results.writing = { status: aiOn ? 'PENDING' : 'REVIEW', band: null, tasks, late };
      } else {
        results.speaking = { status: aiOn ? 'PENDING' : 'REVIEW', band: null, late };
      }
      done[section] = new Date().toISOString();
      const finished = SECTIONS.every((s) => done[s]);
      results.overall = overallBand(Object.fromEntries(SECTIONS.map((s) => [s, results[s]?.band ?? null])));
      return { answers: all, sectionDone: done, results, ...(finished ? { status: 'COMPLETED', completedAt: new Date() } : {}) };
    });
    if (aiOn && (section === 'writing' || section === 'speaking')) {
      // Marking takes a while; the page polls for the result.
      void this.gradeWithAi(attemptId, section).catch((err) => this.logger.error(`mock AI grading failed: ${(err as Error).message}`));
    }
    return this.attemptForStudent(studentId, tenantId, attemptId);
  }

  // ------------------------------------------------------------ AI marking

  async gradeWithAi(attemptId: string, section: 'writing' | 'speaking') {
    const [a] = await this.db.select().from(mockAttempts).where(eq(mockAttempts.id, attemptId));
    if (!a) return;
    const [test] = await this.db.select().from(mockTests).where(eq(mockTests.id, a.testId));
    const content = normalizeContent(parse(test.content, {}));
    const answers = parse<Answers>(a.answers, {});
    let result: SectionResult;
    try {
      result = section === 'writing' ? await this.aiWriting(content, answers) : await this.aiSpeaking(content, answers);
    } catch (err) {
      this.logger.warn(`AI examiner failed (${section}): ${(err as Error).message}`);
      result = { status: 'REVIEW', band: null };
    }
    await this.mutate(attemptId, a.tenantId, null, (row) => {
      const results = parse<Results>(row.results, {});
      // A teacher's mark is never overwritten by the AI.
      if (results[section]?.gradedBy === 'TEACHER') return null;
      results[section] = { ...results[section], ...result, late: results[section]?.late };
      results.overall = overallBand(Object.fromEntries(SECTIONS.map((s) => [s, results[s]?.band ?? null])));
      return { results };
    });
  }

  private async aiWriting(content: MockContent, answers: Answers): Promise<SectionResult> {
    const tasks: NonNullable<SectionResult['tasks']> = [];
    for (let i = 0; i < content.writing.tasks.length; i++) {
      const task = content.writing.tasks[i];
      const text = (answers.writing?.[String(i)] ?? '').trim();
      const words = wordCount(text);
      if (words < 20) {
        // Too little to mark: band 0-2 without asking the AI.
        tasks.push({ band: words === 0 ? 0 : 1, words, feedback: null });
        continue;
      }
      const reply = await this.ai.completeText(writingPrompt({ task: i === 0 ? 1 : 2, prompt: task.prompt, answer: text, minWords: task.minWords, words }), 1800);
      const fb = parseExaminerReply(reply, ['TR', 'CC', 'LR', 'GRA']);
      if (!fb) throw new Error('unreadable writing feedback');
      tasks.push({ band: fb.band, words, feedback: fb });
    }
    const band = content.writing.tasks.length === 2 ? writingBand(tasks[0]?.band ?? null, tasks[1]?.band ?? null) : tasks[0]?.band != null ? roundBand(tasks[0].band) : null;
    return { status: band == null ? 'REVIEW' : 'DONE', band, tasks, gradedBy: 'AI' };
  }

  private async aiSpeaking(content: MockContent, answers: Answers): Promise<SectionResult> {
    const parts = content.speaking.parts.map((p, pi) => ({
      title: p.title,
      items: p.questions.map((q, qi) => {
        const ans = answers.speaking?.[`${pi}.${qi}`];
        return { question: q, transcript: ans?.transcript ?? '', seconds: ans?.seconds ?? null };
      }),
    }));
    const spoken = parts.flatMap((p) => p.items).map((i) => i.transcript).join(' ');
    // No transcript (browser without speech recognition): the teacher listens.
    if (wordCount(spoken) < 15) return { status: 'REVIEW', band: null, feedback: null };
    const reply = await this.ai.completeText(speakingPrompt({ parts }), 1500);
    const fb = parseExaminerReply(reply, ['FC', 'LR', 'GRA']);
    if (!fb) throw new Error('unreadable speaking feedback');
    return { status: 'DONE', band: fb.band, feedback: fb, gradedBy: 'AI' };
  }

  // -------------------------------------------------------------- helpers

  private async row(tenantId: string, id: string) {
    const [row] = await this.db.select().from(mockTests).where(and(eq(mockTests.id, id), eq(mockTests.tenantId, tenantId)));
    if (!row) throw new NotFoundException('Test topilmadi');
    return row;
  }

  private async ownAttempt(studentId: string, tenantId: string, attemptId: string) {
    const [a] = await this.db.select().from(mockAttempts)
      .where(and(eq(mockAttempts.id, attemptId), eq(mockAttempts.tenantId, tenantId), eq(mockAttempts.studentId, studentId)));
    if (!a) throw new NotFoundException('Urinish topilmadi');
    return a;
  }

  private assertSection(section: string): asserts section is Section {
    if (!(SECTIONS as readonly string[]).includes(section)) throw new BadRequestException("Bo'lim noto'g'ri");
  }

  // { "0": "B", ... } with short string values only.
  private cleanTextAnswers(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 100)) {
      if (!/^\d{1,3}$/.test(k)) continue;
      if (typeof v === 'string') out[k] = v.slice(0, MAX_TEXT);
    }
    return out;
  }

  // What the student sees of the results: no hidden fields to strip today,
  // but kept in one place for when there are.
  private studentResults(r: Results) {
    return r;
  }

  // Read-modify-write of one attempt under a row lock, so autosaves, section
  // submits and the AI examiner never overwrite each other. `studentId`
  // (when given) must own the attempt. The callback returns the columns to
  // change, or null to change nothing.
  private async mutate(
    attemptId: string,
    tenantId: string,
    studentId: string | null,
    fn: (a: typeof mockAttempts.$inferSelect, tx: Tx) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null,
  ) {
    return this.db.transaction(async (tx) => {
      const [a] = await tx.select().from(mockAttempts)
        .where(and(eq(mockAttempts.id, attemptId), eq(mockAttempts.tenantId, tenantId), ...(studentId ? [eq(mockAttempts.studentId, studentId)] : [])))
        .for('update');
      if (!a) throw new NotFoundException('Urinish topilmadi');
      const change = await fn(a, tx);
      if (!change) return a;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(change)) set[k] = typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v;
      const [row] = await tx.update(mockAttempts).set(set).where(eq(mockAttempts.id, attemptId)).returning();
      return row;
    });
  }
}
