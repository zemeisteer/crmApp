import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';
import {
  DEFAULT_TTS_MODELS,
  dialogueOf,
  pcmToWav,
  rateOf,
  speakersOf,
  speechRequest,
  ttsModels,
} from './tts';

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

const NEW = DEFAULT_TTS_MODELS[0];
const OLD = DEFAULT_TTS_MODELS[1];
const dialogue =
  'Anna: Hello, I would like to book a room.\nClerk: Certainly. For how many nights?\nAnna: Three, please.';
const seminar =
  'Tutor: Let us begin.\nLee: I read the paper.\nMaria: So did I.\nSam: I have a question.\nTutor: Go on.\nLee: Yes.\nMaria: Agreed.\nSam: Thanks.';
const wavReply = (mimeType = 'audio/L16;codec=pcm;rate=24000', bytes = 100) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: Buffer.alloc(bytes).toString('base64'),
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200 },
  );
const sentModel = (call: unknown[]) =>
  String(call[0]).match(/models\/([^:]+):/)![1];
const sentBody = (call: unknown[]) =>
  JSON.parse((call[1] as { body: string }).body);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Listening audio (Gemini TTS): reading an audioscript', () => {
  it('finds the turns and speakers; an unnamed line continues the turn before it', () => {
    expect(speakersOf(dialogue)).toEqual(['Anna', 'Clerk']);
    expect(
      dialogueOf('Anna: Hello.\nI am new here.\n\nTom: Welcome.\nAnna: Thanks.'),
    ).toEqual([
      { speaker: 'Anna', text: 'Hello. I am new here.' },
      { speaker: 'Tom', text: 'Welcome.' },
      { speaker: 'Anna', text: 'Thanks.' },
    ]);
    // Narration before the first named line joins the first turn.
    expect(
      dialogueOf('You will hear a call.\nAnna: Hello.\nTom: Hi.\nAnna: Bye.')[0],
    ).toEqual({ speaker: 'Anna', text: 'You will hear a call. Hello.' });
  });

  it('a sentence with a colon in a talk is not a speaker, and is read aloud whole (live Part 2)', () => {
    const talk = 'Tour Guide: Welcome to the gardens.\nThe tour takes an hour.\nOne final announcement: the cafe closes at five.\nNote: keep to the paths.';
    expect(speakersOf(talk)).toEqual(['Tour Guide']);
    const body = speechRequest(NEW, talk);
    expect(body.contents[0].parts).toEqual([
      { text: 'Welcome to the gardens. The tour takes an hour. One final announcement: the cafe closes at five. Note: keep to the paths.' },
    ]);
    // A real second speaker is still found when they speak more than once.
    expect(speakersOf('Dr. Mitchell: Hello.\nLeo: Hi.\nDr. Mitchell: Ready?\nLeo: Yes.')).toEqual(['Dr. Mitchell', 'Leo']);
  });

  it('newer model: every line is its own part with its speaker, up to four voices', () => {
    const body = speechRequest(NEW, seminar);
    expect(body.contents[0].parts).toEqual([
      { text: 'Let us begin.', speechMetadata: { speaker: 'Tutor' } },
      { text: 'I read the paper.', speechMetadata: { speaker: 'Lee' } },
      { text: 'So did I.', speechMetadata: { speaker: 'Maria' } },
      { text: 'I have a question.', speechMetadata: { speaker: 'Sam' } },
      { text: 'Go on.', speechMetadata: { speaker: 'Tutor' } },
      { text: 'Yes.', speechMetadata: { speaker: 'Lee' } },
      { text: 'Agreed.', speechMetadata: { speaker: 'Maria' } },
      { text: 'Thanks.', speechMetadata: { speaker: 'Sam' } },
    ]);
    const voices = (body.generationConfig.speechConfig as any)
      .multiSpeakerVoiceConfig.speakerVoiceConfigs;
    expect(
      voices.map((v: any) => [
        v.speaker,
        v.voiceConfig.prebuiltVoiceConfig.voiceName,
      ]),
    ).toEqual([
      ['Tutor', 'Kore'],
      ['Lee', 'Puck'],
      ['Maria', 'Charon'],
      ['Sam', 'Aoede'],
    ]);
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
  });

  it('a monologue (or more than four speakers) is one voice, and the names are not read aloud', () => {
    const lecture = speechRequest(
      NEW,
      'Lecturer: Today we look at bees.\nThey live in colonies.',
    );
    expect(lecture.contents[0].parts).toEqual([
      { text: 'Today we look at bees. They live in colonies.' },
    ]);
    expect(lecture.generationConfig.speechConfig).toHaveProperty('voiceConfig');
    const five = speechRequest(NEW, `${seminar}\nKim: Me too.`);
    expect(five.contents[0].parts).toHaveLength(1);
    expect(five.contents[0].parts[0].text).not.toMatch(/Tutor:|Kim:/);
  });

  it('older (2.x) model: one prompt, two named voices at most; it does not get speechMetadata', () => {
    const two = speechRequest(OLD, dialogue);
    expect(two.contents[0].parts).toHaveLength(1);
    expect(two.contents[0].parts[0].text).toContain(
      'Anna: Hello, I would like to book a room.\nClerk: Certainly.',
    );
    expect(JSON.stringify(two)).not.toContain('speechMetadata');
    expect(
      (two.generationConfig.speechConfig as any).multiSpeakerVoiceConfig
        .speakerVoiceConfigs,
    ).toHaveLength(2);
    const four = speechRequest(OLD, seminar);
    expect(four.generationConfig.speechConfig).toHaveProperty('voiceConfig');
    expect(four.contents[0].parts[0].text).not.toMatch(/Tutor:/);
  });

  it('tries GEMINI_TTS_MODEL first, then the defaults', () => {
    expect(ttsModels()).toEqual(DEFAULT_TTS_MODELS);
    expect(ttsModels('gemini-9-tts')).toEqual([
      'gemini-9-tts',
      ...DEFAULT_TTS_MODELS,
    ]);
    expect(ttsModels(OLD)).toEqual([OLD, NEW]);
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
});

