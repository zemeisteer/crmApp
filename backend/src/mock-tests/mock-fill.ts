import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { mockTests } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { parseLooseJson } from '../ai/test-prompts';
import { normalizeQuestion, type TestQuestion } from '../common/test-questions';
import { examById } from './exam-catalog';
import {
  emptySpecParts,
  normalizePractice,
  PRACTICE_KIND,
  type PracticeContent,
  type PracticePart,
} from './practice';
import { pool } from './generation';

export const FILLING = '__GENERATING__';
const FAILED = '__FAILED__';

// Fills the empty parts of a test made from an exam template (exam-catalog):
// every part is its own AI call, all of them at once (a handful in
// parallel), so a whole SAT or TRKI test is ready in about the time of the
// slowest part instead of the sum. Runs in the background; the list shows
// the test as "being written" (source = FILLING) until it is done.

const TYPE_RULES: Record<string, string> = {
  MCQ: '"options": 4 strings, "correctAnswer": the letter of the right option ("A".."D").',
  MCQ_MULTI:
    '"options": 5 strings, "correctAnswer": the right letters joined by "," (e.g. "A,D").',
  TRUE_FALSE: '"correctAnswer": "true" or "false".',
  TRUE_FALSE_NG: '"correctAnswer": "true", "false" or "ng" (not given).',
  FILL_BLANK:
    'the prompt has a gap "_____"; "correctAnswer": the missing word(s); alternatives joined by "|".',
  SHORT_ANSWER:
    '"correctAnswer": the short answer (a number for maths); alternatives joined by "|".',
  MATCHING:
    '"pairs": [{"left": "...", "right": "..."}] (6 pairs unless told otherwise), "correctAnswer": "".',
  WORD_ORDER:
    '"words": the words of the sentence shuffled, "correctAnswer": the sentence in the right order.',
  ERROR_CORRECTION:
    'a sentence with one mistake; "correctAnswer": the corrected sentence and the corrected word joined by "|".',
  TRANSFORMATION:
    'the prompt has the first sentence, the key word in capitals and the second sentence with a gap; "correctAnswer": the words for the gap.',
  WORD_FORMATION:
    'the prompt has a sentence with a gap and the base word in capitals; "correctAnswer": the formed word.',
};

export function fillPrompt(opts: {
  exam: string;
  target: string;
  level: string | null;
  section: string;
  part: PracticePart;
}) {
  const spec = opts.part.spec!;
  const text = spec.text
    ? `First write the ${spec.text === 'code' ? 'program' : spec.text === 'notice' ? 'short texts (notices, adverts or messages)' : spec.text === 'dialogue' ? 'dialogue' : 'reading text'} the questions are about, of the length and difficulty the real exam uses at this level, in ${opts.target}. Put it in "text".`
    : 'There is no common text: "text" is null; each question stands on its own (put any short passage a question needs inside its prompt).';
  return `You write practice questions for the ${opts.exam} exam${opts.level ? ` at level ${opts.level}` : ''}.
Section: ${opts.section}
Part: ${opts.part.title}
Instruction shown to the student: ${spec.instruction}
Question type: ${spec.type} — ${TYPE_RULES[spec.type] ?? ''}
Number of questions: ${spec.count}${spec.hint ? `\nAbout this part: ${spec.hint}` : ''}

${text}
Rules:
- Match the real exam's style, topics and difficulty${opts.level ? ` for ${opts.level}` : ''}; questions in ${opts.target} (maths in plain text: "2x + 5 = 15", "x^2", "√16"; no LaTeX, markdown or HTML).
- Every question has one clear right answer; wrong options are plausible.
- All ${spec.count} questions are of type "${spec.type}".

Reply with JSON only:
{"text": "..." or null, "questions": [{"type": "${spec.type}", "prompt": "...", "options": [...], "pairs": [...], "words": [...], "correctAnswer": "..."}]}`;
}

/** The questions (and text) of a reply; null when it holds none of the right type. */
export function parseFill(
  reply: string,
  part: PracticePart,
): { text: string | null; questions: TestQuestion[] } | null {
  const data = parseLooseJson(reply);
  if (!data) return null;
  const want = part.spec!.type;
  const questions = (Array.isArray(data.questions) ? data.questions : [])
    .map((q) => normalizeQuestion({ ...(q as object), type: want }))
    .filter((q): q is TestQuestion => q !== null)
    .slice(0, part.spec!.count);
  if (!questions.length) return null;
  const text =
    typeof data.text === 'string' && data.text.trim()
      ? data.text.trim().slice(0, 30_000)
      : null;
  return { text: part.spec!.text ? text : null, questions };
}

