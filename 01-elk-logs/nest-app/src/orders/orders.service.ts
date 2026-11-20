import { Injectable } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

// A tracer creates spans. The name says which part of the code they come from.
const tracer = trace.getTracer('orders-api');

export interface CreateOrderDto {
  userId: number;
  product: string;
  amount: number;
  currency?: string;
}

export interface Order extends CreateOrderDto {
  id: number;
  status: 'paid' | 'payment_failed';
}

@Injectable()
export class OrdersService {
  private orders: Order[] = [];
  private nextId = 1;

  constructor(
    @InjectPinoLogger(OrdersService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    // Manual span: wraps the whole "create order" business logic.
    // startActiveSpan makes it the ACTIVE span, so spans started inside it become its children.
    return tracer.startActiveSpan('orders.create', async (span) => {
      try {
        const orderId = this.nextId++;
        const currency = dto.currency ?? 'USD';

        // Attributes: searchable details on the span (like fields on a log)
        span.setAttributes({
          'order.id': orderId,
          'order.product': dto.product,
          'user.id': dto.userId,
        });

        // assign() adds these fields to EVERY log written during this request
        // (exercise 3: now the payment logs and the HTTP request log carry the product too,
        // because assignResponse is true in logger.config.ts)
        this.logger.assign({
          orderId,
          userId: dto.userId,
          product: dto.product,
        });

        // Structured log: first argument = fields (searchable in Kibana), second = message
        this.logger.info('order created');

        const paid = await this.processPayment(dto.amount, currency);
        const order: Order = {
          id: orderId,
          ...dto,
          currency,
          status: paid ? 'paid' : 'payment_failed',
        };
        await this.save(order);

        span.setAttribute('order.status', order.status);
        return order;
      } finally {
        span.end(); // a span is only sent when it ends: never forget this
      }
    });
  }

  findOne(id: number): Order | undefined {
    const order = this.orders.find((o) => o.id === id);
    if (!order) this.logger.warn({ orderId: id }, 'order not found');
    return order;
  }

  remove(id: number): boolean {
    const index = this.orders.findIndex((o) => o.id === id);
    if (index === -1) {
      this.logger.warn({ orderId: id }, 'order not found');
      return false;
    }
    this.orders.splice(index, 1);
    this.logger.info({ orderId: id }, 'order cancelled');
    return true;
  }

  // Fake payment gateway: random duration, fails ~30% of the time
  private async processPayment(
    amount: number,
    currency: string,
  ): Promise<boolean> {
    return tracer.startActiveSpan('payment.process', async (span) => {
      try {
        span.setAttributes({
          'payment.amount': amount,
          'payment.currency': currency,
        });

        const durationMs = Math.round(100 + Math.random() * 1500);
        await new Promise((resolve) => setTimeout(resolve, durationMs));

        if (Math.random() < 0.3) {
          // Status ERROR marks the span as failed; an exception records what went wrong
          span.recordException(new Error('card declined'));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: 'card declined',
          });
          this.logger.error(
            { amount, currency, durationMs },
            'payment failed: card declined',
          );
          return false;
        }

        // Event: a point in time inside the span ("this happened at 412ms")
        span.addEvent('payment.authorized');
        this.logger.info({ amount, currency, durationMs }, 'payment succeeded');
        return true;
      } finally {
        span.end();
      }
    });
  }

  // Fake database write: 20-80ms
  private async save(order: Order): Promise<void> {
    return tracer.startActiveSpan('orders.save', async (span) => {
      try {
        span.setAttribute('db.operation.name', 'insert');
        await new Promise((resolve) =>
          setTimeout(resolve, 20 + Math.random() * 60),
        );
        this.orders.push(order);
      } finally {
        span.end();
      }
    });
  }
}
