// Helpers for reading a Listening audioscript aloud with Gemini's
// text-to-speech (the same GEMINI_API_KEY; no other provider).
//
// Two request formats, checked against the live API (November 2026):
// - Gemini 3.x TTS models: every line of a dialogue is its own text part
//   with `speechMetadata.speaker`, up to 4 named voices; no instruction part.
// - Gemini 2.5 TTS models: one text part with "Name: line" lines, at most 2
//   named voices; they refuse `speechMetadata`.
// The newer model is tried first and the 2.5 one is the fallback (Google no
// longer offers 2.5 text models to new accounts; its TTS model may follow).

export const DEFAULT_TTS_MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-2.5-flash-preview-tts',
];
// Prebuilt Gemini voices, clearly different from each other.
export const TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Aoede'];

const SPEAKER_LINE = /^\s*([A-Z][A-Za-z .'-]{0,30}?)\s*:\s+(\S.*)$/;

/** The models to try, in order: GEMINI_TTS_MODEL first when set, then the defaults. */
export function ttsModels(configured?: string | null): string[] {
  const own = configured?.trim();
  return own
    ? [own, ...DEFAULT_TTS_MODELS.filter((m) => m !== own)]
    : [...DEFAULT_TTS_MODELS];
}

/** Gemini 2.x TTS models take the older request format. */
export const usesSpeechMetadata = (model: string) => !model.startsWith('gemini-2.');

/**
 * An audioscript written as "Name: line" lines, as spoken turns. A line
 * without a name continues the turn before it; text before the first named
 * line joins the first turn.
 *
 * A label is a speaker only when it looks like one: every word capitalised
 * ("Dr. Mitchell", "Tour Guide"). In a monologue (no label used twice) only
 * the first label counts ("Lecturer:"), so "One final announcement: ..." or
 * "Note: ..." in the middle of a talk stays text and is read aloud whole.
 */
export function dialogueOf(
  transcript: string,
): Array<{ speaker: string | null; text: string }> {
  const lines = transcript.split('\n').map((l) => l.trim()).filter(Boolean);
  const labels = lines.map((l) => l.match(SPEAKER_LINE)?.[1].trim() ?? null);
  const uses = new Map<string, number>();
  for (const l of labels) if (l) uses.set(l, (uses.get(l) ?? 0) + 1);
  const firstLabel = labels.find((l) => l !== null) ?? null;
  const dialogue = [...uses.values()].some((n) => n >= 2);
  const isSpeaker = (l: string | null): l is string =>
    !!l && l.split(/\s+/).every((w) => /^[A-Z]/.test(w)) && (dialogue || l === firstLabel);
  const turns: Array<{ speaker: string | null; text: string }> = [];
  lines.forEach((line, i) => {
    const label = labels[i];
    if (isSpeaker(label)) turns.push({ speaker: label, text: line.match(SPEAKER_LINE)![2].trim() });
    else if (turns.length) turns[turns.length - 1].text += ` ${line}`;
    else turns.push({ speaker: null, text: line });
  });
  // Leading narration belongs to whoever speaks first.
  if (turns.length > 1 && turns[0].speaker === null && turns[1].speaker) {
    turns[1].text = `${turns[0].text} ${turns[1].text}`;
    turns.shift();
  }
  return turns;
}

/** Speaker names in order of appearance. */
export function speakersOf(transcript: string): string[] {
  return [
    ...new Set(
      dialogueOf(transcript)
        .map((t) => t.speaker)
        .filter((s): s is string => !!s),
    ),
  ];
}

const voice = (name: string) => ({ prebuiltVoiceConfig: { voiceName: name } });
const multiVoice = (speakers: string[]) => ({
  multiSpeakerVoiceConfig: {
    speakerVoiceConfigs: speakers.map((speaker, i) => ({
      speaker,
      voiceConfig: voice(TTS_VOICES[i]),
    })),
  },
});
// One voice: the names are not read aloud (an IELTS recording never says "Lecturer:").
const plainText = (transcript: string) =>
  dialogueOf(transcript)
    .map((t) => t.text)
    .join('\n');

/** The generateContent body that reads `transcript` aloud with `model`. */
export function speechRequest(model: string, transcript: string) {
  const turns = dialogueOf(transcript);
  const speakers = speakersOf(transcript);
  const audio = (speechConfig: object) => ({
    responseModalities: ['AUDIO'],
    speechConfig,
  });
  if (usesSpeechMetadata(model)) {
    if (speakers.length >= 2 && speakers.length <= TTS_VOICES.length) {
      return {
        contents: [
          {
            role: 'user',
            parts: turns.map((t) => ({
              text: t.text,
              speechMetadata: { speaker: t.speaker ?? speakers[0] },
            })),
          },
        ],
        generationConfig: audio(multiVoice(speakers)),
      };
    }
    return {
      contents: [{ role: 'user', parts: [{ text: plainText(transcript) }] }],
      generationConfig: audio({ voiceConfig: voice(TTS_VOICES[0]) }),
    };
  }
  // Gemini 2.x: one prompt; the names stay in the text only when each maps to a voice.
  const two = speakers.length === 2;
  const text = two
    ? turns.map((t) => `${t.speaker ?? speakers[0]}: ${t.text}`).join('\n')
    : plainText(transcript);
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Read this IELTS Listening audioscript aloud at a natural, clear exam pace:\n\n${text}`,
          },
        ],
      },
    ],
    generationConfig: audio(
      two ? multiVoice(speakers) : { voiceConfig: voice(TTS_VOICES[0]) },
    ),
  };
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
