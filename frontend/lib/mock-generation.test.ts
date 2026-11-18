// node --test (Node 22 strips the types); no test framework needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { failedIn, marksOf, mergeRetried, partsNeedingAudio, sumMarks } from "./mock-generation.ts";

const q = (type = "FILL_BLANK", correctAnswer = "x") => ({ type, correctAnswer });
const content = () => ({
  listening: { audioPath: null as string | null, parts: [0, 1, 2, 3].map(() => ({ audioPath: null as string | null, transcript: "Anna: hi", questions: [q()] })) },
  reading: { passages: [{ questions: [q()] }, { questions: [] as ReturnType<typeof q>[] }, { questions: [q()] }] },
  writing: { tasks: [] as unknown[] },
  speaking: { parts: [{ questions: ["a?"] }] },
  generation: { failed: [{ key: "reading.1", label: "Reading Passage 2", error: "cut off" }], running: [] as string[], runningSince: null, tts: "UNAVAILABLE" as const, ttsError: null },
});

test("a choose-TWO question counts two IELTS marks", () => {
  assert.equal(marksOf(q("MCQ_MULTI", "A,C")), 2);
  assert.equal(sumMarks([...Array(8)].map(() => q()).concat(q("MCQ_MULTI", "B,E"))), 10);
});

test("failed parts are found per section", () => {
  const c = content();
  assert.deepEqual(failedIn(c, "reading").map((f) => f.label), ["Reading Passage 2"]);
  assert.deepEqual(failedIn(c, "listening"), []);
});

test("an AI test's Listening parts need audio until they (or the section) have a recording", () => {
  const c = content();
  assert.deepEqual(partsNeedingAudio(c), [0, 1, 2, 3]);
  c.listening.parts[1].audioPath = "a1b2c3d4e5.wav";
  assert.deepEqual(partsNeedingAudio(c), [0, 2, 3]);
  c.listening.audioPath = "section1234.mp3";
  assert.deepEqual(partsNeedingAudio(c), []);
  // A test the teacher built by hand is not asked for audio.
  const manual = { ...content(), generation: undefined };
  assert.deepEqual(partsNeedingAudio(manual), []);
});

test("a finished retry replaces only the retried slots and keeps the teacher's other edits", () => {
  const local = content();
  local.reading.passages[0].questions = [q("FILL_BLANK", "edited by teacher")];
  local.generation.running = ["reading.1", "audio"];
  const server = content();
  server.reading.passages[1].questions = [q(), q(), q()];
  server.listening.parts[2].audioPath = "tts000001.wav";
  server.generation.failed = [];
  const merged = mergeRetried(local, server, ["reading.1", "audio"]);
  assert.equal(merged.reading.passages[1].questions.length, 3);
  assert.equal(merged.reading.passages[0].questions[0].correctAnswer, "edited by teacher");
  assert.equal(merged.listening.parts[2].audioPath, "tts000001.wav");
  assert.deepEqual(merged.generation?.failed, []);
  assert.deepEqual(merged.generation?.running, []);
});
