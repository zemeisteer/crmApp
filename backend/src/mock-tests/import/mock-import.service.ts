import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
const byNo = (qs: unknown) => (Array.isArray(qs) ? [...qs].sort((a: any, b: any) => (Number(a?.no) || 0) - (Number(b?.no) || 0)) : []);

// Uploaded materials -> mock tests (drafts). The work runs in the background
// and reports progress on the import row; the page polls it.
@Injectable()
export class MockImportService implements OnModuleInit {
  private readonly logger = new Logger(MockImportService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
  ) {}

  // Jobs live in this process: after a restart unfinished ones are marked
  // failed so the page does not wait forever.
  async onModuleInit() {
    await this.db.update(mockImports)
      .set({ status: 'FAILED', error: "Server qayta ishga tushdi — importni qaytadan boshlang", updatedAt: new Date() })
      .where(inArray(mockImports.status, ['QUEUED', 'RUNNING']))
      .catch(() => undefined);
  }

  async start(tenantId: string, files: ImportFile[]) {
    if (!files.some((f) => f.type === 'application/pdf')) throw new BadRequestException('Kamida bitta PDF (test kitobi yoki varag\'i) yuklang');
    if (!this.ai.isConfigured) {
      throw new ServiceUnavailableException("Materiallarni avtomatik o'qish uchun AI kerak (serverda GEMINI_API_KEY yoki ANTHROPIC_API_KEY).");
    }
    const progress: ImportProgress = { step: 'queued', message: 'Navbatda', done: 0, total: 0 };
    const [row] = await this.db.insert(mockImports).values({ tenantId, files: JSON.stringify(files), progress: JSON.stringify(progress) }).returning();
    void this.run(row.id).catch((err) => this.logger.error(`mock import ${row.id} crashed: ${(err as Error).message}`));
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
      files: parse<ImportFile[]>(r.files, []).map(({ name, type, size }) => ({ name, type, size })),
      progress: parse<ImportProgress>(r.progress, { step: 'queued', message: '', done: 0, total: 0 }),
      result: parse<ImportResult>(r.result, {}),
    };
  }

  private async report(id: string, progress: ImportProgress, extra: Partial<typeof mockImports.$inferInsert> = {}) {
    await this.db.update(mockImports).set({ progress: JSON.stringify(progress), updatedAt: new Date(), ...extra }).where(eq(mockImports.id, id));
  }

  // ------------------------------------------------------------------ job

  async run(id: string) {
    const [row] = await this.db.select().from(mockImports).where(eq(mockImports.id, id));
    if (!row) return;
    const files = parse<ImportFile[]>(row.files, []);
    const pdfFiles = files.filter((f) => f.type === 'application/pdf').sort((a, b) => natural(a.name, b.name));
    const audioFiles = files.filter((f) => f.type.startsWith('audio/'));
    try {
      await this.report(id, { step: 'reading', message: "PDF o'qilmoqda", done: 0, total: 0 }, { status: 'RUNNING' });
      const book = await mergePdfs(await Promise.all(pdfFiles.map((f) => readFile(join(UPLOAD_DIR, f.path)))));
      const texts = await pageTexts(book.pdf).catch(() => [] as string[]);

      await this.report(id, { step: 'locating', message: `${book.pages} sahifadan testlar qidirilmoqda`, done: 0, total: book.pages });
      const plan = await this.locate(id, book.pdf, book.pages, texts);
      if (plan.tests.length === 0) throw new Error("Materiallarda IELTS test topilmadi (Listening/Reading/Writing/Speaking bo'limlari aniqlanmadi)");

      const audio = matchAudio(audioFiles.map((f) => f.name), plan.tests.length);
      const pathOf = (name: string | null) => (name ? audioFiles.find((f) => f.name === name)?.path ?? null : null);

      const result: ImportResult = { book: plan.book, tests: [], unmatchedAudio: audio.unmatched };
      const steps = plan.tests.reduce((n, t) => n + (['listening', 'reading', 'writing', 'speaking'] as const).filter((s) => t[s].length > 0).length, 0);
      let done = 0;
      for (let ti = 0; ti < plan.tests.length; ti++) {
        const t = plan.tests[ti];
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
        const [test] = await this.db.insert(mockTests).values({
          tenantId: row.tenantId, title, source: plan.book, level: t.level, module: plan.module, importId: id, content: JSON.stringify(content),
        }).returning();
        result.tests!.push({
          id: test.id, title, level: t.level, warnings,
          counts: {
            listening: sectionQuestions(content, 'listening').length,
            reading: sectionQuestions(content, 'reading').length,
            writing: content.writing.tasks.length,
            speaking: content.speaking.parts.length,
          },
        });
      }
      if (audio.unmatched.length) result.unmatchedAudio = audio.unmatched;
      await this.report(id, { step: 'done', message: `${result.tests!.length} ta test yaratildi`, done: steps, total: steps }, { status: 'DONE', result: JSON.stringify(result) });
    } catch (err) {
      const msg = (err as Error).message || 'Import xatosi';
      this.logger.warn(`mock import ${id} failed: ${msg}`);
      await this.db.update(mockImports).set({ status: 'FAILED', error: msg.slice(0, 500), updatedAt: new Date() }).where(eq(mockImports.id, id));
    } finally {
      // The book is not needed once read; recordings stay (tests use them).
      await Promise.all(pdfFiles.map((f) => unlink(join(UPLOAD_DIR, f.path)).catch(() => undefined)));
    }
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
