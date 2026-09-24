import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DB = 'DB';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Columns are `timestamp without time zone`, and drizzle writes and
        // reads them as UTC. Pinning the session to UTC makes defaultNow()
        // store UTC too; otherwise a server whose timezone is e.g.
        // Asia/Tashkent stored local wall-clock time, 5 h off from every
        // app-written timestamp.
        const pool = new Pool({
          connectionString: config.get<string>('DATABASE_URL'),
          options: '-c TimeZone=UTC',
        });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}

export type Database = NodePgDatabase<typeof schema>;
