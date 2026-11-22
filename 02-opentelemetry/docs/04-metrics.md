# Stage 2, Lesson 4: Metrics

## Why metrics, when we already have logs and traces?

| Signal | Answers | Example | Cost |
|---|---|---|---|
| **Logs** | *What happened* in one event? | `"payment failed: card declined"` | One document per event |
| **Traces** | *Where did the time go* in one request? | `payment.process` took 1342ms | One document per span |
| **Metrics** | *How is the system doing overall*, over time? | 2,140 orders in the last hour, p95 payment time 1.4s, 28% declined | **One number per time window**, no matter how much traffic |

The key difference is the last column. If your API gets 10,000 requests a second, you can't keep a log line and a trace for every one forever. A metric like "requests per second" is **one small number every 10 seconds**, whether there was 1 request or 1 million. That's why dashboards and alerts are usually built on metrics.

Typical flow in real work:

```
metric alert:  "payment p95 > 1.5s for 5 minutes"   <- something is wrong (metrics)
      ↓
open a slow trace from that time                      <- where is it slow? (traces)
      ↓
read the logs of that trace (lesson 3)                <- why? (logs)
```

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Metric** | A number measured over time | `orders.created` |
| **Meter** | The object that creates metric instruments (like a tracer creates spans) | `metrics.getMeter('orders-api')` |
| **Instrument** | One thing you measure. The type decides what you can ask about it | Counter, Histogram, Gauge |
| **Counter** | Only goes **up**. You call `add()` | Orders created, requests served, bytes sent |
| **UpDownCounter** | Goes up **and** down. You call `add(+1)` / `add(-1)` | Active connections, items in a queue |
| **Histogram** | Records many values, so you can ask for **avg, p50, p95, max**. You call `record()` | Payment duration, response size |
| **Bucket** | A histogram doesn't store every value. It counts how many values fall in each range | `<=100ms: 3`, `<=250ms: 12`, `<=500ms: 40`... |
| **Observable (async) instrument** | You don't record it; you give a **callback** that the SDK calls on every collection | `orders.stored` = `this.orders.length` |
| **Gauge** | The current value of something, not a sum | Memory used, orders stored, CPU % |
| **Attributes (dimensions)** | Key/values that split a metric into series | `orders.created{order.status="paid"}` vs `{order.status="payment_failed"}` |
| **Cardinality** | How many different attribute combinations exist. **High cardinality = expensive** | `order.status` has 2 values ✅. `user.id` could have millions ❌ |
| **Metric reader** | Collects all metrics on a schedule and passes them to the exporter | `PeriodicExportingMetricReader`, every 10s |
| **Temporality** | Does each export send the **running total** (cumulative) or **only what's new** since the last export (delta)? | Cumulative: 5, 9, 12. Delta: 5, 4, 3 |
| **Percentile (p95)** | 95% of values are at or below this number | p95 = 1400ms: only 5% of payments are slower |

## Part 1: Tell the SDK to export metrics

**File:** `01-elk-logs/nest-app/src/instrumentation.ts`

In lesson 1 we turned metrics **off** (`OTEL_METRICS_EXPORTER = 'none'`). Now we remove that line and add a metric reader:

```ts
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { AggregationTemporality, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const otlpBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

const sdk = new NodeSDK({
  // ...resource, traceExporter as before...
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? `${otlpBase}/v1/metrics`,
        temporalityPreference: AggregationTemporality.DELTA,
      }),
      exportIntervalMillis: 10_000,
    }),
  ],
  // ...instrumentations as before...
});
```

| Piece | Meaning |
|---|---|
| `PeriodicExportingMetricReader` | Every `exportIntervalMillis` (10s here; the default is 60s) it reads all instruments and exports them |
| `OTLPMetricExporter` | Sends them over OTLP to the Collector, at `/v1/metrics` (traces use `/v1/traces` on the same port) |
| `AggregationTemporality.DELTA` | Send "what happened in the last 10s". Elastic recommends delta for OTel metrics, and it makes "sum per minute" charts simple |

New packages (already in `package.json`, `npm install` adds them):

```bash
npm install @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-proto
```

