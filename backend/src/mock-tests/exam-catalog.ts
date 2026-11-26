import type { QuestionType } from '../common/test-questions';

// The exams a center can build a practice test from, per language or
// direction: their real sections and timing, the question types of each
// part and the levels they are taken at. A test made from one starts with
// that structure (each part knows its question type and count) and the AI
// can fill every part at once (MockFillService). IELTS keeps its own format
// (ielts.ts) and is listed here only so the picker can show it.

export type ExamLanguage =
  | 'ENGLISH'
  | 'RUSSIAN'
  | 'GERMAN'
  | 'FRENCH'
  | 'TURKISH'
  | 'ARABIC'
  | 'KOREAN'
  | 'JAPANESE'
  | 'CHINESE'
  | 'SAT'
  | 'MATH'
  | 'PROGRAMMING';

export interface ExamPartSpec {
  title: string;
  type: QuestionType;
  count: number;
  // What the student is told above the questions.
  instruction: string;
  // A reading text (or dialogue, notice, code) the questions are about.
  text?: 'reading' | 'dialogue' | 'notice' | 'code' | null;
  // What the AI is told about this part beyond the type and count.
  hint?: string;
}

export interface ExamSectionSpec {
  title: string;
  durationMin: number;
  instruction?: string;
  parts: ExamPartSpec[];
  task?: { prompt: string; minWords: number };
}

export interface ExamSpec {
  id: string;
  language: ExamLanguage;
  name: string;
  // One line for the picker.
  about: string;
  // Language the questions are written in (for the AI).
  target: string;
  levels: string[];
  sections: ExamSectionSpec[];
  // IELTS has its own editor and AI writer; the picker sends it there.
  ielts?: boolean;
}

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1'];

