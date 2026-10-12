import { isoWeekdaysOf } from '../common/weekdays';

// A student's past lessons for the portal schedule: every lesson day of their
// groups in the window, with what happened there - their attendance mark,
// homework given that day and test/exam results for that day.

export interface PastLessonGroup {
  id: string;
  name: string;
  subject: string | null;
  scheduleDays: string | null;
  // The group's weekly lessons live in the timetable (groups.timetableManaged):
  // scheduleDays is then never a source of lesson days.
  timetableManaged?: boolean;
  startTime: string | null;
  endTime: string | null;
  teacher: string | null;
  // Joined on this local date; lessons before it are not the student's.
  joinedOn: string;
  // Left on this local date (null while still in the group).
  leftOn: string | null;
  // Every stay in the group, as local dates (enrollments/membership.ts).
  // When given, these decide which lessons were the student's - a break
  // between two stays is not; joinedOn/leftOn are then not consulted.
  stays?: Array<{ from: string; until: string | null }>;
}

export interface PastLessonSlot {
  // The timetable row: the lesson's identity (lessons/occurrences.ts). Two
  // rows of one group on one day are two lessons.
  id?: string;
  groupId: string;
  dayOfWeek: number | null;
  date: string | null; // one-time lesson
  startTime: string;
  endTime: string;
  topic: string | null;
  status: string; // SCHEDULED | CANCELLED | COMPLETED
}

export interface PastLessonHomework {
  id: string;
  groupId: string;
  givenOn: string; // local date the homework was created
  title: string;
  description: string | null;
  dueDate: Date | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  status: string | null; // completion status for this student
  score: number | null;
  maxScore: number;
  feedback?: string | null; // the teacher's comment on this student's work
}

export interface PastLessonExam {
  id: string;
  groupId: string;
  heldOn: string; // local date of the exam
  title: string;
  maxScore: number;
  passingScore: number | null;
  score: number | null; // this student's result, null when none
}

export interface PastLessonInput {
  from: string; // first local date (inclusive), YYYY-MM-DD
  today: string; // local today, YYYY-MM-DD (inclusive when something was recorded)
  groups: PastLessonGroup[];
  slots: PastLessonSlot[];
  // scheduleId: the lesson the mark is for (null/absent: the day as a whole); startTime: the lesson's start when marked.
  attendance: Array<{ groupId: string; date: string; status: string; scheduleId?: string | null; startTime?: string | null }>;
  // What the teacher recorded as covered on that day (wins over a slot topic).
  topics?: Array<{ groupId: string; date: string; topic: string }>;
  homework: PastLessonHomework[];
  exams: PastLessonExam[];
}

export interface PastLesson {
  date: string;
  groupId: string;
  groupName: string;
  subject: string | null;
  teacher: string | null;
  startTime: string | null;
  endTime: string | null;
  topic: string | null;
  cancelled: boolean;
  // This lesson's own mark.
  attendance: string | null;
  // A mark for the day as a whole, on a day with several lessons: it is not
  // known which lesson it was for, so it is shown beside each and is none's.
  dayAttendance: string | null;
  // The lesson's timetable row (null: a day that is a lesson without one).
  scheduleId: string | null;
  homework: Array<Omit<PastLessonHomework, 'groupId' | 'givenOn'>>;
  exams: Array<Omit<PastLessonExam, 'groupId' | 'heldOn'>>;
}

