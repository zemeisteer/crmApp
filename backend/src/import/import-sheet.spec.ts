import { describe, expect, it } from 'vitest';
import { cellText, daysOf, mapHeader, parseGroup, parseStudent, parseTeacher, phoneDisplay, slotsOverlap, timeOf } from './import-sheet';

describe('import-sheet', () => {
  it('maps headers in Uzbek, Russian and English, any case, and names what is missing', () => {
    expect(mapHeader('teachers', ['', 'F.I.O', 'telefon', 'Fan', 'Something'])).toEqual({ at: { fullName: 1, phone: 2, subject: 3 }, unknown: ['Something'], missing: [] });
    expect(mapHeader('groups', ['', 'Группа', 'Предмет', 'Цена']).missing).toEqual([]);
    expect(mapHeader('groups', ['', 'Guruh nomi']).missing).toEqual(['Fan', 'Oylik narx']);
  });

  it('reads cells as text: rich text, formulas, dates and Excel times', () => {
    expect(cellText({ richText: [{ text: 'Ali ' }, { text: 'Vali' }] })).toBe('Ali Vali');
    expect(cellText({ formula: 'A1', result: 450000 })).toBe('450000');
    expect(cellText(new Date(Date.UTC(2026, 9, 1)))).toBe('2026-10-01');
    expect(cellText(new Date(Date.UTC(1899, 11, 30, 18, 30)))).toBe('18:30');
    expect(timeOf('0.75')).toBe('18:00');
    expect(timeOf('8:30')).toBe('08:30');
    expect(timeOf('18.00')).toBe('18:00');
    expect(timeOf('25:00')).toBeNull();
  });

  it('understands lesson days however they are written, and refuses unknown ones', () => {
    expect(daysOf('Du, Cho, Ju')).toBe('Dushanba,Chorshanba,Juma');
    expect(daysOf('juma/dushanba')).toBe('Dushanba,Juma');
    expect(daysOf('Mon Wed')).toBe('Dushanba,Chorshanba');
    expect(daysOf('пн, ср')).toBe('Dushanba,Chorshanba');
    expect(daysOf('Dushanba, Xyz')).toBeNull();
  });

  it('teachers: phone as the forms write it, salary words, limits', () => {
    expect(phoneDisplay('901234567')).toBe('+998 90 123 45 67');
    expect(parseTeacher({ fullName: 'Aziza Karimova', phone: '998901234567', salaryType: 'foiz', salaryValue: '40' }).value).toMatchObject({ phone: '+998 90 123 45 67', salaryType: 'PERCENT', salaryValue: 40 });
    expect(parseTeacher({ fullName: 'A', salaryType: 'foiz', salaryValue: '140' }).errors).toEqual(['F.I.O kamida 2 harf', 'Foiz 100 dan oshmaydi']);
    expect(parseTeacher({ fullName: 'Bob', salaryValue: '3 000 000' }).value).toMatchObject({ salaryType: 'FIXED', salaryValue: 3_000_000 });
    expect(parseTeacher({ fullName: 'Bob', salaryType: 'kunbay' }).errors[0]).toContain("Maosh turi noma'lum");
  });

  it('groups: required fields, times, and days with a time', () => {
    expect(parseGroup({ name: 'IELTS', subject: 'Ingliz tili', monthlyPrice: '450 000', days: 'Du, Cho', startTime: '18:00', endTime: '19:30' }).value)
      .toMatchObject({ monthlyPrice: 450_000, scheduleDays: 'Dushanba,Chorshanba', startTime: '18:00', endTime: '19:30' });
    expect(parseGroup({ name: 'X', subject: '', monthlyPrice: 'abc' }).errors).toEqual(['Guruh nomi kamida 2 belgi', 'Fan kiritilmagan', "Oylik narx butun son bo'lishi kerak: abc"]);
    expect(parseGroup({ name: 'G1', subject: 'Math', monthlyPrice: '1', days: 'Du' }).errors).toEqual(["Kunlar berilgan, boshlanish vaqti yo'q"]);
    expect(parseGroup({ name: 'G1', subject: 'Math', monthlyPrice: '1', days: 'Du', startTime: '19:00', endTime: '18:00' }).errors).toEqual(["Tugash vaqti boshlanishidan keyin bo'lishi kerak"]);
    expect(parseGroup({ name: 'G1', subject: 'Math', monthlyPrice: '1', startDate: '2026-02-30' }).errors[0]).toContain('YYYY-MM-DD');
  });

  it('students: several groups, gender words, bad phones', () => {
    expect(parseStudent({ fullName: 'Javohir T', gender: 'Erkak', groups: 'A; B ;' }).value).toMatchObject({ gender: 'MALE', groups: ['A', 'B'] });
    expect(parseStudent({ fullName: 'Javohir T', phone: '123' }).errors).toEqual(["Telefon noto'g'ri: 123"]);
  });

  it('a teacher cannot be in two groups at once', () => {
    expect(slotsOverlap({ days: 'Dushanba,Juma', start: '18:00', end: '19:30' }, { days: 'Juma', start: '19:00', end: '20:00' })).toBe(true);
    expect(slotsOverlap({ days: 'Dushanba', start: '18:00', end: '19:30' }, { days: 'Dushanba', start: '19:30', end: '21:00' })).toBe(false);
  });
});
