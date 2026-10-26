# Lesson 3: A NestJS app sending structured logs

## Before we start: why did every log appear twice?

In lesson 2 you ran the same `_bulk` request twice, and Discover showed every log two times.

| Term | Meaning | Example |
|---|---|---|
| **`_id`** | Every document has a unique id. If you don't give one, Elasticsearch generates a random one | `POST app-logs/_doc` → `"_id": "aB3x..."` |
| **Idempotent** | Running the same operation twice gives the same result as running it once | `PUT app-logs/_doc/my-fixed-id` twice = still one document |

`POST` without an `_id` is **not** idempotent: each call creates a new document. For logs this is usually fine (each log line is a new event), but it is why retries or re-sending can create duplicates.

Try it in Dev Tools:

```
PUT app-logs/_doc/my-fixed-id
{"@timestamp":"2026-10-25T21:00:00Z","level":"info","service":"demo","message":"only once"}
```

Run it twice. The response says `"result": "created"` the first time and `"result": "updated"` the second time, and there is still only one document.

Clean up the duplicates by deleting the index (the app will use a new index anyway):

```
DELETE app-logs
```

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Unstructured log** | A plain text line. Easy for humans to read, hard to search or filter | `Payment failed for order 104 after 5000ms` |
| **Structured log** | A log line as JSON, where every piece of information is its own field | `{"message":"payment failed","orderId":104,"durationMs":5000}` |
| **Logger** | The library that formats and writes logs | NestJS's built-in `Logger`, or **pino** |
| **pino** | A very fast JSON logger for Node.js | `logger.info({ orderId: 1 }, 'order created')` |
| **nestjs-pino** | Connects pino to NestJS, and logs every HTTP request automatically (via `pino-http`) | `GET /orders/1 200 3ms` |
| **Log level** | How important a log is: `debug` < `info` < `warn` < `error` | 404 → `warn`, 500 → `error` |
| **Stream** | Where the logs go. We send them to two places | Terminal (pretty) + Elasticsearch (JSON) |
| **Context** | The class that wrote the log | `"context": "OrdersService"` |

**Why structured logs?** Compare searching for slow payments:

- Unstructured: you need a regex over text like `after (\d+)ms`, and hope every developer wrote the same sentence.
- Structured: `durationMs > 1000` in Kibana. That's it.

This is exactly what you did in lesson 2 with hand-written logs. Now the app produces them by itself.

**How the logs reach Elasticsearch in this lesson:**

```
NestJS (pino) ──┬──> terminal (pino-pretty, human readable)
                └──> pino-elasticsearch ──(Bulk API, every 2s)──> Elasticsearch index "nest-app-logs" ──> Kibana
```

The app talks to Elasticsearch directly. In lesson 4 we'll put **Logstash** in the middle and see why that's useful.

## Code

The app lives in [`01-elk-logs/nest-app`](../nest-app). It was created with `nest new nest-app` and then changed. The important files:

### `src/logger.config.ts`: the logger setup

```ts
pinoHttp: [
  {
    messageKey: 'message',                       // pino writes "msg" by default
    base: { service: 'orders-api' },             // added to every log line
    timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
    formatters: { level: (label) => ({ level: label }) },  // 30 -> "info"
    customLogLevel: ...,                         // 4xx -> warn, 5xx -> error
  },
  pino.multistream([{ stream: consoleStream }, { stream: elasticStream }]),
]
```

Why each option:

- `@timestamp`: the name Kibana expects for the time field (same as our hand-written logs).
- `level` as text: pino uses numbers (`30` = info, `50` = error). Text is easier to search: `level: "error"`.
- `service`: when many apps send logs to the same Elasticsearch, this is how you tell them apart.

### `src/orders/orders.service.ts`: writing structured logs

```ts
this.logger.info({ orderId, userId: dto.userId, product: dto.product }, 'order created');
this.logger.error({ orderId, amount, durationMs }, 'payment failed: card declined');
```

The **first argument is an object of fields**, the **second is the message**. Never build values into the message string (`'order ' + id + ' created'`), because then you can't filter on them.

### `src/main.ts`: use pino as the NestJS logger

```ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
```

## Run it

### 1. Make sure Elasticsearch and Kibana are running

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning
git pull
cd 01-elk-logs
docker compose up -d
```

### 2. Install and start the app

```bash
cd nest-app
npm install
LOG_TO_ELASTICSEARCH=true npm run start:dev
```

> **Note:** since lesson 4, the app ships logs through Logstash by default. `LOG_TO_ELASTICSEARCH=true` turns on the direct shipping used in this lesson.

You'll see colored logs in the terminal, ending with `Nest application successfully started`.

### 3. Send some requests (in a second terminal)

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/01-elk-logs/nest-app

curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"userId":7,"product":"book","amount":20}'

curl http://localhost:3000/orders/1
curl http://localhost:3000/orders/999     # 404 -> warn log

./scripts/generate-traffic.sh 20          # 20 random orders
```

### 4. Check the index exists

```bash
curl "http://localhost:9200/nest-app-logs/_count?pretty"
```

### 5. Explore in Kibana

1. Create a new data view: name `nest-app-logs`, index pattern `nest-app-logs*`, timestamp field `@timestamp`.
2. Open **Discover**, pick `nest-app-logs`, time range **Last 15 minutes**.
3. Add the columns `level`, `context`, `message`, `orderId`, `durationMs`.

Try:

```
level: "error"
context: "OrdersService"
durationMs > 1000
res.statusCode >= 400
orderId: 3
```

`orderId: 3` shows the full story of one order: `order created` → `payment ...`.

## Exercise

1. Add a new endpoint `DELETE /orders/:id` that logs `order cancelled` with `orderId` (info), or `order not found` (warn) if it doesn't exist.
2. Add a `currency` field to the payment logs.
3. In Kibana, find all failed payments for `product: "laptop"`. Hint: the product is only on the `order created` log. How could you change the code so the payment logs have it too?
4. Stop Elasticsearch (`docker compose stop elasticsearch`) and send a request. What happens to the app? What happens to the logs? Start it again (`docker compose start elasticsearch`). Keep your answer in mind for lesson 4.
