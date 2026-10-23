import { ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';

// Reading tests from PDFs when the AI provider is busy: retries without
// real waiting, a plain message for people, and Claude -> Gemini fallback.
function service(env: Record<string, string>) {
  const ai = new AiService({} as never, { get: (k: string) => env[k] } as never);
  vi.spyOn(ai as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue(undefined);
  return ai;
}
const gemini = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const busy = () => new Response('{"error":{"code":503,"message":"This model is currently experiencing high demand."}}', { status: 503 });
const questions = JSON.stringify([
  { type: 'MCQ', prompt: '1. She ___ to school.', options: [{ id: 'A', text: 'go' }, { id: 'B', text: 'goes' }], correctAnswer: 'B' },
  { type: 'MCQ', prompt: '12 x 8 = ?', options: [{ id: 'A', text: '86' }, { id: 'B', text: '96' }], correctAnswer: 'B' },
]);
const pdf = Buffer.from('%PDF-1.4 test');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AiService: reading questions from a PDF', () => {
  it('keeps trying through overloads and the lighter model, and gets the questions', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValueOnce(gemini(questions));
    vi.stubGlobal('fetch', fetchMock);
    const qs = await service({ GEMINI_API_KEY: 'k' }).extractQuestionsFromPdf(pdf);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3][0])).toContain('gemini-flash-lite-latest');
    // The file's own numbering is dropped; a question that starts with a number is not.
    expect(qs.map((q) => q.prompt)).toEqual(['She ___ to school.', '12 x 8 = ?']);
  });

  it('a dropped connection is retried like an overload', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(gemini(questions));
    vi.stubGlobal('fetch', fetchMock);
    expect(await service({ GEMINI_API_KEY: 'k' }).extractQuestionsFromPdf(pdf)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('still busy after every try: a plain message, not the provider\'s raw error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => busy()));
    const err = await service({ GEMINI_API_KEY: 'k' }).extractQuestionsFromPdf(pdf).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toBe("AI xizmati hozir band. Bir necha daqiqadan keyin qayta urinib ko'ring.");
  });

  it('a request the AI refuses (e.g. a broken file) is not retried', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"bad"}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await service({ GEMINI_API_KEY: 'k' }).extractQuestionsFromPdf(pdf).catch((e: unknown) => e);
    expect((err as Error).message).toContain('(400)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Claude overloaded with both keys set: Gemini answers', async () => {
    const ai = service({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    vi.spyOn(ai as unknown as { completeAnthropic: () => Promise<string> }, 'completeAnthropic')
      .mockRejectedValue(Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers()));
    const fetchMock = vi.fn().mockResolvedValue(gemini(questions));
    vi.stubGlobal('fetch', fetchMock);
    expect(await ai.extractQuestionsFromPdf(pdf)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Claude refusing the request itself (400) is not hidden behind Gemini', async () => {
    const ai = service({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' });
    vi.spyOn(ai as unknown as { completeAnthropic: () => Promise<string> }, 'completeAnthropic')
      .mockRejectedValue(Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad pdf' } }, 'bad pdf', new Headers()));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(ai.extractQuestionsFromPdf(pdf)).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AiService: no made-up answers', () => {
  it('without an AI key, materials and homework suggestions say AI is not connected', async () => {
    const ai = service({});
    await expect(ai.generateMaterial({ subject: 'Matematika', topic: 'Kasrlar', type: 'QUIZ' } as never)).rejects.toMatchObject({ response: { code: 'AI_OFF' } });
    await expect(ai.suggestHomework({ subject: 'Matematika', request: '5 ta misol' })).rejects.toMatchObject({ response: { code: 'AI_OFF' } });
  });

  it('an answer that is not the JSON asked for is "busy", not a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gemini('Here you go: { not json')));
    await expect(service({ GEMINI_API_KEY: 'k' }).suggestHomework({ subject: 'Matematika' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a main model that hangs is not tried twice: the next try is the lighter model', async () => {
    const models: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      models.push(String(url).match(/models\/([^:]+)/)![1]);
      if (models.length === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return gemini('Material matni');
    }));
    const r = await service({ GEMINI_API_KEY: 'k' }).generateMaterial({ subject: 'Matematika', topic: 'Kasrlar', type: 'HOMEWORK' } as never);
    expect(r.material).toBe('Material matni');
    expect(models).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest']);
  });
});
