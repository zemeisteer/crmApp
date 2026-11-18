// State of an IELTS mock test the AI wrote (content.generation, set by the
// server): parts that could not be written, parts being rewritten now, and
// Listening parts that still need a recording. Kept free of other imports so
// node --test can run it as is.

export interface MockGeneration {
  failed: Array<{ key: string; label: string; error: string }>;
  running: string[];
  runningSince: string | null;
  tts: "DONE" | "UNAVAILABLE" | "FAILED" | null;
  ttsError: string | null;
}

type Question = { type: string; correctAnswer: string; pairs?: unknown[] | null };
interface ContentLike {
  listening: { audioPath: string | null; parts: Array<{ audioPath: string | null; transcript: string | null; questions: Question[] }> };
  reading: { passages: Array<{ questions: Question[] }> };
  writing: { tasks: unknown[] };
  speaking: { parts: Array<{ questions: string[] }> };
  generation?: MockGeneration;
}

/** IELTS marks of a question: a "choose TWO" is two of the 40, a matching task one per item. */
export function marksOf(q: Question): number {
  if (q.type === "MCQ_MULTI") return Math.max(1, q.correctAnswer.split(",").filter(Boolean).length);
  if (q.type === "MATCHING") return Math.max(1, (q.pairs ?? []).length);
  return 1;
}

export const sumMarks = (qs: Question[]) => qs.reduce((n, q) => n + marksOf(q), 0);

/** Failed parts of one section ("listening", "reading", "writing", "speaking"). */
export function failedIn(content: ContentLike, section: string) {
  return (content.generation?.failed ?? []).filter((f) => f.key === section || f.key.startsWith(`${section}.`));
}

/** Indexes of the Listening parts of an AI test that have no recording (none needed once the whole section has one). */
export function partsNeedingAudio(content: ContentLike): number[] {
  if (!content.generation || content.listening.audioPath) return [];
  return content.listening.parts.flatMap((p, i) => (p.audioPath ? [] : [i]));
}

export const isRunning = (content: ContentLike, key?: string) =>
  key ? !!content.generation?.running.includes(key) : !!content.generation?.running.length;

/**
 * After a retry finishes: the rewritten slots (and the generation state) come
 * from the server, everything else stays as the teacher has it in the editor.
 */
export function mergeRetried<T extends ContentLike>(local: T, server: T, keys: string[]): T {
  const out = structuredClone(local);
  for (const key of keys) {
    const [s, n] = key.split(".");
    const i = Number(n);
    if (s === "listening" && server.listening.parts[i]) out.listening.parts[i] = structuredClone(server.listening.parts[i]);
    else if (s === "reading" && server.reading.passages[i]) out.reading.passages[i] = structuredClone(server.reading.passages[i]);
    else if (s === "writing") out.writing.tasks = structuredClone(server.writing.tasks);
    else if (s === "speaking") out.speaking.parts = structuredClone(server.speaking.parts);
    else if (s === "audio") {
      server.listening.parts.forEach((p, j) => {
        if (out.listening.parts[j] && !out.listening.parts[j].audioPath && p.audioPath) out.listening.parts[j].audioPath = p.audioPath;
      });
    }
  }
  out.generation = server.generation ? structuredClone(server.generation) : out.generation;
  return out;
}
