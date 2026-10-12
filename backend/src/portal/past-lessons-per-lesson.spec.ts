import { describe, expect, it } from 'vitest';
import { buildPastLessons, type PastLessonGroup, type PastLessonSlot } from './past-lessons';

// 2026-03-07 and 2026-03-14 are Saturdays (ISO weekday 6).
const group = (over: Partial<PastLessonGroup> = {}): PastLessonGroup => ({
  id: 'g', name: 'Twice', subject: 'English', scheduleDays: null, timetableManaged: true, startTime: '09:00', endTime: '10:00', teacher: null,
  joinedOn: '2026-01-01', leftOn: null, ...over,
});
const slot = (id: string, startTime: string, endTime: string, over: Partial<PastLessonSlot> = {}): PastLessonSlot => ({
  id, groupId: 'g', dayOfWeek: 6, date: null, startTime, endTime, topic: null, status: 'SCHEDULED', ...over,
});
const build = (over: Partial<Parameters<typeof buildPastLessons>[0]>) => buildPastLessons({
  from: '2026-03-01', today: '2026-03-20', groups: [group()], slots: [slot('am', '09:00', '10:00'), slot('pm', '15:00', '16:00')], attendance: [], homework: [], exams: [], ...over,
});

describe('cabinet past lessons, per lesson', () => {
  it('two lessons of one day are two entries, each with its own mark', () => {
    const lessons = build({ attendance: [
      { groupId: 'g', date: '2026-03-07', status: 'PRESENT', scheduleId: 'am', startTime: '09:00' },
      { groupId: 'g', date: '2026-03-07', status: 'ABSENT', scheduleId: 'pm', startTime: '15:00' },
    ] });
    const day = lessons.filter((l) => l.date === '2026-03-07');
    expect(day.map((l) => [l.startTime, l.scheduleId, l.attendance, l.dayAttendance])).toEqual([['09:00', 'am', 'PRESENT', null], ['15:00', 'pm', 'ABSENT', null]]);
    // The other Saturday has both lessons too, unmarked.
    expect(lessons.filter((l) => l.date === '2026-03-14').map((l) => [l.startTime, l.attendance])).toEqual([['09:00', null], ['15:00', null]]);
  });

  it('a day-level mark on a day with two lessons is shown beside both and is neither lesson\'s own', () => {
    const day = build({ attendance: [{ groupId: 'g', date: '2026-03-07', status: 'ABSENT', scheduleId: null }] }).filter((l) => l.date === '2026-03-07');
    expect(day.map((l) => [l.startTime, l.attendance, l.dayAttendance])).toEqual([['09:00', null, 'ABSENT'], ['15:00', null, 'ABSENT']]);
  });

  it('a day-level mark on a day with one lesson is that lesson\'s', () => {
    const day = build({ slots: [slot('am', '09:00', '10:00')], attendance: [{ groupId: 'g', date: '2026-03-07', status: 'LATE' }] }).filter((l) => l.date === '2026-03-07');
    expect(day.map((l) => [l.scheduleId, l.attendance, l.dayAttendance])).toEqual([['am', 'LATE', null]]);
  });

  it('a mark of a lesson that is no longer on the timetable still shows, with the time it had', () => {
    const day = build({ slots: [slot('am', '09:00', '10:00')], attendance: [{ groupId: 'g', date: '2026-03-07', status: 'ABSENT', scheduleId: 'gone', startTime: '18:00' }] }).filter((l) => l.date === '2026-03-07');
    expect(day.map((l) => [l.scheduleId, l.startTime, l.attendance])).toEqual([['am', '09:00', null], ['gone', '18:00', 'ABSENT']]);
  });

  it('with stays given, the lessons of a break between two stays are not listed', () => {
    const lessons = build({
      slots: [slot('am', '09:00', '10:00')],
      groups: [group({ stays: [{ from: '2026-02-01', until: '2026-03-08' }, { from: '2026-03-16', until: null }] })],
      from: '2026-02-20', today: '2026-03-25',
    });
    // Saturdays: Feb 21, 28, Mar 7 (first stay); Mar 14 is in the break; Mar 21 (second stay).
    expect(lessons.map((l) => l.date).sort()).toEqual(['2026-02-21', '2026-02-28', '2026-03-07', '2026-03-21']);
  });
});
