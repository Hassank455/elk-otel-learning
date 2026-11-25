import pino from 'pino';
import pretty from 'pino-pretty';
import type { Params } from 'nestjs-pino';

// We write into the SAME folder as orders-api (01-elk-logs/nest-app/logs).
// Logstash already tails "*.log" in that folder, so payments logs reach
// Elasticsearch with no Logstash change. The "service" field tells them apart.
const LOG_FILE =
  process.env.LOG_FILE ?? '../../01-elk-logs/nest-app/logs/payments-api.log';

const consoleStream = pretty({
  colorize: true,
  messageKey: 'message',
  timestampKey: '@timestamp',
  ignore: 'pid,hostname,req,res',
});
const fileStream = pino.destination({
  dest: LOG_FILE,
  mkdir: true,
  sync: false,
});

export const loggerConfig: Params = {
  assignResponse: true,
  pinoHttp: [
    {
      level: 'debug',
      messageKey: 'message',
      base: { service: 'payments-api' },
      timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label }),
      },
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res, responseTime) =>
        `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
      customErrorMessage: (req, res) =>
        `${req.method} ${req.url} ${res.statusCode}`,
    },
    pino.multistream([{ stream: consoleStream }, { stream: fileStream }]),
  ],
};
