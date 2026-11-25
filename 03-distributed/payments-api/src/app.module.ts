import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from './logger.config.js';
import { PaymentsModule } from './payments/payments.module.js';

@Module({
  imports: [LoggerModule.forRoot(loggerConfig), PaymentsModule],
})
export class AppModule {}
