// Prompts that turn an uploaded IELTS book into mock tests: first find the
// tests in the book (from page text, or page by page for scanned books),
// then read each section's pages into the app's JSON.

const QUESTION_RULES = `Question JSON (one object per NUMBERED question, in paper order):
{"no": 1, "type": "...", "prompt": "...", "options": [...], "correctAnswer": "...", "section": "Questions 1-10", "instruction": "..."}
Types:
- "FILL_BLANK": form/note/table/flow-chart/summary/sentence completion and diagram labels with a written answer. "prompt" = the line of the task with the gap written as ______ (e.g. "Name of hotel: ______", "The bees return to the ______ at night."). Keep table/notes context in the line.
- "SHORT_ANSWER": a direct question answered in a few words.
- "MCQ": one letter. "options": [{"id":"A","text":"..."}, ...].
- "MCQ_MULTI": "Choose TWO/THREE letters". ONE object for the whole group, "no" = its first number, "options" as for MCQ, "correctAnswer" = the letters joined with commas, e.g. "B,E".
- "TRUE_FALSE_NG": TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN; "correctAnswer": "true" | "false" | "ng" (YES = true, NO = false).
- Matching of any kind (features, headings, information, sentence endings, map/plan labelling with letters, matching a list to people/places): ONE "MCQ" PER NUMBERED ITEM, "options" = the FULL list from the box (id = the letter or roman numeral as printed, text = its text; for letters on a map/plan with no text use the letter as text), "prompt" = the item.
"section" = the question range heading ("Questions 11-15"); "instruction" = the task instruction exactly as printed (word limits etc.), repeated for every question of the group.
Answers ("correctAnswer") come ONLY from the answer key pages. Alternatives written "A / B" or "A OR B" become "A|B"; optional words in brackets stay in round brackets: "(the) station|train station". If the key does not give an answer, use "".
Copy the text exactly: do not translate, correct, shorten, add or skip anything.`;

export function locatePrompt(outline: string, pages: number) {
  return `You are given the text of every page of an uploaded IELTS book or test booklet (${pages} pages; some pages may be empty images).
Find every complete practice test in it and where its parts are.

PAGES (page number: beginning of the page text):
"""
${outline}
"""

Reply with JSON only:
{"book": "e.g. Cambridge IELTS 18 Academic", "module": "ACADEMIC" or "GENERAL",
 "tests": [{"title": "Test 1", "estimatedLevel": null,
            "listening": "5-12", "reading": "13-26", "writing": "27-28", "speaking": "29-30",
            "answerKey": "115-116", "audioscript": "95-101"}]}
Rules: page ranges are inclusive, 1-based, as listed above. Include answer key and audioscript (tapescript/transcript) pages of THAT test only. Leave a section "" when the test does not have it. "estimatedLevel": null for official full-difficulty IELTS papers (e.g. Cambridge IELTS books); for graded practice material give the target band as "B4" (4.0-4.5), "B5" (5.0-5.5), "B6" (6.0-6.5), "B7" (7.0-7.5) or "B8" (8.0+). General Training books: "module": "GENERAL".`;
}

// Scanned book: labels for each page of one chunk (the PDF attached holds
// pages `from`..`from + count - 1` of the book).
export function labelPagesPrompt(from: number, count: number) {
  return `The attached PDF is pages ${from}-${from + count - 1} of a scanned IELTS book. For EACH page, say which practice test it belongs to and what it is.
Reply with JSON only: {"book": "title if visible, else null", "module": "ACADEMIC" or "GENERAL", "pages": [{"page": ${from}, "test": 1, "kind": "listening"}]}
"page": the book page number (${from} for the first page of the attachment, then +1 each page).
"test": the test number printed on/around the page (Test 1, Test 2...), null if none.
"kind": one of "listening", "reading", "writing", "speaking", "answerKey", "audioscript", "other" (contents, introduction, advertising...).`;
}

export function listeningPrompt(hasAudio: boolean) {
  return `The attached PDF has the LISTENING section of one IELTS test (question pages), its answer key${hasAudio ? '' : ' and its audioscript'}.
Build the four parts (Part 1-4 / Section 1-4) with all 40 questions.
${QUESTION_RULES}

Reply with JSON only:
{"parts": [{"title": "Part 1", "instruction": "general instruction of the part or null", ${hasAudio ? '"transcript": null' : '"transcript": "the full audioscript of this part as plain text (speaker names as \\"Name:\\")"'}, "questions": [ ... ]}]}`;
}

export function readingPrompt() {
  return `The attached PDF has the READING section of one IELTS test (three passages with their questions) and its answer key.
Build the passages with all 40 questions.
${QUESTION_RULES}
Passage text: complete, paragraphs separated by a blank line; keep paragraph letters ("A", "B"...) at the start of their paragraphs when printed; keep the title and subtitle as "title".

Reply with JSON only:
{"passages": [{"title": "...", "text": "...", "questions": [ ... ]}]}`;
}

export function writingPrompt() {
  return `The attached PDF has the WRITING section of one IELTS test (Task 1 and Task 2).
Reply with JSON only:
{"tasks": [{"title": "Task 1", "prompt": "the full task text exactly as printed", "minWords": 150}, {"title": "Task 2", "prompt": "...", "minWords": 250}]}
If Task 1 has a chart, graph, table, map, process diagram or letter situation, add after the task text a line "[Chart]" followed by a precise description of it in English with every label and number, so a candidate can write the answer without the picture.`;
}

export function speakingPrompt() {
  return `The attached PDF has the SPEAKING section of one IELTS test (Part 1 introduction topics, Part 2 cue card, Part 3 discussion).
Reply with JSON only:
{"parts": [{"title": "Part 1", "instruction": null, "questions": ["...", "..."]},
           {"title": "Part 2", "instruction": "You will have to talk about the topic for one to two minutes. You have one minute to think about what you are going to say.", "questions": ["the whole cue card as one question: topic line and all 'You should say' points, then the 'and explain' line"]},
           {"title": "Part 3", "instruction": null, "questions": ["...", "..."]}]}
Copy questions exactly. Part 1 has 4-12 short questions (topic names may be given as "Let's talk about ..." lines).`;
}

// First JSON object in a model reply.
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
