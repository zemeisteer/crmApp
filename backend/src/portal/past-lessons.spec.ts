import { describe, expect, it } from 'vitest';
import { buildPastLessons, type PastLessonInput } from './past-lessons';

// 2026-09-21 is a Monday.
const base = (): PastLessonInput => ({
  from: '2026-09-14',
  today: '2026-09-23',
  groups: [
    { id: 'g1', name: 'English A1', subject: 'Ingliz tili', scheduleDays: 'Dushanba,Chorshanba', startTime: '14:00', endTime: '15:30', teacher: 'Aziza', joinedOn: '2026-09-01', leftOn: null },
  ],
  slots: [],
  attendance: [],
  homework: [],
  exams: [],
});

describe('buildPastLessons', () => {
  it('lists the lesson days before today from the group days, newest first', () => {
    const lessons = buildPastLessons(base());
    expect(lessons.map((l) => l.date)).toEqual(['2026-09-21', '2026-09-16', '2026-09-14']);
    expect(lessons[0]).toMatchObject({ groupName: 'English A1', startTime: '14:00', teacher: 'Aziza', attendance: null });
  });

  it('prefers the timetable over the group days and keeps the topic', () => {
    const input = base();
    input.slots = [{ groupId: 'g1', dayOfWeek: 2, date: null, startTime: '10:00', endTime: '11:00', topic: 'Past Simple', status: 'SCHEDULED' }];
    const lessons = buildPastLessons(input);
    expect(lessons.map((l) => l.date)).toEqual(['2026-09-22', '2026-09-15']);
    expect(lessons[0]).toMatchObject({ startTime: '10:00', topic: 'Past Simple' });
  });

  it('attaches attendance, homework and exam results to their day', () => {
    const input = base();
    input.attendance = [{ groupId: 'g1', date: '2026-09-21', status: 'LATE' }];
    input.homework = [{ id: 'h1', groupId: 'g1', givenOn: '2026-09-21', title: 'Ex. 5', description: 'Page 12', dueDate: null, attachmentPath: null, attachmentName: null, status: 'GRADED', score: 9, maxScore: 10 }];
    input.exams = [{ id: 'e1', groupId: 'g1', heldOn: '2026-09-16', title: 'Unit test', maxScore: 100, passingScore: 60, score: 72 }];
    const [mon, wed] = buildPastLessons(input);
    expect(mon.attendance).toBe('LATE');
    expect(mon.homework).toEqual([{ id: 'h1', title: 'Ex. 5', description: 'Page 12', dueDate: null, attachmentPath: null, attachmentName: null, status: 'GRADED', score: 9, maxScore: 10 }]);
    expect(wed.exams).toEqual([{ id: 'e1', title: 'Unit test', maxScore: 100, passingScore: 60, score: 72 }]);
  });

  it('puts homework posted on a day off under the latest lesson', () => {
    const input = base();
    // Sunday 20th: the latest lesson before it is Wednesday 16th.
    input.homework = [{ id: 'h2', groupId: 'g1', givenOn: '2026-09-20', title: 'Weekend task', description: null, dueDate: null, attachmentPath: null, attachmentName: null, status: null, score: null, maxScore: 10 }];
    const lessons = buildPastLessons(input);
    expect(lessons.map((l) => l.date)).toEqual(['2026-09-21', '2026-09-16', '2026-09-14']);
    expect(lessons[1].homework.map((h) => h.id)).toEqual(['h2']);
  });

  it('adds make-up days and today only when something was recorded', () => {
    const input = base();
    input.attendance = [
      { groupId: 'g1', date: '2026-09-19', status: 'PRESENT' }, // Saturday make-up
      { groupId: 'g1', date: '2026-09-23', status: 'ABSENT' }, // today
    ];
    const dates = buildPastLessons(input).map((l) => l.date);
    expect(dates).toContain('2026-09-19');
    expect(dates[0]).toBe('2026-09-23');
  });

  it('skips days before joining and after leaving, and marks cancelled one-off lessons', () => {
    const input = base();
    input.groups[0].joinedOn = '2026-09-15';
    input.groups[0].leftOn = '2026-09-20';
    input.slots = [{ groupId: 'g1', dayOfWeek: null, date: '2026-09-18', startTime: '09:00', endTime: '10:00', topic: null, status: 'CANCELLED' }];
    const lessons = buildPastLessons(input);
    expect(lessons.map((l) => l.date)).toEqual(['2026-09-18', '2026-09-16']);
    expect(lessons[0].cancelled).toBe(true);
  });
});
