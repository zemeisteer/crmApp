import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { DB, Database } from '../db/db.module';
import { groups, payments, attendance } from '../db/schema';
import { GenerateMaterialDto, PlacementTestDto } from './dto/ai.dto';
import { bankFor, pickFromBank, type PlacementQuestion } from './placement-bank';

// Cleans AI (or client) supplied placement questions; drops broken ones.
export function normalizePlacementQuestions(raw: unknown): PlacementQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PlacementQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q.prompt !== 'string' || !q.prompt.trim()) continue;
    const level = ([1, 2, 3].includes(q.level) ? q.level : 2) as 1 | 2 | 3;
    const options = Array.isArray(q.options) ? q.options.map((o: unknown) => String(o)) : [];
    const type = q.type === 'TRUE_FALSE' || q.type === 'SHORT_ANSWER' ? q.type : 'MCQ';
    if (type === 'SHORT_ANSWER') {
      const answer = typeof q.answer === 'string' ? q.answer.trim() : '';
      if (!answer) continue;
      out.push({ type, prompt: q.prompt.trim(), options: [], answer, level });
    } else {
      const opts = type === 'TRUE_FALSE' && options.length !== 2 ? ['True', 'False'] : options;
      if (opts.length < 2 || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= opts.length) continue;
      out.push({ type, prompt: q.prompt.trim(), options: opts, correctIndex: q.correctIndex, level });
    }
  }
  return out;
}

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

