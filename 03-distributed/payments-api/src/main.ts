import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // orders-api runs on 3000, so payments-api uses 3001
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
