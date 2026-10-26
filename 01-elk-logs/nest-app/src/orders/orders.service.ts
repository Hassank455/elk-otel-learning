import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

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
    const orderId = this.nextId++;
    const currency = dto.currency ?? 'USD';

    // assign() adds these fields to EVERY log written during this request
    // (exercise 3: now the payment logs and the HTTP request log carry the product too,
    // because assignResponse is true in logger.config.ts)
    this.logger.assign({ orderId, userId: dto.userId, product: dto.product });

    // Structured log: first argument = fields (searchable in Kibana), second = message
    this.logger.info('order created');

    const paid = await this.processPayment(dto.amount, currency);
    const order: Order = {
      id: orderId,
      ...dto,
      currency,
      status: paid ? 'paid' : 'payment_failed',
    };
    this.orders.push(order);
    return order;
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
    const durationMs = Math.round(100 + Math.random() * 1500);
    await new Promise((resolve) => setTimeout(resolve, durationMs));

    if (Math.random() < 0.3) {
      this.logger.error(
        { amount, currency, durationMs },
        'payment failed: card declined',
      );
      return false;
    }
    this.logger.info({ amount, currency, durationMs }, 'payment succeeded');
    return true;
  }
}
