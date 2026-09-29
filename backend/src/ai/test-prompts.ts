// Prompts for reading and writing tests with the rich question model
// (common/test-questions.ts). Kept apart from AiService so the wording is
// easy to tune.

const TYPES_HELP = `Savol turlari (type):
- "MCQ": variantli. "options": ["...", "...", ...] (odatda 4 ta), "correctAnswer": to'g'ri variant harfi ("A", "B", ...).
- "TRUE_FALSE": to'g'ri/noto'g'ri. "correctAnswer": "true" yoki "false".
- "TRUE_FALSE_NG": True / False / Not Given. "correctAnswer": "true", "false" yoki "ng".
- "FILL_BLANK": bo'sh joyni to'ldirish (qavsdagi so'zni to'g'ri shaklda yozish ham shu). "correctAnswer": to'g'ri javob.
- "SHORT_ANSWER": qisqa yozma javob. "correctAnswer": to'g'ri javob.
- "MATCHING": moslashtirish. "pairs": [{"left": "chap element", "right": "unga mos o'ng element"}, ...]. "correctAnswer": "". Hech biriga mos kelmaydigan ortiqcha variantlar bo'lsa (masalan IELTS sarlavhalar ro'yxatidagi ortiqchalari): "extra": ["...", ...].
- "WORD_ORDER": so'zlarni tartiblash. "words": berilgan so'zlar ro'yxati (aralash tartibda), "correctAnswer": to'g'ri gap.
- "ERROR_CORRECTION": xatoni topib tuzatish. "correctAnswer": to'g'rilangan gap VA to'g'rilangan so'z (xato so'z emas!), "|" bilan ("There are fewer people here today than yesterday.|fewer").
- "TRANSFORMATION": gapni ma'nosini saqlab qayta yozish (kalit so'z bilan). "correctAnswer": bo'sh joyga tushadigan so'zlar.
- "WORD_FORMATION": katta harfdagi so'zdan yangi so'z yasash. "correctAnswer": yasalgan so'z.
- "ESSAY": insho/xat/erkin yozish. "rubric": baholash mezoni, "correctAnswer": "".
Bir nechta to'g'ri javob bo'lsa "|" bilan ajrat ("where I worked|where I work"); ixtiyoriy so'zni qavsga ol ("(the) Ulugh Beg Madrasa").`;

const FIELDS_HELP = `Har bir savol maydonlari:
{"type": "...", "section": "bo'lim nomi (masalan \\"1. Multiple choice\\")", "instruction": "bo'lim ko'rsatmasi (masalan \\"Circle the correct answer.\\")",
 "passage": "savol tayanadigan o'qish matni (bo'lmasa null)", "prompt": "savol matni", "options": [...], "pairs": [...], "words": [...],
 "correctAnswer": "...", "rubric": "...", "points": ball (butun son), "level": 1|2|3}`;

export function pdfExtractPrompt() {
  return extractPrompt('pdf');
}

// Same rules for a test given as text (e.g. an AI material). A written
// material rarely has an answer key, so the model works the answers out.
export function textExtractPrompt(text: string) {
  return `${extractPrompt('text')}

MATN:
"""
${text}
"""`;
}

function extractPrompt(source: 'pdf' | 'text') {
  const intro = source === 'pdf'
    ? "Bu PDF faylda o'quv markazi testi (imtihon varag'i) bor. Undagi BARCHA savollarni raqamli testga aylantir."
    : "Quyidagi matnda o'quv materiali (test, mashqlar yoki topshiriqlar) bor. Undagi BARCHA savol va mashqlarni raqamli testga aylantir.";
  const answers = source === 'pdf'
    ? `Javob ko'rsatilmagan bo'lsa "correctAnswer": "" qoldir (o'ylab topma).`
    : `Javob ko'rsatilmagan bo'lsa to'g'ri javobni o'zing aniq yech va yoz; javobi bir xil bo'lmaydigan ochiq topshiriqlarni "ESSAY" qil.`;
  return `${intro}

Qoidalar:
- Savollarni AYNAN qanday yozilgan bo'lsa shunday ko'chir: tarjima qilma, tuzatma, yangi savol qo'shma, birortasini ham tashlab ketma.
- Bo'lim ichidagi a), b), c) ... kichik savollarning HAR BIRI alohida savol bo'ladi. Faqat moslashtirish (matching) bo'limi bitta "MATCHING" savol bo'ladi (barcha juftliklar "pairs" ichida).
- Bo'lim sarlavhasini "section" ga, bo'lim ko'rsatmasini "instruction" ga yoz — shu bo'limning har bir savoliga takrorla.
- O'qish matni (reading text) bo'lsa, uni shu matnga tegishli HAR BIR savolning "passage" maydoniga to'liq yoz.
- Ballar: bo'limda ball ko'rsatilgan bo'lsa (masalan "(4 POINTS)" va 4 ta savol) — har bir savolga teng bo'lib ber; MATCHING va ESSAY uchun bo'lim balining hammasi.
- Javoblar kaliti (Answer Key) sahifasi yoki belgilangan javoblar bo'lsa, "correctAnswer" ni shundan ol. ${answers}
- Savoldagi rasm yoki jadvalni iloji boricha matn bilan ifodala.

${TYPES_HELP}

${FIELDS_HELP}

Javobni FAQAT JSON massiv ko'rinishida ber (markdown, izoh qo'shma).`;
}

