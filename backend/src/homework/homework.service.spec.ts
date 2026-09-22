import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomeworkService } from './homework.service';

describe('HomeworkService', () => {
  let service: HomeworkService;
  let mockDb: any;
  let mockTelegram: any;

  beforeEach(() => {
    mockDb = {
      query: {
        homework: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        homeworkCompletions: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        students: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        enrollments: {
          findMany: vi.fn(),
        },
        examResults: {
          findMany: vi.fn(),
        },
        groups: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn(),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn(),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    };

    mockTelegram = {
      notifyStudent: vi.fn(),
      notifyGroup: vi.fn(),
    };

    const mockNotifications = {
      notifyHomeworkGraded: vi.fn(),
      notifyHomework: vi.fn(),
    };

    service = new HomeworkService(mockDb, mockTelegram, mockNotifications as any);
  });

  describe('submit', () => {
    it('records student homework submission', async () => {
      mockDb.query.homework.findFirst.mockResolvedValue({
        id: 'hw-1',
        title: 'Essay on Environment',
        maxScore: 100,
      });
      mockDb.query.students.findFirst.mockResolvedValue({
        id: 'student-1',
        fullName: 'Botir Zokirov',
      });
      mockDb.query.homeworkCompletions.findFirst.mockResolvedValue(null);

      const created = {
        id: 'comp-1',
        homeworkId: 'hw-1',
        studentId: 'student-1',
        status: 'SUBMITTED',
        completed: true,
        submissionText: 'Here is my essay text...',
      };
      mockDb.insert().values().returning.mockResolvedValue([created]);

      const res = await service.submit('tenant-1', 'hw-1', {
        studentId: 'student-1',
        submissionText: 'Here is my essay text...',
      });

      expect(res).toEqual(created);
    });
  });

  describe('grade', () => {
    it('records teacher score, feedback and notifies student via Telegram', async () => {
      mockDb.query.homework.findFirst.mockResolvedValue({
        id: 'hw-1',
        title: 'Math Quiz',
        maxScore: 100,
      });
      mockDb.query.students.findFirst.mockResolvedValue({
        id: 'student-1',
        fullName: 'Botir Zokirov',
      });
      mockDb.query.homeworkCompletions.findFirst.mockResolvedValue({
        id: 'comp-1',
        homeworkId: 'hw-1',
        studentId: 'student-1',
      });

      const updated = {
        id: 'comp-1',
        score: 95,
        feedback: "A'lo natija, barakalla!",
        status: 'GRADED',
      };
      mockDb.update().set().where().returning.mockResolvedValue([updated]);

      const res = await service.grade('tenant-1', 'hw-1', {
        studentId: 'student-1',
        score: 95,
        feedback: "A'lo natija, barakalla!",
      });

      expect(res).toEqual(updated);
      expect(mockTelegram.notifyStudent).toHaveBeenCalledWith(
        'student-1',
        expect.stringContaining('95 / 100'),
      );
    });
  });

  describe('getLeaderboard', () => {
    it('calculates total scores and assigns ranking badges', async () => {
      mockDb.query.students.findMany.mockResolvedValue([
        { id: 's1', fullName: 'Ali Valiyev' },
        { id: 's2', fullName: 'Vali Aliyev' },
      ]);

      mockDb.query.homeworkCompletions.findMany.mockResolvedValue([
        { studentId: 's1', score: 90, completed: true },
        { studentId: 's2', score: 60, completed: true },
      ]);

      mockDb.query.examResults.findMany.mockResolvedValue([
        { studentId: 's1', score: 85 },
        { studentId: 's2', score: 70 },
      ]);

      const leaderboard = await service.getLeaderboard('tenant-1');

      expect(leaderboard).toHaveLength(2);
      // Ali: 90 + 85 = 175 (Rank 1, GOLD)
      expect(leaderboard[0].studentId).toBe('s1');
      expect(leaderboard[0].totalScore).toBe(175);
      expect(leaderboard[0].rank).toBe(1);
      expect(leaderboard[0].badge).toBe('GOLD');

      // Vali: 60 + 70 = 130 (Rank 2, SILVER)
      expect(leaderboard[1].studentId).toBe('s2');
      expect(leaderboard[1].totalScore).toBe(130);
      expect(leaderboard[1].rank).toBe(2);
      expect(leaderboard[1].badge).toBe('SILVER');
    });
  });
});
