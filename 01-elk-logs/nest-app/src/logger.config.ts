import pino from 'pino';
import pretty from 'pino-pretty';
import { createRequire } from 'node:module';
import type { Params } from 'nestjs-pino';

// pino-elasticsearch is a CommonJS package whose types don't match ESM imports, so we load it with require
const require = createRequire(import.meta.url);
const pinoElastic: typeof import('pino-elasticsearch').default = require('pino-elasticsearch');

const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200';

// Stream 1: human-readable logs in the terminal
const consoleStream = pretty({
  colorize: true,
  messageKey: 'message',
  timestampKey: '@timestamp',
  ignore: 'pid,hostname,req,res',
});

// Stream 2: JSON logs shipped to Elasticsearch in batches (Bulk API)
const elasticStream = pinoElastic({
  node: ELASTICSEARCH_URL,
  index: 'nest-app-logs',
  esVersion: 9,
  flushInterval: 2000, // send a batch every 2 seconds (learning only, default is 30s)
});

elasticStream.on('error', (err: Error) => {
  console.error('Elasticsearch stream error:', err.message);
});

export const loggerConfig: Params = {
  // fields added with logger.assign() also go on the HTTP request log
  assignResponse: true,
  pinoHttp: [
    {
      level: 'debug',
      messageKey: 'message', // "msg" -> "message"
      base: { service: 'orders-api' }, // added to every log line
      timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label }), // 30 -> "info"
      },
      // keep request logs small: only the fields we care about
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // 5xx or exception -> error, 4xx -> warn, everything else -> info
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res, responseTime) =>
        `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
      customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    },
    pino.multistream([{ stream: consoleStream }, { stream: elasticStream }]),
  ],
};
