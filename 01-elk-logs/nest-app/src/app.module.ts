import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from './logger.config.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [LoggerModule.forRoot(loggerConfig), OrdersModule],
})
export class AppModule {}
