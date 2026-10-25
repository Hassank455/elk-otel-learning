import { Injectable } from '@nestjs/common';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

export interface CreateOrderDto {
  userId: number;
  product: string;
  amount: number;
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

    // Structured log: first argument = fields (searchable in Kibana), second = message
    this.logger.info({ orderId, userId: dto.userId, product: dto.product }, 'order created');

    const paid = await this.processPayment(orderId, dto.amount);
    const order: Order = { id: orderId, ...dto, status: paid ? 'paid' : 'payment_failed' };
    this.orders.push(order);
    return order;
  }

  findOne(id: number): Order | undefined {
    const order = this.orders.find((o) => o.id === id);
    if (!order) this.logger.warn({ orderId: id }, 'order not found');
    return order;
  }

  // Fake payment gateway: random duration, fails ~30% of the time
  private async processPayment(orderId: number, amount: number): Promise<boolean> {
    const durationMs = Math.round(100 + Math.random() * 1500);
    await new Promise((resolve) => setTimeout(resolve, durationMs));

    if (Math.random() < 0.3) {
      this.logger.error({ orderId, amount, durationMs }, 'payment failed: card declined');
      return false;
    }
    this.logger.info({ orderId, amount, durationMs }, 'payment succeeded');
    return true;
  }
}
