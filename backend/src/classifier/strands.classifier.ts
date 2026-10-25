import { fromProbabilities, type ClassifyInput, type ClassifyResult, type MessageClassifier, UnreadableAnswerError } from './classifier.types';

/**
 * The self-hosted Strands Decider service (Apache-2.0,
 * github.com/strands-labs/strands-decider), started separately:
 *
 *   pip install strands-decider
 *   strands-decider serve <model> --port 8000
 *
 * Request, as its README and docs/inference.md give it: POST /v1/systemone
 * with `state` (the text) and `questions`; a `choice` question lists its
 * options as the keys of `criteria`, each with a description.
 *
 * The docs show the HTTP answer only for a yes/no ("noul") question:
 * `{ model, answers: { <name>: { type, noul } }, usage, latency_ms }`. They
 * do not show a `choice` answer's fields, so `readChoiceAnswer` accepts the
 * plausible shapes and refuses anything else (the caller then logs "needs a
 * person"). Check it against a running server with the evaluation script's
 * --raw flag before relying on it.
 */
export class StrandsClassifier implements MessageClassifier {
  readonly provider = 'strands';

  constructor(
    private readonly baseUrl: string,
    readonly modelVersion: string,
  ) {}

  async classify(input: ClassifyInput, signal: AbortSignal): Promise<ClassifyResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(strandsRequest(input)),
      signal,
    });
    if (!res.ok) throw new Error(`strands HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    const result = readChoiceAnswer(body, input.options);
    if (!result) throw new UnreadableAnswerError(body);
    return result;
  }
}

export const QUESTION = 'topic';

export function strandsRequest(input: ClassifyInput) {
  return {
    state: input.text,
    questions: {
      [QUESTION]: {
        type: 'choice',
        instructions: "Bu xabar o'quv markaziga o'quvchi yoki ota-onadan kelgan. U nima haqida? / What is this message to an education center about?",
        criteria: input.options,
      },
    },
  };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reads a `choice` answer; null when the shape is not one we understand. */
export function readChoiceAnswer(body: unknown, options: Record<string, string>): ClassifyResult | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { model?: unknown; answers?: Record<string, unknown> };
  const a = b.answers?.[QUESTION];
  if (!a || typeof a !== 'object') return null;
  const ans = a as Record<string, unknown>;
  const servedBy = typeof b.model === 'string' ? b.model : undefined;

  // Per-option probabilities, under whichever name the service uses.
  for (const key of ['probabilities', 'probs', 'scores', 'distribution', 'options']) {
    const d = ans[key];
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const r = fromProbabilities(d as Record<string, number>, options);
      if (r) return { ...r, servedBy };
    }
  }
  // Or just the chosen option and a confidence.
  const choice = [ans.choice, ans.label, ans.answer, ans.option, ans.value].find((v): v is string => typeof v === 'string' && v in options);
  const p = num(ans.confidence) ?? num(ans.probability) ?? num(ans.score);
  if (choice && p !== null && p >= 0 && p <= 1) return { choice, probability: p, servedBy };
  return null;
}
