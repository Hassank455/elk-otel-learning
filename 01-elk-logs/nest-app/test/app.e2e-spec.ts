import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('OrdersController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('POST /orders creates an order', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .send({ userId: 1, product: 'book', amount: 20 })
      .expect(201);
    expect(res.body.id).toBe(1);
  });

  it('GET /orders/:id returns 404 for an unknown order', () => {
    return request(app.getHttpServer()).get('/orders/999').expect(404);
  });

  it('DELETE /orders/:id cancels an order, then returns 404', async () => {
    const server = app.getHttpServer();
    const { body } = await request(server)
      .post('/orders')
      .send({ userId: 1, product: 'book', amount: 20 })
      .expect(201);
    await request(server).delete(`/orders/${body.id}`).expect(200);
    await request(server).delete(`/orders/${body.id}`).expect(404);
  });

  afterEach(async () => {
    await app.close();
  });
});
