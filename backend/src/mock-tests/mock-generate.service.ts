import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { mockTests } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { isLevel, normalizeContent, sectionQuestions } from './ielts';
import { listeningPartPrompt, readingPassagePrompt, speakingGenPrompt, trendsPrompt, writingGenPrompt } from './generate-prompts';
import { parseJsonObject } from './import/import-prompts';
import { bundledTrends, TREND_SOURCES } from './trends';

export const GENERATING = '__GENERATING__';
export const FAILED = '__FAILED__';

const asStrings = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, n) : []);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// Writes a whole new IELTS mock test (Listening, Reading, Writing, Speaking)
// for a chosen band level, or a mixed one: a web search finds the topics and
// task types in current use, then every part is written fresh with answer
// keys and explanations. The result is a DRAFT for the teacher to check.
@Injectable()
export class MockGenerateService {
  private readonly logger = new Logger(MockGenerateService.name);
  constructor(@Inject(DB) private readonly db: Database, private readonly ai: AiService) {}

  // Creates the placeholder test and starts writing it in the background.
  async start(tenantId: string, dto: { level?: string | null; module?: string }) {
    const level = isLevel(dto.level) ? dto.level : null;
    const module = dto.module === 'GENERAL' ? 'GENERAL' : 'ACADEMIC';
    const [row] = await this.db.insert(mockTests).values({
      tenantId, title: `AI mock · ${level ?? 'aralash'}`, subject: 'Ingliz tili', level, module, source: GENERATING, content: JSON.stringify(normalizeContent({})),
    }).returning();
    void this.write(row.id, level, module).catch(async (err) => {
      this.logger.error(`mock generation failed: ${(err as Error).message}`);
      await this.db.update(mockTests).set({ source: `${FAILED}${(err as Error).message.slice(0, 200)}`, updatedAt: new Date() }).where(eq(mockTests.id, row.id));
    });
    return row;
  }

  private async json(prompt: string, tokens = 12_000): Promise<Record<string, any> | null> {
    for (let i = 0; i < 2; i++) {
      const parsed = parseJsonObject(await this.ai.completeText(prompt, tokens));
      if (parsed) return parsed;
    }
    return null;
  }

  // Runs the jobs three at a time (the AI is rate limited).
  private async pool<T>(jobs: Array<() => Promise<T>>, size = 3): Promise<T[]> {
    const out: T[] = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: size }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }));
    return out;
  }

  private async write(id: string, level: string | null, module: string) {
    // 1. What is current, from the web.
    let topics: Record<string, any> = {};
    let sources: Array<{ title: string; url: string }> = [];
    let live = false;
    try {
      const found = await this.ai.completeSearch(trendsPrompt(level, module), 3000);
      topics = parseJsonObject(found.text) ?? {};
      sources = found.sources;
      live = sources.length > 0 && asStrings(topics.reading, 3).length > 0;
    } catch (err) {
      this.logger.warn(`live trend search unavailable, using the bundled trends: ${(err as Error).message}`);
    }
    if (!live) {
      topics = bundledTrends(module);
      sources = TREND_SOURCES;
    }
    const lt = asStrings(topics.listening, 4);
    const rt = asStrings(topics.reading, 3);
    const pick = (list: string[], i: number, fallback: string) => list[i] ?? fallback;
    const sp = {
      part1: asStrings(topics.speaking?.part1, 3).length ? asStrings(topics.speaking?.part1, 3) : ['hometown', 'work or study', 'free time'],
      part2: String(topics.speaking?.part2 ?? 'a place you visited that you liked'),
      part3: String(topics.speaking?.part3 ?? 'travel and tourism'),
    };

    // 2. Every part, three at a time.
    const lcount = [10, 10, 10, 10];
    const rcount = [13, 13, 14];
    const lfrom = [1, 11, 21, 31];
    const rfrom = [1, 14, 27];
    const jobs: Array<() => Promise<Record<string, any> | null>> = [
      ...lcount.map((c, i) => () => this.json(listeningPartPrompt(i + 1, pick(lt, i, ['booking a hotel room', 'a local museum tour', 'a university project', 'urban wildlife'][i]), level, lfrom[i], c))),
      ...rcount.map((c, i) => () => this.json(readingPassagePrompt(i + 1, pick(rt, i, ['the history of a common invention', 'how cities adapt to climate', 'memory and learning'][i]), level, rfrom[i], c, module))),
      () => this.json(writingGenPrompt(String(topics.writing?.task1 ?? 'changes over time in a chart'), String(topics.writing?.task2 ?? 'technology and education'), level, module), 5000),
      () => this.json(speakingGenPrompt(sp, level), 5000),
    ];
    const res = await this.pool(jobs);
    const [l1, l2, l3, l4, r1, r2, r3, w, s] = res;
    const content = normalizeContent({
      listening: { durationMin: 30, parts: [l1, l2, l3, l4].filter(Boolean).map((p) => ({ ...p, questions: p!.questions })) },
      reading: { durationMin: 60, passages: [r1, r2, r3].filter(Boolean) },
      writing: { durationMin: 60, tasks: w?.tasks ?? [] },
      speaking: { parts: s?.parts ?? [] },
    });
    const total = sectionQuestions(content, 'listening').length + sectionQuestions(content, 'reading').length;
    if (total === 0) throw new Error("AI savollar yoza olmadi — keyinroq qayta urinib ko'ring");

    const domains = [...new Set(sources.map((x) => host(x.url)))].slice(0, 6);
    const note = `AI yozdi (yangi matn). Mavzular hozirgi IELTS trendlaridan: ${domains.join(', ')}`;
    await this.db.update(mockTests).set({
      title: `AI mock · ${level ?? 'aralash'} · ${new Date().toLocaleDateString('en-GB')}`,
      content: JSON.stringify(content), source: note, updatedAt: new Date(),
    }).where(eq(mockTests.id, id));
  }
}
