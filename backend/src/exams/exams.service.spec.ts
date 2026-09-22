import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExamsService } from './exams.service';
import { NotFoundException } from '@nestjs/common';

describe('ExamsService (Question Bank & Auto-Grading)', () => {
  let service: ExamsService;
  let mockDb: any;
  let mockTelegram: any;
  let mockAi: any;

  const tenantId = 'tenant-test-1';
  const examId = 'exam-123';
  const studentId = 'student-456';

  beforeEach(() => {
    mockDb = {
      query: {
        exams: {
          findFirst: vi.fn().mockResolvedValue({
            id: examId,
            tenantId,
            title: 'IELTS Vocabulary Midterm',
            maxScore: 100,
            passingScore: 60,
            durationMinutes: 30,
            group: { id: 'group-1', name: 'IELTS 1', subject: 'Ingliz tili' },
          }),
        },
        students: {
          findFirst: vi.fn().mockResolvedValue({
            id: studentId,
            tenantId,
            fullName: 'Ali Valiyev',
          }),
        },
        examQuestions: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'q1',
              tenantId,
              examId,
              prompt: 'What is the synonym of rapid?',
              questionType: 'MCQ',
              options: JSON.stringify([
                { id: 'A', text: 'Fast' },
                { id: 'B', text: 'Slow' },
                { id: 'C', text: 'Quiet' },
                { id: 'D', text: 'Heavy' },
              ]),
              correctAnswer: 'A',
              explanation: 'Rapid means fast or swift.',
              points: 1,
              order: 0,
            },
            {
              id: 'q2',
              tenantId,
              examId,
              prompt: 'Is vocabulary crucial for IELTS speaking?',
              questionType: 'TRUE_FALSE',
              options: JSON.stringify([
                { id: 'true', text: 'True' },
                { id: 'false', text: 'False' },
              ]),
              correctAnswer: 'true',
              explanation: 'Lexical Resource is 25% of the score.',
              points: 1,
              order: 1,
            },
          ]),
        },
        examAttempts: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'attempt-789', score: 100, passed: true }]),
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ success: true }),
      }),
    };

    mockTelegram = {
      notifyExamResult: vi.fn().mockResolvedValue(true),
    };

    mockAi = {
      generateExamQuestions: vi.fn().mockResolvedValue([
        {
          prompt: 'Generated question?',
          questionType: 'MCQ',
          options: [{ id: 'A', text: 'Choice A' }],
          correctAnswer: 'A',
          explanation: 'Because it is right',
          points: 1,
        },
      ]),
    };

    service = new ExamsService(mockDb, mockTelegram, mockAi);
  });

  it('sanitizes questions in startAttempt to prevent client-side answer leakage', async () => {
    const session = await service.startAttempt(tenantId, examId, studentId);

    expect(session.exam.id).toBe(examId);
    expect(session.questions).toHaveLength(2);

    // Ensure correctAnswer and explanation are NOT returned in sanitized questions
    for (const q of session.questions) {
      expect((q as any).correctAnswer).toBeUndefined();
      expect((q as any).explanation).toBeUndefined();
      expect(Array.isArray(q.options)).toBe(true);
    }
  });

  it('correctly auto-grades a 100% score attempt and notifies via Telegram', async () => {
    const result = await service.submitAttempt(tenantId, examId, {
      studentId,
      answers: {
        q1: 'A',
        q2: 'true',
      },
    });

    expect(result.score).toBe(100);
    expect(result.maxScore).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.percentage).toBe(100);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].isCorrect).toBe(true);
    expect(result.breakdown[1].isCorrect).toBe(true);

    expect(mockTelegram.notifyExamResult).toHaveBeenCalledWith(
      studentId,
      'IELTS Vocabulary Midterm',
      100,
      100,
      expect.stringContaining('o\'tdi'),
    );
  });

  it('correctly calculates partial credit when student answers 1 of 2 questions correctly', async () => {
    const result = await service.submitAttempt(tenantId, examId, {
      studentId,
      answers: {
        q1: 'A', // correct
        q2: 'false', // incorrect (correct is true)
      },
    });

    expect(result.score).toBe(50);
    expect(result.percentage).toBe(50);
    expect(result.passed).toBe(false); // passing is 60
    expect(result.breakdown[0].isCorrect).toBe(true);
    expect(result.breakdown[1].isCorrect).toBe(false);

    expect(mockTelegram.notifyExamResult).toHaveBeenCalledWith(
      studentId,
      'IELTS Vocabulary Midterm',
      50,
      100,
      expect.stringContaining('O\'tish bali: 60'),
    );
  });

  it('throws NotFoundException if student does not belong to tenant', async () => {
    mockDb.query.students.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.submitAttempt(tenantId, examId, {
        studentId: 'wrong-student',
        answers: {},
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
