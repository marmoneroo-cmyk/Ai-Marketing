import { logger } from './logger';

/**
 * Initialize OpenTelemetry tracing for a service.
 *
 * Behaviour is env-gated and fail-safe:
 * - If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, telemetry is disabled and we log
 *   that fact exactly once (no SDK is started).
 * - Otherwise a `NodeSDK` is started with an OTLP/HTTP trace exporter and the
 *   standard Node auto-instrumentations, and a SIGTERM handler is registered to
 *   flush + shut it down gracefully.
 *
 * The OTel SDK is loaded via dynamic `import()` so its (heavy, optional) deps are
 * only pulled in when tracing is actually enabled. The function returns `void`
 * immediately; startup completes on a background microtask. Any failure while
 * loading or starting the SDK is swallowed (logged, never thrown) so a telemetry
 * problem can never crash the host application.
 */
export function initTelemetry(serviceName: string): void {
  if (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] === undefined) {
    logger.info({ service: serviceName }, 'OpenTelemetry disabled (OTEL_EXPORTER_OTLP_ENDPOINT unset)');
    return;
  }

  void startSdk(serviceName);
}

async function startSdk(serviceName: string): Promise<void> {
  try {
    const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
    ]);

    const sdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();
    logger.info({ service: serviceName }, 'OpenTelemetry started');

    const shutdown = (): void => {
      void sdk
        .shutdown()
        .then(() => logger.info({ service: serviceName }, 'OpenTelemetry shut down'))
        .catch((err: unknown) => logger.error({ service: serviceName, err }, 'OpenTelemetry shutdown failed'));
    };
    process.on('SIGTERM', shutdown);
  } catch (err: unknown) {
    logger.error({ service: serviceName, err }, 'OpenTelemetry failed to start; continuing without tracing');
  }
}
