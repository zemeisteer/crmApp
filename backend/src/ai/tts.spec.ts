import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';
import { pcmToWav, rateOf, speakersOf, speechConfigFor } from './tts';

function service(env: Record<string, string>) {
  const ai = new AiService(
    {} as never,
    { get: (k: string) => env[k] } as never,
  );
  vi.spyOn(
    ai as unknown as { sleep: (ms: number) => Promise<void> },
    'sleep',
  ).mockResolvedValue(undefined);
  return ai;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Listening audio (Gemini TTS)', () => {
  it('finds the speakers of an audioscript and gives a dialogue two voices', () => {
    const script =
      'Anna: Hello, I would like to book a room.\nClerk: Certainly. For how many nights?\nAnna: Three, please.';
    expect(speakersOf(script)).toEqual(['Anna', 'Clerk']);
    expect(speechConfigFor(script)).toHaveProperty(
      'multiSpeakerVoiceConfig.speakerVoiceConfigs.length',
      2,
    );
    expect(speechConfigFor('Lecturer: Today we look at bees.')).toHaveProperty(
      'voiceConfig',
    );
    expect(speechConfigFor('A: x\nB: y\nC: z')).toHaveProperty('voiceConfig');
  });

  it('wraps raw PCM as a WAV file', () => {
    const wav = pcmToWav(
      Buffer.alloc(480),
      rateOf('audio/L16;codec=pcm;rate=24000'),
    );
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(480);
    expect(wav.length).toBe(524);
  });

  it('without a Gemini key there is no speech (Claude has none either)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ai = service({ ANTHROPIC_API_KEY: 'k' });
    expect(ai.canSynthesizeSpeech).toBe(false);
    expect(await ai.synthesizeSpeech('Anna: hi')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a busy TTS model and returns a WAV recording', async () => {
    const audio = new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/L16;codec=pcm;rate=24000',
                    data: Buffer.alloc(100).toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(audio);
    vi.stubGlobal('fetch', fetchMock);
    const out = await service({ GEMINI_API_KEY: 'k' }).synthesizeSpeech(
      'Anna: hi\nTom: hello',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('tts');
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig
        .responseModalities,
    ).toEqual(['AUDIO']);
    expect(out?.ext).toBe('.wav');
    expect(out?.bytes.length).toBe(144);
  });

  it('says so when the provider gives no audio', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('{"error":"no"}', { status: 400 })),
    );
    await expect(
      service({ GEMINI_API_KEY: 'k' }).synthesizeSpeech('Anna: hi'),
    ).rejects.toThrow(/Audio yaratilmadi/);
  });
});
