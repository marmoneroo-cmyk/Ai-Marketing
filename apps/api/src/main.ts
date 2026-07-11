import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnv } from '@brandpilot/config';
import { initTelemetry, initErrorTracking, logger } from '@brandpilot/observability';
import { AppModule } from './app.module';
import { ZodValidationPipe } from './common/zod-validation.pipe';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { AuditInterceptor } from './common/audit.interceptor';
import { DATABASE } from './db/db.provider';
import type { Database } from '@brandpilot/db';

const DEFAULT_PORT = 4000;

/** Derive the listen port from API_URL (falls back to 4000). */
function resolvePort(apiUrl: string): number {
  try {
    const parsed = new URL(apiUrl);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * Validate APP_URL is a concrete http(s) origin before using it for CORS. A
 * wildcard (`*`) or malformed value is rejected so we never reflect an
 * unintended origin alongside `credentials: true`.
 */
function assertCorsOrigin(appUrl: string): string {
  if (appUrl === '*') {
    throw new Error('APP_URL must be a concrete origin, not "*", when CORS credentials are enabled');
  }
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error(`APP_URL is not a well-formed URL: ${appUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`APP_URL must use http(s), got: ${parsed.protocol}`);
  }
  return parsed.origin;
}

async function bootstrap(): Promise<void> {
  // Start tracing at the very top of bootstrap, before the Nest app is created,
  // so auto-instrumentation wraps the HTTP server and outbound clients.
  initTelemetry('brandpilot-api');
  initErrorTracking('brandpilot-api');

  const env = loadEnv();
  // `rawBody: true` retains the unparsed request body on `req.rawBody`, which the
  // webhook controllers need to verify the `X-Hub-Signature-256` HMAC (the
  // signature is computed over the exact bytes Meta sent, not the re-serialized
  // JSON).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    rawBody: true,
  });

  // Behind Railway's reverse proxy: trust the first hop so `req.ip` reflects the
  // real client (from X-Forwarded-For) rather than the proxy. Without this,
  // @nestjs/throttler keys every request on the shared proxy address, collapsing
  // all per-client rate limits (login, refresh, …) into one global bucket.
  app.set('trust proxy', 1);

  const corsOrigin = assertCorsOrigin(env.APP_URL);
  app.enableCors({ origin: corsOrigin, credentials: true });

  // Global pipes/filters/interceptors. The audit interceptor needs the DB,
  // which it resolves from the Nest container.
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  const db = app.get<Database>(DATABASE);
  app.useGlobalInterceptors(new AuditInterceptor(db));

  // Swagger exposes the full API surface; keep it off in production.
  if (env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('BrandPilot API')
      .setDescription('Multi-tenant API gateway for the BrandPilot marketing OS.')
      .setVersion('0.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // Railway and most PaaS inject the port to bind via $PORT; fall back to API_URL locally.
  const port = process.env.PORT ? Number(process.env.PORT) : resolvePort(env.API_URL);
  await app.listen(port);
  logger.info({ port }, 'BrandPilot API listening');
}

bootstrap().catch((err: unknown) => {
  logger.error({ err }, 'API bootstrap failed');
  process.exit(1);
});
