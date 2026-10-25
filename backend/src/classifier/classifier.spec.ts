import { describe, expect, it } from 'vitest';
import { fromProbabilities, MESSAGE_OPTIONS } from './classifier.types';
import { readChoiceAnswer, strandsRequest } from './strands.classifier';
import { classifierConfig, makeClassifier, summarize } from './classifier.service';

describe('Strands Decider client', () => {
  it('asks a choice question with the options as criteria (as the docs show)', () => {
    const body = strandsRequest({ text: "Qarzim qancha?", options: { payment: "To'lov", other: 'Boshqa' } });
    expect(body).toEqual({
      state: 'Qarzim qancha?',
      questions: { topic: { type: 'choice', instructions: expect.any(String), criteria: { payment: "To'lov", other: 'Boshqa' } } },
    });
  });

  it('reads per-option probabilities or a choice with a confidence', () => {
    expect(readChoiceAnswer({ model: 'm', answers: { topic: { type: 'choice', probabilities: { payment: 3, other: 1 } } } }, MESSAGE_OPTIONS)).toEqual({
      choice: 'payment',
      probability: 0.75,
      probabilities: { payment: 0.75, other: 0.25 },
      servedBy: 'm',
    });
    expect(readChoiceAnswer({ answers: { topic: { type: 'choice', choice: 'schedule', confidence: 0.62 } } }, MESSAGE_OPTIONS)).toMatchObject({ choice: 'schedule', probability: 0.62 });
  });

  it('refuses shapes it does not know instead of guessing', () => {
    expect(readChoiceAnswer({ answers: { topic: { type: 'noul', noul: 0.8 } } }, MESSAGE_OPTIONS)).toBeNull();
    expect(readChoiceAnswer({ answers: { topic: { choice: 'refund', confidence: 0.9 } } }, MESSAGE_OPTIONS)).toBeNull(); // not an option
    expect(readChoiceAnswer({ answers: { topic: { choice: 'payment', confidence: 7 } } }, MESSAGE_OPTIONS)).toBeNull();
    expect(readChoiceAnswer('oops', MESSAGE_OPTIONS)).toBeNull();
  });

  it('normalises probabilities and ignores unknown options', () => {
    expect(fromProbabilities({ payment: 1, nonsense: 5 }, MESSAGE_OPTIONS)).toEqual({ choice: 'payment', probability: 1, probabilities: { payment: 1 } });
    expect(fromProbabilities({}, MESSAGE_OPTIONS)).toBeNull();
  });
});

describe('configuration', () => {
  it('is off unless chosen; the Strands model is pinned', () => {
    const none = (_: string) => undefined;
    expect(makeClassifier(none)).toBeNull();
    const env: Record<string, string> = { CLASSIFIER_PROVIDER: 'strands' };
    expect(makeClassifier((k) => env[k])).toMatchObject({ provider: 'strands', modelVersion: 'StrandsAgents/strands-decider-2B-hobson-v21' });
    expect(classifierConfig(none)).toMatchObject({ threshold: 0.7, timeoutMs: 5000, perTenantPerHour: 120 });
  });
});

describe('evaluation CSV', () => {
  it('reads quoted text with commas, quotes and new lines', async () => {
    const { parseCsv } = await import('../../scripts/eval-classifier');
    expect(parseCsv('text,label\n"Salom, ""ustoz""\nqachon?",schedule\r\nRahmat,other\n')).toEqual([
      ['text', 'label'],
      ['Salom, "ustoz"\nqachon?', 'schedule'],
      ['Rahmat', 'other'],
    ]);
  });
});

describe('summarize', () => {
  it('accuracy, confident-only accuracy and a confusion matrix', () => {
    const s = summarize([
      { chosen: 'payment', finalLabel: 'payment', status: 'SUGGESTED' },
      { chosen: 'price', finalLabel: 'payment', status: 'NEEDS_HUMAN' },
      { chosen: null, finalLabel: 'complaint', status: 'NEEDS_HUMAN' },
      { chosen: 'schedule', finalLabel: null, status: 'SUGGESTED' },
    ]);
    expect(s).toMatchObject({ labelled: 3, answered: 2, accuracy: 0.5, confident: 1, confidentAccuracy: 1, needsHuman: 2 });
    expect(s.matrix.payment).toMatchObject({ payment: 1, price: 1 });
    expect(s.matrix.complaint.none).toBe(1);
  });
});
