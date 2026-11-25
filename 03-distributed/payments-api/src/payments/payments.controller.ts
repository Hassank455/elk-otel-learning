import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthorizePaymentDto } from './payments.service.js';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @InjectPinoLogger(PaymentsController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Post()
  async authorize(
    @Body() dto: AuthorizePaymentDto,
    // Only for learning: show the header that carries the trace from orders-api
    @Headers('traceparent') traceparent?: string,
  ) {
    this.logger.info({ traceparent }, 'incoming traceparent header');

    const result = await this.paymentsService.authorize(dto);
    if (result.status === 'declined') {
      // 402 Payment Required: orders-api reads this as "card declined"
      throw new HttpException(result, HttpStatus.PAYMENT_REQUIRED);
    }
    return result;
  }
}