// ISO weekday (1 = Monday) of a YYYY-MM-DD date.
function weekdayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function nextDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildPastLessons(input: PastLessonInput): PastLesson[] {
  const byKey = new Map<string, PastLesson>();
  const groupById = new Map(input.groups.map((g) => [g.id, g]));
  const inWindow = (g: PastLessonGroup, date: string) =>
    date >= input.from && date <= input.today && (g.stays
      ? g.stays.some((s) => date >= s.from && (!s.until || date <= s.until))
      : date >= g.joinedOn && (!g.leftOn || date <= g.leftOn));

  // One entry per lesson: the group, the date and the timetable row ("" for
  // a day that is a lesson without one - a group with no timetable rows, or
  // a record made on a day off the timetable).
  const add = (g: PastLessonGroup, date: string, extra: Partial<PastLesson> = {}, slotId = '') => {
    const key = `${g.id}|${date}|${slotId}`;
    const existing = byKey.get(key);
    if (existing) {
      Object.assign(existing, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)));
      return existing;
    }
    const lesson: PastLesson = {
      date,
      groupId: g.id,
      groupName: g.name,
      subject: g.subject,
      teacher: g.teacher,
      startTime: g.startTime,
      endTime: g.endTime,
      topic: null,
      cancelled: false,
      attendance: null,
      dayAttendance: null,
      scheduleId: slotId || null,
      homework: [],
      exams: [],
      ...extra,
    };
    byKey.set(key, lesson);
    return lesson;
  };

  // 1. Lesson days from the timetable (weekly slots and one-time lessons);
  //    a group without timetable rows uses its own scheduleDays.
  const slotsByGroup = new Map<string, PastLessonSlot[]>();
  for (const s of input.slots) slotsByGroup.set(s.groupId, [...(slotsByGroup.get(s.groupId) ?? []), s]);
  for (const g of input.groups) {
    const slots = slotsByGroup.get(g.id) ?? [];
    const weekly = slots.filter((s) => s.date == null && s.dayOfWeek != null && s.status !== 'CANCELLED');
    // Only a group that never had a weekly row falls back to its own days:
    // one whose rows were cancelled or deleted has no weekly lessons (the
    // same rule as lessons/occurrences.ts).
    const everWeekly = g.timetableManaged || slots.some((s) => s.date == null && s.dayOfWeek != null);
    const weekdays = weekly.length > 0 ? new Set(weekly.map((s) => s.dayOfWeek!)) : everWeekly ? new Set<number>() : new Set(isoWeekdaysOf(g.scheduleDays));
    // Today's lesson is listed only once something was recorded for it.
    for (let d = input.from; d < input.today; d = nextDate(d)) {
      if (!weekdays.has(weekdayOf(d)) || !inWindow(g, d)) continue;
      // Every weekly lesson of that weekday is its own entry (a group may have two a day).
      const today = weekly.filter((s) => s.dayOfWeek === weekdayOf(d));
      if (today.length === 0) add(g, d);
      for (const slot of today) add(g, d, { startTime: slot.startTime, endTime: slot.endTime, topic: slot.topic }, slot.id ?? '');
    }
    for (const s of slots) {
      if (!s.date || s.date >= input.today || !inWindow(g, s.date)) continue;
      add(g, s.date, { startTime: s.startTime, endTime: s.endTime, topic: s.topic, cancelled: s.status === 'CANCELLED' }, s.id ?? '');
    }
  }

  // 2. What happened on each day. A record on a day off the timetable (a
  //    make-up lesson) still makes that day a lesson, and a mark proves the
  //    student was in the group even before the recorded join date.
  const lessonsOn = (groupId: string, date: string) => [...byKey.values()].filter((l) => l.groupId === groupId && l.date === date);
  /** The day's entry for something recorded per day: its first lesson, or the day itself. */
  const dayEntry = (g: PastLessonGroup, date: string) => lessonsOn(g.id, date).sort((x, y) => (x.startTime ?? '').localeCompare(y.startTime ?? ''))[0] ?? add(g, date);
  for (const a of input.attendance) {
    const g = groupById.get(a.groupId);
    if (!g || a.date < input.from || a.date > input.today) continue;
    if (a.scheduleId) {
      // A mark of one lesson. The lesson may be gone from the timetable since: the mark still shows, with the time it had.
      add(g, a.date, byKey.has(`${g.id}|${a.date}|${a.scheduleId}`) ? {} : { startTime: a.startTime ?? null, endTime: null }, a.scheduleId).attendance = a.status;
      continue;
    }
    // A mark for the day as a whole. With one lesson that day it is that
    // lesson's; with several it is shown as the day's mark on each, and is
    // nobody's in particular (it is never copied into a lesson's own mark).
    const same = lessonsOn(g.id, a.date);
    if (same.length <= 1) (same[0] ?? add(g, a.date)).attendance = a.status;
    else for (const l of same) l.dayAttendance = a.status;
  }
  for (const tp of input.topics ?? []) {
    const g = groupById.get(tp.groupId);
    if (!g || tp.date < input.from || tp.date > input.today) continue;
    // The topic is kept per group and day: every lesson of that day shows it.
    const existing = lessonsOn(g.id, tp.date);
    if (existing.length) for (const l of existing) l.topic = tp.topic;
    else if (inWindow(g, tp.date)) add(g, tp.date).topic = tp.topic;
  }
  // Homework is often posted after the lesson (that evening or the next
  // day): it belongs to the group's latest lesson on or before that day.
  for (const h of input.homework) {
    const g = groupById.get(h.groupId);
    if (!g || !inWindow(g, h.givenOn)) continue;
    const { groupId: _g, givenOn: _d, ...rest } = h;
    const lesson = [...byKey.values()]
      .filter((l) => l.groupId === g.id && l.date <= h.givenOn)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.startTime ?? '').localeCompare(a.startTime ?? ''))[0];
    (lesson ?? add(g, h.givenOn)).homework.push(rest);
  }
  for (const e of input.exams) {
    const g = groupById.get(e.groupId);
    if (!g || !inWindow(g, e.heldOn)) continue;
    const { groupId: _g, heldOn: _d, ...rest } = e;
    dayEntry(g, e.heldOn).exams.push(rest);
  }

  // A day that became a lesson through a record (e.g. a mark from before
  // the recorded join date) still shows the topic set for that date.
  for (const l of byKey.values()) {
    if (l.topic) continue;
    const dated = input.slots.find((s) => s.groupId === l.groupId && s.date === l.date && s.topic);
    if (dated) l.topic = dated.topic;
  }

  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}