### Free metrics from auto-instrumentation

Just by turning metrics on, the auto-instrumentations start sending some for us, without any code:

| Metric | From | Meaning |
|---|---|---|
| `http.server.request.duration` | HTTP instrumentation | Histogram of every request's duration, with `http.request.method`, `http.route`, `http.response.status_code` |
| `nodejs.eventloop.delay.*` | runtime-node instrumentation | How long the event loop is blocked (high = the app is busy or something is blocking it) |
| `nodejs.eventloop.utilization` | runtime-node instrumentation | 0 to 1, how busy the event loop is |

## Part 2: Our own business metrics

Auto metrics know about HTTP. They don't know about **orders** or **payments**. Like manual spans, we add those ourselves.

**File:** `01-elk-logs/nest-app/src/orders/orders.service.ts`

### 2a. A meter and its instruments (top of the file)

```ts
import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';

const meter = metrics.getMeter('orders-api');

// Counter: "How many orders were created?"
const ordersCreated = meter.createCounter('orders.created', {
  description: 'Number of orders created',
  unit: '{order}',
});

// Histogram: "How long does a payment take?"
const paymentDuration = meter.createHistogram('payment.duration', {
  description: 'How long the payment gateway took',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [100, 250, 500, 750, 1000, 1500, 2000],
  },
});
```

| Piece | Meaning |
|---|---|
| `unit: '{order}'` | Curly braces = "a count of things" (OTel convention). `ms` is a real unit |
| `explicitBucketBoundaries` | The bucket edges. The default buckets go up to 10,000 in odd steps, so we pick edges that fit our 100–1600ms payments. Better buckets = more accurate percentiles |

> **Note:** unlike `trace.getTracer()`, `metrics.getMeter()` must be called **after** the SDK has started, or you get a meter that does nothing. That's fine for us: `instrumentation.ts` runs first (`node --import`), and this file is loaded later by the app.

### 2b. Count every order (in `create()`)

```ts
ordersCreated.add(1, {
  'order.status': order.status,   // "paid" | "payment_failed"
  'order.product': dto.product,
});
```

One counter, but because of the attributes Kibana can split it: paid vs failed, laptop vs phone.

### 2c. Record every payment duration (in `processPayment()`)

```ts
const declined = Math.random() < 0.3;

paymentDuration.record(durationMs, {
  'payment.outcome': declined ? 'declined' : 'success',
});
```

### 2d. A gauge with a callback (in the constructor)

```ts
meter
  .createObservableGauge('orders.stored', {
    description: 'Orders currently kept in memory',
    unit: '{order}',
  })
  .addCallback((result) => result.observe(this.orders.length));
```

We don't call anything when an order is added or deleted. Every 10 seconds the reader runs the callback and asks "how many now?". Use this style for values you can just **read**: queue length, cache size, memory.

### ⚠️ Don't do this

```ts
ordersCreated.add(1, { 'order.id': orderId });   // ❌
```

Every order id creates a **new series**. 1 million orders = 1 million series, and the metric becomes as expensive as logs (or the backend starts dropping data). Ids belong in **logs and span attributes**, not metric attributes. Keep metric attributes to small, fixed sets: status, product type, HTTP method, route.

## Part 3: The Collector gets a metrics pipeline

**File:** `02-opentelemetry/otel-collector/config.yaml`

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug, otlphttp/apm]
    # Stage 2, lesson 4: a second pipeline for metrics (same receiver and exporters)
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug, otlphttp/apm]
```

A **pipeline** is per signal type. The same `otlp` receiver accepts traces and metrics, but without a `metrics` pipeline the Collector would drop the metrics. APM Server accepts OTLP metrics too, and stores them in Elasticsearch.

## Part 4: Run it

```bash
git pull

cd 01-elk-logs/nest-app
npm install                     # new metrics packages

cd ../../02-opentelemetry
docker compose up -d
docker compose restart otel-collector    # load the new pipeline

cd ../01-elk-logs/nest-app
npm run start:dev:otel

