import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { join } from 'path';
dotenv.config();
dotenv.config({ path: join(__dirname, '..', '.env') });
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { redactQuery, redactUrl } from './common/log-redact';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // CORS, /uploads, validation, /api prefix, trust proxy (app.setup.ts).
  configureApp(app);

  // Structured (JSON) request logs — pipe stdout through `pino-pretty` in
  // dev if you want colorized output; in production, JSON lines are what
  // most log aggregators (Datadog, CloudWatch, Loki) expect. Tokens in
  // links (invitations, e-mail verification) are masked (common/log-redact.ts).
  app.use(
    pinoHttp({
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      serializers: {
        req: (req: { url?: string; query?: unknown }) => ({ ...req, url: redactUrl(req.url), query: redactQuery(req.query) }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`TalimCRM backend running on http://localhost:${port}/api`);
  if (!process.env.SENTRY_DSN) {
    // eslint-disable-next-line no-console
    console.log('Sentry error monitoring: disabled (set SENTRY_DSN in .env to enable)');
  }
}
bootstrap();
