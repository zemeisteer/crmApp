// Prompts that write a whole IELTS mock test from scratch: first find what
// is current (topics, task types) with a web search, then write each section
// at the chosen level. Everything is new text: nothing is copied from books.

export const LEVEL_GUIDE: Record<string, string> = {
  B4: 'target band 4.0-4.5: everyday topics, short simple sentences, common vocabulary, direct questions where the answer is stated plainly',
  B5: 'target band 5.0-5.5: familiar topics, some longer sentences, mostly common vocabulary with a few topic words, answers need little inference',
  B6: 'target band 6.0-6.5: a mix of everyday and academic topics, complex sentences, paraphrase between question and text, some inference',
  B7: 'target band 7.0-7.5: academic topics, dense paragraphs, heavy paraphrase, distractors, Not Given / multiple-choice traps',
  B8: 'target band 8.0+: demanding academic texts, abstract argument, subtle distinctions, very close distractors',
};
export const MIXED_GUIDE = 'the difficulty of a real exam: easy at the start of each section, harder at the end (about band 4.5 rising to 8)';

export const guideOf = (level: string | null) => (level ? LEVEL_GUIDE[level] ?? MIXED_GUIDE : MIXED_GUIDE);

export function trendsPrompt(level: string | null, module: string) {
  return `Search the web for what is CURRENT in IELTS ${module === 'GENERAL' ? 'General Training' : 'Academic'} tests: the topics that appear most often in recent exams and teacher/prep sites (Listening contexts, Reading passage subjects, Writing Task 1 and Task 2 themes, Speaking Part 1/2/3 topics) and which question types are most used. ${level ? `Focus on what suits ${guideOf(level)}.` : ''}
Reply with JSON only:
{"listening": ["4 current topics, one per part"], "reading": ["3 passage subjects"], "writing": {"task1": "a current Task 1 type and subject", "task2": "a current Task 2 theme and essay type"}, "speaking": {"part1": ["3 topics"], "part2": "a cue-card topic", "part3": "the abstract theme for Part 3"}, "questionTypes": ["the most used question types"]}`;
}

const RULES = `Question JSON, one object per NUMBERED question, in order:
{"no": 1, "type": "...", "prompt": "...", "options": [...], "correctAnswer": "...", "section": "Questions 1-5", "instruction": "...", "explanation": "one sentence: where the answer is and why"}
Types: "FILL_BLANK" (prompt has the gap as ______; correctAnswer = the word(s), alternatives joined with |), "SHORT_ANSWER", "MCQ" (options [{"id":"A","text":"..."}], correctAnswer = the letter), "MCQ_MULTI" (ONE object for "choose TWO", correctAnswer "B,E"), "TRUE_FALSE_NG" (correctAnswer "true" | "false" | "ng"), matching: ONE "MCQ" per item with the full list as options.
"section" = the range heading, "instruction" = the task instruction with the word limit, repeated for each question of the group. Every question MUST have a correct answer that the text/audio really supports, and an "explanation". Use a variety of question types as in a real exam.`;

export function listeningPartPrompt(part: number, topic: string, level: string | null, from: number, count: number) {
  const kind = [
    'a conversation between two people in an everyday social context (booking, enquiry)',
    'a monologue in an everyday social context (a talk, a guide, an announcement)',
    'a conversation between up to four people in an educational context (students and a tutor)',
    'an academic lecture (monologue)',
  ][part - 1];
  return `Write Part ${part} of an original IELTS Listening test: ${kind}, topic: ${topic}. Level: ${guideOf(level)}.
First the audioscript: natural spoken English with speaker names as "Name:", long enough for about 4 minutes of audio at normal speed. Then ${count} questions numbered ${from}-${from + count - 1} that follow the order of the audio.
${RULES}
Reply with JSON only: {"title": "Part ${part}", "instruction": null, "transcript": "the full audioscript", "questions": [ ... ]}`;
}

export function readingPassagePrompt(n: number, topic: string, level: string | null, from: number, count: number, module: string) {
  return `Write Passage ${n} of an original IELTS ${module === 'GENERAL' ? 'General Training' : 'Academic'} Reading test on: ${topic}. Level: ${guideOf(level)}.
The passage: at least ${n === 3 ? '850' : '750'} words (never shorter), up to ${n === 3 ? '950' : '900'}, in paragraphs lettered "A", "B", ... at the start of each paragraph, with a title. Then ${count} questions numbered ${from}-${from + count - 1}, in the order of the passage (except matching headings / information, which come first in their group).
${RULES}
Reply with JSON only: {"title": "...", "text": "the passage, paragraphs separated by a blank line", "questions": [ ... ]}`;
}

export function writingGenPrompt(task1: string, task2: string, level: string | null, module: string) {
  return `Write the Writing section of an original IELTS ${module === 'GENERAL' ? 'General Training' : 'Academic'} test. Level: ${guideOf(level)}.
Task 1 (${module === 'GENERAL' ? 'a letter: situation and three bullet points to cover' : 'describe a chart, table, graph, map or process'}), theme: ${task1}. ${module === 'GENERAL' ? '' : 'After the instruction line write "[Chart]" and a precise description of the data in English, with every label, year and number, so a candidate can write without the picture.'}
Task 2: an essay question on: ${task2}.
Reply with JSON only: {"tasks": [{"title": "Task 1", "prompt": "...", "minWords": 150}, {"title": "Task 2", "prompt": "...", "minWords": 250}]}`;
}

export function speakingGenPrompt(t: { part1: string[]; part2: string; part3: string }, level: string | null) {
  return `Write the Speaking section of an original IELTS test. Level: ${guideOf(level)}.
Part 1: 8 short questions on these topics: ${t.part1.join(', ')}. Part 2: one cue card on: ${t.part2} (topic line, 3-4 "You should say" points, "and explain" line). Part 3: 5 abstract discussion questions on: ${t.part3}.
Reply with JSON only: {"parts": [{"title": "Part 1", "instruction": null, "questions": ["..."]}, {"title": "Part 2", "instruction": "You will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say.", "questions": ["the whole cue card as one string"]}, {"title": "Part 3", "instruction": null, "questions": ["..."]}]}`;
}
