import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { aiUsage, enrollments, mockAttempts, mockTests, students, tenants } from '../db/schema';
import { AiService } from '../ai/ai.service';
import {
  bandToLevel,
  isLevel,
  LEVELS,
  levelOpen,
  missingKeys,
  parseLevel,
  type Level,
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
import {
  normalizePractice,
  PRACTICE_KIND,
  practiceIsEmpty,
  practiceKeys,
  practiceMissingKeys,
  practiceOverall,
  practiceTemplate,
  publicPractice,
  scorePracticeSection,
  sectionIndex,
  sectionKeyOf,
  sectionQuestionsOf,
  TASK_POINTS,
  templateFor,
  type PracticeContent,
  type PracticeSectionResult,
  type PracticeTaskResult,
} from './practice';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';

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
  // TRANSCRIPT: an AI Speaking band worked out from the speech-to-text
  // transcript alone - an estimate without pronunciation, not an exam band.
  basis?: 'TRANSCRIPT';
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
const isPractice = (kind: string | null | undefined) => kind === PRACTICE_KIND;
// Content of a test in its own format.
const contentOf = (kind: string | null | undefined, raw: string | null | undefined) =>
  isPractice(kind) ? normalizePractice(parse(raw, {})) : normalizeContent(parse(raw, {}));
// Practice tests the AI makes for one student per day.
const STUDENT_PRACTICE_PER_DAY = 5;
const PRACTICE_USAGE = 'PRACTICE';
type PracticeResults = Record<string, PracticeSectionResult | number | null | undefined> & { overallPercent?: number | null };
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
    // Tests the AI made for one student stay out of the staff list.
    const rows = await this.db.select().from(mockTests).where(and(eq(mockTests.tenantId, tenantId), isNull(mockTests.ownerStudentId))).orderBy(desc(mockTests.createdAt));
    const counts = rows.length === 0 ? [] : await this.db.select({ testId: mockAttempts.testId, n: count() }).from(mockAttempts)
      .where(inArray(mockAttempts.testId, rows.map((r) => r.id))).groupBy(mockAttempts.testId);
    return rows.map(({ content, ...r }) => {
      const attempts = Number(counts.find((x) => x.testId === r.id)?.n ?? 0);
      if (isPractice(r.kind)) {
        const pc = normalizePractice(parse(content, {}));
        return {
          ...r,
          attempts,
          summary: {
            sections: pc.sections.length,
            questions: pc.sections.reduce((n, x) => n + sectionQuestionsOf(x).length, 0),
            tasks: pc.sections.reduce((n, x) => n + x.tasks.length, 0),
          },
        };
      }
      const c = normalizeContent(parse(content, {}));
      return {
        ...r,
        attempts,
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
    return { ...row, content: contentOf(row.kind, row.content) };
  }

  async create(tenantId: string, dto: { title?: string; subject?: string; sample?: boolean; content?: unknown; level?: string | null; module?: string; kind?: string; template?: string }) {
    if (isPractice(dto.kind)) {
      const subject = dto.subject?.trim().slice(0, 120) || 'Umumiy';
      const tpl = practiceTemplate(dto.template ?? templateFor(subject));
      const content = dto.content !== undefined ? normalizePractice(dto.content) : tpl.content;
      const [row] = await this.db.insert(mockTests).values({
        tenantId, kind: PRACTICE_KIND, title: (dto.title?.trim() || tpl.title).slice(0, 200), subject, content: JSON.stringify(content),
      }).returning();
      return { ...row, content };
    }
    const content = normalizeContent(dto.sample ? SAMPLE_IELTS.content : dto.content ?? {});
    const title = dto.title?.trim() || (dto.sample ? SAMPLE_IELTS.title : 'IELTS mock test');
    const [row] = await this.db.insert(mockTests).values({
      tenantId, title: title.slice(0, 200), subject: dto.subject?.trim().slice(0, 120) || 'Ingliz tili', content: JSON.stringify(content),
      level: isLevel(dto.level) ? dto.level : null, module: dto.module === 'GENERAL' ? 'GENERAL' : 'ACADEMIC',
    }).returning();
    return { ...row, content };
  }

  async update(tenantId: string, id: string, dto: { title?: string; subject?: string; status?: string; content?: unknown; level?: string | null; module?: string }) {
    await this.row(tenantId, id);
    const set: Partial<typeof mockTests.$inferInsert> = { updatedAt: new Date() };
    if (dto.title !== undefined) {
      if (!dto.title.trim()) throw new BadRequestException('Nom kiriting');
      set.title = dto.title.trim().slice(0, 200);
    }
    if (dto.subject !== undefined) set.subject = dto.subject.trim().slice(0, 120) || 'Ingliz tili';
    const current = await this.row(tenantId, id);
    if (isPractice(current.kind)) {
      if (dto.content !== undefined) set.content = JSON.stringify(normalizePractice(dto.content));
      if (dto.status !== undefined) {
        if (!['DRAFT', 'PUBLISHED'].includes(dto.status)) throw new BadRequestException("Holat noto'g'ri");
        if (dto.status === 'PUBLISHED') {
          const c = normalizePractice(dto.content ?? parse(current.content, {}));
          if (practiceIsEmpty(c)) throw new BadRequestException("Bo'sh testni e'lon qilib bo'lmaydi");
          const missing = practiceMissingKeys(c);
          if (missing > 0) throw new BadRequestException(`${missing} ta savolning javob kaliti yo'q — avval kiriting`);
        }
        set.status = dto.status;
      }
      const [row] = await this.db.update(mockTests).set(set).where(and(eq(mockTests.id, id), eq(mockTests.tenantId, tenantId))).returning();
      return { ...row, content: normalizePractice(parse(row.content, {})) };
    }
    if (dto.level !== undefined) set.level = isLevel(dto.level) ? dto.level : null;
    if (dto.module !== undefined) set.module = dto.module === 'GENERAL' ? 'GENERAL' : 'ACADEMIC';
    if (dto.content !== undefined) set.content = JSON.stringify(normalizeContent(dto.content));
    if (dto.status !== undefined) {
      if (!['DRAFT', 'PUBLISHED'].includes(dto.status)) throw new BadRequestException("Holat noto'g'ri");
      if (dto.status === 'PUBLISHED') {
        const c = normalizeContent(dto.content ?? parse(current.content, {}));
        const empty = sectionQuestions(c, 'listening').length + sectionQuestions(c, 'reading').length + c.writing.tasks.length + c.speaking.parts.length === 0;
        if (empty) throw new BadRequestException("Bo'sh testni e'lon qilib bo'lmaydi");
        const missing = missingKeys(c);
        if (missing > 0) throw new BadRequestException(`${missing} ta savolning javob kaliti yo'q — avval kiriting`);
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
    const [att] = await this.db.select({ testId: mockAttempts.testId }).from(mockAttempts).where(and(eq(mockAttempts.id, attemptId), eq(mockAttempts.tenantId, tenantId)));
    if (att && isPractice((await this.row(tenantId, att.testId)).kind)) throw new BadRequestException("Bu mashq testi — topshiriqlarga ball qo'ying");
    return this.mutate(attemptId, tenantId, null, (a) => {
      const results = parse<Results>(a.results, {});
      const prev = results[dto.section] ?? { status: 'REVIEW', band: null };
      const tasks = dto.section === 'writing' && prev.tasks
        ? prev.tasks.map((t, i) => ({ ...t, band: [dto.task1, dto.task2][i] !== undefined && valid([dto.task1, dto.task2][i]) ? roundBand([dto.task1, dto.task2][i]!) : t.band }))
        : prev.tasks;
      // The teacher's band replaces the AI's transcript-only estimate.
      results[dto.section] = { ...prev, basis: undefined, tasks, status: 'DONE', band: roundBand(dto.band), gradedBy: 'TEACHER', teacherComment: dto.comment?.trim().slice(0, 2000) || prev.teacherComment || null };
      results.overall = overallBand(Object.fromEntries(SECTIONS.map((s) => [s, results[s]?.band ?? null])));
      return { results };
    });
  }

  // The teacher scores a practice section's writing tasks (0-10 each).
  async reviewPractice(tenantId: string, attemptId: string, dto: { section: string; scores: number[]; comment?: string }) {
    const [a] = await this.db.select({ testId: mockAttempts.testId }).from(mockAttempts).where(and(eq(mockAttempts.id, attemptId), eq(mockAttempts.tenantId, tenantId)));
    if (!a) throw new NotFoundException('Urinish topilmadi');
    const test = await this.row(tenantId, a.testId);
    if (!isPractice(test.kind)) throw new BadRequestException("Bu IELTS test — band qo'ying");
    const content = normalizePractice(parse(test.content, {}));
    const si = sectionIndex(dto.section, content);
    if (si === null) throw new BadRequestException("Bo'lim noto'g'ri");
    const section = content.sections[si];
    await this.mutate(attemptId, tenantId, null, (row) => {
      const answers = parse<Record<string, Record<string, string>>>(row.answers, {});
      const results = parse<PracticeResults>(row.results, {});
      const prev = results[dto.section] as PracticeSectionResult | undefined;
      const tasks: PracticeTaskResult[] = section.tasks.map((_, i) => {
        const given = dto.scores[i];
        const score = typeof given === 'number' && Number.isFinite(given) ? Math.max(0, Math.min(TASK_POINTS, Math.round(given * 2) / 2)) : prev?.tasks?.[i]?.score ?? null;
        return { score, words: prev?.tasks?.[i]?.words ?? 0, comment: prev?.tasks?.[i]?.comment ?? null };
      });
      const r = scorePracticeSection(section, answers[dto.section] ?? {}, tasks);
      results[dto.section] = { ...r, gradedBy: 'TEACHER', late: prev?.late, teacherComment: dto.comment?.trim().slice(0, 2000) || prev?.teacherComment || null };
      results.overallPercent = practiceOverall(content.sections.map((_, i) => results[sectionKeyOf(i)] as PracticeSectionResult | undefined));
      return { results };
    });
    return this.attemptDetail(tenantId, attemptId);
  }

  // Runs the AI examiner again for a section waiting for review.
  async regrade(tenantId: string, attemptId: string, section: string) {
    const [a] = await this.db.select().from(mockAttempts).where(and(eq(mockAttempts.id, attemptId), eq(mockAttempts.tenantId, tenantId)));
    if (!a) throw new NotFoundException('Urinish topilmadi');
    if (!(await this.aiAvailable(tenantId))) throw new ConflictException({ code: 'AI_OFF', message: 'AI baholash markazda yoqilmagan' });
    if (/^s\d$/.test(section)) await this.gradePracticeWithAi(a.id, section);
    else if (section === 'writing' || section === 'speaking') await this.gradeWithAi(a.id, section);
    else throw new BadRequestException("Bo'lim noto'g'ri");
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

  // The student's IELTS level: their latest overall mock band, else the
  // level written on their English group ("6.5", "B2", "Intermediate"...).
  async studentLevel(studentId: string, tenantId: string): Promise<Level | null> {
    const done = await this.db.select({ results: mockAttempts.results }).from(mockAttempts)
      .where(and(eq(mockAttempts.studentId, studentId), eq(mockAttempts.tenantId, tenantId), eq(mockAttempts.status, 'COMPLETED')))
      .orderBy(desc(mockAttempts.completedAt)).limit(5);
    const overall = done.map((d) => parse<Results>(d.results, {}).overall).find((b) => b != null);
    if (overall != null) return bandToLevel(overall);
    const enrolls = await this.db.query.enrollments.findMany({ where: eq(enrollments.studentId, studentId), with: { group: true } });
    for (const e of enrolls) {
      if (e.status !== 'ACTIVE' || e.group?.tenantId !== tenantId || !isEnglish(`${e.group.subject} ${e.group.name}`)) continue;
      const lvl = parseLevel(e.group.level) ?? (/ielts/i.test(e.group.name) ? parseLevel(e.group.name) : null);
      if (lvl) return lvl;
    }
    return null;
  }

  // The practice area: the student's directions (their groups' subjects),
  // each with the published mock tests for it and the student's sittings.
  // Tests above the student's level + 1 are shown locked.
  async forStudent(studentId: string, tenantId: string) {
    const enrolls = await this.db.query.enrollments.findMany({ where: eq(enrollments.studentId, studentId), with: { group: true } });
    const subjects = [...new Set(enrolls.filter((e) => e.group?.tenantId === tenantId && !e.group.deletedAt && e.status === 'ACTIVE').map((e) => e.group.subject.trim()).filter(Boolean))];
    const tests = await this.db.select({ id: mockTests.id, title: mockTests.title, kind: mockTests.kind, subject: mockTests.subject, level: mockTests.level, module: mockTests.module, content: mockTests.content, ownerStudentId: mockTests.ownerStudentId })
      .from(mockTests)
      .where(and(eq(mockTests.tenantId, tenantId), eq(mockTests.status, 'PUBLISHED'), or(isNull(mockTests.ownerStudentId), eq(mockTests.ownerStudentId, studentId))))
      .orderBy(desc(mockTests.createdAt));
    const mine = tests.length === 0 ? [] : await this.db.select().from(mockAttempts)
      .where(and(eq(mockAttempts.studentId, studentId), inArray(mockAttempts.testId, tests.map((t) => t.id)))).orderBy(desc(mockAttempts.createdAt));
    const level = await this.studentLevel(studentId, tenantId);
    const view = (t: (typeof tests)[number]) => {
      const attempts = mine.filter((a) => a.testId === t.id).map((a) => ({
        id: a.id, status: a.status, createdAt: a.createdAt, completedAt: a.completedAt,
        sectionDone: parse<Record<string, string>>(a.sectionDone, {}), results: this.studentResults(parse<Results>(a.results, {})),
      }));
      if (isPractice(t.kind)) {
        const pc = normalizePractice(parse(t.content, {}));
        return {
          id: t.id, title: t.title, kind: t.kind, subject: t.subject, level: null, module: t.module, open: true, recommended: false,
          mine: !!t.ownerStudentId,
          sections: { listening: 0, reading: 0, writing: 0, speaking: 0 },
          durations: { listening: 0, reading: 0, writing: 0 },
          practice: pc.sections.map((x, i) => ({ key: sectionKeyOf(i), title: x.title, durationMin: x.durationMin, questions: sectionQuestionsOf(x).length, tasks: x.tasks.length })),
          attempts,
        };
      }
      const c = normalizeContent(parse(t.content, {}));
      const testLevel = isLevel(t.level) ? t.level : null;
      return {
        id: t.id, title: t.title, kind: t.kind, subject: t.subject, level: testLevel, module: t.module,
        open: levelOpen(testLevel, level),
        // Their own level and the next one up: the tests to work on now.
        recommended: !!level && !!testLevel && [0, 1].includes(LEVELS.indexOf(testLevel) - LEVELS.indexOf(level)),
        sections: { listening: sectionQuestions(c, 'listening').length, reading: sectionQuestions(c, 'reading').length, writing: c.writing.tasks.length, speaking: c.speaking.parts.length },
        durations: { listening: c.listening.durationMin, reading: c.reading.durationMin, writing: c.writing.durationMin },
        mine: false,
        practice: null,
        attempts,
      };
    };
    // Open tests first, the student's own level before others.
    const rank = (x: ReturnType<typeof view>) => (x.open ? 0 : 2) + (x.level === level ? 0 : 1);
    const directions = subjects.map((subject) => ({
      subject,
      english: isEnglish(subject),
      template: templateFor(subject),
      // The student's own AI practice sets come last; they are for this
      // direction only.
      tests: tests
        .filter((t) => (t.ownerStudentId ? t.subject === subject : sameDirection(t.subject, subject)))
        .map(view)
        .sort((a, b) => Number(a.mine) - Number(b.mine) || rank(a) - rank(b)),
    }));
    const aiFeedback = await this.aiAvailable(tenantId);
    return { directions, level, aiFeedback, aiPractice: aiFeedback ? await this.practiceQuota(studentId, tenantId) : null };
  }

  // Opens the unfinished sitting of this test, or starts a new one.
  async start(studentId: string, tenantId: string, testId: string) {
    const [test] = await this.db.select().from(mockTests)
      .where(and(eq(mockTests.id, testId), eq(mockTests.tenantId, tenantId), eq(mockTests.status, 'PUBLISHED')));
    if (!test || (test.ownerStudentId && test.ownerStudentId !== studentId)) throw new NotFoundException('Test topilmadi');
    if (!levelOpen(isLevel(test.level) ? test.level : null, await this.studentLevel(studentId, tenantId))) {
      throw new ForbiddenException({ code: 'LEVEL_LOCKED', message: "Bu test darajangizdan ancha yuqori — avval o'z darajangizdagi testlarni ishlang" });
    }
    const [open] = await this.db.select({ id: mockAttempts.id }).from(mockAttempts)
      .where(and(eq(mockAttempts.testId, testId), eq(mockAttempts.studentId, studentId), eq(mockAttempts.status, 'IN_PROGRESS')));
    if (open) return this.attemptForStudent(studentId, tenantId, open.id);
    const [row] = await this.db.insert(mockAttempts).values({ tenantId, testId, studentId }).returning();
    return this.attemptForStudent(studentId, tenantId, row.id);
  }

  async attemptForStudent(studentId: string, tenantId: string, attemptId: string) {
    const a = await this.ownAttempt(studentId, tenantId, attemptId);
    const [test] = await this.db.select().from(mockTests).where(eq(mockTests.id, a.testId));
    const done = parse<Record<string, string>>(a.sectionDone, {});
    if (isPractice(test.kind)) {
      const pc = normalizePractice(parse(test.content, {}));
      const pkeys: Record<string, string[]> = {};
      pc.sections.forEach((sec, i) => { if (done[sectionKeyOf(i)]) pkeys[sectionKeyOf(i)] = practiceKeys(sec); });
      return {
        id: a.id,
        status: a.status,
        test: { id: test.id, title: test.title, kind: test.kind, subject: test.subject, level: null, module: test.module, content: publicPractice(pc) },
        answers: parse<Record<string, Record<string, string>>>(a.answers, {}),
        sectionStarted: parse<Record<string, string>>(a.sectionStarted, {}),
        sectionDone: done,
        results: parse<PracticeResults>(a.results, {}),
        keys: pkeys,
        serverNow: new Date().toISOString(),
        aiFeedback: await this.aiAvailable(tenantId),
      };
    }
    const content = normalizeContent(parse(test.content, {}));
    // Keys are shown only for finished Listening/Reading (to learn from).
    const keys: Partial<Record<'listening' | 'reading', string[]>> = {};
    for (const s of ['listening', 'reading'] as const) {
      if (done[s]) keys[s] = sectionQuestions(content, s).map((q) => (q.type === 'MATCHING' ? (q.pairs ?? []).map((p) => `${p.left} → ${p.right}`).join('; ') : q.options?.find((o) => o.id === q.correctAnswer)?.text ?? q.correctAnswer.split('|')[0]));
    }
    return {
      id: a.id,
      status: a.status,
      test: { id: test.id, title: test.title, kind: test.kind, subject: test.subject, level: test.level, module: test.module, content: publicContent(content) },
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
  async startSection(studentId: string, tenantId: string, attemptId: string, section: string) {
    await this.assertSectionOf(studentId, tenantId, attemptId, section);
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
  async saveAnswers(studentId: string, tenantId: string, attemptId: string, section: string, answers: unknown) {
    await this.assertSectionOf(studentId, tenantId, attemptId, section);
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
    await this.assertSectionOf(studentId, tenantId, attemptId, 'speaking');
    await this.mutate(attemptId, tenantId, studentId, (a) => {
      if (parse<Record<string, string>>(a.sectionDone, {}).speaking) throw new ConflictException({ code: 'SECTION_DONE', message: "Bu bo'lim topshirilgan" });
      const all = parse<Answers>(a.answers, {});
      const prev = all.speaking?.[key];
      all.speaking = {
        ...all.speaking,
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
  async submitSection(studentId: string, tenantId: string, attemptId: string, section: string, answers?: unknown) {
    const kind = await this.assertSectionOf(studentId, tenantId, attemptId, section);
    if (isPractice(kind)) return this.submitPractice(studentId, tenantId, attemptId, section, answers);
    return this.submitIelts(studentId, tenantId, attemptId, section as Section, answers);
  }

  private async submitIelts(studentId: string, tenantId: string, attemptId: string, section: Section, answers?: unknown) {
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
        const r = scoreObjective(content, section, all[section] ?? {}, test.module === 'GENERAL' ? 'GENERAL' : 'ACADEMIC');
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

  // ------------------------------------------------------------- practice

  private async submitPractice(studentId: string, tenantId: string, attemptId: string, key: string, answers?: unknown) {
    const aiOn = await this.aiAvailable(tenantId);
    let needsAi = false;
    await this.mutate(attemptId, tenantId, studentId, async (a, tx) => {
      const done = parse<Record<string, string>>(a.sectionDone, {});
      if (done[key]) throw new ConflictException({ code: 'SECTION_DONE', message: "Bu bo'lim topshirilgan" });
      const all = parse<Record<string, Record<string, string>>>(a.answers, {});
      if (answers !== undefined) all[key] = this.cleanTextAnswers(answers);
      const [test] = await tx.select().from(mockTests).where(eq(mockTests.id, a.testId));
      const content = normalizePractice(parse(test.content, {}));
      const si = sectionIndex(key, content)!;
      const section = content.sections[si];
      const started = parse<Record<string, string>>(a.sectionStarted, {});
      const late = !!(started[key] && Date.now() > Date.parse(started[key]) + section.durationMin * 60_000 + GRACE_MS);
      const r = scorePracticeSection(section, all[key] ?? {});
      const written = section.tasks.some((_, i) => (all[key]?.[`t${i}`] ?? '').trim());
      // Tasks left empty score 0 at once; written ones go to the AI.
      if (r.tasks && !written) {
        const zero = r.tasks.map((x) => ({ ...x, score: 0 }));
        Object.assign(r, scorePracticeSection(section, all[key] ?? {}, zero));
      } else if (r.tasks && aiOn) {
        r.status = 'PENDING';
        needsAi = true;
      }
      const results = parse<PracticeResults>(a.results, {});
      results[key] = { ...r, gradedBy: 'AUTO', late };
      done[key] = new Date().toISOString();
      results.overallPercent = practiceOverall(content.sections.map((_, i) => results[sectionKeyOf(i)] as PracticeSectionResult | undefined));
      const finished = content.sections.every((_, i) => done[sectionKeyOf(i)]);
      return { answers: all, sectionDone: done, results, ...(finished ? { status: 'COMPLETED', completedAt: new Date() } : {}) };
    });
    if (needsAi) void this.gradePracticeWithAi(attemptId, key).catch((err) => this.logger.error(`practice AI grading failed: ${(err as Error).message}`));
    return this.attemptForStudent(studentId, tenantId, attemptId);
  }

  // The AI marks the writing tasks of a practice section (0-10 each, with a
  // short comment); the teacher can change the scores later.
  async gradePracticeWithAi(attemptId: string, key: string) {
    const [a] = await this.db.select().from(mockAttempts).where(eq(mockAttempts.id, attemptId));
    if (!a) return;
    const [test] = await this.db.select().from(mockTests).where(eq(mockTests.id, a.testId));
    const content = normalizePractice(parse(test.content, {}));
    const si = sectionIndex(key, content);
    if (si === null) return;
    const section = content.sections[si];
    const answers = parse<Record<string, Record<string, string>>>(a.answers, {})[key] ?? {};
    let tasks: PracticeTaskResult[] | null = [];
    try {
      for (let i = 0; i < section.tasks.length; i++) {
        const task = section.tasks[i];
        const text = (answers[`t${i}`] ?? '').trim();
        const words = wordCount(text);
        if (words < 5) {
          tasks.push({ score: 0, words, comment: null });
          continue;
        }
        const g = await this.ai.gradeEssay({ prompt: task.prompt, rubric: task.rubric, answer: text, maxPoints: TASK_POINTS });
        tasks.push({ score: g.score, words, comment: g.comment || null });
      }
    } catch (err) {
      this.logger.warn(`AI practice grading failed: ${(err as Error).message}`);
      tasks = null;
    }
    await this.mutate(attemptId, a.tenantId, null, (row) => {
      const results = parse<PracticeResults>(row.results, {});
      const prev = results[key] as PracticeSectionResult | undefined;
      if (prev?.gradedBy === 'TEACHER') return null;
      const all = parse<Record<string, Record<string, string>>>(row.answers, {});
      results[key] = tasks
        ? { ...scorePracticeSection(section, all[key] ?? {}, tasks), gradedBy: 'AI', late: prev?.late }
        : { ...(prev ?? scorePracticeSection(section, all[key] ?? {})), status: 'REVIEW' };
      results.overallPercent = practiceOverall(content.sections.map((_, i) => results[sectionKeyOf(i)] as PracticeSectionResult | undefined));
      return { results };
    });
  }

  // How many AI practice sets the student may still make today.
  async practiceQuota(studentId: string, tenantId: string) {
    const day = await this.localDay(tenantId);
    const [row] = await this.db.select({ used: aiUsage.used }).from(aiUsage)
      .where(and(eq(aiUsage.studentId, studentId), eq(aiUsage.kind, PRACTICE_USAGE), eq(aiUsage.day, day)));
    const used = Math.min(STUDENT_PRACTICE_PER_DAY, row?.used ?? 0);
    return { limit: STUDENT_PRACTICE_PER_DAY, used, left: Math.max(0, STUDENT_PRACTICE_PER_DAY - used) };
  }

  // Today's date at the center.
  private async localDay(tenantId: string) {
    const [t] = await this.db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const p = zonedParts(new Date(), isValidTimeZone(t?.timezone) ? t!.timezone! : DEFAULT_TIMEZONE);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  // Takes one of today's practice sets, or returns false when none is left.
  // One statement: the row is created or its counter raised only while it
  // is below the limit, so requests arriving together cannot pass it.
  private async reservePractice(studentId: string, tenantId: string, day: string) {
    const rows = await this.db.insert(aiUsage)
      .values({ tenantId, studentId, kind: PRACTICE_USAGE, day, used: 1 })
      .onConflictDoUpdate({
        target: [aiUsage.studentId, aiUsage.kind, aiUsage.day],
        set: { used: sql`${aiUsage.used} + 1`, updatedAt: new Date() },
        setWhere: sql`${aiUsage.used} < ${STUDENT_PRACTICE_PER_DAY}`,
      })
      .returning({ used: aiUsage.used });
    return rows.length > 0;
  }

  // Gives a reserved set back: the student is not charged for a set that
  // was never made (the AI failed or returned nothing usable).
  private async refundPractice(studentId: string, day: string) {
    await this.db.update(aiUsage)
      .set({ used: sql`greatest(${aiUsage.used} - 1, 0)`, updatedAt: new Date() })
      .where(and(eq(aiUsage.studentId, studentId), eq(aiUsage.kind, PRACTICE_USAGE), eq(aiUsage.day, day)))
      .catch((err) => this.logger.error(`practice quota refund failed for ${studentId}: ${(err as Error).message}`));
  }

  // A practice set the AI makes for the student in one of their directions
  // (optionally on a topic), started at once. The day's limit is reserved
  // before the AI is asked and given back if no set comes out of it.
  async generateForStudent(studentId: string, tenantId: string, dto: { subject: string; topic?: string; count?: number }) {
    const enrolls = await this.db.query.enrollments.findMany({ where: eq(enrollments.studentId, studentId), with: { group: true } });
    const own = enrolls.filter((e) => e.status === 'ACTIVE' && e.group?.tenantId === tenantId && !e.group.deletedAt);
    const group = own.find((e) => e.group.subject.trim() === dto.subject.trim())?.group;
    if (!group) throw new BadRequestException("Bu yo'nalishda o'qimaysiz");
    if (!(await this.aiAvailable(tenantId))) throw new ConflictException({ code: 'AI_OFF', message: 'AI markazda yoqilmagan' });
    const day = await this.localDay(tenantId);
    if (!(await this.reservePractice(studentId, tenantId, day))) {
      throw new ConflictException({ code: 'LIMIT', message: `Bugun ${STUDENT_PRACTICE_PER_DAY} ta AI mashq yaratdingiz — ertaga yana urinib ko'ring` });
    }
    let testId: string;
    try {
      const topic = dto.topic?.trim().slice(0, 200) || '';
      const n = Math.min(20, Math.max(5, Math.round(dto.count ?? 10)));
      const questions = await this.ai.generateExamQuestions({
        subject: group.subject,
        topic: topic || group.subject,
        count: n,
        level: group.level ?? null,
        request: "O'quvchi mustaqil mashq qiladi: savollar aniq, bir xil qiyinlikda, har biriga bitta aniq javob. ESSAY bo'lmasin.",
      });
      const content: PracticeContent = normalizePractice({
        sections: [{ title: topic || group.subject, durationMin: Math.max(10, Math.round(n * 1.5)), parts: [{ title: 'Questions', questions }] }],
      });
      if (sectionQuestionsOf(content.sections[0]).length === 0) throw new ConflictException({ code: 'AI_EMPTY', message: "AI savol yarata olmadi — qaytadan urinib ko'ring" });
      const [row] = await this.db.insert(mockTests).values({
        tenantId, kind: PRACTICE_KIND, status: 'PUBLISHED', ownerStudentId: studentId, subject: group.subject,
        title: `AI: ${topic || group.subject}`.slice(0, 200), content: JSON.stringify(content),
      }).returning();
      testId = row.id;
    } catch (err) {
      await this.refundPractice(studentId, day);
      throw err;
    }
    return this.start(studentId, tenantId, testId);
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
    // The AI read the words, it did not hear the voice: pronunciation is not
    // part of this band (the real exam has it as a fourth criterion).
    return { status: 'DONE', band: fb.band, feedback: fb, gradedBy: 'AI', basis: 'TRANSCRIPT' };
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

  // Checks the section name against the test's own format; returns the kind.
  private async assertSectionOf(studentId: string, tenantId: string, attemptId: string, section: string) {
    const a = await this.ownAttempt(studentId, tenantId, attemptId);
    const [test] = await this.db.select({ kind: mockTests.kind, content: mockTests.content }).from(mockTests).where(eq(mockTests.id, a.testId));
    if (isPractice(test?.kind)) {
      if (sectionIndex(section, normalizePractice(parse(test.content, {}))) === null) throw new BadRequestException("Bo'lim noto'g'ri");
    } else if (!(SECTIONS as readonly string[]).includes(section)) {
      throw new BadRequestException("Bo'lim noto'g'ri");
    }
    return test?.kind ?? 'IELTS';
  }

  // { "0": "B", ... } with short string values only.
  private cleanTextAnswers(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 100)) {
      if (!/^(\d{1,3}|t\d)$/.test(k)) continue;
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
