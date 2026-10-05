/**
 * Reading an Excel import: the first sheet, a header row, one record per row.
 * Pure (no database): turning cells into checked values, so the rules can be
 * tested on their own. What exists already, and creating, is ImportService.
 */
import { normalizePhone } from '../leads/phone';
import { isoWeekdaysOf } from '../common/weekdays';

const DAY_NAMES = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const DAY_ALIASES: string[][] = [
  ['dushanba', 'du', 'dush', 'mon', 'monday', 'пн', 'понедельник'],
  ['seshanba', 'se', 'sesh', 'tue', 'tuesday', 'вт', 'вторник'],
  ['chorshanba', 'cho', 'chor', 'wed', 'wednesday', 'ср', 'среда'],
  ['payshanba', 'pa', 'pay', 'thu', 'thursday', 'чт', 'четверг'],
  ['juma', 'ju', 'fri', 'friday', 'пт', 'пятница'],
  ['shanba', 'sha', 'sat', 'saturday', 'сб', 'суббота'],
  ['yakshanba', 'ya', 'yak', 'sun', 'sunday', 'вс', 'воскресенье'],
];

/**
 * Lesson days as written in a sheet ("Du, Cho, Ju", "Dushanba/Juma",
 * "Mon Wed") -> "Dushanba,Chorshanba,Juma" as the group form stores them;
 * null when any of them is not a weekday.
 */
