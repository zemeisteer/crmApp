import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'unreachable' });
    }
    // The commit the running image was built from (backend/Dockerfile).
    return { status: 'ok', db: 'ok', revision: process.env.APP_REVISION || 'unknown', time: new Date().toISOString() };
  }
}
