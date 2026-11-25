# Stage 2, Lesson 3: Correlating logs and traces with `trace_id`

## The problem

We now have two kinds of data in Elasticsearch:

- **Logs** (Stage 1): *what happened*, as text plus fields. `"payment failed: card declined"`
- **Traces** (lessons 1–2): *where the time went*, as a tree of spans. `payment.process took 1342ms, status ERROR`

On their own, each one tells half the story. A real debugging session looks like this:

> A customer says "my order failed at 14:03".
> 1. You open the **trace** of that request and see `payment.process` is red.
> 2. You want to read **every log line** written during that exact request: the order details, the payment amount, the error message.

Searching logs by time ("around 14:03") gives you hundreds of lines from other requests. What we need is **one shared id** on both the trace and its logs. That id is the `trace_id`.

```
            trace_id = 3b7c04e7b1cb67825ff66baa14059bf4
                 │
     ┌───────────┴─────────────┐
     ▼                         ▼
  TRACE (APM)                LOGS (nest-app-logs-*)
  POST /orders               "order created"          span_id fb12...
  └ orders.create            "payment failed: ..."    span_id e505...
    ├ payment.process  ❌     "POST /orders 500 ..."   span_id 0359...
    └ orders.save
```

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Correlation** | Linking different signals (logs, traces, metrics) that belong to the same request, using a shared id | A log line and a span with the same `trace_id` |
| **`trace_id`** | 32 hex characters (16 bytes). The same for **every** span and log in one request | `3b7c04e7b1cb67825ff66baa14059bf4` |
| **`span_id`** | 16 hex characters (8 bytes). Which span was active when the log was written | `e50529b703682c47` = `payment.process` |
| **`trace_flags`** | Extra bits. `01` means "sampled": this trace is being recorded and exported | `"trace_flags": "01"` |
| **Context** | The "current trace and span" for the code that is running now | Inside `processPayment()` the context holds the `payment.process` span |
| **Context propagation (in-process)** | Carrying the context through `await`, callbacks and timers, so code deep in the call stack still knows the active span. Node does this with `AsyncLocalStorage` | `logger.info()` in the service knows the trace even though we never passed it in |
| **Log correlation / log injection** | The OTel pino instrumentation reads the active context and adds `trace_id`, `span_id`, `trace_flags` to **every** log line | We changed zero logging code for this |
| **ECS** (Elastic Common Schema) | Elastic's standard field names. Kibana's built-in features look for these names | `trace.id`, `span.id`, `service.name`, `log.level` |
| **Log sources** | A Kibana setting that tells Observability/APM which indices contain logs | `nest-app-logs-*` |
| **`x-trace-id` header** | We return the trace id in the HTTP response, so a client or support ticket can include it | `x-trace-id: 3b7c04e7...` |

## Part 1: The ids are already in our logs

Remember lesson 1? In `instrumentation.ts` we enabled the pino instrumentation with `disableLogSending: true`. That turned off *sending* logs over OTLP, but kept **log injection** on. So every log line already looks like this (from `logs/app.log`):

```json
{
  "level": "error",
  "@timestamp": "2026-11-21T20:15:23.762Z",
  "service": "orders-api",
  "orderId": 1,
  "trace_id": "3b7c04e7b1cb67825ff66baa14059bf4",
  "span_id": "e50529b703682c47",
  "trace_flags": "01",
  "context": "OrdersService",
  "message": "payment failed: card declined"
}
```

**How does pino know the trace id?** No one passes it as a parameter. When `tracer.startActiveSpan('payment.process', ...)` runs, OTel puts the span into the **context** (backed by `AsyncLocalStorage`). Every function called inside the callback, even after an `await`, sees the same context. The pino instrumentation hooks into pino's `mixin` and asks `trace.getActiveSpan()` before writing each line.

Notice the three log lines of one request have the **same** `trace_id` but **different** `span_id`s:

| Log message | `span_id` belongs to |
|---|---|
| `order created` | `orders.create` |
| `payment succeeded` / `payment failed` | `payment.process` |
| `POST /orders 201 1239ms` | the HTTP server span (the root) |

So you can tell not only *which request* wrote a log, but *which step* inside it.

## Part 2: Rename the fields to ECS names (Logstash)

Our logs say `trace_id`. Kibana APM looks for **`trace.id`** (ECS). So we rename the fields in the Logstash pipeline.

**File:** `01-elk-logs/logstash/pipeline/nest-app.conf`

```ruby
filter {
  # ...slow / alert tags from Stage 1...

  # Stage 2, lesson 3: rename the OTel ids to their ECS names (trace.id, span.id)
  # so Kibana APM can find the logs that belong to a trace
  if [trace_id] {
    mutate {
      rename => {
        "trace_id" => "[trace][id]"
        "span_id" => "[span][id]"
      }
    }
  }

  # ...shipper / environment fields...
}
```

| Piece | Meaning |
|---|---|
| `if [trace_id]` | Only touch events that have the field (logs written without OTel don't) |
| `rename` | Move a field to a new name. The value is unchanged |
| `"[trace][id]"` | Logstash syntax for a **nested** field: `{ "trace": { "id": "..." } }`. In Kibana it shows as `trace.id` |

> **Why not rename `service` to `service.name` too?** In our `nest-app-logs-logstash` index, `service` already exists as a **text** field. Turning it into an object (`service.name`) would be a **mapping conflict**, and Elasticsearch would reject those documents. Changing a field's type needs a new index (we'll see this with index templates in Stage 4). APM matches logs by `trace.id`, which is enough for now.