export function daysOf(text: string): string | null {
  const tokens = text.toLowerCase().split(/[,;/\s]+/).map((t) => t.replace(/[.'ʻ’]/g, '')).filter(Boolean);
  if (tokens.length === 0) return null;
  const idx = new Set<number>();
  for (const t of tokens) {
    const i = DAY_ALIASES.findIndex((names) => names.includes(t));
    if (i < 0) return null;
    idx.add(i);
  }
  return [...idx].sort((a, b) => a - b).map((i) => DAY_NAMES[i]).join(',');
}

export type ImportKind = 'teachers' | 'groups' | 'students';
export const MAX_ROWS = 2000;

export interface Column {
  key: string;
  /** The header written in the template (Uzbek). */
  title: string;
  /** Other headers accepted (any case, extra spaces ignored). */
  aliases: string[];
  required?: boolean;
  /** Example value for the template. */
  example: string;
  hint?: string;
}

export const COLUMNS: Record<ImportKind, Column[]> = {
  teachers: [
    { key: 'fullName', title: 'F.I.O', aliases: ['fio', 'ism', 'ism familiya', "to'liq ism", 'full name', 'fullname', 'фио', 'имя'], required: true, example: 'Aziza Karimova' },
    { key: 'phone', title: 'Telefon', aliases: ['phone', 'telefon raqam', 'телефон'], example: '+998 90 123 45 67' },
    { key: 'email', title: 'Email', aliases: ['e-mail', 'pochta', 'почта'], example: 'aziza@example.uz' },
    { key: 'subject', title: 'Fan', aliases: ["yo'nalish", 'subject', 'предмет', 'направление'], example: 'Ingliz tili' },
    { key: 'salaryType', title: 'Maosh turi', aliases: ['salary type', 'тип оплаты'], example: 'oylik', hint: "oylik | foiz | darsbay | o'quvchi boshiga" },
    { key: 'salaryValue', title: 'Maosh', aliases: ['stavka', 'salary', 'ставка', 'оплата'], example: '4000000', hint: "so'm (foiz uchun: 0-100)" },
  ],
  groups: [
    { key: 'name', title: 'Guruh nomi', aliases: ['guruh', 'nomi', 'group', 'name', 'группа', 'название'], required: true, example: 'IELTS 6.5 Kechki' },
    { key: 'subject', title: 'Fan', aliases: ["yo'nalish", 'subject', 'предмет', 'направление'], required: true, example: 'Ingliz tili' },
    { key: 'teacher', title: "O'qituvchi", aliases: ['oqituvchi', 'teacher', 'преподаватель', 'учитель'], example: 'Aziza Karimova', hint: "tizimdagi o'qituvchining to'liq ismi" },
    { key: 'monthlyPrice', title: 'Oylik narx', aliases: ['narx', 'price', 'monthly price', 'цена', 'стоимость'], required: true, example: '450000', hint: "so'm" },
    { key: 'maxStudents', title: "Sig'im", aliases: ['sigim', "o'rinlar", 'max students', 'capacity', 'мест'], example: '12' },
    { key: 'days', title: 'Kunlar', aliases: ['dars kunlari', 'days', 'дни'], example: 'Dushanba, Chorshanba, Juma' },
    { key: 'startTime', title: 'Boshlanish vaqti', aliases: ['vaqt', 'start time', 'начало'], example: '18:00', hint: 'HH:MM' },
    { key: 'endTime', title: 'Tugash vaqti', aliases: ['end time', 'конец'], example: '19:30', hint: 'HH:MM' },
    { key: 'startDate', title: 'Boshlanish sanasi', aliases: ['start date', 'дата начала'], example: '2026-10-01', hint: 'YYYY-MM-DD' },
    { key: 'level', title: 'Daraja', aliases: ['level', 'уровень'], example: 'B1' },
    { key: 'branch', title: 'Filial', aliases: ['branch', 'филиал'], example: '', hint: 'tizimdagi filial nomi' },
  ],
  students: [
    { key: 'fullName', title: 'F.I.O', aliases: ['fio', 'ism', 'ism familiya', "to'liq ism", 'full name', 'fullname', 'фио', 'имя'], required: true, example: 'Javohir Toshmatov' },
    { key: 'phone', title: 'Telefon', aliases: ['phone', 'telefon raqam', 'телефон'], example: '+998 90 111 22 33' },
    { key: 'parentPhone', title: 'Ota-ona telefoni', aliases: ['ota-ona', 'parent phone', 'parentphone', 'телефон родителя'], example: '+998 91 444 55 66' },
    { key: 'birthDate', title: "Tug'ilgan sana", aliases: ['birth date', 'tugilgan sana', 'дата рождения'], example: '2010-05-17', hint: 'YYYY-MM-DD' },
    { key: 'gender', title: 'Jinsi', aliases: ['gender', 'пол'], example: 'erkak', hint: 'erkak | ayol' },
    { key: 'groups', title: 'Guruh', aliases: ['guruhlar', 'group', 'groups', 'группа'], example: 'IELTS 6.5 Kechki', hint: "bir nechta bo'lsa ; bilan" },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`]/g, "'").replace(/\s+/g, ' ').trim();

/** A cell as text: rich text, hyperlinks, formulas and dates included. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // A date cell; a time-only cell is a date on 1899-12-30.
    if (v.getUTCFullYear() <= 1900) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; text?: unknown; result?: unknown; hyperlink?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('').trim();
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
    return '';
  }
  return String(v).trim();
}

/** Which column holds which field, from the header row; unknown headers are listed. */
export function mapHeader(kind: ImportKind, headerCells: string[]) {
  const columns = COLUMNS[kind];
  const at: Record<string, number> = {};
  const unknown: string[] = [];
  headerCells.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    const c = columns.find((col) => norm(col.title) === n || col.key.toLowerCase() === n || col.aliases.some((a) => norm(a) === n));
    if (c && at[c.key] === undefined) at[c.key] = i;
    else unknown.push(h);
  });
  const missing = columns.filter((c) => c.required && at[c.key] === undefined).map((c) => c.title);
  return { at, unknown, missing };
}

export const phoneDisplay = (raw: string): string | null => {
  const p = normalizePhone(raw);
  if (!p) return null;
  // Uzbek numbers as the forms write them: +998 90 123 45 67.
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(p);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
};

const SALARY: Record<string, string> = {
  oylik: 'FIXED', fixed: 'FIXED', 'belgilangan': 'FIXED', оклад: 'FIXED',
  foiz: 'PERCENT', percent: 'PERCENT', '%': 'PERCENT', процент: 'PERCENT',
  darsbay: 'PER_LESSON', 'per lesson': 'PER_LESSON', 'per_lesson': 'PER_LESSON', 'har bir dars uchun': 'PER_LESSON', 'за урок': 'PER_LESSON',
  "o'quvchi boshiga": 'PER_STUDENT', 'per student': 'PER_STUDENT', 'per_student': 'PER_STUDENT', "har bir o'quvchi uchun": 'PER_STUDENT', 'за ученика': 'PER_STUDENT',
};

const intOf = (s: string) => {
  const t = s.replace(/[\s,']/g, '');
  return /^\d+$/.test(t) ? Number(t) : NaN;
};
const isDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
/** "18:00", "8:30", "18.00", or Excel's fraction of a day (0.75). */
export function timeOf(s: string): string | null {
  if (!s) return null;
  if (/^0?\.\d+$|^0$/.test(s)) {
    const mins = Math.round(Number(s) * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export interface Parsed<T> {
  value: T | null;
  errors: string[];
}

export function parseTeacher(cells: Record<string, string>): Parsed<{ fullName: string; phone?: string; email?: string; subject?: string; salaryType?: string; salaryValue?: number }> {
  const errors: string[] = [];
  const fullName = cells.fullName ?? '';
  if (fullName.length < 2) errors.push("F.I.O kamida 2 harf");
  let phone: string | undefined;
  if (cells.phone) {
    phone = phoneDisplay(cells.phone) ?? undefined;
    if (!phone) errors.push(`Telefon noto'g'ri: ${cells.phone}`);
  }
  if (cells.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cells.email)) errors.push(`Email noto'g'ri: ${cells.email}`);
  let salaryType: string | undefined;
  let salaryValue: number | undefined;
  if (cells.salaryType) {
    salaryType = SALARY[norm(cells.salaryType)] ?? (['FIXED', 'PERCENT', 'PER_LESSON', 'PER_STUDENT'].includes(cells.salaryType.toUpperCase()) ? cells.salaryType.toUpperCase() : undefined);
    if (!salaryType) errors.push(`Maosh turi noma'lum: ${cells.salaryType} (oylik, foiz, darsbay, o'quvchi boshiga)`);
  }
  if (cells.salaryValue) {
    salaryValue = intOf(cells.salaryValue);
    if (Number.isNaN(salaryValue)) errors.push(`Maosh butun son bo'lishi kerak: ${cells.salaryValue}`);
    else if ((salaryType ?? 'FIXED') === 'PERCENT' && salaryValue > 100) errors.push('Foiz 100 dan oshmaydi');
    if (!salaryType) salaryType = 'FIXED';
  }
  if (errors.length) return { value: null, errors };
  return { value: { fullName, phone, email: cells.email?.toLowerCase() || undefined, subject: cells.subject || undefined, salaryType, salaryValue }, errors };
}

export interface GroupRow {
  name: string;
  subject: string;
  teacher?: string;
  monthlyPrice: number;
  maxStudents?: number;
  scheduleDays?: string;
  startTime?: string;
  endTime?: string;
  startDate?: string;
  level?: string;
  branch?: string;
}

export function parseGroup(cells: Record<string, string>): Parsed<GroupRow> {
  const errors: string[] = [];
  const name = cells.name ?? '';
  if (name.length < 2) errors.push('Guruh nomi kamida 2 belgi');
  if (!cells.subject) errors.push('Fan kiritilmagan');
  const monthlyPrice = intOf(cells.monthlyPrice ?? '');
  if (Number.isNaN(monthlyPrice)) errors.push(`Oylik narx butun son bo'lishi kerak: ${cells.monthlyPrice ?? ''}`);
  let maxStudents: number | undefined;
  if (cells.maxStudents) {
    maxStudents = intOf(cells.maxStudents);
    if (Number.isNaN(maxStudents) || maxStudents < 1) errors.push(`Sig'im 1 yoki undan katta butun son: ${cells.maxStudents}`);
  }
  let scheduleDays: string | undefined;
  if (cells.days) {
    scheduleDays = daysOf(cells.days) ?? undefined;
    if (!scheduleDays) errors.push(`Kunlar tushunilmadi: ${cells.days} (masalan: Dushanba, Chorshanba yoki Du, Cho)`);
  }
  const startTime = cells.startTime ? timeOf(cells.startTime) : null;
  if (cells.startTime && !startTime) errors.push(`Boshlanish vaqti HH:MM bo'lishi kerak: ${cells.startTime}`);
  const endTime = cells.endTime ? timeOf(cells.endTime) : null;
  if (cells.endTime && !endTime) errors.push(`Tugash vaqti HH:MM bo'lishi kerak: ${cells.endTime}`);
  if (startTime && endTime && endTime <= startTime) errors.push('Tugash vaqti boshlanishidan keyin bo\'lishi kerak');
  if (scheduleDays && !startTime) errors.push('Kunlar berilgan, boshlanish vaqti yo\'q');
  if (startTime && !scheduleDays) errors.push('Vaqt berilgan, kunlar yo\'q');
  if (cells.startDate && !isDate(cells.startDate)) errors.push(`Sana YYYY-MM-DD bo'lishi kerak: ${cells.startDate}`);
  if (errors.length) return { value: null, errors };
  return {
    value: {
      name, subject: cells.subject, teacher: cells.teacher || undefined, monthlyPrice, maxStudents, scheduleDays,
      startTime: startTime ?? undefined, endTime: endTime ?? undefined, startDate: cells.startDate || undefined, level: cells.level || undefined, branch: cells.branch || undefined,
    },
    errors,
  };
}

export interface StudentRow {
  fullName: string;
  phone?: string;
  parentPhone?: string;
  birthDate?: string;
  gender?: 'MALE' | 'FEMALE';
  groups: string[];
}

export function parseStudent(cells: Record<string, string>): Parsed<StudentRow> {
  const errors: string[] = [];
  const fullName = cells.fullName ?? '';
  if (fullName.length < 2) errors.push('F.I.O kamida 2 harf');
  const phone = cells.phone ? phoneDisplay(cells.phone) : null;
  if (cells.phone && !phone) errors.push(`Telefon noto'g'ri: ${cells.phone}`);
  const parentPhone = cells.parentPhone ? phoneDisplay(cells.parentPhone) : null;
  if (cells.parentPhone && !parentPhone) errors.push(`Ota-ona telefoni noto'g'ri: ${cells.parentPhone}`);
  if (cells.birthDate && !isDate(cells.birthDate)) errors.push(`Tug'ilgan sana YYYY-MM-DD bo'lishi kerak: ${cells.birthDate}`);
  let gender: 'MALE' | 'FEMALE' | undefined;
  if (cells.gender) {
    const g = norm(cells.gender);
    gender = ['erkak', 'male', 'm', 'o\'g\'il', 'муж', 'мужской'].includes(g) ? 'MALE' : ['ayol', 'female', 'f', 'qiz', 'жен', 'женский'].includes(g) ? 'FEMALE' : undefined;
    if (!gender) errors.push(`Jinsi: erkak yoki ayol (${cells.gender})`);
  }
  const groups = (cells.groups ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  if (errors.length) return { value: null, errors };
  return { value: { fullName, phone: phone ?? undefined, parentPhone: parentPhone ?? undefined, birthDate: cells.birthDate || undefined, gender, groups }, errors };
}

/** Two weekly slots of one teacher overlap (same weekday, times cross). */
export function slotsOverlap(a: { days: string; start: string; end: string }, b: { days: string; start: string; end: string }) {
  const da = isoWeekdaysOf(a.days);
  const db = isoWeekdaysOf(b.days);
  return da.some((d) => db.includes(d)) && a.start < b.end && b.start < a.end;
}

export const nameKey = (s: string) => norm(s);
