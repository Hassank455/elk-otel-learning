import { Injectable } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

const tracer = trace.getTracer('payments-api');

export interface AuthorizePaymentDto {
  orderId: number;
  amount: number;
  currency?: string;
}

export interface PaymentResult {
  paymentId: string;
  orderId: number;
  status: 'authorized' | 'declined';
  reason?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class PaymentsService {
  private nextId = 1;

  constructor(
    @InjectPinoLogger(PaymentsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async authorize(dto: AuthorizePaymentDto): Promise<PaymentResult> {
    // This span's PARENT is the HTTP server span, whose parent is the
    // client span in orders-api: one trace across two services.
    return tracer.startActiveSpan(
      'payment.authorize',
      async (span): Promise<PaymentResult> => {
        try {
          const paymentId = `pay_${this.nextId++}`;
          const currency = dto.currency ?? 'USD';
          span.setAttributes({
            'payment.id': paymentId,
            'payment.amount': dto.amount,
            'payment.currency': currency,
            'order.id': dto.orderId,
          });
          this.logger.assign({ orderId: dto.orderId, paymentId });

          await this.fraudCheck(dto.amount);

          // the "bank": 100-1500ms, declines ~30% of the time
          const durationMs = Math.round(100 + Math.random() * 1400);
          await sleep(durationMs);

          if (Math.random() < 0.3) {
            span.recordException(new Error('card declined'));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'card declined',
            });
            this.logger.error(
              { amount: dto.amount, currency, durationMs },
              'payment declined by bank',
            );
            return {
              paymentId,
              orderId: dto.orderId,
              status: 'declined',
              reason: 'card declined',
            };
          }

          span.addEvent('payment.authorized');
          this.logger.info(
            { amount: dto.amount, currency, durationMs },
            'payment authorized',
          );
          return { paymentId, orderId: dto.orderId, status: 'authorized' };
        } finally {
          span.end();
        }
      },
    );
  }

  // A small child span, so the payments side of the trace has some depth
  private async fraudCheck(amount: number): Promise<void> {
    return tracer.startActiveSpan('fraud.check', async (span) => {
      try {
        span.setAttribute('payment.amount', amount);
        await sleep(10 + Math.random() * 40);
        span.setAttribute('fraud.score', Math.round(Math.random() * 100) / 100);
      } finally {
        span.end();
      }
    });
  }
}
