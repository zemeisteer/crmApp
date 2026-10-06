import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { exams } from '../db/schema';
import { assertTeacherGroups } from '../common/teacher-scope';

/**
 * Every /exams/:id... route: a teacher works only with exams of their own
 * groups (questions, results, attempts, grading, material). Other roles are
 * not restricted here; an exam of another center is left to the handler's
 * own 404.
 */
@Injectable()
export class ExamTeacherScopeGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as { role?: string; sub?: string; tenantId?: string } | undefined;
    const id = req.params?.id as string | undefined;
    if (!user || user.role !== 'TEACHER' || !id || !user.tenantId) return true;
    const exam = await this.db.query.exams.findFirst({
      where: and(eq(exams.id, id), eq(exams.tenantId, user.tenantId)),
      columns: { groupId: true },
    });
    if (!exam) return true;
    await assertTeacherGroups(this.db, user.tenantId, { role: user.role, userId: user.sub }, [exam.groupId]);
    return true;
  }
}
