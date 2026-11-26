import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { mockTests } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { FilesService } from '../files/files.service';
import { saveGeneratedFile } from '../common/upload.util';
import { isLevel, normalizeContent, type MockContent } from './ielts';
import { trendsPrompt } from './generate-prompts';
import { parseJsonObject } from './import/import-prompts';
import { bundledTrends, TREND_SOURCES } from './trends';
import { applyResults, emptyMeta, isPartKey, PART_KEYS, partLabel, partsWithoutAudio, pool, runPart, specFor, type PartKey, type PartResult, type Topics } from './generation';

export const GENERATING = '__GENERATING__';
export const FAILED = '__FAILED__';
// A retry that has not finished after this long is treated as lost (server restart).
const RUNNING_STALE_MS = 15 * 60_000;
// The live trend search gets this long; then the bundled trends are used.
export const TREND_SEARCH_MS = 30_000;

const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });

const asStrings = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, n) : []);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

// Writes a whole new IELTS mock test (Listening, Reading, Writing, Speaking)
// for a chosen band level, or a mixed one: a web search finds the topics and
// task types in current use, then every part is written in its own AI call,
// checked, and asked for again when it comes back short or cut off (see
// generation.ts). A part that still fails is recorded in the content, shown
// in the editor with a retry button, and blocks publishing; so does a
// Listening part without audio. Audio is read aloud by Gemini TTS when a
// Gemini key is set. The result is a DRAFT for the teacher to check.
@Injectable()
export class MockGenerateService {
  private readonly logger = new Logger(MockGenerateService.name);
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
    private readonly files: FilesService,
  ) {}

  // Creates the placeholder test and starts writing it in the background.
  async start(tenantId: string, dto: { level?: string | null; module?: string }) {
    const level = isLevel(dto.level) ? dto.level : null;
    const module = dto.module === 'GENERAL' ? 'GENERAL' : 'ACADEMIC';
    const [row] = await this.db.insert(mockTests).values({
      tenantId, title: `AI mock · ${level ?? 'aralash'}`, subject: 'Ingliz tili', level, module, source: GENERATING, content: JSON.stringify(normalizeContent({})),
    }).returning();
    void this.write(tenantId, row.id, level, module).catch(async (err) => {
      this.logger.error(`mock generation failed: ${(err as Error).message}`);
      await this.db.update(mockTests).set({ source: `${FAILED}${(err as Error).message.slice(0, 200)}`, updatedAt: new Date() }).where(eq(mockTests.id, row.id));
    });
    return row;
  }

  private async topics(level: string | null, module: string): Promise<{ topics: Topics; sources: Array<{ title: string; url: string }> }> {
    let found: Record<string, any> = {};
    let sources: Array<{ title: string; url: string }> = [];
    let live = false;
    try {
      const res = await within(this.ai.completeSearch(trendsPrompt(level, module), 3000), TREND_SEARCH_MS);
      found = parseJsonObject(res.text) ?? {};
      sources = res.sources;
      live = sources.length > 0 && asStrings(found.reading, 3).length > 0;
    } catch (err) {
      this.logger.warn(`live trend search unavailable, using the bundled trends: ${(err as Error).message}`);
    }
    if (!live) {
      found = bundledTrends(module);
      sources = TREND_SOURCES;
    }
    const part1 = asStrings(found.speaking?.part1, 3);
    return {
      sources,
      topics: {
        listening: asStrings(found.listening, 4),
        reading: asStrings(found.reading, 3),
        writing: { task1: String(found.writing?.task1 ?? 'changes over time in a chart'), task2: String(found.writing?.task2 ?? 'technology and education') },
        speaking: {
          part1: part1.length ? part1 : ['hometown', 'work or study', 'free time'],
          part2: String(found.speaking?.part2 ?? 'a place you visited that you liked'),
          part3: String(found.speaking?.part3 ?? 'travel and tourism'),
        },
      },
    };
  }

  /** The whole test: every part, then the audio. Exported for tests through `writeContent`. */
  async writeContent(tenantId: string, id: string, topics: Topics, level: string | null, module: string): Promise<MockContent> {
    const specs = PART_KEYS.map((k) => specFor(k, topics, level, module));
    // All nine parts are written at once, and each Listening part is read
    // aloud as soon as it is ready (while the other parts are still being
    // written): the test takes about as long as its slowest part.
    const recordings: Array<Promise<{ i: number; path: string | null; error: string | null }>> = [];
    const results = await pool(
      specs.map((s) => async () => {
        const r = await runPart(this.ai, s);
        if (r.ok && s.key.startsWith('listening') && this.ai.canSynthesizeSpeech) {
          const i = Number(s.key.split('.')[1]);
          const transcript = applyResults(normalizeContent({ generation: emptyMeta() }), [r]).listening.parts[i]?.transcript;
          if (transcript) recordings.push(this.record(tenantId, id, transcript).then((path) => ({ i, path, error: null }), (err: Error) => ({ i, path: null, error: err.message })));
        }
        return r;
      }),
      PART_KEYS.length,
    );
    for (const r of results) {
      if (!r.ok) this.logger.warn(`mock ${id}: ${partLabel(r.key)} failed after ${r.attempts} tries: ${r.error}`);
    }
    if (results.every((r) => !r.ok)) {
      const first = results.find((r): r is Extract<PartResult, { ok: false }> => !r.ok);
      throw new Error(`AI test yoza olmadi (${first?.error.slice(0, 120) ?? 'javob yo\'q'}) — keyinroq qayta urinib ko'ring`);
    }
    let content = applyResults(normalizeContent({ generation: emptyMeta() }), results);
    content.generation!.plan = topics;
    for (const rec of await Promise.all(recordings)) {
      if (rec.path && content.listening.parts[rec.i]) content.listening.parts[rec.i].audioPath = rec.path;
      else if (rec.error) this.logger.warn(`mock ${id}: audio for Listening Part ${rec.i + 1} failed: ${rec.error}`);
    }
    // Parts whose recording failed get one more try here (and the status).
    content = await this.addAudio(tenantId, id, content);
    return content;
  }

  private async write(tenantId: string, id: string, level: string | null, module: string) {
    const { topics, sources } = await this.topics(level, module);
    const content = await this.writeContent(tenantId, id, topics, level, module);
    const domains = [...new Set(sources.map((x) => host(x.url)))].slice(0, 6);
    const note = `AI yozdi (yangi matn). Mavzular hozirgi IELTS trendlaridan: ${domains.join(', ')}`;
    await this.db.update(mockTests).set({
      title: `AI mock · ${level ?? 'aralash'} · ${new Date().toLocaleDateString('en-GB')}`,
      content: JSON.stringify(content), source: note, updatedAt: new Date(),
    }).where(eq(mockTests.id, id));
  }

  /**
   * Reads every Listening part that has an audioscript but no recording
   * aloud and stores it like an upload of this test. Without a Gemini key
   * the parts stay silent and are marked "audio kerak" (publishing waits).
   */
  async addAudio(tenantId: string, id: string, content: MockContent): Promise<MockContent> {
    const c = structuredClone(content);
    const gen = c.generation ?? emptyMeta();
    c.generation = gen;
    const todo = partsWithoutAudio(c).filter((i) => c.listening.parts[i].transcript);
    if (!todo.length) {
      if (!partsWithoutAudio(c).length) { gen.tts = 'DONE'; gen.ttsError = null; }
      return c;
    }
    if (!this.ai.canSynthesizeSpeech) {
      gen.tts = 'UNAVAILABLE';
      gen.ttsError = null;
      return c;
    }
    let error: string | null = null;
    await Promise.all(
      todo.map(async (i) => {
        try {
          const name = await this.record(tenantId, id, c.listening.parts[i].transcript!);
          if (name) c.listening.parts[i].audioPath = name;
        } catch (err) {
          error = (err as Error).message;
          this.logger.warn(`mock ${id}: audio for Listening Part ${i + 1} failed: ${error}`);
        }
      }),
    );
    gen.tts = partsWithoutAudio(c).length ? 'FAILED' : 'DONE';
    gen.ttsError = gen.tts === 'FAILED' ? (error ?? 'audio yaratilmadi').slice(0, 300) : null;
    return c;
  }

  /** Reads a transcript aloud and stores it as an asset of the test; null without audio. */
  private async record(tenantId: string, id: string, transcript: string): Promise<string | null> {
    const audio = await this.ai.synthesizeSpeech(transcript);
    if (!audio) return null;
    const name = await saveGeneratedFile(audio.bytes, audio.ext);
    await this.files.register(tenantId, name, 'MOCK_ASSET', id);
    return name;
  }

  /**
   * Writes the failed parts of an AI test again (or the ones named; "audio"
   * re-reads the Listening parts without a recording). Runs in the
   * background; the editor polls until `generation.running` is empty.
   */
  async retry(tenantId: string, id: string, requested: string[] | undefined) {
    // Checked and marked "running" under a row lock: two retries sent
    // together (a double click, two teachers) start one rewrite, not two.
    const { row, content, parts, audio } = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(mockTests).where(and(eq(mockTests.id, id), eq(mockTests.tenantId, tenantId))).for('update');
      if (!row) throw new NotFoundException('Test topilmadi');
    const content = normalizeContent(parse(row.content));
    const gen = content.generation;
    if (!gen) throw new BadRequestException("Bu test AI bilan yozilmagan");
    const since = gen.runningSince ? Date.parse(gen.runningSince) : 0;
    if (gen.running.length && Date.now() - since < RUNNING_STALE_MS) throw new ConflictException('AI hali yozmoqda — biroz kuting');
    const failed = gen.failed.map((f) => f.key).filter(isPartKey);
    const wanted = requested?.length ? requested : [...failed, ...(partsWithoutAudio(content).length ? ['audio'] : [])];
    const parts = wanted.filter((k): k is PartKey => isPartKey(k));
    const audio = wanted.includes('audio');
    if (!parts.length && !audio) throw new BadRequestException("Qayta yoziladigan qism yo'q");
    gen.running = [...parts, ...(audio ? ['audio'] : [])];
    gen.runningSince = new Date().toISOString();
      await tx.update(mockTests).set({ content: JSON.stringify(content), updatedAt: new Date() }).where(eq(mockTests.id, id));
      return { row, content, parts, audio };
    });
    void this.rewrite(tenantId, id, row.level, row.module, parts, audio).catch(async (err) => {
      this.logger.error(`mock ${id}: retry failed: ${(err as Error).message}`);
      await this.merge(id, (c) => {
        c.generation!.running = [];
        return c;
      });
    });
    return { ...row, content };
  }

  private async rewrite(tenantId: string, id: string, level: string | null, module: string, parts: PartKey[], audio: boolean) {
    const [row] = await this.db.select({ content: mockTests.content }).from(mockTests).where(eq(mockTests.id, id));
    // The parts are written again on the topics they had.
    const plan = normalizeContent(parse(row?.content ?? '{}')).generation?.plan;
    const topics = parts.length ? plan ?? (await this.topics(level, module)).topics : null;
    const results = topics ? await pool(parts.map((k) => () => runPart(this.ai, specFor(k, topics, level, module))), PART_KEYS.length) : [];
    // The teacher may have edited other parts meanwhile: only these slots change.
    let updated = await this.merge(id, (c) => applyResults(c, results));
    if (audio || results.some((r) => r.ok && r.key.startsWith('listening'))) {
      const withAudio = await this.addAudio(tenantId, id, updated);
      updated = await this.merge(id, (c) => {
        withAudio.listening.parts.forEach((p, i) => {
          if (c.listening.parts[i] && !c.listening.parts[i].audioPath && p.audioPath) c.listening.parts[i].audioPath = p.audioPath;
        });
        c.generation!.tts = withAudio.generation!.tts;
        c.generation!.ttsError = withAudio.generation!.ttsError;
        return c;
      });
    }
    await this.merge(id, (c) => {
      c.generation!.running = [];
      c.generation!.runningSince = null;
      return c;
    });
    return updated;
  }

  // Applies `fn` to the test's current content and saves it.
  private async merge(id: string, fn: (c: MockContent) => MockContent): Promise<MockContent> {
    const [row] = await this.db.select({ content: mockTests.content }).from(mockTests).where(eq(mockTests.id, id));
    if (!row) throw new NotFoundException('Test topilmadi');
    const c = normalizeContent(parse(row.content));
    c.generation ??= emptyMeta();
    const next = fn(c);
    await this.save(id, next);
    return next;
  }

  private async save(id: string, content: MockContent) {
    await this.db.update(mockTests).set({ content: JSON.stringify(content), updatedAt: new Date() }).where(eq(mockTests.id, id));
  }
}
