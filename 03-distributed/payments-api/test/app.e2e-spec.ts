import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('PaymentsController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('POST /payments authorizes (201) or declines (402)', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments')
      .send({ orderId: 1, amount: 50 });
    expect([201, 402]).toContain(res.status);
    expect(res.body.orderId).toBe(1);
    expect(['authorized', 'declined']).toContain(res.body.status);
  });

  afterEach(async () => {
    await app.close();
  });
});
