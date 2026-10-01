import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { DB, Database } from '../../db/db.module';
import { mockImports, mockTests } from '../../db/schema';
import { AiService } from '../../ai/ai.service';
import { UPLOAD_DIR } from '../../common/upload.util';
import { missingKeys, normalizeContent, sectionQuestions } from '../ielts';
import { mergePdfs, pageTexts, subPdf } from './pdf';
import { matchAudio, normalizePlan, planFromLabels, type BookPlan, type TestPlan } from './plan';
import { labelPagesPrompt, listeningPrompt, locatePrompt, parseJsonObject, readingPrompt, speakingPrompt, writingPrompt } from './import-prompts';

export interface ImportFile { path: string; name: string; type: string; size: number }
export interface ImportProgress { step: 'queued' | 'reading' | 'locating' | 'extracting' | 'saving' | 'done'; message: string; done: number; total: number }
export interface ImportResult {
  book?: string | null;
  tests?: Array<{ id: string; title: string; level: string | null; counts: Record<string, number>; warnings: string[] }>;
  unmatchedAudio?: string[];
}

const OUTLINE_BUDGET = 110_000;
const SCAN_CHUNK = 10;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
// The plan kept on the row by an earlier attempt, if it is usable.
const normalizeStoredPlan = (raw: string | null): BookPlan | null => {
  const plan = parse<BookPlan | null>(raw, null);
  return plan && Array.isArray(plan.tests) && plan.tests.length > 0 ? plan : null;
};
const byNo = (qs: unknown) => (Array.isArray(qs) ? [...qs].sort((a: any, b: any) => (Number(a?.no) || 0) - (Number(b?.no) || 0)) : []);

// How many times a job is started before it is given up, how long a silent
// job is left alone before another server takes it over, and how often a
// working server says "still here".
const MAX_ATTEMPTS = 3;
const STALE_MS = 3 * 60_000;
const HEARTBEAT_MS = 30_000;
const BACKOFF_MS = 30_000;

// Trying again cannot help (nothing to import, the files are gone).
class PermanentImportError extends Error {}
// Another server has taken the job over: stop without touching it.
class LostLockError extends Error {}