export function generateTestPrompt(opts: {
  subject: string;
  count: number;
  topic?: string | null;
  level?: string | null;
  language: string;
  request?: string | null;
  withLevels: boolean;
}) {
  const lang = opts.language === 'RU' ? 'rus' : opts.language === 'EN' ? 'ingliz' : "o'zbek";
  return `Sen o'quv markazi uchun tajribali test tuzuvchisisan.
Fan: ${opts.subject}
${opts.topic ? `Mavzu: ${opts.topic}\n` : ''}Daraja: ${opts.level ?? "noma'lum — osondan qiyinga, barcha darajalarni qamrab ol"}
Savollar soni: ${opts.count}
Til: ${lang} (til fanining o'zi bo'lsa, savollar o'sha tilda bo'lsin).
${opts.request ? `O'qituvchi talabi (eng muhimi): ${opts.request}\n` : ''}
Talablar:
- Savol turlari ARALASH bo'lsin (kamida 4-5 xil tur): MCQ, TRUE_FALSE_NG yoki TRUE_FALSE, FILL_BLANK, MATCHING, WORD_ORDER, ERROR_CORRECTION, WORD_FORMATION va h.k. — fanga mosini tanla (matematikada masala va qisqa javob ko'proq).
- Savollarni bo'limlarga ajrat ("section" va "instruction"); bir bo'limda bir xil tur.
- Til fanida bitta qisqa o'qish matni ("passage") va unga 2-4 ta savol bo'lsin.
- ESSAY qo'shma${opts.count >= 15 ? ", faqat oxirida bitta qisqa yozish topshirig'i bo'lishi mumkin" : ''}.
- Har bir savolning aniq to'g'ri javobi bo'lsin; muqobil javoblarni "|" bilan yoz.
- Oddiy matn yoz: LaTeX ($...$), markdown yoki HTML ishlatma; formulalarni "2x + 5 = 15", "x^2", "√16" kabi yoz.
${opts.withLevels ? "- Har bir savolga \"level\" ber: 1 (boshlang'ich), 2 (o'rta), 3 (yuqori); taxminan teng taqsimla, osondan qiyinga.\n" : ''}
${TYPES_HELP}

${FIELDS_HELP}

Javobni FAQAT JSON massiv ko'rinishida ber (markdown, izoh qo'shma).`;
}

export function essayGradePrompt(opts: { prompt: string; rubric?: string | null; answer: string; maxPoints: number }) {
  return `Sen tajribali o'qituvchisan. O'quvchining yozma ishini bahola.
Topshiriq: ${opts.prompt}
Baholash mezoni: ${opts.rubric || "mazmun, tuzilish, grammatika va lug'at"}
Maksimal ball: ${opts.maxPoints}
O'quvchi javobi:
"""
${opts.answer.slice(0, 6000)}
"""
Javobni FAQAT JSON ko'rinishida ber: {"score": 0 dan ${opts.maxPoints} gacha butun son, "comment": "o'zbek tilida 1-3 jumla: nima yaxshi, nimani tuzatish kerak"}`;
}

// Pulls the JSON array out of a model reply; if the reply was cut off
// mid-array, keeps the complete items.
export function parseJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  if (start < 0) return [];
  const body = text.slice(start);
  const end = body.lastIndexOf(']');
  if (end > 0) {
    try {
      const parsed = JSON.parse(body.slice(0, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to the salvage below
    }
  }
  const lastItem = body.lastIndexOf('},');
  if (lastItem > 0) {
    try {
      const parsed = JSON.parse(body.slice(0, lastItem + 1) + ']');
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}
