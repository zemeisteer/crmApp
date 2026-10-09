import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, mergeMap } from 'rxjs';
import { CalendarChanges } from './calendar-changes';

/**
 * On controllers whose writes change who has which lesson (groups,
 * timetable, students' enrollments and guardians, lead conversion): after
 * a successful non-GET request, record that the center's calendars need a
 * sync. Awaited, so the record exists before the answer goes out.
 */
@Injectable()
export class CalendarTouch implements NestInterceptor {
  constructor(private readonly changes: CalendarChanges) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<{ method: string; user?: { tenantId?: string | null } }>();
    if (req.method === 'GET') return next.handle();
    return next.handle().pipe(mergeMap((value) => from(this.changes.touch(req.user?.tenantId).then(() => value))));
  }
}
