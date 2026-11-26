import { describe, expect, it, vi } from 'vitest';

vi.mock('../common/upload.util', () => ({
  saveGeneratedFile: vi.fn(
    async (_b: Buffer, ext: string) =>
      `gen${Math.random().toString(36).slice(2, 10)}${ext}`,
  ),
}));

import { MockGenerateService } from './mock-generate.service';
import { emptyMeta } from './generation';
import { normalizeContent } from './ielts';

const script = 'Anna: Hello.\nTom: Hi there.';
const content = () =>
  normalizeContent({
    generation: emptyMeta(),
    listening: {
      parts: [0, 1, 2, 3].map((i) => ({
        title: `Part ${i + 1}`,
        transcript: script,
        questions: [],
      })),
    },
  });

function service(ai: Record<string, unknown>) {
  const files = { register: vi.fn(async () => undefined) };
  return {
    svc: new MockGenerateService({} as never, ai as never, files as never),
    files,
  };
}

describe('MockGenerateService: Listening audio', () => {
  it('without a speech provider keeps the transcripts and marks every part as needing audio', async () => {
    const synthesizeSpeech = vi.fn();
    const { svc } = service({ canSynthesizeSpeech: false, synthesizeSpeech });
    const out = await svc.addAudio('t1', 'm1', content());
    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(out.generation?.tts).toBe('UNAVAILABLE');
    expect(
      out.listening.parts.every(
        (p) => p.audioPath === null && p.transcript === script,
      ),
    ).toBe(true);
  });

  it("with Gemini TTS stores each part's recording as an asset of the test", async () => {
    const synthesizeSpeech = vi.fn(async () => ({
      bytes: Buffer.from('RIFF'),
      mime: 'audio/wav',
      ext: '.wav',
    }));
    const { svc, files } = service({
      canSynthesizeSpeech: true,
      synthesizeSpeech,
    });
    const out = await svc.addAudio('t1', 'm1', content());
    expect(synthesizeSpeech).toHaveBeenCalledTimes(4);
    expect(
      out.listening.parts.every((p) => /^gen\w+\.wav$/.test(p.audioPath ?? '')),
    ).toBe(true);
    expect(files.register).toHaveBeenCalledTimes(4);
    expect(files.register).toHaveBeenCalledWith(
      't1',
      out.listening.parts[0].audioPath,
      'MOCK_ASSET',
      'm1',
    );
    expect(out.generation?.tts).toBe('DONE');
  });

  it('a part whose audio fails stays marked (FAILED) while the others get theirs', async () => {
    const synthesizeSpeech = vi
      .fn(async () => ({
        bytes: Buffer.from('RIFF'),
        mime: 'audio/wav',
        ext: '.wav',
      }))
      .mockRejectedValueOnce(new Error('Audio yaratilmadi (503)'));
    const { svc } = service({ canSynthesizeSpeech: true, synthesizeSpeech });
    const out = await svc.addAudio('t1', 'm1', content());
    expect(out.listening.parts.map((p) => !!p.audioPath)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(out.generation).toMatchObject({
      tts: 'FAILED',
      ttsError: 'Audio yaratilmadi (503)',
    });
  });

  it('a test where every part failed is not saved as a silently empty test', async () => {
    const ai = {
      completeText: vi.fn(async () => 'not json'),
      canSynthesizeSpeech: false,
    };
    const { svc } = service(ai);
    const topics = {
      listening: [],
      reading: [],
      writing: { task1: 'a', task2: 'b' },
      speaking: { part1: ['x'], part2: 'y', part3: 'z' },
    };
    await expect(
      svc.writeContent('t1', 'm1', topics, null, 'ACADEMIC'),
    ).rejects.toThrow(/AI test yoza olmadi/);
    // 9 parts x 3 tries.
    expect(ai.completeText).toHaveBeenCalledTimes(27);
  });

  it('writes all nine parts at once, not three at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const ai = {
      completeText: vi.fn(async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return 'not json';
      }),
      canSynthesizeSpeech: false,
    };
    const { svc } = service(ai);
    const topics = {
      listening: [],
      reading: [],
      writing: { task1: 'a', task2: 'b' },
      speaking: { part1: ['x'], part2: 'y', part3: 'z' },
    };
    await expect(
      svc.writeContent('t1', 'm1', topics, null, 'ACADEMIC'),
    ).rejects.toThrow();
    expect(most).toBe(9);
  });

  it('reads the Listening parts aloud at the same time, not one after another', async () => {
    let inFlight = 0;
    let most = 0;
    const synthesizeSpeech = vi.fn(async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { bytes: Buffer.from('RIFF'), mime: 'audio/wav', ext: '.wav' };
    });
    const { svc } = service({ canSynthesizeSpeech: true, synthesizeSpeech });
    const out = await svc.addAudio('t1', 'm1', content());
    expect(most).toBe(4);
    expect(out.generation?.tts).toBe('DONE');
  });
});
