/**
 * One interface for whatever reads a message and picks one of the options.
 * The rest of the code (the shadow log, the review page, the evaluation
 * script) only knows this, so the model behind it can be swapped - the
 * Strands Decider service, Gemini, or another small LLM - by configuration.
 */
export interface MessageClassifier {
  /** "gemini" | "strands" | ... (stored with every result). */
  readonly provider: string;
  /** The pinned model (and version) answering, stored with every result. */
  readonly modelVersion: string;
  classify(input: ClassifyInput, signal: AbortSignal): Promise<ClassifyResult>;
}

export interface ClassifyInput {
  text: string;
  /** option key -> what it means (the model sees both). */
  options: Record<string, string>;
}

export interface ClassifyResult {
  choice: string;
  /** 0..1, how sure the model is of `choice`. */
  probability: number;
  /** Every option's probability, when the model gives them. */
  probabilities?: Record<string, number>;
  /** The model the service says answered (may differ from the pinned one). */
  servedBy?: string;
}

/** A reply the client could not read: kept apart so the log says so plainly. */
export class UnreadableAnswerError extends Error {
  constructor(public readonly raw: unknown) {
    super('Unreadable classifier answer');
  }
}

/**
 * What an incoming Telegram message from a student or parent is about. The
 * descriptions are Uzbek, as the messages are; the keys are what is stored.
 */
export const MESSAGE_OPTIONS: Record<string, string> = {
  payment: "To'lov, qarz, chek, to'lov qilish yoki to'lov tasdiqlanishi haqida",
  price: "Kurs narxi, chegirma, tariflar haqida savol",
  schedule: "Dars vaqti, jadval, darsga kela olmaslik, dars ko'chirilishi haqida",
  complaint: "Shikoyat, norozilik, o'qituvchi yoki xizmatdan qoniqmaslik",
  other: "Boshqa mavzu",
};

/** Picks the most probable option; probabilities are normalised to sum to 1. */
export function fromProbabilities(raw: Record<string, number>, options: Record<string, string>): ClassifyResult | null {
  const entries = Object.entries(raw).filter(([k, v]) => k in options && Number.isFinite(v) && v >= 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0 || total <= 0) return null;
  const probabilities = Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
  const [choice, probability] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  return { choice, probability, probabilities };
}