export const EXAMS: ExamSpec[] = [
  // ------------------------------------------------------------- English
  {
    id: 'IELTS',
    language: 'ENGLISH',
    name: 'IELTS',
    ielts: true,
    target: 'English',
    about:
      'Listening, Reading, Writing, Speaking — band 4–8, Academic / General',
    levels: ['B4', 'B5', 'B6', 'B7', 'B8'],
    sections: [],
  },
  {
    id: 'CEFR_EN',
    language: 'ENGLISH',
    name: 'CEFR (Multilevel)',
    target: 'English',
    about: 'Milliy sertifikat formati: Reading, Use of English, Writing',
    levels: CEFR,
    sections: [
      {
        title: 'Reading',
        durationMin: 60,
        instruction: 'Read the texts and answer the questions.',
        parts: [
          {
            title: 'Part 1 — Gap fill',
            type: 'FILL_BLANK',
            count: 6,
            text: 'reading',
            instruction: 'Fill each gap with ONE word from the text.',
          },
          {
            title: 'Part 2 — Matching',
            type: 'MATCHING',
            count: 1,
            text: 'notice',
            instruction: 'Match the people to the advertisements.',
            hint: 'one MATCHING question with 6 pairs',
          },
          {
            title: 'Part 3 — True / False / Not Given',
            type: 'TRUE_FALSE_NG',
            count: 8,
            text: 'reading',
            instruction: 'Do the statements agree with the text?',
          },
          {
            title: 'Part 4 — Multiple choice',
            type: 'MCQ',
            count: 8,
            text: 'reading',
            instruction: 'Choose the correct answer A, B, C or D.',
          },
        ],
      },
      {
        title: 'Use of English',
        durationMin: 30,
        instruction: 'Grammar and vocabulary in context.',
        parts: [
          {
            title: 'Grammar',
            type: 'MCQ',
            count: 10,
            instruction: 'Choose the correct option.',
          },
          {
            title: 'Word formation',
            type: 'WORD_FORMATION',
            count: 6,
            instruction: 'Form a word from the word in capitals.',
          },
          {
            title: 'Key word transformation',
            type: 'TRANSFORMATION',
            count: 4,
            instruction: 'Rewrite the sentence using the word given.',
          },
        ],
      },
      {
        title: 'Writing',
        durationMin: 45,
        parts: [],
        task: {
          prompt:
            'Task 1: write a letter or email (about 150 words). Task 2: write an essay giving your opinion (about 200 words).',
          minWords: 150,
        },
      },
    ],
  },
  {
    id: 'GENERAL_EN',
    language: 'ENGLISH',
    name: 'General English',
    target: 'English',
    about: 'Grammar, Vocabulary, Reading, Writing — darajaga mos',
    levels: CEFR,
    sections: [
      {
        title: 'Grammar and Vocabulary',
        durationMin: 25,
        parts: [
          {
            title: 'Grammar',
            type: 'MCQ',
            count: 12,
            instruction: 'Choose the correct option.',
          },
          {
            title: 'Vocabulary',
            type: 'FILL_BLANK',
            count: 8,
            instruction: 'Complete the sentences with the right word.',
          },
          {
            title: 'Find the mistake',
            type: 'ERROR_CORRECTION',
            count: 5,
            instruction: 'Each sentence has one mistake. Write it correctly.',
          },
        ],
      },
      {
        title: 'Reading',
        durationMin: 25,
        parts: [
          {
            title: 'Text 1',
            type: 'TRUE_FALSE',
            count: 6,
            text: 'reading',
            instruction: 'True or false?',
          },
          {
            title: 'Text 2',
            type: 'MCQ',
            count: 6,
            text: 'reading',
            instruction: 'Choose the correct answer.',
          },
        ],
      },
      {
        title: 'Writing',
        durationMin: 25,
        parts: [],
        task: {
          prompt:
            'Write an email to a friend about your last holiday (100–150 words).',
          minWords: 100,
        },
      },
    ],
  },
  // ------------------------------------------------------------- Russian
  {
    id: 'CEFR_RU',
    language: 'RUSSIAN',
    name: 'CEFR (Milliy sertifikat)',
    target: 'Russian',
    about: 'Чтение, Лексика и грамматика, Письмо — A1–C1',
    levels: CEFR,
    sections: [
      {
        title: 'Чтение',
        durationMin: 50,
        instruction: 'Прочитайте тексты и выполните задания.',
        parts: [
          {
            title: 'Задание 1 — Верно / неверно / нет информации',
            type: 'TRUE_FALSE_NG',
            count: 8,
            text: 'reading',
            instruction: 'Соответствуют ли утверждения тексту?',
          },
          {
            title: 'Задание 2 — Выберите ответ',
            type: 'MCQ',
            count: 8,
            text: 'reading',
            instruction: 'Выберите правильный вариант.',
          },
          {
            title: 'Задание 3 — Заполните пропуски',
            type: 'FILL_BLANK',
            count: 6,
            text: 'reading',
            instruction: 'Вставьте пропущенное слово.',
          },
        ],
      },
      {
        title: 'Лексика и грамматика',
        durationMin: 30,
        parts: [
          {
            title: 'Грамматика',
            type: 'MCQ',
            count: 15,
            instruction: 'Выберите правильную форму.',
          },
          {
            title: 'Словообразование',
            type: 'WORD_FORMATION',
            count: 5,
            instruction: 'Образуйте нужную форму слова.',
          },
        ],
      },
      {
        title: 'Письмо',
        durationMin: 45,
        parts: [],
        task: {
          prompt:
            'Напишите письмо другу (около 150 слов) и эссе-рассуждение (около 200 слов).',
          minWords: 150,
        },
      },
    ],
  },
  {
    id: 'TRKI',
    language: 'RUSSIAN',
    name: 'ТРКИ',
    target: 'Russian',
    about:
      'Государственный тест по русскому языку: лексика, грамматика, чтение, письмо',
    levels: [
      'ТЭУ (A1)',
      'ТБУ (A2)',
      'ТРКИ-1 (B1)',
      'ТРКИ-2 (B2)',
      'ТРКИ-3 (C1)',
    ],
    sections: [
      {
        title: 'Лексика. Грамматика',
        durationMin: 50,
        parts: [
          {
            title: 'Часть 1 — Лексика',
            type: 'MCQ',
            count: 15,
            instruction: 'Выберите правильный вариант ответа.',
          },
          {
            title: 'Часть 2 — Грамматика',
            type: 'MCQ',
            count: 20,
            instruction: 'Выберите правильную грамматическую форму.',
          },
        ],
      },
      {
        title: 'Чтение',
        durationMin: 50,
        parts: [
          {
            title: 'Текст 1',
            type: 'MCQ',
            count: 7,
            text: 'reading',
            instruction:
              'Прочитайте текст и выберите вариант, соответствующий его содержанию.',
          },
          {
            title: 'Текст 2',
            type: 'MCQ',
            count: 7,
            text: 'reading',
            instruction: 'Прочитайте текст и выполните задания.',
          },
        ],
      },
      {
        title: 'Письмо',
        durationMin: 50,
        parts: [],
        task: {
          prompt:
            'Напишите письмо-сообщение на заданную тему (не менее 100 слов).',
          minWords: 100,
        },
      },
    ],
  },
  // ------------------------------------------------------------- Other languages
  {
    id: 'GOETHE',
    language: 'GERMAN',
    name: 'Goethe-Zertifikat',
    target: 'German',
    about: 'Lesen, Sprachbausteine, Schreiben — A1–C1',
    levels: CEFR,
    sections: [
      {
        title: 'Lesen',
        durationMin: 65,
        parts: [
          {
            title: 'Teil 1',
            type: 'TRUE_FALSE',
            count: 6,
            text: 'reading',
            instruction: 'Richtig oder falsch?',
          },
          {
            title: 'Teil 2',
            type: 'MCQ',
            count: 6,
            text: 'reading',
            instruction: 'Wählen Sie die richtige Antwort.',
          },
          {
            title: 'Teil 3',
            type: 'MATCHING',
            count: 1,
            text: 'notice',
            instruction: 'Welche Anzeige passt?',
            hint: 'one MATCHING question with 6 pairs',
          },
        ],
      },
      {
        title: 'Sprachbausteine',
        durationMin: 20,
        parts: [
          {
            title: 'Grammatik und Wortschatz',
            type: 'MCQ',
            count: 12,
            instruction: 'Welches Wort passt in die Lücke?',
          },
        ],
      },
      {
        title: 'Schreiben',
        durationMin: 60,
        parts: [],
        task: {
          prompt:
            'Schreiben Sie eine E-Mail (ca. 80–150 Wörter) und einen Forumsbeitrag mit Ihrer Meinung.',
          minWords: 80,
        },
      },
    ],
  },
  {
    id: 'DELF',
    language: 'FRENCH',
    name: 'DELF / DALF',
    target: 'French',
    about: 'Compréhension écrite, grammaire, production écrite — A1–C1',
    levels: CEFR,
    sections: [
      {
        title: 'Compréhension des écrits',
        durationMin: 45,
        parts: [
          {
            title: 'Exercice 1',
            type: 'MCQ',
            count: 6,
            text: 'reading',
            instruction: 'Lisez le document et répondez aux questions.',
          },
          {
            title: 'Exercice 2',
            type: 'TRUE_FALSE',
            count: 6,
            text: 'reading',
            instruction: 'Vrai ou faux ?',
          },
        ],
      },
      {
        title: 'Grammaire et vocabulaire',
        durationMin: 20,
        parts: [
          {
            title: 'Questions',
            type: 'MCQ',
            count: 12,
            instruction: 'Choisissez la bonne réponse.',
          },
        ],
      },
      {
        title: 'Production écrite',
        durationMin: 45,
        parts: [],
        task: {
          prompt:
            'Écrivez un message ou un article pour donner votre opinion (160–180 mots).',
          minWords: 120,
        },
      },
    ],
  },
  {
    id: 'TURKISH',
    language: 'TURKISH',
    name: 'TÖMER / CEFR',
    target: 'Turkish',
    about: 'Okuma, Dil bilgisi, Yazma — A1–C1',
    levels: CEFR,
    sections: [
      {
        title: 'Okuma',
        durationMin: 45,
        parts: [
          {
            title: 'Metin 1',
            type: 'MCQ',
            count: 8,
            text: 'reading',
            instruction: 'Metni okuyun ve doğru seçeneği işaretleyin.',
          },
          {
            title: 'Metin 2',
            type: 'TRUE_FALSE',
            count: 6,
            text: 'reading',
            instruction: 'Doğru mu, yanlış mı?',
          },
        ],
      },
      {
        title: 'Dil bilgisi',
        durationMin: 25,
        parts: [
          {
            title: 'Sorular',
            type: 'MCQ',
            count: 15,
            instruction: 'Boşluğa uygun ifadeyi seçin.',
          },
        ],
      },
      {
        title: 'Yazma',
        durationMin: 40,
        parts: [],
        task: {
          prompt: 'Verilen konuda bir kompozisyon yazın (150–200 kelime).',
          minWords: 120,
        },
      },
    ],
  },
  {
    id: 'CEFR_AR',
    language: 'ARABIC',
    name: 'CEFR (Milliy sertifikat)',
    target: 'Arabic',
    about: 'القراءة، القواعد، الكتابة — A1–C1',
    levels: CEFR,
    sections: [
      {
        title: 'القراءة',
        durationMin: 50,
        parts: [
          {
            title: 'النص ١',
            type: 'MCQ',
            count: 8,
            text: 'reading',
            instruction: 'اقرأ النص واختر الإجابة الصحيحة.',
          },
          {
            title: 'النص ٢',
            type: 'TRUE_FALSE',
            count: 6,
            text: 'reading',
            instruction: 'صح أم خطأ؟',
          },
        ],
      },
      {
        title: 'القواعد والمفردات',
        durationMin: 30,
        parts: [
          {
            title: 'الأسئلة',
            type: 'MCQ',
            count: 15,
            instruction: 'اختر الإجابة الصحيحة.',
          },
        ],
      },
      {
        title: 'الكتابة',
        durationMin: 40,
        parts: [],
        task: {
          prompt: 'اكتب رسالة أو مقالًا قصيرًا عن الموضوع (١٢٠–١٥٠ كلمة).',
          minWords: 100,
        },
      },
    ],
  },
  {
    id: 'TOPIK',
    language: 'KOREAN',
    name: 'TOPIK',
    target: 'Korean',
    about: 'TOPIK I (1–2) va TOPIK II (3–6): 읽기, 쓰기',
    levels: [
      'TOPIK I · 1',
      'TOPIK I · 2',
      'TOPIK II · 3',
      'TOPIK II · 4',
      'TOPIK II · 5',
      'TOPIK II · 6',
    ],
    sections: [
      {
        title: '읽기 (Reading)',
        durationMin: 70,
        parts: [
          {
            title: '어휘·문법',
            type: 'MCQ',
            count: 15,
            instruction: '알맞은 것을 고르십시오.',
          },
          {
            title: '짧은 글',
            type: 'MCQ',
            count: 10,
            text: 'notice',
            instruction: '다음을 읽고 물음에 답하십시오.',
          },
          {
            title: '긴 글',
            type: 'MCQ',
            count: 10,
            text: 'reading',
            instruction: '다음 글을 읽고 물음에 답하십시오.',
          },
        ],
      },
      {
        title: '쓰기 (Writing)',
        durationMin: 50,
        parts: [
          {
            title: '빈칸 채우기',
            type: 'FILL_BLANK',
            count: 4,
            instruction: '빈칸에 알맞은 말을 쓰십시오.',
          },
        ],
        task: {
          prompt: '주어진 주제에 대해 200~300자로 글을 쓰십시오.',
          minWords: 0,
        },
      },
    ],
  },
  {
    id: 'JLPT',
    language: 'JAPANESE',
    name: 'JLPT',
    target: 'Japanese',
    about: '言語知識・読解 — N5–N1',
    levels: ['N5', 'N4', 'N3', 'N2', 'N1'],
    sections: [
      {
        title: '言語知識（文字・語彙）',
        durationMin: 25,
        parts: [
          {
            title: '漢字読み',
            type: 'MCQ',
            count: 8,
            instruction: 'の言葉の読み方として最もよいものを選んでください。',
          },
          {
            title: '文脈規定',
            type: 'MCQ',
            count: 7,
            instruction: '（　）に入れるのに最もよいものを選んでください。',
          },
        ],
      },
      {
        title: '言語知識（文法）・読解',
        durationMin: 50,
        parts: [
          {
            title: '文法形式の判断',
            type: 'MCQ',
            count: 10,
            instruction: '（　）に入れるのに最もよいものを選んでください。',
          },
          {
            title: '内容理解',
            type: 'MCQ',
            count: 8,
            text: 'reading',
            instruction: '次の文章を読んで、質問に答えてください。',
          },
        ],
      },
    ],
  },
  {
    id: 'HSK',
    language: 'CHINESE',
    name: 'HSK',
    target: 'Chinese (simplified)',
    about: '阅读、书写 — HSK 1–6',
    levels: ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6'],
    sections: [
      {
        title: '阅读 (Reading)',
        durationMin: 40,
        parts: [
          {
            title: '第一部分',
            type: 'MCQ',
            count: 10,
            instruction: '选词填空。',
          },
          {
            title: '第二部分',
            type: 'TRUE_FALSE',
            count: 8,
            instruction: '判断对错。',
          },
          {
            title: '第三部分',
            type: 'MCQ',
            count: 10,
            text: 'reading',
            instruction: '阅读短文，选择正确答案。',
          },
        ],
      },
      {
        title: '书写 (Writing)',
        durationMin: 25,
        parts: [
          {
            title: '完成句子',
            type: 'WORD_ORDER',
            count: 8,
            instruction: '把词语排成正确的句子。',
          },
        ],
      },
    ],
  },
  // ------------------------------------------------------------- SAT / Math / IT
  {
    id: 'SAT',
    language: 'SAT',
    name: 'Digital SAT',
    target: 'English',
    about: 'Reading and Writing (2 module) + Math (2 module), 400–1600',
    levels: ['1000–1200', '1200–1400', '1400–1600'],
    sections: [
      {
        title: 'Reading and Writing — Module 1',
        durationMin: 32,
        parts: [
          {
            title: 'Craft and Structure',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the best answer.',
            hint: 'short SAT-style passages inside each question: words in context, text structure and purpose',
          },
          {
            title: 'Information and Ideas',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the best answer.',
            hint: 'central ideas, command of evidence (textual and quantitative), inferences; each question has its own short passage',
          },
          {
            title: 'Standard English Conventions',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the choice that conforms to Standard English.',
            hint: 'boundaries, form, structure and sense',
          },
          {
            title: 'Expression of Ideas',
            type: 'MCQ',
            count: 6,
            instruction: 'Choose the most effective choice.',
            hint: 'rhetorical synthesis and transitions',
          },
        ],
      },
      {
        title: 'Reading and Writing — Module 2',
        durationMin: 32,
        parts: [
          {
            title: 'Craft and Structure',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the best answer.',
            hint: 'harder module: words in context, cross-text connections',
          },
          {
            title: 'Information and Ideas',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the best answer.',
            hint: 'harder module: command of evidence, inferences',
          },
          {
            title: 'Standard English Conventions',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the choice that conforms to Standard English.',
          },
          {
            title: 'Expression of Ideas',
            type: 'MCQ',
            count: 6,
            instruction: 'Choose the most effective choice.',
          },
        ],
      },
      {
        title: 'Math — Module 1',
        durationMin: 35,
        instruction:
          'Calculator allowed. For student-produced responses enter a number.',
        parts: [
          {
            title: 'Algebra and Advanced Math',
            type: 'MCQ',
            count: 10,
            instruction: 'Choose the correct answer.',
            hint: 'linear equations and functions, systems, quadratics, nonlinear functions',
          },
          {
            title: 'Problem Solving, Data, Geometry',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the correct answer.',
            hint: 'ratios, percentages, statistics, probability, area, volume, triangles, circles',
          },
          {
            title: 'Student-produced responses',
            type: 'SHORT_ANSWER',
            count: 5,
            instruction: 'Enter your answer as a number.',
            hint: 'the answer is a single number',
          },
        ],
      },
      {
        title: 'Math — Module 2',
        durationMin: 35,
        instruction:
          'Calculator allowed. For student-produced responses enter a number.',
        parts: [
          {
            title: 'Algebra and Advanced Math',
            type: 'MCQ',
            count: 10,
            instruction: 'Choose the correct answer.',
            hint: 'harder module',
          },
          {
            title: 'Problem Solving, Data, Geometry',
            type: 'MCQ',
            count: 7,
            instruction: 'Choose the correct answer.',
            hint: 'harder module',
          },
          {
            title: 'Student-produced responses',
            type: 'SHORT_ANSWER',
            count: 5,
            instruction: 'Enter your answer as a number.',
            hint: 'the answer is a single number',
          },
        ],
      },
    ],
  },
  {
    id: 'MATH_NATIONAL',
    language: 'MATH',
    name: 'Milliy sertifikat (Matematika)',
    target: 'Uzbek',
    about: 'Test va yozma javobli topshiriqlar: algebra, geometriya',
    levels: ["Boshlang'ich", "O'rta", 'Yuqori'],
    sections: [
      {
        title: '1-qism — Test',
        durationMin: 90,
        parts: [
          {
            title: 'Algebra',
            type: 'MCQ',
            count: 20,
            instruction: "To'g'ri javobni tanlang.",
          },
          {
            title: 'Geometriya',
            type: 'MCQ',
            count: 12,
            instruction: "To'g'ri javobni tanlang.",
          },
        ],
      },
      {
        title: '2-qism — Yozma javob',
        durationMin: 60,
        parts: [
          {
            title: 'Masalalar',
            type: 'SHORT_ANSWER',
            count: 10,
            instruction: 'Javobni son yoki ifoda shaklida yozing.',
          },
        ],
      },
    ],
  },
  {
    id: 'MATH_DTM',
    language: 'MATH',
    name: 'DTM (abituriyent)',
    target: 'Uzbek',
    about: 'Kirish imtihoni formati: 30 ta test, 60 daqiqa',
    levels: ["Boshlang'ich", "O'rta", 'Yuqori'],
    sections: [
      {
        title: 'Matematika',
        durationMin: 60,
        parts: [
          {
            title: 'Algebra',
            type: 'MCQ',
            count: 18,
            instruction: "To'g'ri javobni tanlang.",
          },
          {
            title: 'Geometriya',
            type: 'MCQ',
            count: 12,
            instruction: "To'g'ri javobni tanlang.",
          },
        ],
      },
    ],
  },
  {
    id: 'PROGRAMMING',
    language: 'PROGRAMMING',
    name: 'Dasturlash',
    target: 'Uzbek',
    about: "Nazariya, kodni o'qish, kod yozish",
    levels: ["Boshlang'ich", "O'rta", 'Yuqori'],
    sections: [
      {
        title: 'Nazariya',
        durationMin: 15,
        parts: [
          {
            title: 'Savollar',
            type: 'MCQ',
            count: 10,
            instruction: "To'g'ri javobni tanlang.",
          },
        ],
      },
      {
        title: "Kodni o'qish",
        durationMin: 20,
        instruction: 'Har bir dastur nima chiqaradi?',
        parts: [
          {
            title: 'Kod',
            type: 'SHORT_ANSWER',
            count: 6,
            instruction: 'Dastur chiqaradigan natijani yozing.',
            hint: 'each question shows a short Python program in its prompt',
          },
        ],
      },
      {
        title: 'Kod yozish',
        durationMin: 25,
        parts: [],
        task: {
          prompt:
            "Ro'yxatdagi eng katta sonni qaytaradigan funksiya yozing va yechimingizni qisqa tushuntiring.",
          minWords: 20,
        },
      },
    ],
  },
];

