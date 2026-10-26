# nest-app (orders-api)

A small NestJS app that writes **structured JSON logs** with [pino](https://getpino.io).

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

Logs go to the terminal and to `logs/app.log` (read by Logstash, lesson 4).

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `LOG_FILE` | `./logs/app.log` | JSON log file |
| `LOG_TO_ELASTICSEARCH` | `false` | `true` = also ship logs directly to Elasticsearch (lesson 3) |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Used when `LOG_TO_ELASTICSEARCH=true` |