describe('Listening audio (Gemini TTS): calling the API', () => {
  it('without a Gemini key there is no speech (Claude has none either)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ai = service({ ANTHROPIC_API_KEY: 'k' });
    expect(ai.canSynthesizeSpeech).toBe(false);
    expect(await ai.synthesizeSpeech('Anna: hi')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the newer model reads it first; a WAV reply is kept as it is', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(wavReply('audio/wav', 300));
    vi.stubGlobal('fetch', fetchMock);
    const out = await service({ GEMINI_API_KEY: 'k' }).synthesizeSpeech(
      dialogue,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentModel(fetchMock.mock.calls[0])).toBe(NEW);
    expect(sentBody(fetchMock.mock.calls[0]).contents[0].parts[0]).toEqual({
      text: 'Hello, I would like to book a room.',
      speechMetadata: { speaker: 'Anna' },
    });
    expect(out).toMatchObject({ ext: '.wav', mime: 'audio/wav' });
    expect(out?.bytes.length).toBe(300);
  });

  it('a busy model gets one more try; raw PCM is wrapped as WAV', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(wavReply());
    vi.stubGlobal('fetch', fetchMock);
    const out = await service({ GEMINI_API_KEY: 'k' }).synthesizeSpeech(
      dialogue,
    );
    expect(fetchMock.mock.calls.map(sentModel)).toEqual([NEW, NEW]);
    expect(out?.bytes.length).toBe(144);
  });

  it('when the newer model is refused (retired, unknown, over quota) the older one reads it, in its own format', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"code":404,"message":"not found"}}', {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(wavReply());
    vi.stubGlobal('fetch', fetchMock);
    const out = await service({ GEMINI_API_KEY: 'k' }).synthesizeSpeech(
      dialogue,
    );
    expect(fetchMock.mock.calls.map(sentModel)).toEqual([NEW, OLD]);
    expect(JSON.stringify(sentBody(fetchMock.mock.calls[1]))).not.toContain(
      'speechMetadata',
    );
    expect(out?.ext).toBe('.wav');

    const quota = vi
      .fn()
      .mockResolvedValueOnce(new Response('quota', { status: 429 }))
      .mockResolvedValueOnce(new Response('quota', { status: 429 }))
      .mockResolvedValueOnce(wavReply());
    vi.stubGlobal('fetch', quota);
    await service({ GEMINI_API_KEY: 'k' }).synthesizeSpeech(dialogue);
    expect(quota.mock.calls.map(sentModel)).toEqual([NEW, NEW, OLD]);
  });

  it('GEMINI_TTS_MODEL is tried first', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(wavReply());
    vi.stubGlobal('fetch', fetchMock);
    await service({
      GEMINI_API_KEY: 'k',
      GEMINI_TTS_MODEL: 'gemini-9-tts',
    }).synthesizeSpeech(dialogue);
    expect(sentModel(fetchMock.mock.calls[0])).toBe('gemini-9-tts');
  });

  it('says so when no model gives audio', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"no"}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      service({ GEMINI_API_KEY: 'k' }).synthesizeSpeech('Anna: hi'),
    ).rejects.toThrow(/Audio yaratilmadi/);
    expect(fetchMock.mock.calls.map(sentModel)).toEqual([NEW, OLD]);
  });
});
