// Helpers for reading a Listening audioscript aloud with Gemini's
// text-to-speech (the same GEMINI_API_KEY; no other provider).

export const DEFAULT_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
// Prebuilt Gemini voices: two clearly different ones for a dialogue.
export const TTS_VOICES = ['Kore', 'Puck'];

/** Speaker names of an audioscript written as "Name: line", in order of appearance. */
export function speakersOf(transcript: string): string[] {
  const seen: string[] = [];
  for (const line of transcript.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Za-z .'-]{0,30}?)\s*:\s+\S/);
    if (m && !seen.includes(m[1].trim())) seen.push(m[1].trim());
  }
  return seen;
}

/** Gemini's speech config: two named voices for a two-person dialogue, one voice otherwise (the API takes at most two speakers). */
export function speechConfigFor(transcript: string) {
  const speakers = speakersOf(transcript);
  if (speakers.length === 2) {
    return {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: speakers.map((speaker, i) => ({
          speaker,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICES[i] } },
        })),
      },
    };
  }
  return { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICES[0] } } };
}

/** Raw 16-bit little-endian PCM (what Gemini TTS returns) wrapped as a WAV file. */
export function pcmToWav(
  pcm: Buffer,
  sampleRate = 24_000,
  channels = 1,
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** "audio/L16;codec=pcm;rate=24000" -> 24000. */
export function rateOf(mime: string): number {
  const m = mime.match(/rate=(\d+)/);
  return m ? Number(m[1]) : 24_000;
}
