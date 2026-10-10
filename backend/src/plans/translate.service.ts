import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../ai/ai.service';

export type TranslateTarget = 'RU' | 'EN';
export type TranslateProvider = 'ai' | 'google' | 'google-public';

const LANGUAGE: Record<TranslateTarget, { code: string; name: string }> = {
  RU: { code: 'ru', name: 'Russian' },
  EN: { code: 'en', name: 'English' },
};
const TIMEOUT_MS = 15_000;
/** A tariff's feature list: a handful of short lines. */
export const MAX_LINES = 40;
export const MAX_LINE_LENGTH = 200;

/**
 * Uzbek lines into Russian or English, for the tariff lists the platform
 * admin writes once in Uzbek. Whichever is set up answers, in this order:
 * the AI the rest of the app uses, Google Cloud Translation
 * (GOOGLE_TRANSLATE_API_KEY), then Google's public web endpoint, which needs
 * no key but comes with no guarantee. Only the tariff text is sent.
 */
@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly ai: AiService,
  ) {}

  private providers(): TranslateProvider[] {
    const list: TranslateProvider[] = [];
    if (this.config.get<string>('ANTHROPIC_API_KEY') || this.config.get<string>('GEMINI_API_KEY')) list.push('ai');
    if (this.config.get<string>('GOOGLE_TRANSLATE_API_KEY')) list.push('google');
    if (this.config.get<string>('TRANSLATE_PUBLIC_FALLBACK') !== 'false') list.push('google-public');
    return list;
  }

  /** What would answer a request now (shown on the integrations page). */
  provider(): TranslateProvider | null {
    return this.providers()[0] ?? null;
  }

  async translateLines(lines: string[], target: TranslateTarget): Promise<{ lines: string[]; provider: TranslateProvider }> {
    if (lines.length === 0) return { lines: [], provider: this.provider() ?? 'google-public' };
    let lastError: unknown = null;
    for (const provider of this.providers()) {
      try {
        const out = provider === 'ai' ? await this.viaAi(lines, target)
          : provider === 'google' ? await this.viaGoogle(lines, target)
          : await this.viaGooglePublic(lines, target);
        // One line in, one line out: a list that came back longer, shorter
        // or with an empty line would put a feature under the wrong tariff.
        if (out.length === lines.length && out.every((l) => l.trim())) {
          return { lines: out.map((l) => l.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH)), provider };
        }
        lastError = new Error(`${provider}: ${out.length} lines for ${lines.length}`);
      } catch (err) {
        lastError = err;
      }
      this.logger.warn(`translate via ${provider} failed: ${(lastError as Error)?.message}`);
    }
    throw new ServiceUnavailableException("Tarjima xizmati javob bermadi. Birozdan so'ng qayta urinib ko'ring yoki tarjimani qo'lda yozing.");
  }

  private async viaAi(lines: string[], target: TranslateTarget): Promise<string[]> {
    const prompt = [
      `Translate these ${lines.length} short pricing-plan feature lines of an education CRM from Uzbek to ${LANGUAGE[target].name}.`,
      'Keep each line short and natural for a pricing page. Keep numbers and brand names (Telegram, Click, Payme, AI, CRM) as they are.',
      `Answer with a JSON array of exactly ${lines.length} strings in the same order, and nothing else.`,
      '',
      JSON.stringify(lines),
    ].join('\n');
    const text = await this.ai.completeText(prompt, 1500);
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('no JSON array in the answer');
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed.map((x) => String(x ?? ''));
  }

  private async viaGoogle(lines: string[], target: TranslateTarget): Promise<string[]> {
    const key = this.config.get<string>('GOOGLE_TRANSLATE_API_KEY')!;
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: lines, source: 'uz', target: LANGUAGE[target].code, format: 'text' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { translations?: Array<{ translatedText?: string }> } };
    return (body.data?.translations ?? []).map((x) => x.translatedText ?? '');
  }

  private async viaGooglePublic(lines: string[], target: TranslateTarget): Promise<string[]> {
    const out: string[] = [];
    for (const line of lines) {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=uz&tl=${LANGUAGE[target].code}&dt=t&q=${encodeURIComponent(line)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      const parts = Array.isArray(body) && Array.isArray(body[0]) ? (body[0] as unknown[]) : [];
      out.push(parts.map((p) => (Array.isArray(p) && typeof p[0] === 'string' ? p[0] : '')).join(''));
    }
    return out;
  }
}
