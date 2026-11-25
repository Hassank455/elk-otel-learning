// OpenTelemetry setup for payments-api. Same as orders-api, only the service name differs.
// Loaded before the app with: node --import ./dist/instrumentation.js dist/main.js
import { register } from 'node:module';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import {
  AggregationTemporality,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

process.env.OTEL_LOGS_EXPORTER ??= 'none';
const otlpBase =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'payments-api',
    [ATTR_SERVICE_VERSION]: '0.1.0',
    'deployment.environment.name': 'local',
  }),
  traceExporter: new OTLPTraceExporter({ url: `${otlpBase}/v1/traces` }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${otlpBase}/v1/metrics`,
        temporalityPreference: AggregationTemporality.DELTA,
      }),
      exportIntervalMillis: 10_000,
    }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-express': {
        ignoreLayersType: [
          ExpressLayerType.MIDDLEWARE,
          ExpressLayerType.ROUTER,
        ],
        ignoreLayers: [/splat/],
      },
      '@opentelemetry/instrumentation-router': { enabled: false },
      '@opentelemetry/instrumentation-pino': { disableLogSending: true },
    }),
  ],
});

sdk.start();

// Our handler replaces Node's default "exit on signal", so we must exit ourselves
process.on('SIGTERM', () => void sdk.shutdown().finally(() => process.exit(0)));
process.on('SIGINT', () => void sdk.shutdown().finally(() => process.exit(0)));
