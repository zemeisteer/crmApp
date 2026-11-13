import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { DB, Database } from '../db/db.module';
import { groups, payments, attendance } from '../db/schema';
import { TEACHER_PUBLIC_COLUMNS } from '../common/teacher-columns';
import { GenerateMaterialDto, PlacementTestDto } from './dto/ai.dto';
import { bankFor, pickFromBank } from './placement-bank';
import { normalizeQuestion, type TestQuestion } from '../common/test-questions';
import { essayGradePrompt, generateTestPrompt, parseJsonArray, parseLooseJson, pdfExtractPrompt, textExtractPrompt } from './test-prompts';
import { tutorPrompt, type TutorContext } from './tutor-prompt';


const MODEL = 'claude-sonnet-5';
// What a person sees when the AI is overloaded after all retries.
const AI_BUSY = "AI xizmati hozir band. Bir necha daqiqadan keyin qayta urinib ko'ring.";
// Said plainly instead of a made-up answer: a template that looks like the
// AI's would mislead the teacher (and the students it reaches).
const aiOff = () =>
  new ServiceUnavailableException({ code: 'AI_OFF', message: "AI ulanmagan: platforma admini \"API va integratsiyalar\" bo'limida AI kalitini qo'shishi kerak." });
// A large PDF can take a while; past this a request is treated as lost.
// How long one try may take: a PDF is read slowly; text answers come in
// seconds, and a model that is overloaded can hang without answering.
const GEMINI_TIMEOUT_MS = 75_000;
const GEMINI_PDF_TIMEOUT_MS = 180_000;

