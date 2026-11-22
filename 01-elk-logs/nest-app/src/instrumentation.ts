// OpenTelemetry setup. This file must run BEFORE the app code, so it is loaded with:
//   node --import ./dist/instrumentation.js dist/main.js
import { register } from 'node:module';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { AggregationTemporality, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// Our app uses ES modules (import/export). This hook lets OpenTelemetry
// patch libraries like express and @nestjs/core when they are imported.
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

// Logs still go through Logstash (Stage 1), so don't send them over OTLP too.
process.env.OTEL_LOGS_EXPORTER ??= 'none';

const otlpBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

const sdk = new NodeSDK({
  // Resource: who is sending this telemetry
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'orders-api',
    [ATTR_SERVICE_VERSION]: '0.1.0',
    'deployment.environment.name': 'local',
  }),
  // Exporter: where spans go (the OTel Collector, OTLP over HTTP on port 4318)
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? `${otlpBase}/v1/traces`,
  }),
  // Stage 2, lesson 4: metrics. A reader collects all metrics every 10 seconds
  // and hands them to the exporter (same Collector, path /v1/metrics).
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? `${otlpBase}/v1/metrics`,
        // DELTA: each export sends "what happened in the last 10s", not the running total.
        // This is what Elastic recommends for OTel metrics.
        temporalityPreference: AggregationTemporality.DELTA,
      }),
      exportIntervalMillis: 10_000,
    }),
  ],
  // Instrumentations: create spans automatically for HTTP, Express, NestJS, ...
  instrumentations: [
    getNodeAutoInstrumentations({
      // Turned off to keep traces readable while learning:
      '@opentelemetry/instrumentation-fs': { enabled: false }, // a span for every file read
      // express: keep the span for the route handler, skip one span per middleware
      '@opentelemetry/instrumentation-express': {
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.ROUTER],
        ignoreLayers: [/splat/], // NestJS internal catch-all handlers
      },
      '@opentelemetry/instrumentation-router': { enabled: false },
      // pino: add trace_id/span_id to every log line, but don't send logs over OTLP
      '@opentelemetry/instrumentation-pino': { disableLogSending: true },
    }),
  ],
});

sdk.start();

// Flush the last spans when the app stops (Ctrl+C)
process.on('SIGTERM', () => void sdk.shutdown());
process.on('SIGINT', () => void sdk.shutdown().finally(() => process.exit(0)));
