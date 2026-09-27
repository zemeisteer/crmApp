import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { DB, Database } from '../db/db.module';
import { groups, payments, attendance } from '../db/schema';
import { GenerateMaterialDto, PlacementTestDto } from './dto/ai.dto';
import { bankFor, pickFromBank } from './placement-bank';
import { normalizeQuestion, type TestQuestion } from '../common/test-questions';
import { essayGradePrompt, generateTestPrompt, parseJsonArray, pdfExtractPrompt, textExtractPrompt } from './test-prompts';


const MODEL = 'claude-sonnet-5';

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
  // providers accept PDFs, including scanned pages).
  private async complete(prompt: string, maxTokens: number, pdf?: Buffer): Promise<string> {
    const anthropicKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (anthropicKey) {
      const res = await new Anthropic({ apiKey: anthropicKey }).messages.create({
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
    const geminiKey = this.config.get<string>('GEMINI_API_KEY');
    if (geminiKey) {
      // Gemini's free tier is sometimes overloaded (503/429): retry, then
      // fall back to the lighter model.
      const primary = this.config.get<string>('GEMINI_MODEL') || 'gemini-flash-latest';
      const models = [primary, primary, 'gemini-flash-lite-latest'];
      let res: Response | null = null;
      let lastError = '';
      for (let i = 0; i < models.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1500 * i));
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(models[i])}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [...(pdf ? [{ inline_data: { mime_type: 'application/pdf', data: pdf.toString('base64') } }] : []), { text: prompt }] }],
            generationConfig: { maxOutputTokens: Math.max(maxTokens, 2048) },
          }),
        });
        if (res.ok) break;
        lastError = `Gemini xatosi (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`;
        if (res.status !== 503 && res.status !== 429 && res.status !== 500) break;
        this.logger.warn(`${lastError} — retrying`);
      }
      if (!res || !res.ok) throw new ServiceUnavailableException(lastError || 'Gemini javob bermadi');
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    }
    throw new ServiceUnavailableException(
      "AI yoqilmagan: backend/.env fayliga GEMINI_API_KEY (bepul) yoki ANTHROPIC_API_KEY qo'shing.",
    );
  }

  async groupInsights(tenantId: string, groupId: string) {
    const group = await this.db.query.groups.findFirst({
      where: eq(groups.id, groupId),
      with: { teacher: true, enrollments: { with: { student: true } } },
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

    const prompt = `Sen tajribali o'qituvchisan. Quyidagi mavzu uchun ${typeLabel} tayyorla, o'zbek tilida, aniq va amaliy formatda (sarlavhalar va ro'yxatlar bilan):

Fan: ${dto.subject}
Daraja: ${dto.level || "belgilanmagan"}
Mavzu: ${dto.topic}${dto.customInstructions ? `\nO'qituvchi maxsus talabi / tafsifi: ${dto.customInstructions}` : ''}`;

    try {
      if (this.aiConfigured()) {
        const text = await this.complete(prompt, 1500);
        if (text) return { material: text };
      }
    } catch (e) {
      if (this.aiConfigured()) throw e;
    }

    return { material: this.buildFallbackMaterial(dto) };
  }

  private buildFallbackMaterial(dto: GenerateMaterialDto): string {
    const isPlan = dto.type === 'LESSON_PLAN';
    const isQuiz = dto.type === 'QUIZ';
    const lvl = dto.level || 'Umumiy daraja';

    if (isPlan) {
      return `📌 Dars rejasi: ${dto.topic}
Fan: ${dto.subject} | Daraja: ${lvl}
${dto.customInstructions ? `O'qituvchi eslatmasi: ${dto.customInstructions}\n` : ''}
1. Dars maqsadi:
- O'quvchilarga ${dto.topic} tushunchasini to'liq yetkazish
- Amaliy misollar va mashqlar orqali ko'nikmani mustahkamlash

2. Dars bosqichlari (80-90 daqiqa):
- 00-10 min: Kirish, o'tgan mavzuni takrorlash va "Warm-up" savollari
- 10-35 min: Yangi mavzuni tushuntirish va taqdimot (${dto.topic})
- 35-65 min: Amaliy mashqlar va guruhlarda ishlash
- 65-75 min: Mustaqil mini-test yoki nazorat topshirig'i
- 75-80 min: Xulosa, savol-javob va uyga vazifa berish

3. Tavsiya etiladigan qo'shimcha resurslar:
- Mavzuga oid ko'rgazmali materiallar va amaliy tarqatmalar`;
    }

    if (isQuiz) {
      return `📝 Test va Quiz: ${dto.topic}
Fan: ${dto.subject} | Daraja: ${lvl}
${dto.customInstructions ? `O'qituvchi eslatmasi: ${dto.customInstructions}\n` : ''}
1-savol. ${dto.topic} mavzusiga oid asosiy tushuncha qaysi javobda to'g'ri ko'rsatilgan?
A) Asosiy ta'rif va qoida 1
B) Noto'g'ri variant
C) Chalg'ituvchi variant
D) Qo'shimcha holat
(To'g'ri javob: A)

