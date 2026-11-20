# Stage 2, Lesson 2: Manual spans, attributes, events and status

## Why manual spans?

In lesson 1, auto-instrumentation gave us this:

```
POST /orders                     ████████████████████████  1422ms
└── request handler - /orders     ███████████████████████   1408ms
```

We know the request took 1.4 seconds, but **not why**. Auto-instrumentation only sees libraries (HTTP, Express, databases...). It doesn't know our business steps: "create order", "process payment", "save order". For those we create spans **ourselves**.

After this lesson:

```
POST /orders                         ████████████████████████  1422ms
└── request handler - /orders         ███████████████████████   1408ms
    └── orders.create                  ██████████████████████    1401ms
        ├── payment.process            ████████████████████      1342ms   <- here's the time!
        └── orders.save                                    █        56ms
```

Now it's obvious: 95% of the time is the payment.

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Tracer** | The object that creates spans. Its name says which code they come from | `trace.getTracer('orders-api')` |
| **Manual span** | A span you create in your own code | `tracer.startActiveSpan('payment.process', ...)` |
| **Active span / context** | The span that is "current" right now. New spans become its children automatically | `payment.process` is created while `orders.create` is active, so it's a child |
| **Attributes** | Key/value details on a span, searchable in Kibana | `order.product: "laptop"`, `payment.amount: 900` |
| **Semantic conventions** | Standard attribute names that every tool understands | `http.response.status_code`, `db.operation.name` |
| **Event** | Something that happened at one **point in time** inside a span | `payment.authorized` at 412ms |
| **Status** | Did the span succeed? `UNSET` (default), `OK` or `ERROR` | Card declined → `ERROR` |
| **Exception** | A special event that records an error (type, message, stack) | `recordException(new Error('card declined'))` |
| **`span.end()`** | Marks the end of the span. **A span is only exported when it ends** | Forgetting it = the span never shows up |

### Attributes vs log fields vs events

- **Log field**: a detail on a *log line* (`durationMs` in the payment log).
- **Span attribute**: a detail on a *span* that's true for its whole duration (`payment.amount`).
- **Span event**: a *moment* inside a span (`payment.authorized`).

### Naming

- Span names: **low cardinality**, a fixed name per operation: `payment.process`, never `payment for order 104`.
- Values that change (order id, amount) go in **attributes**, never in the name. Same rule as with logs (lesson 3, Stage 1): never put values in the message.
- Custom attributes get a **namespace**: `order.*`, `payment.*`, so they don't collide with standard ones.

## Code

All the changes are in [`orders.service.ts`](../../01-elk-logs/nest-app/src/orders/orders.service.ts).

### 1. Get a tracer

```ts
import { SpanStatusCode, trace } from '@opentelemetry/api';

const tracer = trace.getTracer('orders-api');
```

`@opentelemetry/api` is the **API** package: just interfaces. If the SDK isn't started (for example, `npm run start:dev` without OTel, or in tests), every call does nothing, so the code is safe to keep everywhere.

### 2. Wrap a business step in a span

```ts
async create(dto: CreateOrderDto): Promise<Order> {
  return tracer.startActiveSpan('orders.create', async (span) => {
    try {
      span.setAttributes({ 'order.id': orderId, 'order.product': dto.product, 'user.id': dto.userId });
      // ... the existing code ...
      const paid = await this.processPayment(dto.amount, currency);  // child span
      await this.save(order);                                         // child span
      span.setAttribute('order.status', order.status);
      return order;
    } finally {
      span.end();
    }
  });
}
```

- **`startActiveSpan`** starts the span **and** makes it active inside the callback. That's why `payment.process` and `orders.save` become its children without passing anything around.
- **`try/finally`**: `span.end()` runs even if the code throws.

### 3. Mark failures: status + exception

```ts
if (Math.random() < 0.3) {
  span.recordException(new Error('card declined'));
  span.setStatus({ code: SpanStatusCode.ERROR, message: 'card declined' });
  ...
  return false;
}
span.addEvent('payment.authorized');
```

### 4. A sibling span: `orders.save`

A fake database write (20 to 80ms) so the trace has two children side by side: `payment.process` and `orders.save`.

## Run it

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning && git pull
cd 02-opentelemetry && docker compose up -d
cd ../01-elk-logs/nest-app && npm run start:dev:otel
# second terminal:
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/01-elk-logs/nest-app
./scripts/generate-traffic.sh 20
```

### In Kibana (APM)

1. ☰ > **Observability** > **Applications** > **orders-api** > **Transactions** > **POST /orders**
2. In **Trace sample**, look at the waterfall: `orders.create` with `payment.process` and `orders.save` under it.
3. Click **`payment.process`**: in the span details you'll find the attributes (`payment.amount`, `payment.currency`). Elastic shows OTel attributes as **labels** or under **attributes**.
4. Use the trace sample arrows to find a trace where `payment.process` is marked as **failed** (red). Open it and look at the exception `card declined`.
5. Open the **Errors** tab of the service: the recorded exceptions show up there, grouped by message.

Notice: the `POST /orders` transaction is still **successful** even when the payment fails, because it returns 201. Same lesson as the pie chart in Stage 1: the HTTP status alone doesn't tell the whole story.

## Exercise

1. Add a span **`fraud.check`** inside `payment.process`, before the payment, that waits 10 to 50ms. Check the waterfall: it should be a **grandchild** of `orders.create`.
2. Add the attribute `payment.result` (`"authorized"` or `"declined"`) to `payment.process`.
3. Remove `span.end()` from `orders.save`, restart, send a request. What happens to that span in Kibana? Put it back.
4. Wrap `remove()` (the DELETE endpoint from Stage 1) in a span `orders.cancel` with the attribute `order.id`. When the order doesn't exist, should the status be `ERROR`? Why or why not?