// Uploaded materials -> mock tests (drafts). A job is a row in mock_imports:
// any server claims it (one at a time, FOR UPDATE SKIP LOCKED), keeps a
// heartbeat on it while working and reports progress on the row; the page
// polls it. A job that failed is retried with a back-off, one whose server
// died is taken over after its heartbeat stops, and a test already created
// is never created again (see mock_tests.import_index).
@Injectable()
export class MockImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MockImportService.name);
  /** This server, for the lock on the jobs it works on. */
  readonly instanceId = randomUUID();
  private readonly concurrency: number;
  private readonly pollMs: number;
  private readonly queue: string;
  private timer?: NodeJS.Timeout;
  private active = 0;
  private stopped = false;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly kicks = new Set<Promise<void>>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
    private readonly config: ConfigService,
  ) {
    // Imports read whole books and call the AI many times: a small, fixed
    // number at once per server keeps memory and AI rate limits in check.
    this.concurrency = Math.max(1, Math.min(4, Number(this.config.get('IMPORT_CONCURRENCY')) || 1));
    // 0: no background polling on this server (it still runs what it starts).
    const poll = this.config.get<string>('IMPORT_POLL_MS');
    this.pollMs = poll === undefined || poll === '' ? 15_000 : Math.max(0, Number(poll) || 0);
    // Only jobs of this queue are taken: environments (or a test run) that
    // share a database do not run each other's imports.
    this.queue = this.config.get<string>('IMPORT_QUEUE')?.trim() || 'default';
  }

  // Nothing is failed at startup: jobs of other servers are theirs, and a
  // job whose server is gone is picked up by the poll once it goes silent.
  onModuleInit() {
    if (this.pollMs <= 0) return;
    this.timer = setInterval(() => void this.kick(), this.pollMs);
    this.timer.unref();
    void this.kick();
  }

  // A clean stop hands this server's jobs back to the queue at once instead
  // of making them wait for the heartbeat to go stale.
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.db.update(mockImports)
      .set({ status: 'QUEUED', lockedBy: null, lockedAt: null, attempts: sql`greatest(${mockImports.attempts} - 1, 0)`, updatedAt: new Date() })
      .where(and(eq(mockImports.lockedBy, this.instanceId), eq(mockImports.status, 'RUNNING')))
      .catch(() => undefined);
  }

  async start(tenantId: string, files: ImportFile[], userId?: string) {
    if (!files.some((f) => f.type === 'application/pdf')) throw new BadRequestException('Kamida bitta PDF (test kitobi yoki varag\'i) yuklang');
    if (!this.ai.isConfigured) {
      throw new ServiceUnavailableException("Materiallarni avtomatik o'qish uchun AI kerak (serverda GEMINI_API_KEY yoki ANTHROPIC_API_KEY).");
    }
    const progress: ImportProgress = { step: 'queued', message: 'Navbatda', done: 0, total: 0 };
    const [row] = await this.db.insert(mockImports).values({ tenantId, createdBy: userId ?? null, queue: this.queue, files: JSON.stringify(files), progress: JSON.stringify(progress) }).returning();
    void this.kick();
    return this.view(row);
  }

  async list(tenantId: string) {
    const rows = await this.db.select().from(mockImports).where(eq(mockImports.tenantId, tenantId)).orderBy(desc(mockImports.createdAt)).limit(20);
    return rows.map((r) => this.view(r));
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.db.select().from(mockImports).where(and(eq(mockImports.id, id), eq(mockImports.tenantId, tenantId)));
    if (!row) throw new NotFoundException('Import topilmadi');
    return this.view(row);
  }

  private view(r: typeof mockImports.$inferSelect) {
    return {
      id: r.id, status: r.status, error: r.error, createdAt: r.createdAt, updatedAt: r.updatedAt,
      createdBy: r.createdBy, attempts: r.attempts,
      files: parse<ImportFile[]>(r.files, []).map(({ name, type, size }) => ({ name, type, size })),
      progress: parse<ImportProgress>(r.progress, { step: 'queued', message: '', done: 0, total: 0 }),
      result: parse<ImportResult>(r.result, {}),
    };
  }

  // Progress goes on the row only while this server still holds the job.
  private async report(id: string, progress: ImportProgress, extra: Partial<typeof mockImports.$inferInsert> = {}) {
    const rows = await this.db.update(mockImports)
      .set({ progress: JSON.stringify(progress), updatedAt: new Date(), lockedAt: new Date(), ...extra })
      .where(and(eq(mockImports.id, id), eq(mockImports.lockedBy, this.instanceId), eq(mockImports.status, 'RUNNING')))
      .returning({ id: mockImports.id });
    if (rows.length === 0) throw new LostLockError(`import ${id}: lock lost`);
  }

  // ---------------------------------------------------------------- queue

  /** Starts waiting jobs while this server has a free slot. */
  kick(): Promise<void> {
    const run = this.fill().finally(() => this.kicks.delete(run));
    this.kicks.add(run);
    return run;
  }

  private async fill() {
    while (!this.stopped && this.active < this.concurrency) {
      // The slot is taken before the claim, so two kicks cannot overfill it.
      this.active++;
      let id: string | null = null;
      try {
        id = await this.claim();
      } catch (err) {
        this.logger.error(`import queue: claim failed: ${(err as Error).message}`);
      }
      if (!id) {
        this.active--;
        return;
      }
      const job = this.work(id).finally(() => {
        this.active--;
        this.inFlight.delete(job);
        void this.kick();
      });
      this.inFlight.add(job);
    }
  }

  /** Waits for the jobs this server is working on (tests, graceful stops). */
  async idle() {
    while (this.kicks.size > 0 || this.inFlight.size > 0) await Promise.allSettled([...this.kicks, ...this.inFlight]);
  }

  // Takes the oldest job that is waiting (and due) or whose server has gone
  // silent. One statement; SKIP LOCKED keeps two servers off the same row.
  private async claim(): Promise<string | null> {
    // ISO strings, not Date objects: the columns are UTC timestamps without
    // a zone, and the driver would write a Date in the server's local time.
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - STALE_MS).toISOString();
    const res = await this.db.execute(sql`
      UPDATE mock_imports
         SET status = 'RUNNING', locked_by = ${this.instanceId}, locked_at = ${now}::timestamp, attempts = attempts + 1, updated_at = ${now}::timestamp
       WHERE id = (
         SELECT id FROM mock_imports
          WHERE queue = ${this.queue}
            AND ((status = 'QUEUED' AND (next_run_at IS NULL OR next_run_at <= ${now}::timestamp))
              OR (status = 'RUNNING' AND (locked_at IS NULL OR locked_at < ${stale}::timestamp)))
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    return (res.rows[0] as { id?: string } | undefined)?.id ?? null;
  }

  private async work(id: string) {
    const beat = setInterval(() => {
      void this.db.update(mockImports).set({ lockedAt: new Date() })
        .where(and(eq(mockImports.id, id), eq(mockImports.lockedBy, this.instanceId), eq(mockImports.status, 'RUNNING')))
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    beat.unref();
    try {
      await this.run(id);
    } catch (err) {
      if (err instanceof LostLockError) {
        this.logger.warn(`mock import ${id}: taken over by another server, stopping here`);
        return;
      }
      await this.failed(id, err as Error).catch((e) => this.logger.error(`mock import ${id}: could not record failure: ${(e as Error).message}`));
    } finally {
      clearInterval(beat);
    }
  }

  // A failed attempt goes back to the queue with a growing pause; after the
  // last one (or when retrying cannot help) the job is closed for good.
  private async failed(id: string, err: Error) {
    const msg = (err.message || 'Import xatosi').slice(0, 500);
    const [row] = await this.db.select().from(mockImports).where(eq(mockImports.id, id));
    if (!row || row.lockedBy !== this.instanceId) return;
    const mine = and(eq(mockImports.id, id), eq(mockImports.lockedBy, this.instanceId));
    if (!(err instanceof PermanentImportError) && row.attempts < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS * 2 ** (row.attempts - 1);
      this.logger.warn(`mock import ${id} attempt ${row.attempts}/${MAX_ATTEMPTS} failed: ${msg}; retrying in ${Math.round(wait / 1000)}s`);
      const progress: ImportProgress = { step: 'queued', message: `Xatolik — qayta uriniladi (${row.attempts}/${MAX_ATTEMPTS})`, done: 0, total: 0 };
      await this.db.update(mockImports)
        .set({ status: 'QUEUED', lockedBy: null, lockedAt: null, nextRunAt: new Date(Date.now() + wait), error: msg, progress: JSON.stringify(progress), updatedAt: new Date() })
        .where(mine);
      return;
    }
    this.logger.warn(`mock import ${id} failed: ${msg}`);
    const closed = await this.db.update(mockImports)
      .set({ status: 'FAILED', lockedBy: null, lockedAt: null, error: msg, updatedAt: new Date() })
      .where(mine).returning({ id: mockImports.id });
    if (closed.length > 0) await this.cleanup(row, true);
  }

  // Uploaded files of a finished job. The book is not needed once read;
  // recordings stay only if a created test plays them.
  private async cleanup(row: typeof mockImports.$inferSelect, failed: boolean) {
    const files = parse<ImportFile[]>(row.files, []);
    const drop = files.filter((f) => f.type === 'application/pdf');
    if (failed) {
      const tests = await this.db.select({ content: mockTests.content }).from(mockTests).where(eq(mockTests.importId, row.id));
      const used = tests.map((t) => t.content).join('\n');
      drop.push(...files.filter((f) => f.type.startsWith('audio/') && !used.includes(f.path)));
    }
    await Promise.all(drop.map((f) => unlink(join(UPLOAD_DIR, f.path)).catch(() => undefined)));
  }

  // ------------------------------------------------------------------ job

  private async run(id: string) {
    const [row] = await this.db.select().from(mockImports).where(eq(mockImports.id, id));
    if (!row) return;
    const files = parse<ImportFile[]>(row.files, []);
    const pdfFiles = files.filter((f) => f.type === 'application/pdf').sort((a, b) => natural(a.name, b.name));
    const audioFiles = files.filter((f) => f.type.startsWith('audio/'));

    await this.report(id, { step: 'reading', message: "PDF o'qilmoqda", done: 0, total: 0 });
    const buffers = await Promise.all(pdfFiles.map((f) => readFile(join(UPLOAD_DIR, f.path)))).catch((err) => {
      // Uploads must be on storage every server shares.
      throw new PermanentImportError(`Yuklangan fayl topilmadi (${(err as NodeJS.ErrnoException).code ?? 'o\'qilmadi'}) — importni qaytadan boshlang`);
    });
    const book = await mergePdfs(buffers);
    const texts = await pageTexts(book.pdf).catch(() => [] as string[]);

    // The plan is found once and kept: a retry extracts the same tests in
    // the same order, which is what makes "test N of this import" stable.
    let plan = normalizeStoredPlan(row.plan);
    if (!plan) {
      await this.report(id, { step: 'locating', message: `${book.pages} sahifadan testlar qidirilmoqda`, done: 0, total: book.pages });
      plan = await this.locate(id, book.pdf, book.pages, texts);
      if (plan.tests.length === 0) throw new PermanentImportError("Materiallarda IELTS test topilmadi (Listening/Reading/Writing/Speaking bo'limlari aniqlanmadi)");
      await this.report(id, { step: 'locating', message: `${plan.tests.length} ta test topildi`, done: book.pages, total: book.pages }, { plan: JSON.stringify(plan) });
    }

    const audio = matchAudio(audioFiles.map((f) => f.name), plan.tests.length);
    const pathOf = (name: string | null) => (name ? audioFiles.find((f) => f.name === name)?.path ?? null : null);

    // Tests an earlier attempt already saved are kept, not made again.
    const earlier = parse<ImportResult>(row.result, {});
    const saved = await this.db.select({ id: mockTests.id, title: mockTests.title, level: mockTests.level, importIndex: mockTests.importIndex, content: mockTests.content })
      .from(mockTests).where(eq(mockTests.importId, id));
    const summary = (test: { id: string; title: string; level: string | null; content: string }, warnings: string[]) => {
      const content = normalizeContent(parse(test.content, {}));
      return {
        id: test.id, title: test.title, level: test.level, warnings,
        counts: {
          listening: sectionQuestions(content, 'listening').length,
          reading: sectionQuestions(content, 'reading').length,
          writing: content.writing.tasks.length,
          speaking: content.speaking.parts.length,
        },
      };
    };

    const result: ImportResult = { book: plan.book, tests: [], unmatchedAudio: audio.unmatched };
    const steps = plan.tests.reduce((n, t) => n + (['listening', 'reading', 'writing', 'speaking'] as const).filter((s) => t[s].length > 0).length, 0);
    let done = 0;
    for (let ti = 0; ti < plan.tests.length; ti++) {
      const t = plan.tests[ti];
      const stepsOf = (['listening', 'reading', 'writing', 'speaking'] as const).filter((s) => t[s].length > 0).length;
      const have = saved.find((x) => x.importIndex === ti);
      if (have) {
        result.tests!.push(summary(have, earlier.tests?.find((x) => x.id === have.id)?.warnings ?? []));
        done += stepsOf;
        continue;
      }
      const a = audio.assignments[ti];
      const warnings: string[] = [];
      const step = async (label: string) => this.report(id, { step: 'extracting', message: `${t.title}: ${label}`, done: done++, total: steps });
      const hasAudio = !!a.section || a.parts.some(Boolean);

      const raw: Record<string, any> = { listening: { durationMin: 30, audioPath: pathOf(a.section), parts: [] }, reading: { durationMin: 60, passages: [] }, writing: { durationMin: 60, tasks: [] }, speaking: { parts: [] } };
      if (t.listening.length) {
        await step('Listening');
        const json = await this.extract(book.pdf, [...t.listening, ...t.answerKey, ...(hasAudio ? [] : t.audioscript)], listeningPrompt(hasAudio), warnings, 'Listening');
        raw.listening.parts = (Array.isArray(json?.parts) ? json.parts : []).map((p: any, i: number) => ({ ...p, audioPath: pathOf(a.parts[i] ?? null), questions: byNo(p?.questions) }));
      }
      if (t.reading.length) {
        await step('Reading');
        const json = await this.extract(book.pdf, [...t.reading, ...t.answerKey], readingPrompt(), warnings, 'Reading');
        raw.reading.passages = (Array.isArray(json?.passages) ? json.passages : []).map((p: any) => ({ ...p, questions: byNo(p?.questions) }));
      }
      if (t.writing.length) {
        await step('Writing');
        const json = await this.extract(book.pdf, t.writing, writingPrompt(), warnings, 'Writing');
        raw.writing.tasks = Array.isArray(json?.tasks) ? json.tasks : [];
      }
      if (t.speaking.length) {
        await step('Speaking');
        const json = await this.extract(book.pdf, t.speaking, speakingPrompt(), warnings, 'Speaking');
        raw.speaking.parts = Array.isArray(json?.parts) ? json.parts : [];
      }

      await this.report(id, { step: 'saving', message: `${t.title}: saqlanmoqda`, done, total: steps });
      const content = normalizeContent(raw);
      warnings.push(...this.checks(content, t, hasAudio));
      const title = `${plan.book ? `${plan.book} — ` : ''}${t.title}`.slice(0, 200);
      // (import, index) is unique: if another server got here first, its
      // test is the one that counts.
      const [made] = await this.db.insert(mockTests).values({
        tenantId: row.tenantId, title, source: plan.book, level: t.level, module: plan.module, importId: id, importIndex: ti, content: JSON.stringify(content),
      }).onConflictDoNothing({ target: [mockTests.importId, mockTests.importIndex] }).returning();
      const test = made ?? (await this.db.select().from(mockTests).where(and(eq(mockTests.importId, id), eq(mockTests.importIndex, ti))))[0];
      result.tests!.push(summary(test, warnings));
      // Saved as it goes, so a retry knows what is done and with what notes.
      await this.report(id, { step: 'saving', message: `${t.title}: saqlandi`, done, total: steps }, { result: JSON.stringify(result) });
    }
    if (audio.unmatched.length) result.unmatchedAudio = audio.unmatched;
    await this.report(id, { step: 'done', message: `${result.tests!.length} ta test yaratildi`, done: steps, total: steps }, { status: 'DONE', result: JSON.stringify(result), error: null, lockedAt: null });
    await this.cleanup(row, false);
  }

  // Finds the tests: from page text when the PDF has it, otherwise the AI
  // looks at the scanned pages chunk by chunk.
  private async locate(id: string, pdf: Buffer, pages: number, texts: string[]): Promise<BookPlan> {
    const withText = texts.filter((t) => t.length > 80).length;
    if (texts.length === pages && withText >= pages * 0.5) {
      const per = Math.max(120, Math.min(500, Math.floor(OUTLINE_BUDGET / Math.max(1, pages))));
      const outline = texts.map((t, i) => `${i + 1}: ${t.slice(0, per) || '(image)'}`).join('\n');
      const reply = await this.ai.completeWithPdf(locatePrompt(outline, pages), 4000);
      return normalizePlan(parseJsonObject(reply), pages);
    }
    const labels: Array<{ page: number; test: number | null; kind: string }> = [];
    let meta: { book: string | null; module: 'ACADEMIC' | 'GENERAL' } = { book: null, module: 'ACADEMIC' };
    for (let from = 1; from <= pages; from += SCAN_CHUNK) {
      const count = Math.min(SCAN_CHUNK, pages - from + 1);
      await this.report(id, { step: 'locating', message: `Skanerlangan sahifalar ko'rilmoqda: ${from}-${from + count - 1}`, done: from - 1, total: pages });
      const chunk = await subPdf(pdf, Array.from({ length: count }, (_, i) => from + i));
      const json = parseJsonObject(await this.ai.completeWithPdf(labelPagesPrompt(from, count), 3000, chunk));
      if (typeof json?.book === 'string' && !meta.book) meta = { ...meta, book: json.book };
      if (json?.module === 'GENERAL') meta = { ...meta, module: 'GENERAL' };
      for (const p of Array.isArray(json?.pages) ? json.pages : []) {
        const page = Number((p as any)?.page);
        if (page >= from && page < from + count) labels.push({ page, test: Number((p as any)?.test) || null, kind: String((p as any)?.kind ?? '') });
      }
    }
    return planFromLabels(labels, meta);
  }

  private async extract(pdf: Buffer, pages: number[], prompt: string, warnings: string[], label: string): Promise<Record<string, any> | null> {
    try {
      const part = await subPdf(pdf, pages);
      const json = parseJsonObject(await this.ai.completeWithPdf(prompt, 24_000, part));
      if (!json) warnings.push(`${label}: AI javobini o'qib bo'lmadi — qo'lda to'ldiring`);
      return json;
    } catch (err) {
      warnings.push(`${label}: o'qilmadi (${(err as Error).message.slice(0, 120)})`);
      return null;
    }
  }

  // What the teacher should look at before publishing.
  private checks(content: ReturnType<typeof normalizeContent>, t: TestPlan, hasAudio: boolean): string[] {
    const out: string[] = [];
    const missing = missingKeys(content);
    if (missing > 0) out.push(`${missing} ta savolning javobi topilmadi — kalitni qo'lda kiriting`);
    if (t.listening.length) {
      const l = sectionQuestions(content, 'listening').length;
      if (l && l !== 40) out.push(`Listening: ${l} ta savol (haqiqiy imtihonda 40)`);
      if (!hasAudio) out.push(content.listening.parts.some((p) => p.transcript) ? "Listening audio yo'q: hozircha brauzer matnni o'qib beradi — mp3 yuklang" : "Listening audio ham, matni ham yo'q — mp3 yuklang");
    }
    const r = sectionQuestions(content, 'reading').length;
    if (t.reading.length && r && r !== 40) out.push(`Reading: ${r} ta savol (haqiqiy imtihonda 40)`);
    const visual = [...content.listening.parts.flatMap((p) => p.questions), ...content.reading.passages.flatMap((p) => p.questions)]
      .some((q) => /\b(map|plan|diagram|label)\b/i.test(`${q.instruction ?? ''} ${q.section ?? ''}`));
    if (visual) out.push("Xarita/diagramma savollari bor — rasmini qismga yuklang");
    if (content.writing.tasks[0]?.prompt.includes('[Chart]')) out.push('Writing Task 1: grafik matn bilan tasvirlandi — asl rasmini yuklash tavsiya etiladi');
    return out;
  }
}