## Part 3: Return the trace id to the client

**File:** `01-elk-logs/nest-app/src/main.ts`

```ts
import { trace } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

// ...inside bootstrap(), after app.useLogger(...)
app.use((_req: Request, res: Response, next: NextFunction) => {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  if (traceId) res.setHeader('x-trace-id', traceId);
  next();
});
```

| Piece | Meaning |
|---|---|
| `app.use(...)` | An Express middleware that runs for every request |
| `trace.getActiveSpan()` | The span in the current context. By the time middleware runs, the HTTP instrumentation has already started the request's root span |
| `.spanContext().traceId` | The 32-character trace id |
| `if (traceId)` | Started without OTel (`npm run start:dev`)? Then there is no span and no header |

Try it:

```bash
curl -i -X POST http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"product":"laptop","amount":900,"userId":"u1"}'
```

```
HTTP/1.1 201 Created
x-trace-id: 3b7c04e7b1cb67825ff66baa14059bf4
...
```

This is how real APIs do it: the error page or the support ticket shows the id, and the developer pastes it into Kibana.

## Part 4: Run it

```bash
git pull

# 1. Start everything (Elasticsearch, Kibana, Logstash, APM Server, Collector)
cd 02-opentelemetry
docker compose up -d

# 2. Logstash only reads its pipeline at startup, so restart it to load the change
docker compose restart logstash

# 3. Start the app with OpenTelemetry
cd ../01-elk-logs/nest-app
npm run start:dev:otel

# 4. In another terminal: make some traffic (some payments will fail)
./scripts/generate-traffic.sh 20
```

## Part 5: Log → trace (start from a log line)

1. Kibana → **Discover** → data view `nest-app-logs-*`.
2. Search for failures:
   ```
   message: "payment failed*"
   ```
3. Open one document and copy the value of **`trace.id`**.
4. Kibana → **Observability → APM → Services → orders-api → Transactions → POST /orders**.
5. In the search bar at the top, filter by the trace id:
   ```
   trace.id : "3b7c04e7b1cb67825ff66baa14059bf4"
   ```
   You'll see the waterfall of exactly that request, with `payment.process` in red.

Tip: you can also open a trace directly by URL (works in recent Kibana versions):

```
http://localhost:5601/app/apm/link-to/trace/<trace id>
```

## Part 6: Trace → logs (start from a trace)

This is the direction you'll use most: you see a slow or red trace and want its logs.

### 6a. Tell Kibana where our logs are (once)

By default, Kibana Observability looks for logs in `logs-*-*,logs-*,filebeat-*`. Our indices are called `nest-app-logs*`, so it can't find them.

1. Kibana → **Stack Management → Advanced Settings**.
2. Search for **Log sources** (`observability:logSources`).
3. Add `nest-app-logs-*` to the list, then **Save changes**.

### 6b. Open a trace and look at its logs

1. **APM → Services → orders-api → Transactions → POST /orders**.
2. Scroll to **Trace sample** and pick a sample (ideally a failed one: use the "failed" filter or the red markers).
3. Above the waterfall, open the **Logs** tab. Kibana searches the log sources for `trace.id : "<this trace's id>"` and shows every log line of the request.

> Not seeing logs in the tab? Check: (1) the logs in Discover have a `trace.id` field (not `trace_id`), so Logstash was restarted after `git pull`; (2) the logs are newer than the restart (old lines were indexed before the rename); (3) `nest-app-logs-*` is in Log sources.

### 6c. Manual way (always works)

Copy the trace id from the trace (or from the `x-trace-id` header) and search Discover:

```
trace.id : "3b7c04e7b1cb67825ff66baa14059bf4"
```

Add the columns `message`, `span.id`, `level`. You now have the full story of one request, in order.

## Part 7: What about the `nest-app-logs` index?

We have two log indices:

| Index | Shipped by | Field name |
|---|---|---|
| `nest-app-logs-logstash` | Logstash (reads `logs/app.log`) | `trace.id` (renamed) ✅ |
| `nest-app-logs` | `pino-elasticsearch` (only with `LOG_TO_ELASTICSEARCH=true`) | `trace_id` (not renamed) |

The direct index skips Logstash, so nothing renames the field. That's another reason the Logstash path (or an OTel Collector, in Stage 3) is the better design: one place to fix up data, instead of changing every app.

## Summary

| Before | After |
|---|---|
| Logs and traces were separate; matching them meant guessing by time | One `trace_id` on the trace and on every log line of the request |
| Field called `trace_id` | ECS field `trace.id`, which Kibana APM understands |
| A user's bug report had only a timestamp | The response has `x-trace-id`, the exact key to the trace and its logs |

## Exercises

1. **Follow one failure end to end.** Make traffic until a payment fails. Start in Discover with `level: "error"`, copy `trace.id`, and find the same request in APM. Which span is red? How long did it take?
2. **Read `span.id`.** For one trace, list its log lines in Discover with the `span.id` column. Match each `span.id` to a span in the APM waterfall (click a span to see its id). Which log belongs to `payment.process`?
3. **Use the header.** Send a request with `curl -i`, copy `x-trace-id`, and find both the trace and the logs using only that value.
4. **Add a log inside `orders.save`.** Add `this.logger.info({ orderId: order.id }, 'saving order')` inside the `orders.save` span. Restart, send a request, and check: does the new log have the `span.id` of `orders.save`?
5. **(Thinking)** Why does the `x-trace-id` header **not** appear when you run `npm run start:dev` (without OTel)? What would you change if you wanted a request id even without OTel?