@Injectable()
export class MockFillService {
  private readonly logger = new Logger(MockFillService.name);
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
  ) {}

  /** Marks the test as being written and fills its empty parts in the background. */
  async start(tenantId: string, id: string) {
    if (!this.ai.isConfigured) throw new ServiceUnavailableException("AI yoqilmagan: backend/.env fayliga GEMINI_API_KEY (bepul) yoki ANTHROPIC_API_KEY qo'shing.");
    const row = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(mockTests)
        .where(and(eq(mockTests.id, id), eq(mockTests.tenantId, tenantId)))
        .for('update');
      if (!row) throw new NotFoundException('Test topilmadi');
      if (row.kind !== PRACTICE_KIND)
        throw new BadRequestException('Bu test imtihon shablonidan emas');
      if (
        row.source === FILLING &&
        Date.now() - row.updatedAt.getTime() < 15 * 60_000
      )
        throw new ConflictException('AI hali yozmoqda — biroz kuting');
      const content = normalizePractice(JSON.parse(row.content || '{}'));
      if (!emptySpecParts(content).length)
        throw new BadRequestException("To'ldiriladigan bo'sh qism yo'q");
      const [updated] = await tx
        .update(mockTests)
        .set({ source: FILLING, updatedAt: new Date() })
        .where(eq(mockTests.id, id))
        .returning();
      return updated;
    });
    void this.fill(id).catch(async (err) => {
      this.logger.error(
        `practice fill ${id} failed: ${(err as Error).message}`,
      );
      await this.db
        .update(mockTests)
        .set({
          source: `${FAILED}${(err as Error).message.slice(0, 200)}`,
          updatedAt: new Date(),
        })
        .where(eq(mockTests.id, id));
    });
    return {
      ...row,
      content: normalizePractice(JSON.parse(row.content || '{}')),
    };
  }

  /** Writes every empty part; exported for tests. */
  async fillContent(
    content: PracticeContent,
  ): Promise<{ content: PracticeContent; failed: number }> {
    const exam = examById(content.exam?.id);
    const todo = emptySpecParts(content);
    const results = await pool(
      todo.map(({ s, p }) => async () => {
        const part = content.sections[s].parts[p];
        const prompt = fillPrompt({
          exam: exam?.name ?? content.sections[s].title,
          target: exam?.target ?? 'English',
          level: content.exam?.level ?? null,
          section: content.sections[s].title,
          part,
        });
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const got = parseFill(
              await this.ai.completeText(
                prompt,
                Math.max(
                  4000,
                  part.spec!.count * 700 + (part.spec!.text ? 2500 : 0),
                ),
              ),
              part,
            );
            if (got) return { s, p, ...got };
          } catch (err) {
            this.logger.warn(
              `practice part "${part.title}" failed: ${(err as Error).message}`,
            );
          }
        }
        return null;
      }),
      6,
    );
    const next = structuredClone(content);
    let failed = 0;
    for (const r of results) {
      if (!r) {
        failed++;
        continue;
      }
      const part = next.sections[r.s].parts[r.p];
      // The teacher may have filled it meanwhile: never overwrite.
      if (part.questions.length) continue;
      part.questions = r.questions;
      if (r.text && !part.text) part.text = r.text;
    }
    if (failed === todo.length && todo.length)
      throw new Error(
        "AI savollarni yoza olmadi — keyinroq qayta urinib ko'ring",
      );
    return { content: next, failed };
  }

  private async fill(id: string) {
    const [row] = await this.db
      .select()
      .from(mockTests)
      .where(eq(mockTests.id, id));
    if (!row) return;
    const { content, failed } = await this.fillContent(
      normalizePractice(JSON.parse(row.content || '{}')),
    );
    // Parts the teacher filled while the AI was writing are kept.
    const [now] = await this.db
      .select({ content: mockTests.content })
      .from(mockTests)
      .where(eq(mockTests.id, id));
    const current = normalizePractice(JSON.parse(now?.content || '{}'));
    current.sections.forEach((sec, s) =>
      sec.parts.forEach((part, p) => {
        const made = content.sections[s]?.parts[p];
        if (
          made &&
          part.spec &&
          part.questions.length === 0 &&
          made.questions.length
        ) {
          part.questions = made.questions;
          if (!part.text) part.text = made.text;
        }
      }),
    );
    const note = failed
      ? `AI yozdi; ${failed} ta qism yozilmadi — qayta urinib ko'ring`
      : 'AI yozdi (tekshirib chiqing)';
    await this.db
      .update(mockTests)
      .set({
        content: JSON.stringify(current),
        source: note,
        updatedAt: new Date(),
      })
      .where(eq(mockTests.id, id));
  }
}
