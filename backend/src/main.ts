import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import * as Sentry from '@sentry/node';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development' });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true, credentials: true });

  // Uploaded homework/exam attachments — local disk in dev. For a
  // multi-instance or ephemeral-filesystem production deploy, swap this
  // for S3 (same pattern as the other optional integrations).
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads/' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  // Structured (JSON) request logs — pipe stdout through `pino-pretty` in
  // dev if you want colorized output; in production, JSON lines are what
  // most log aggregators (Datadog, CloudWatch, Loki) expect.
  app.use(
    pinoHttp({
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.setGlobalPrefix('api');
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
