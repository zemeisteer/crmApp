import { isoWeekdaysOf } from '../common/weekdays';

// A student's past lessons for the portal schedule: every lesson day of their
// groups in the window, with what happened there - their attendance mark,
// homework given that day and test/exam results for that day.

export interface PastLessonGroup {
  id: string;
  name: string;
  subject: string | null;
  scheduleDays: string | null;
  startTime: string | null;
  endTime: string | null;
  teacher: string | null;
  // Joined on this local date; lessons before it are not the student's.
  joinedOn: string;
  // Left on this local date (null while still in the group).
  leftOn: string | null;
}

export interface PastLessonSlot {
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
  attendance: Array<{ groupId: string; date: string; status: string }>;
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
  attendance: string | null;
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
    date >= input.from && date <= input.today && date >= g.joinedOn && (!g.leftOn || date <= g.leftOn);

  const add = (g: PastLessonGroup, date: string, extra: Partial<PastLesson> = {}) => {
    const key = `${g.id}|${date}`;
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
    const weekdays = weekly.length > 0 ? new Set(weekly.map((s) => s.dayOfWeek!)) : new Set(isoWeekdaysOf(g.scheduleDays));
    // Today's lesson is listed only once something was recorded for it.
    for (let d = input.from; d < input.today; d = nextDate(d)) {
      if (!weekdays.has(weekdayOf(d)) || !inWindow(g, d)) continue;
      const slot = weekly.find((s) => s.dayOfWeek === weekdayOf(d));
      add(g, d, slot ? { startTime: slot.startTime, endTime: slot.endTime, topic: slot.topic } : {});
    }
    for (const s of slots) {
      if (!s.date || s.date >= input.today || !inWindow(g, s.date)) continue;
      add(g, s.date, { startTime: s.startTime, endTime: s.endTime, topic: s.topic, cancelled: s.status === 'CANCELLED' });
    }
  }

  // 2. What happened on each day. A record on a day off the timetable (a
  //    make-up lesson) still makes that day a lesson, and a mark proves the
  //    student was in the group even before the recorded join date.
  for (const a of input.attendance) {
    const g = groupById.get(a.groupId);
    if (!g || a.date < input.from || a.date > input.today) continue;
    add(g, a.date).attendance = a.status;
  }
  for (const tp of input.topics ?? []) {
    const g = groupById.get(tp.groupId);
    if (!g || tp.date < input.from || tp.date > input.today) continue;
    const existing = byKey.get(`${g.id}|${tp.date}`);
    if (existing) existing.topic = tp.topic;
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
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    (lesson ?? add(g, h.givenOn)).homework.push(rest);
  }
  for (const e of input.exams) {
    const g = groupById.get(e.groupId);
    if (!g || !inWindow(g, e.heldOn)) continue;
    const { groupId: _g, heldOn: _d, ...rest } = e;
    add(g, e.heldOn).exams.push(rest);
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
