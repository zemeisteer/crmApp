import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { corsOriginChecker } from './common/cors';
import { setUploadHeaders } from './common/upload.util';

/**
 * TRUST_PROXY: how many reverse proxies stand in front of the API (the
 * production stack: one, nginx). Then the client address is the one nginx
 * saw - rate limits are per visitor instead of one shared bucket for all.
 * Unset: the API is reached directly and X-Forwarded-For is ignored, so a
 * client cannot pick its own address. A non-numeric value is passed to
 * Express as is (e.g. "loopback, uniquelocal").
 */
export function trustProxySetting(value: string | undefined): number | string | false {
  const v = (value ?? '').trim();
  if (!v || v === '0' || v.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/** Everything main.ts sets on the app besides logging and listening (also used by e2e tests). */
export function configureApp(app: NestExpressApplication, env: NodeJS.ProcessEnv = process.env) {
  const trust = trustProxySetting(env.TRUST_PROXY);
  if (trust !== false) app.set('trust proxy', trust);

  // Only the app's own domain and center subdomains (plus localhost in dev).
  const corsAllowed = corsOriginChecker(env);
  app.enableCors({
    origin: (origin, cb) => cb(null, corsAllowed(origin)),
    credentials: true,
  });

  // Uploaded homework/exam attachments — local disk in dev. For a
  // multi-instance or ephemeral-filesystem production deploy, swap this
  // for S3 (same pattern as the other optional integrations). Served from
  // the app's own origin, hence the strict headers (common/upload.util.ts).
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads/', setHeaders: setUploadHeaders });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.setGlobalPrefix('api');
}
