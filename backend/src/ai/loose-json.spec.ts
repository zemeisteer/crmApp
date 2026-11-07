import { parseLooseJson } from './test-prompts';

describe('parseLooseJson', () => {
  it('reads a reply with raw line breaks inside strings', () => {
    const reply = 'Here it is:\n{"title": "Tenses", "content": "## Part 1\n1. She ___ (go) home.\n\t2. They ___ (eat).", "dueDays": 3}\nDone.';
    expect(parseLooseJson(reply)).toEqual({ title: 'Tenses', content: '## Part 1\n1. She ___ (go) home.\n\t2. They ___ (eat).', dueDays: 3 });
  });
  it('keeps escaped quotes and plain JSON as they are', () => {
    expect(parseLooseJson('{"a": "say \\"hi\\"", "b": 1}')).toEqual({ a: 'say "hi"', b: 1 });
  });
  it('null when there is no object', () => {
    expect(parseLooseJson('no json here')).toBeNull();
    expect(parseLooseJson('{broken')).toBeNull();
  });
});