export const examById = (id: string | undefined | null) =>
  EXAMS.find((e) => e.id === id) ?? null;

/** Which languages a direction (group subject) is about; several for a mixed name. */
export function languagesFor(subject: string): ExamLanguage[] {
  const s = subject.toLowerCase();
  const out: ExamLanguage[] = [];
  if (/\bsat\b/.test(s)) out.push('SAT');
  if (/ingliz|english|ielts|cefr|англ/.test(s)) out.push('ENGLISH');
  if (/\brus|русск|russian/.test(s)) out.push('RUSSIAN');
  if (/nemis|german|deutsch|немец/.test(s)) out.push('GERMAN');
  if (/fransuz|french|fran[cç]ais|француз/.test(s)) out.push('FRENCH');
  if (/turk|турец/.test(s)) out.push('TURKISH');
  if (/arab|араб/.test(s)) out.push('ARABIC');
  if (/koreys|korean|корей|topik/.test(s)) out.push('KOREAN');
  if (/yapon|japan|япон|jlpt/.test(s)) out.push('JAPANESE');
  if (/xitoy|chinese|китай|hsk|mandarin/.test(s)) out.push('CHINESE');
  if (/matem|math|algebra|geometr|матем/.test(s)) out.push('MATH');
  if (
    /dastur|program|python|java|kompyuter|informat|информат|программ|\bit\b/.test(
      s,
    )
  )
    out.push('PROGRAMMING');
  return out;
}

/** The exams that fit a direction first, then all the others. */
export function examsFor(subject: string) {
  const langs = languagesFor(subject);
  const fit = EXAMS.filter((e) => langs.includes(e.language));
  const rest = EXAMS.filter((e) => !langs.includes(e.language));
  return { fit: fit.map(publicExam), other: rest.map(publicExam) };
}

export function publicExam(e: ExamSpec) {
  return {
    id: e.id,
    language: e.language,
    name: e.name,
    about: e.about,
    levels: e.levels,
    ielts: !!e.ielts,
    durationMin: e.sections.reduce((s, x) => s + x.durationMin, 0),
    questions: e.sections.reduce(
      (s, x) => s + x.parts.reduce((n, p) => n + p.count, 0),
      0,
    ),
    sections: e.sections.map((s) => ({
      title: s.title,
      durationMin: s.durationMin,
      parts: s.parts.map((p) => ({
        title: p.title,
        type: p.type,
        count: p.count,
      })),
      task: !!s.task,
    })),
  };
}