Javobni FAQAT quyidagi JSON formatida ber (boshqa hech qanday so'z qo'shma):
{
  "title": "Vazifa sarlavhasi (masalan: Unit 5: Present Perfect vs Past Simple mashqlari)",
  "description": "Vazifaning qisqa va aniq bandlari (1. ..., 2. ..., 3. ...)",
  "dueDays": 3
}`;
        const text = await this.complete(prompt, 500);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            title: parsed.title,
            description: parsed.description,
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
      };
    }

    const isEnglish = /ingliz|ielts|cefr|english/i.test(`${subject} ${groupName} ${topic}`);
    const isMath = /matem|math|algebra|geomet/i.test(`${subject} ${groupName} ${topic}`);

    if (isEnglish) {
      return {
        title: topic ? `${topic} — Homework & Practice` : `${groupName || "English"} — Unit 4 Grammar & Vocabulary`,
        description: `1. Kitobdagi 4-mavzu bo'yicha Ex 1-6 mashqlarni daftarda to'liq bajaring.\n2. Berilgan 15 ta yangi so'z bilan kamida 2 tadan gap tuzing.\n3. Reading matnini o'qib, savollarga yozma javob tayyorlang (kamida 80-100 so'z).`,
        dueDays: 3,
      };
    } else if (isMath) {
      return {
        title: topic ? `${topic} — Misollar to'plami` : `${groupName || "Matematika"} — Amaliy masalalar va formulalar`,
        description: `1. Darslikdagi §12 mavzu qoidalarini takrorlash va formulalarni yodlash.\n2. 145-155-misollarni daftarga to'liq yechish (har bir qadamni ko'rsatgan holda).\n3. 2 ta murakkabroq mantiqiy masalani mustaqil yechishga harakat qiling.`,
        dueDays: 2,
      };
    } else {
      return {
        title: topic ? `${topic} — Mustaqil ish` : `${subject} — Amaliy topshiriq va mashqlar`,
        description: `1. O'tilgan mavzu bo'yicha konspektni to'ldiring.\n2. Mavzu oxiridagi savollarga yozma javob yozing.\n3. Amaliy mashqlarni bajaring va keyingi darsda savollarga tayyor bo'ling.`,
        dueDays: 3,
      };
    }
  }

  async generateExamQuestions(topic: string, subject?: string, count: number = 5): Promise<Array<{
    prompt: string;
    questionType: 'MCQ' | 'TRUE_FALSE';
    options: Array<{ id: string; text: string }>;
    correctAnswer: string;
    explanation?: string;
    points: number;
  }>> {
    try {
      if (this.aiConfigured()) {
        const prompt = `Sen o'quv markazi uchun professional test tuzuvchisisan.
Quyidagi fan va mavzu bo'yicha ${count} ta sifatli, qiziqarli test savolini o'zbek tilida tuz:
Fan: ${subject || 'Umumiy'}
Mavzu: ${topic}

Javobni FAQAT valid JSON array ko'rinishida ber (hech qanday markdown yoki tushuntirishsiz, faqat xom JSON array):
[
  {
    "prompt": "Savol matni?",
    "questionType": "MCQ",
    "options": [
      { "id": "A", "text": "Variant 1" },
      { "id": "B", "text": "Variant 2" },
      { "id": "C", "text": "Variant 3" },
      { "id": "D", "text": "Variant 4" }
    ],
    "correctAnswer": "A",
    "explanation": "Nima sababdan ushbu javob to'g'riligi haqida qisqa izoh",
    "points": 1
  }
]`;
        const text = await this.complete(prompt, 1500);
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.map((q: any) => ({
              prompt: String(q.prompt || 'Savol matni'),
              questionType: (q.questionType === 'TRUE_FALSE' ? 'TRUE_FALSE' : 'MCQ') as 'MCQ' | 'TRUE_FALSE',
              options: Array.isArray(q.options) ? q.options : [
                { id: 'A', text: 'Variant A' },
                { id: 'B', text: 'Variant B' },
                { id: 'C', text: 'Variant C' },
                { id: 'D', text: 'Variant D' },
              ],
              correctAnswer: String(q.correctAnswer || 'A'),
              explanation: q.explanation ? String(q.explanation) : undefined,
              points: Number(q.points) || 1,
            }));
          }
        }
      }
    } catch {
      // Fallback
    }

    return [
      {
        prompt: `"${topic}" mavzusi bo'yicha eng muhim asosiy tushuncha yoki qoida qaysi javobda to'g'ri ifodalangan?`,
        questionType: 'MCQ',
        options: [
          { id: 'A', text: `${topic} ning asosiy nazariy ta'rifi va amaliy qo'llanilishi` },
          { id: 'B', text: 'Mavzuga to\'g\'ri kelmaydigan chalg\'ituvchi variant' },
          { id: 'C', text: 'Faqat ikkinchi darajali xususiyatlar' },
          { id: 'D', text: 'Teskari ma\'nodagi noto\'g\'ri tushuncha' },
        ],
        correctAnswer: 'A',
        explanation: `${topic} bo'yicha asosiy ta'rif qoidaga to'liq mos keladi.`,
        points: 1,
      },
      {
        prompt: `Amaliyotda "${topic}" bilan ishlashda qaysi qoidaga qat'iy amal qilish lozim?`,
        questionType: 'MCQ',
        options: [
          { id: 'A', text: 'Shartlarni e\'tiborga olmasdan tezkor ishlash' },
          { id: 'B', text: 'Ketma-ketlik va tekshirish bosqichlariga rioya qilish' },
          { id: 'C', text: 'Hech qanday qo\'shimcha qoidaga hojat yo\'q' },
          { id: 'D', text: 'Faqat oxirgi natijani tekshirish' },
        ],
        correctAnswer: 'B',
        explanation: 'Ketma-ketlik va tekshiruv har doim to\'g\'ri natijani kafolatlaydi.',
        points: 1,
      },
      {
        prompt: `Tasdiqlang: "${topic}" tushunchasi o'rganilayotgan fanning muhim amaliy bo'limlaridan biri hisoblanadi.`,
        questionType: 'TRUE_FALSE',
        options: [
          { id: 'true', text: 'To\'g\'ri (Rost)' },
          { id: 'false', text: 'Noto\'g\'ri (Yolg\'on)' },
        ],
        correctAnswer: 'true',
        explanation: 'Ushbu tasdiq fan dasturida to\'liq tasdiqlangan.',
        points: 1,
      },
      {
        prompt: `Quyidagi misollardan qaysi biri "${topic}" ga to'g'ridan-to'g'ri misol bo'la oladi?`,
        questionType: 'MCQ',
        options: [
          { id: 'A', text: 'Standart amaliy misol va holat' },
          { id: 'B', text: 'Tegishli bo\'lmagan holat' },
          { id: 'C', text: 'Qarama-qarshi holat' },
          { id: 'D', text: 'Barcha javoblar noto\'g\'ri' },
        ],
        correctAnswer: 'A',
        explanation: 'Standart misol ushbu mavzuni to\'liq yoritadi.',
        points: 1,
      },
      {
        prompt: `"${topic}" mavzusida eng ko'p uchraydigan tipik xatolik nimada?`,
        questionType: 'MCQ',
        options: [
          { id: 'A', text: 'Nazariy qoidalarni e\'tibordan chetda qoldirish' },
          { id: 'B', text: 'Keragidan ortiq to\'g\'ri ishlash' },
          { id: 'C', text: 'Barcha qoidalarga qat\'iy bo\'ysunish' },
          { id: 'D', text: 'Xatolik umuman bo\'lmaydi' },
        ],
        correctAnswer: 'A',
        explanation: 'Nazariy qoidalarni e\'tibordan chetda qoldirish ko\'pincha xatolarga sabab bo\'ladi.',
        points: 1,
      },
    ];
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
    return { subject, source: 'bank' as const, questions: pickFromBank(bank, count, target) };
  }

  private async aiPlacementQuestions(subject: string, count: number, level: string | null, groupLevel: string | null, language: string): Promise<PlacementQuestion[]> {
    const lang = language === 'RU' ? 'rus' : language === 'EN' ? 'ingliz' : "o'zbek";
    const prompt = `Sen o'quv markazi uchun daraja aniqlash (placement) testini tuzasan.
Fan: ${subject}
Kutilayotgan daraja: ${level ?? groupLevel ?? "noma'lum — barcha darajalarni teng qamrab ol"}
Savollar soni: ${count}
Savollar tili: ${lang} (til fanining o'zi bo'lsa, savollar o'sha tilda bo'lsin).
Savol turlari ARALASH bo'lsin, bir xil turdagi savollar ketma-ket kelmasin:
- taxminan 60% "MCQ": 4 ta variant, bittasi to'g'ri ("correctIndex" 0-3);
- taxminan 20% "TRUE_FALSE": tasdiq, options ["True","False"] (yoki savol tilida), "correctIndex" 0 = to'g'ri, 1 = noto'g'ri;
- taxminan 20% "SHORT_ANSWER": bo'sh joyni to'ldirish yoki qisqa javob (1-3 so'z yoki son), options [], "answer" — to'g'ri javob, muqobil yozilishlar "|" bilan ("6|x=6").
Savollar mavzusi ham xilma-xil bo'lsin (grammatika, lug'at, o'qib tushunish, masala va h.k. — fanga qarab).
Osondan qiyinga: level 1 (boshlang'ich), 2 (o'rta), 3 (yuqori), taxminan teng taqsimlangan.

Javobni FAQAT JSON massiv ko'rinishida ber, boshqa so'z qo'shma:
[{"type": "MCQ", "prompt": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "level": 1},
 {"type": "TRUE_FALSE", "prompt": "...", "options": ["True", "False"], "correctIndex": 1, "level": 2},
 {"type": "SHORT_ANSWER", "prompt": "... ______ ...", "options": [], "answer": "went", "level": 2}]`;
    // Roomy budget: long tests got cut off mid-JSON.
    const text = await this.complete(prompt, Math.max(8000, count * 800));
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return normalizePlacementQuestions(JSON.parse(match[0])).slice(0, count);
  }

  // Reads a test from a PDF and returns its questions in the question-bank
  // format. Copies questions as written (no new ones); the correct answer is
  // filled only when the PDF shows it (answer key, marked option).
  async extractQuestionsFromPdf(pdf: Buffer) {
    if (!this.aiConfigured()) {
      throw new ServiceUnavailableException(
        "PDF'dan savollarni o'qish uchun AI kerak: backend/.env fayliga GEMINI_API_KEY (bepul) qo'shing.",
      );
    }
    const prompt = `Bu PDF faylda test (imtihon) bor. Undagi BARCHA savollarni aynan qanday yozilgan bo'lsa shunday, o'z tilida ko'chirib ol.
Yangi savol o'ylab topma, matnni tarjima qilma, tuzatma.
- Variantli savollar: questionType "MCQ", variantlar A, B, C, D ... tartibida.
- To'g'ri/Noto'g'ri savollar: questionType "TRUE_FALSE", options [{"id":"true","text":"True"},{"id":"false","text":"False"}].
- Variantsiz (ochiq javobli) savollar: questionType "SHORT_ANSWER", options [].
- correctAnswer: PDF'da javoblar kaliti yoki belgilangan javob bo'lsa — variant harfi ("A"), "true"/"false" yoki qisqa javob matni. Javob ko'rsatilmagan bo'lsa null.
- Savoldagi rasm yoki formulani matn bilan iloji boricha ifodalab yoz.

Javobni FAQAT JSON massiv ko'rinishida ber, boshqa so'z qo'shma:
[{"prompt": "...", "questionType": "MCQ", "options": [{"id": "A", "text": "..."}], "correctAnswer": "A", "points": 1}]`;
    const text = await this.complete(prompt, 8000, pdf);
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new ServiceUnavailableException("PDF'dan savollar topilmadi. Fayl test ekanini tekshiring.");
    let raw: unknown;
    try {
      raw = JSON.parse(match[0]);
    } catch {
      throw new ServiceUnavailableException("AI javobini o'qib bo'lmadi, qaytadan urinib ko'ring.");
    }
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((q) => q && typeof q.prompt === 'string' && q.prompt.trim())
      .slice(0, 200)
      .map((q) => {
        const type: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' =
          q.questionType === 'TRUE_FALSE' ? 'TRUE_FALSE' : q.questionType === 'SHORT_ANSWER' ? 'SHORT_ANSWER' : 'MCQ';
        const options: Array<{ id: string; text: string }> = Array.isArray(q.options)
          ? q.options
              .filter((o: { text?: unknown }) => o && o.text !== undefined)
              .map((o: { id?: unknown; text: unknown }, i: number) => ({ id: String(o.id ?? String.fromCharCode(65 + i)), text: String(o.text) }))
          : [];
        const answer = q.correctAnswer === null || q.correctAnswer === undefined ? null : String(q.correctAnswer).trim();
        return {
          prompt: String(q.prompt).trim(),
          questionType: type,
          options: type === 'TRUE_FALSE' && options.length === 0 ? [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] : options,
          correctAnswer: answer || null,
          points: Number.isInteger(q.points) && q.points > 0 ? q.points : 1,
        };
      });
  }
}

