import { NestFactory } from '@nestjs/core';
import { trace } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // bufferLogs: keep startup logs until the pino logger is ready
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Stage 2, lesson 3: send the trace id back to the client.
  // If a user reports a problem, they can give us this id and we find the
  // whole trace (and all its logs) in Kibana. Without OTel there is no span,
  // so no header is added.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    if (traceId) res.setHeader('x-trace-id', traceId);
    next();
  });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
