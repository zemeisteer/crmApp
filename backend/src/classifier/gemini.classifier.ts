import { fromProbabilities, type ClassifyInput, type ClassifyResult, type MessageClassifier, UnreadableAnswerError } from './classifier.types';

/**
 * A small hosted LLM as the classifier (Gemini Flash-Lite by default), with
 * the platform's Gemini key. The model is asked for a probability per
 * option; those are its own estimate, not a calibrated score, which is why
 * the evaluation script measures accuracy on real, labelled messages.
 * Only the one message (one center's) is sent.
 */
export class GeminiClassifier implements MessageClassifier {
  readonly provider = 'gemini';

  constructor(
    private readonly apiKey: () => string | undefined,
    readonly modelVersion: string,
  ) {}

  async classify(input: ClassifyInput, signal: AbortSignal): Promise<ClassifyResult> {
    const key = this.apiKey();
    if (!key) throw new Error('GEMINI_API_KEY is not set');
    const options = Object.entries(input.options).map(([k, d]) => `- ${k}: ${d}`).join('\n');
    const prompt = [
      "You classify one message a student or parent sent to an education center in Uzbekistan (Uzbek, Russian or both mixed).",
      'Options:',
      options,
      'Reply with JSON only: {"probabilities": {"<option>": <0..1>, ...}} covering every option, summing to 1.',
      '',
      'Message:',
      input.text,
    ].join('\n');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.modelVersion)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new UnreadableAnswerError(text);
    }
    const probs = (parsed as { probabilities?: Record<string, number> })?.probabilities;
    const r = probs ? fromProbabilities(probs, input.options) : null;
    if (!r) throw new UnreadableAnswerError(parsed);
    return { ...r, servedBy: this.modelVersion };
  }
}
