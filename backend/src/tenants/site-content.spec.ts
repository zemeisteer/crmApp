import { describe, expect, it } from 'vitest';
import { normalizeSiteContent, parseSiteContent } from './site-content';

describe('site content', () => {
  it('keeps what a center wrote, caps lists and drops empty rows', () => {
    const c = normalizeSiteContent({
      heroTitle: '  IELTS 7+ bilan  ',
      advantages: [{ icon: '🎯', title: 'Kichik guruhlar', text: '8 kishigacha' }, { title: '' }],
      results: Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, result: 'IELTS 7' })),
      faq: [{ q: 'Narx?', a: '400 000' }, { q: 'Bo‘sh', a: '' }],
      trialLesson: true,
    });
    expect(c.heroTitle).toBe('IELTS 7+ bilan');
    expect(c.advantages).toEqual([{ icon: '🎯', title: 'Kichik guruhlar', text: '8 kishigacha' }]);
    expect(c.results).toHaveLength(12);
    expect(c.faq).toHaveLength(1);
    expect(c.trialLesson).toBe(true);
  });

  it('only allows http(s) links and upload file names', () => {
    const c = normalizeSiteContent({
      socials: { instagram: 'instagram.com/markaz', youtube: 'javascript:alert(1)' },
      gallery: ['abc123.jpg', '../../etc/passwd', 'https://evil/x.png'],
    });
    expect(c.socials.instagram).toBe('https://instagram.com/markaz');
    expect(c.socials.youtube).toBeNull();
    expect(c.gallery).toEqual(['abc123.jpg']);
  });

  it('keeps joined emoji icons whole', () => {
    expect(normalizeSiteContent({ advantages: [{ icon: '👩‍🏫', title: 'Ustozlar' }] }).advantages[0].icon).toBe('👩‍🏫');
  });

  it('reads broken stored JSON as empty', () => {
    expect(parseSiteContent('{oops').advantages).toEqual([]);
    expect(parseSiteContent(null).trialLesson).toBe(false);
  });
});