# another terminal: a few minutes of traffic gives nicer charts
./scripts/generate-traffic.sh 100
```

Check the Collector received metrics:

```bash
docker compose -f ../../02-opentelemetry/docker-compose.yml logs otel-collector --tail 30
```

Every 10 seconds you should see a `Metrics` entry from the `debug` exporter, listing names like `orders.created`, `payment.duration` and `http.server.request.duration`.

## Part 5: Find the metrics in Kibana

APM Server writes our custom metrics to a data stream named like:

```
metrics-apm.app.orders_api-default
```

(`app` = application metrics, `orders_api` = the service name with `-` changed to `_`.)

### 5a. Data view + Discover

1. **Stack Management → Data views → Create data view**
   - Name: `APM app metrics`
   - Index pattern: `metrics-apm.app.*`
   - Timestamp field: `@timestamp`
2. **Discover** → pick `APM app metrics` → search:
   ```
   orders.created : *
   ```
3. Open a document. You'll see `orders.created` (the count in that 10s window), `service.name: orders-api`, and the attributes.

> **Where are my attributes?** APM Server stores metric attributes as **labels**, and changes dots to underscores: `order.status` becomes **`labels.order_status`**, `payment.outcome` becomes **`labels.payment_outcome`**. Number-valued attributes go to `numeric_labels.*`. If the names look a bit different in your Kibana, search the field list for `order_status`.

### 5b. Build panels with Lens

Add these to a new dashboard called **Orders API metrics**:

**Panel 1: Orders per minute, paid vs failed**
- Visualization: **Bar** (vertical, stacked)
- Horizontal axis: `@timestamp`, interval 1 minute
- Vertical axis: **Sum** of `orders.created`
- Breakdown: **Top values** of `labels.order_status`

Why **Sum**? With delta temporality each document is "orders in these 10 seconds". Summing them per minute = orders per minute.

**Panel 2: Payment duration p95, by outcome**
- Visualization: **Line**
- Horizontal axis: `@timestamp`
- Vertical axis: **Percentile** of `payment.duration`, percentile = 95
- Breakdown: **Top values** of `labels.payment_outcome`

`payment.duration` is stored as an Elasticsearch **histogram** field (the buckets, not each value), and Lens can compute percentiles from it.

**Panel 3: Orders stored right now**
- Visualization: **Metric**
- Metric: **Last value** of `orders.stored`

Send a few `DELETE /orders/:id` requests and watch it go down after ~10s.

### 5c. APM's built-in charts

Open **Observability → APM → Services → orders-api**. The latency, throughput and failed transaction rate charts are also metrics: APM Server **computes them from the spans** and stores them in `metrics-apm.service_*` and `metrics-apm.transaction.*`. So you get the standard request metrics for free, and you add custom metrics for your business.

## Summary

| Before | After |
|---|---|
| Metrics exporter was `none` | A reader exports all metrics every 10s over OTLP |
| Only spans told us about payments, one request at a time | `payment.duration` histogram: p95 over all payments, by outcome |
| No idea how many orders per minute | `orders.created` counter, split by status and product |
| — | `orders.stored` gauge read by a callback |
| Collector had one pipeline (traces) | Two pipelines: traces and metrics |

## Exercises

1. **Failure rate.** Using Panel 1's data, build a Lens **Metric** panel that shows the % of orders that failed. Hint: Lens **Formula**: `sum(orders.created, kql='labels.order_status : "payment_failed"') / sum(orders.created)`, format as percent.
2. **An UpDownCounter.** Replace the `orders.stored` gauge with an UpDownCounter called `orders.active`: `add(1)` when an order is saved, `add(-1)` when it's deleted. Compare: when is each style a better fit?
3. **HTTP metrics.** Find `http.server.request.duration` in Discover (it may be in a different `metrics-apm.*` data stream; search all of them with `metrics-apm*`). Which attributes does it have? Build a chart of request count per `http.route`.
4. **Buckets.** Change `explicitBucketBoundaries` to `[1000]` (only two buckets). Restart, generate traffic, and look at the p95 in Panel 2. Why did it get less accurate?
5. **(Thinking)** Your manager wants a chart of "orders per user". Would you use a metric attribute `user.id`? If not, where would you get that answer from?
