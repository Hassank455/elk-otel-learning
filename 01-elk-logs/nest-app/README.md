# nest-app (orders-api)

A small NestJS app that writes **structured JSON logs** with [pino](https://getpino.io) and ships them to Elasticsearch.

See the lesson: [../docs/03-nestjs-structured-logs.md](../docs/03-nestjs-structured-logs.md)

```bash
npm install
npm run start:dev                 # app on http://localhost:3000
./scripts/generate-traffic.sh 20  # send 20 random orders
```

| Endpoint | Description |
|---|---|
| `POST /orders` | Create an order `{ "userId": 7, "product": "book", "amount": 20 }`. Payment fails ~30% of the time |
| `GET /orders/:id` | Get an order, or 404 |

Environment variables: `PORT` (default `3000`), `ELASTICSEARCH_URL` (default `http://localhost:9200`).
