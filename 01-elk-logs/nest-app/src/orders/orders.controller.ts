import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import type { CreateOrderDto } from './orders.service.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    const order = this.ordersService.findOne(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    if (!this.ordersService.remove(id)) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return { id, status: 'cancelled' };
  }
}