// A question read from a file keeps its text without the file's own number
// ("3. She ___" -> "She ___"): the test numbers its questions itself, and a
// scanned page and a typed one then read the same. "12 x 8 = ?" is untouched.
function withoutNumber(q: TestQuestion): TestQuestion {
  const prompt = q.prompt.replace(/^\s*\d{1,3}\s*[.)]\s+(?=\S)/, '');
  return prompt === q.prompt ? q : { ...q, prompt };
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  // Which AI answers: Claude when ANTHROPIC_API_KEY is set, otherwise
  // Google Gemini (free tier) when GEMINI_API_KEY is set.
  private aiConfigured() {
    return Boolean(this.config.get<string>('ANTHROPIC_API_KEY') || this.config.get<string>('GEMINI_API_KEY'));
  }

  // `pdf` attaches a document the model reads alongside the prompt (both
  // providers accept PDFs, including scanned pages). With both keys set,
  // Claude answers first and Gemini takes over when Claude is unavailable
  // (overloaded, rate limited, unreachable); the reverse is not needed as
  // Claude is only skipped when no key is set.
  private async complete(prompt: string, maxTokens: number, pdf?: Buffer): Promise<string> {
    const anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY');
    const geminiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!anthropicKey && !geminiKey) {
      throw new ServiceUnavailableException(
        "AI yoqilmagan: backend/.env fayliga GEMINI_API_KEY (bepul) yoki ANTHROPIC_API_KEY qo'shing.",
      );
    }
    if (anthropicKey) {
      try {
        return await this.completeAnthropic(anthropicKey, prompt, maxTokens, pdf);
      } catch (err) {
        const transient = err instanceof Anthropic.APIConnectionError || (err instanceof Anthropic.APIError && (err.status === 429 || (err.status ?? 0) >= 500));
        if (!transient) throw err;
        if (!geminiKey) throw new ServiceUnavailableException(AI_BUSY);
        this.logger.warn(`Claude unavailable (${err instanceof Anthropic.APIError ? err.status ?? 'network' : 'error'}); using Gemini`);
      }
    }
    return this.completeGemini(geminiKey!, prompt, maxTokens, pdf);
  }

  // The SDK itself retries overloads, rate limits and dropped connections.
  private async completeAnthropic(apiKey: string, prompt: string, maxTokens: number, pdf?: Buffer): Promise<string> {
    const res = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: pdf
          ? [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
              { type: 'text', text: prompt },
            ]
          : prompt,
      }],
    });
    return res.content.find((b) => b.type === 'text')?.text ?? '';
  }

  // Gemini's free tier is often overloaded (503/429) for a while: retry with
  // growing pauses, then on the lighter model. A dropped connection or a
  // request that hangs counts the same. The person sees a plain "busy, try
  // again" message, never the provider's raw error; the details go to the log.
  private async completeGemini(apiKey: string, prompt: string, maxTokens: number, pdf?: Buffer, fileMime = 'application/pdf'): Promise<string> {
    const primary = this.config.get<string>('GEMINI_MODEL') || 'gemini-flash-latest';
    const attempts = [
      { model: primary, wait: 0 },
      { model: primary, wait: 2000 },
      { model: 'gemini-flash-lite-latest', wait: 4000 },
      { model: 'gemini-flash-lite-latest', wait: 8000 },
    ];
    let primaryHung = false;
    for (const { model, wait } of attempts) {
      // An overloaded model that did not answer at all will not on a second
      // try: go straight to the lighter one.
      if (primaryHung && model === primary) continue;
      if (wait) await this.sleep(wait);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [...(pdf ? [{ inline_data: { mime_type: fileMime, data: pdf.toString('base64') } }] : []), { text: prompt }] }],
            generationConfig: { maxOutputTokens: Math.max(maxTokens, 2048) },
          }),
          signal: AbortSignal.timeout(pdf ? GEMINI_PDF_TIMEOUT_MS : GEMINI_TIMEOUT_MS),
        });
      } catch (err) {
        if (model === primary) primaryHung = true;
        this.logger.warn(`Gemini (${model}) unreachable: ${err instanceof Error ? err.message : String(err)} - retrying`);
        continue;
      }
      if (res.ok) {
        const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      }
      const body = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 503 || res.status === 429 || res.status === 500) {
        this.logger.warn(`Gemini (${model}) ${res.status}: ${body} - retrying`);
        continue;
      }
      this.logger.error(`Gemini (${model}) ${res.status}: ${body}`);
      throw new ServiceUnavailableException(`AI so'rovni qabul qilmadi (${res.status}). Fayl juda katta yoki buzilgan bo'lishi mumkin.`);
    }
    throw new ServiceUnavailableException(AI_BUSY);
  }

  /** A pause between retries (its own method so tests need not wait). */
  protected sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  async groupInsights(tenantId: string, groupId: string) {
    const group = await this.db.query.groups.findFirst({
      where: eq(groups.id, groupId),
      with: { teacher: { columns: TEACHER_PUBLIC_COLUMNS }, enrollments: { with: { student: true } } },
    });
    if (!group || group.tenantId !== tenantId) {
      throw new ServiceUnavailableException("Guruh topilmadi");
    }

    const month = new Date().toISOString().slice(0, 7);
    const groupPayments = await this.db.query.payments.findMany({ where: eq(payments.tenantId, tenantId) });
    const groupAttendance = await this.db.query.attendance.findMany({ where: eq(attendance.groupId, groupId) });

    const studentSummaries = (group.enrollments || []).map((e) => {
      const paid = groupPayments.some(
        (p) => p.studentId === e.student.id && p.forMonth === month && p.status === 'PAID',
      );
      const records = groupAttendance.filter((a) => a.studentId === e.student.id);
      const attended = records.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
      const attendancePct = records.length ? Math.round((attended / records.length) * 100) : null;
      return `- ${e.student.fullName}: bu oy to'lov = ${paid ? "to'langan" : 'qarzdor'}, davomat = ${attendancePct === null ? "ma'lumot yo'q" : attendancePct + '%'}`;
    });

    const prompt = `Sen o'quv markazi uchun ishlaydigan yordamchi tahlilchisan. Quyidagi guruh haqidagi ma'lumotlarga asoslanib, o'zbek tilida qisqa va amaliy tahlil yoz (5-8 jumla): qaysi o'quvchilarga e'tibor kerak (qarzdorlik yoki past davomat sababli), umumiy guruh holati va admin uchun 2-3 ta aniq tavsiya.

Guruh: ${group.name} (${group.subject}${group.level ? ', ' + group.level : ''})
O'qituvchi: ${group.teacher?.fullName ?? "biriktirilmagan"}
O'quvchilar (${studentSummaries.length} ta):
${studentSummaries.join('\n') || 'Guruhda o\'quvchi yo\'q.'}`;

    const text = await this.complete(prompt, 700);
    return { insight: text };
  }

  async generateMaterial(dto: GenerateMaterialDto) {
    const typeLabel =
      dto.type === 'LESSON_PLAN' ? 'dars rejasi' : dto.type === 'HOMEWORK' ? 'uy vazifasi' : 'test (quiz)';

    const prompt = `Sen tajribali o'qituvchisan. Quyidagi mavzu uchun ${typeLabel} tayyorla, aniq va amaliy formatda (sarlavhalar va ro'yxatlar bilan).
Til: o'qituvchi talabi qaysi tilda yozilgan bo'lsa, o'sha tilda; talab bo'lmasa - o'zbek tilida.
Salomlashma, o'zingni tanishtirma, "tayyorlab berdim" kabi gaplar yozma: darhol materialning o'zidan boshla.
O'qituvchi talabi bo'lsa, uni so'zma-so'z bajar (savollar soni, turi, mavzusi).

Fan: ${dto.subject}
Daraja: ${dto.level || "belgilanmagan"}
Mavzu: ${dto.topic}${dto.customInstructions ? `\nO'qituvchi talabi (eng muhimi): ${dto.customInstructions}` : ''}`;

    if (!this.aiConfigured()) throw aiOff();
    const text = await this.complete(prompt, 8000);
    if (!text.trim()) throw new ServiceUnavailableException(AI_BUSY);
    return { material: text };
  }


  async suggestHomework(dto: { subject?: string; groupName?: string; topic?: string; level?: string; request?: string }) {
    const subject = dto.subject || 'Ingliz tili';
    const groupName = dto.groupName || '';
    const topic = dto.topic || '';
    const request = dto.request?.trim() || '';

    if (!this.aiConfigured()) throw aiOff();
    const prompt = `Sen o'quv markazi uchun tajribali o'qituvchi yordamchisisan.
Quyidagi guruh va fan uchun uyga vazifa (homework) TAYYORLA.
Fan: ${subject}
Guruh nomi: ${groupName || "umumiy"}
Mavzu (agar ko'rsatilgan bo'lsa): ${topic || "navbatdagi mavzu"}
Daraja: ${dto.level || "ko'rsatilmagan"}
O'qituvchining talabi (ENG MUHIMI): ${request || "yo'q"}

Qoidalar:
- O'qituvchi talabini so'zma-so'z bajar: nechta savol/mashq so'ragan bo'lsa, aynan shuncha savol/mashqni O'ZING to'liq yozib ber (masalan "12 ta savol" - 12 ta tayyor savol, javob variantlari bilan). O'quvchiga "savol tuzing" deb topshirma, agar o'qituvchi aniq shuni so'ramagan bo'lsa.
- Turli savol turlari so'ralgan bo'lsa (test, bo'sh joyni to'ldirish, to'g'ri/noto'g'ri, gap tuzish...), har birini ishlat va har bir savol oldida turini yoz.
- Matn o'qituvchi talabi yozilgan tilda bo'lsin (inglizcha yozgan bo'lsa - inglizcha).
- Salomlashish, o'zingni tanishtirish va keraksiz izoh yozma: faqat vazifaning o'zi.
- Oxirida "## Answer key" (yoki talab tilida "Javoblar") bo'limi bo'lsin.

Vazifaning o'zi (mashqlar, gaplar, misollar, matn) o'quvchiga PDF fayl bo'lib beriladi — uni "content" ga to'liq yoz:
sarlavhalar "## " bilan, mashqlar raqamlangan, har bir mashqda aniq ko'rsatma va barcha gaplar/misollar bo'lsin (o'quvchi faqat shu faylga qarab bajara olsin).
Oddiy matn yoz: jadval, LaTeX va HTML ishlatma.

Javobni FAQAT quyidagi JSON formatida ber (boshqa hech qanday so'z qo'shma):
{
"title": "Vazifa sarlavhasi (masalan: Unit 5: Present Perfect vs Past Simple mashqlari)",
"description": "O'quvchiga 1-2 gapli qisqa ko'rsatma (masalan: Biriktirilgan fayldagi 3 ta mashqni daftarga bajaring.)",
"content": "Vazifaning to'liq matni (qatorlar \\n bilan)",
"dueDays": 3
}`;
    const text = await this.complete(prompt, 8000);
    // A model often puts raw line breaks inside the JSON strings: read it leniently.
    const parsed = parseLooseJson(text) as { title?: unknown; description?: unknown; content?: unknown; dueDays?: number } | null;
    if (parsed) {
      return {
        title: String(parsed.title ?? '').slice(0, 160),
        description: String(parsed.description ?? ''),
        content: typeof parsed.content === 'string' && parsed.content.trim() ? parsed.content.trim() : null,
        dueDays: parsed.dueDays || 3,
      };
    }
    throw new ServiceUnavailableException(AI_BUSY);
  }

  // Questions for an exam's question bank, mixed types. Needs an AI key: a
  // made-up fallback would put wrong questions in front of students.
  async generateExamQuestions(opts: { subject: string; topic: string; count?: number; level?: string | null; request?: string | null; language?: string }): Promise<TestQuestion[]> {
    if (!this.aiConfigured()) {
      throw new ServiceUnavailableException("AI bilan savol yaratish uchun backend/.env fayliga GEMINI_API_KEY (bepul) qo'shing.");
    }
    const count = Math.min(Math.max(opts.count ?? 5, 1), 40);
    const text = await this.complete(
      generateTestPrompt({ subject: opts.subject, topic: opts.topic, count, level: opts.level ?? null, request: opts.request ?? null, language: opts.language ?? 'UZ', withLevels: false }),
      Math.max(8000, count * 900),
    );
    const questions = parseJsonArray(text).map((q) => normalizeQuestion(q)).filter((q): q is TestQuestion => q !== null);
    if (questions.length === 0) throw new ServiceUnavailableException("AI savol yarata olmadi. Qaytadan urinib ko'ring.");
    return questions.slice(0, count);
  }

  get isConfigured() {
    return this.aiConfigured();
  }

  // Completion with an optional PDF attached (mock test imports).
  /**
   * What a student said in a Speaking recording, word for word (Gemini
   * listens to the audio itself: far closer than the browser's live
   * recognition, which often mishears accents). Null when there is no
   * Gemini key, the file is too big, or the AI could not do it: the
   * browser's transcript is kept then.
   */
  async transcribeAudio(audio: Buffer, mime: string): Promise<string | null> {
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key || audio.length === 0 || audio.length > 14 * 1024 * 1024) return null;
    const prompt = `Transcribe this recording of a student answering an IELTS Speaking question in English.
Write exactly what is said, word for word, in English. Keep hesitations ("um", "uh") and repeated words as spoken; do not correct grammar.
Output only the transcript, nothing else. If there is no speech, output nothing.`;
    try {
      const text = (await this.completeGemini(key, prompt, 4000, audio, mime.split(';')[0].trim() || 'audio/webm')).trim();
      return text || null;
    } catch (err) {
      this.logger.warn(`Speaking transcription failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // A reply grounded in a Google search, with the pages it relied on. Used
  // to learn what IELTS topics and task types are current before writing a test.
  async completeSearch(prompt: string, maxTokens: number): Promise<{ text: string; sources: Array<{ title: string; url: string }> }> {
    if (!this.aiConfigured()) throw new ServiceUnavailableException('AI yoqilmagan');
    // Claude's own web search first; Gemini's Google search when that fails or is off.
    const claudeKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (claudeKey) {
      try {
        const res = await new Anthropic({ apiKey: claudeKey }).messages.create({
          model: MODEL,
          max_tokens: Math.max(maxTokens, 2048),
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }] as never,
          messages: [{ role: 'user', content: prompt }],
        });
        const seen = new Set<string>();
        const sources: Array<{ title: string; url: string }> = [];
        for (const block of res.content as Array<{ type: string; text?: string; content?: unknown }>) {
          if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const r of block.content as Array<{ url?: string; title?: string }>) {
              if (r.url && !seen.has(r.url)) { seen.add(r.url); sources.push({ title: r.title ?? '', url: r.url }); }
            }
          }
        }
        const text = (res.content as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
        if (text.trim()) return { text, sources };
      } catch (err) {
        this.logger.warn(`Claude web search unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key) throw new ServiceUnavailableException('AI qidiruvi mavjud emas');
    const model = this.config.get<string>('GEMINI_MODEL') || 'gemini-flash-latest';
    for (let i = 0; i < 3; i++) {
      if (i) await this.sleep(2000 * i);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: Math.max(maxTokens, 2048) },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      }).catch(() => null);
      if (!res || res.status === 503 || res.status === 429 || res.status === 500) continue;
      if (!res.ok) break;
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }> };
      const c = data.candidates?.[0];
      const seen = new Set<string>();
      const sources = (c?.groundingMetadata?.groundingChunks ?? [])
        .map((g) => ({ title: g.web?.title ?? '', url: g.web?.uri ?? '' }))
        .filter((x) => x.url && !seen.has(x.url) && !!seen.add(x.url));
      return { text: c?.content?.parts?.map((p) => p.text ?? '').join('') ?? '', sources };
    }
    throw new ServiceUnavailableException(AI_BUSY);
  }

  async completeWithPdf(prompt: string, maxTokens: number, pdf?: Buffer): Promise<string> {
    if (!this.aiConfigured()) throw new ServiceUnavailableException('AI yoqilmagan');
    return this.complete(prompt, maxTokens, pdf);
  }

  // Plain text completion for prompts built elsewhere (tutor reports).
  async completeText(prompt: string, maxTokens: number): Promise<string> {
    if (!this.aiConfigured()) throw new ServiceUnavailableException('AI yoqilmagan');
    return this.complete(prompt, maxTokens);
  }

  // One reply of the students' AI tutor (Telegram bot).
  async tutorReply(ctx: TutorContext): Promise<string> {
    if (!this.aiConfigured()) throw new ServiceUnavailableException('AI yoqilmagan');
    const text = (await this.complete(tutorPrompt(ctx), 900)).trim();
    return text || "Kechirasiz, javob tayyorlay olmadim. Savolni boshqacha yozib ko'ring.";
  }

  // Scores one essay answer for the teacher to confirm.
  async gradeEssay(opts: { prompt: string; rubric?: string | null; answer: string; maxPoints: number }) {
    if (!this.aiConfigured()) {
      throw new ServiceUnavailableException("AI yoqilmagan: backend/.env fayliga GEMINI_API_KEY (bepul) qo'shing.");
    }
    if (!opts.answer.trim()) return { score: 0, comment: "Javob yozilmagan." };
    const text = await this.complete(essayGradePrompt(opts), 1500);
    const match = text.match(/\{[\s\S]*\}/);
    let parsed: { score?: unknown; comment?: unknown } = {};
    try {
      parsed = match ? JSON.parse(match[0]) : {};
    } catch {
      parsed = {};
    }
    const score = Math.max(0, Math.min(opts.maxPoints, Math.round(Number(parsed.score) || 0)));
    return { score, comment: typeof parsed.comment === 'string' ? parsed.comment.slice(0, 600) : '' };
  }

  // Level test with mixed question types. Questions carry a level (1-3) so
  // the result can suggest a level. Uses AI when configured, otherwise the
  // built-in English/Math questions.
  async placementTest(tenantId: string, dto: PlacementTestDto) {
    let subject = dto.subject.trim();
    let groupLevel: string | null = null;
    if (dto.groupId) {
      const [g] = await this.db.select({ subject: groups.subject, level: groups.level }).from(groups)
        .where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      if (!g) throw new NotFoundException('Guruh topilmadi');
      subject = subject || g.subject;
      groupLevel = g.level;
    }
    const count = dto.count ?? 15;
    const target = dto.level === 'BEGINNER' ? 1 : dto.level === 'ADVANCED' ? 3 : dto.level === 'INTERMEDIATE' ? 2 : undefined;
    const language = dto.language ?? 'UZ';

    if (this.aiConfigured()) {
      try {
        const questions = await this.aiPlacementQuestions(subject, count, dto.level ?? null, groupLevel, language);
        if (questions.length >= Math.min(5, count)) return { subject, source: 'ai' as const, questions };
        this.logger.warn(`AI placement test for "${subject}" returned ${questions.length} usable questions; using built-in ones`);
      } catch (e) {
        // fall through to the built-in questions
        this.logger.warn(`AI placement test for "${subject}" failed: ${(e as Error).message}`);
      }
    }
    const bank = bankFor(subject);
    if (!bank) {
      throw new ServiceUnavailableException(
        `"${subject}" uchun tayyor test yo'q. AI bilan yaratish uchun backend/.env fayliga GEMINI_API_KEY (bepul) qo'shing (hozircha Ingliz tili va Matematika tayyor).`,
      );
    }
    const questions = pickFromBank(bank, count, target)
      .map((q) => normalizeQuestion({ ...q, correctAnswer: q.answer }))
      .filter((q): q is TestQuestion => q !== null);
    return { subject, source: 'bank' as const, questions };
  }

  private async aiPlacementQuestions(subject: string, count: number, level: string | null, groupLevel: string | null, language: string): Promise<TestQuestion[]> {
    const text = await this.complete(
      generateTestPrompt({ subject, count, level: level ?? groupLevel, language, withLevels: true }),
      Math.max(8000, count * 900),
    );
    return parseJsonArray(text)
      .map((q) => normalizeQuestion(q))
      .filter((q): q is TestQuestion => q !== null && q.type !== 'ESSAY')
      .slice(0, count);
  }

  // Reads a test from a PDF (typed or scanned) into questions for review:
  // sections, instructions, reading passages, points and answers from the
  // answer key when there is one (otherwise left empty for the teacher).
  async extractQuestionsFromPdf(pdf: Buffer): Promise<TestQuestion[]> {
    if (!this.aiConfigured()) {
      throw new ServiceUnavailableException(
        "PDF'dan savollarni o'qish uchun AI kerak: backend/.env fayliga GEMINI_API_KEY (bepul) qo'shing.",
      );
    }
    const text = await this.complete(pdfExtractPrompt(), 24000, pdf);
    const questions = parseJsonArray(text)
      .map((q) => normalizeQuestion(q, { requireAnswer: false }))
      .filter((q): q is TestQuestion => q !== null)
      .map(withoutNumber)
      .slice(0, 300);
    if (questions.length === 0) throw new ServiceUnavailableException("PDF'dan savollar topilmadi. Fayl test ekanini tekshiring.");
    return questions;
  }

  // Questions from written text (e.g. an AI material), for review.
  async extractQuestionsFromText(text: string): Promise<TestQuestion[]> {
    if (!this.aiConfigured()) {
      throw new ServiceUnavailableException("Matndan savol ajratish uchun AI kerak: backend/.env fayliga GEMINI_API_KEY (bepul) qo'shing.");
    }
    const out = await this.complete(textExtractPrompt(text.slice(0, 40000)), 16000);
    const questions = parseJsonArray(out)
      .map((q) => normalizeQuestion(q, { requireAnswer: false }))
      .filter((q): q is TestQuestion => q !== null)
      .map(withoutNumber)
      .slice(0, 300);
    if (questions.length === 0) throw new ServiceUnavailableException('Matndan savollar topilmadi.');
    return questions;
  }
}

