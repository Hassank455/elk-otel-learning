import { Injectable } from '@nestjs/common';
import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

// A tracer creates spans. The name says which part of the code they come from.
const tracer = trace.getTracer('orders-api');

// Stage 3: where payments-api runs, e.g. http://localhost:3001 (unset = fake gateway)
const PAYMENTS_API_URL = process.env.PAYMENTS_API_URL;

// A meter creates metric instruments (counters, histograms, gauges).
// Stage 2, lesson 4.
const meter = metrics.getMeter('orders-api');

// Counter: a number that only goes up. "How many orders were created?"
const ordersCreated = meter.createCounter('orders.created', {
  description: 'Number of orders created',
  unit: '{order}',
});

// Histogram: records many values so we can ask for avg, p95, max...
// "How long does a payment take?"
const paymentDuration = meter.createHistogram('payment.duration', {
  description: 'How long the payment gateway took',
  unit: 'ms',
  advice: {
    // bucket edges in ms: <=100, <=250, <=500, ... (our fake payments take 100-1600ms)
    explicitBucketBoundaries: [100, 250, 500, 750, 1000, 1500, 2000],
  },
});

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
  ) {
    // Observable gauge: a value we READ when metrics are collected (every 10s),
    // instead of recording it ourselves. "How many orders are stored right now?"
    meter
      .createObservableGauge('orders.stored', {
        description: 'Orders currently kept in memory',
        unit: '{order}',
      })
      .addCallback((result) => result.observe(this.orders.length));
  }

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

        const paid = await this.processPayment(orderId, dto.amount, currency);
        const order: Order = {
          id: orderId,
          ...dto,
          currency,
          status: paid ? 'paid' : 'payment_failed',
        };
        await this.save(order);

        span.setAttribute('order.status', order.status);

        // +1 order, split by status and product (attributes = dimensions)
        ordersCreated.add(1, {
          'order.status': order.status,
          'order.product': dto.product,
        });
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

  // Stage 3: if PAYMENTS_API_URL is set, payments are done by a separate service
  // (payments-api). Otherwise we use the fake in-process gateway from Stage 2.
  private async processPayment(
    orderId: number,
    amount: number,
    currency: string,
  ): Promise<boolean> {
    return tracer.startActiveSpan('payment.process', async (span) => {
      const started = performance.now();
      try {
        span.setAttributes({
          'payment.amount': amount,
          'payment.currency': currency,
        });

        const declined = PAYMENTS_API_URL
          ? await this.callPaymentsApi(orderId, amount, currency)
          : await this.fakeGateway();
        const durationMs = Math.round(performance.now() - started);

        // one value per payment, tagged with the outcome
        paymentDuration.record(durationMs, {
          'payment.outcome': declined ? 'declined' : 'success',
        });

        if (declined) {
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

  // Stage 2: random duration, declines ~30% of the time. Returns true if declined.
  private async fakeGateway(): Promise<boolean> {
    await new Promise((resolve) =>
      setTimeout(resolve, 100 + Math.random() * 1500),
    );
    return Math.random() < 0.3;
  }

  // Stage 3: a real HTTP call to payments-api. Returns true if declined.
  // We do NOTHING special for tracing here: the undici (fetch) instrumentation
  // creates a client span and adds the "traceparent" header for us.
  private async callPaymentsApi(
    orderId: number,
    amount: number,
    currency: string,
  ): Promise<boolean> {
    const res = await fetch(`${PAYMENTS_API_URL}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, amount, currency }),
    });
    if (res.status === 402) return true; // Payment Required = declined
    if (!res.ok) throw new Error(`payments-api returned ${res.status}`);
    return false;
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