2-savol. Quyidagi berilgan topshiriqni to'g'ri bajaring:
A) Variant 1
B) Variant 2 (To'g'ri)
C) Variant 3
D) Variant 4

3-savol. Amaliy vaziyat / Case-study topshirig'i:
- Berilgan ma'lumotni tahlil qiling va qisqa xulosa yozing (3-4 jumla).`;
    }

    return `📚 Uyga vazifa: ${dto.topic}
Fan: ${dto.subject} | Daraja: ${lvl}
${dto.customInstructions ? `O'qituvchi eslatmasi: ${dto.customInstructions}\n` : ''}
1. Nazariy qism:
- ${dto.topic} mavzusi bo'yicha qoidalar va formulalarni yodlash.

2. Amaliy mashqlar:
- Darslikdagi tegishli mavzu bo'yicha 1-5 gacha mashqlarni daftarga to'liq yechish.
- O'rganilgan yangi terminlar ishtirokida 5 ta mustaqil misol yoki gap tuzish.

3. Kengaytirilgan topshiriq:
- Keyingi mavzu bo'yicha qisqa tayyorgarlik ko'rish.`;
  }

  async suggestHomework(dto: { subject?: string; groupName?: string; topic?: string; level?: string; request?: string }) {
    const subject = dto.subject || 'Ingliz tili';
    const groupName = dto.groupName || '';
    const topic = dto.topic || '';
    const request = dto.request?.trim() || '';

    try {
      if (this.aiConfigured()) {
        const prompt = `Sen o'quv markazi uchun tajribali o'qituvchi yordamchisisan.
Quyidagi guruh va fan uchun aniq, qiziqarli va professional uyga vazifa (homework) tavsiya et.
Fan: ${subject}
Guruh nomi: ${groupName || "umumiy"}
Mavzu (agar ko'rsatilgan bo'lsa): ${topic || "navbatdagi mavzu"}
Daraja: ${dto.level || "ko'rsatilmagan"}
O'qituvchining talabi (eng muhimi, aynan shunga mos vazifa tuz): ${request || "yo'q"}
Vazifa matni o'qituvchi talabidagi tilda bo'lsin.

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
        const text = await this.complete(prompt, 4000);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            title: String(parsed.title ?? '').slice(0, 160),
            description: String(parsed.description ?? ''),
            content: typeof parsed.content === 'string' && parsed.content.trim() ? parsed.content.trim() : null,
            dueDays: parsed.dueDays || 3,
          };
        }
      }
    } catch {
      // Fallback
    }

    // Without an AI key: still honour the teacher's own description.
    if (request) {
      return {
        title: topic || request.split(/[.!?\n]/)[0].slice(0, 80),
        description: `1. ${request}\n2. Bajarilgan ishni daftarga toza yozib, keyingi darsga olib keling.\n3. Tushunmagan joylaringizni belgilab, savol sifatida yozib keling.`,
        dueDays: 3,
        content: null,
      };
    }

    const isEnglish = /ingliz|ielts|cefr|english/i.test(`${subject} ${groupName} ${topic}`);
    const isMath = /matem|math|algebra|geomet/i.test(`${subject} ${groupName} ${topic}`);

    if (isEnglish) {
      return {
        title: topic ? `${topic} — Homework & Practice` : `${groupName || "English"} — Unit 4 Grammar & Vocabulary`,
        description: `1. Kitobdagi 4-mavzu bo'yicha Ex 1-6 mashqlarni daftarda to'liq bajaring.\n2. Berilgan 15 ta yangi so'z bilan kamida 2 tadan gap tuzing.\n3. Reading matnini o'qib, savollarga yozma javob tayyorlang (kamida 80-100 so'z).`,
        dueDays: 3,
        content: null,
      };
    } else if (isMath) {
      return {
        title: topic ? `${topic} — Misollar to'plami` : `${groupName || "Matematika"} — Amaliy masalalar va formulalar`,
        description: `1. Darslikdagi §12 mavzu qoidalarini takrorlash va formulalarni yodlash.\n2. 145-155-misollarni daftarga to'liq yechish (har bir qadamni ko'rsatgan holda).\n3. 2 ta murakkabroq mantiqiy masalani mustaqil yechishga harakat qiling.`,
        dueDays: 2,
        content: null,
      };
    } else {
      return {
        title: topic ? `${topic} — Mustaqil ish` : `${subject} — Amaliy topshiriq va mashqlar`,
        description: `1. O'tilgan mavzu bo'yicha konspektni to'ldiring.\n2. Mavzu oxiridagi savollarga yozma javob yozing.\n3. Amaliy mashqlarni bajaring va keyingi darsda savollarga tayyor bo'ling.`,
        dueDays: 3,
        content: null,
      };
    }
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
      .slice(0, 300);
    if (questions.length === 0) throw new ServiceUnavailableException('Matndan savollar topilmadi.');
    return questions;
  }
}

