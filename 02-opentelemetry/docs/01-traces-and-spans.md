# Stage 2, Lesson 1: Traces and spans with OpenTelemetry

## Why we need traces

Our dashboard from Stage 1 tells us **that** something went wrong ("39 errors", "43 slow payments"). It can't tell us:

- **Where** the time went inside one slow request.
- **Which** log lines belong to the **same** request (remember: `orderId` restarts from 1 every time the app restarts).

A **trace** answers both.

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Trace** | The full journey of **one request** through the system | Everything that happened for one `POST /orders` |
| **Span** | One step of that journey, with a start time and a duration | "HTTP request", "process payment", "database query" |
| **Root span** | The first span of a trace; every other span is under it | `POST /orders` |
| **Parent / child span** | A span that happens *inside* another span is its child | `process payment` is a child of `POST /orders` |
| **`trace_id`** | A unique id shared by **all** spans (and logs) of one trace | `4ec893439b940d3ba6773ae60f71ea65` |
| **`span_id`** | A unique id for one span | `bee996ba8f5784d6` |
| **Attributes** | Key/value details on a span (like fields on a log) | `http.request.method: POST`, `http.response.status_code: 201` |
| **Instrumentation** | Code that creates spans. **Auto** = libraries patched for you; **manual** = you write it | Auto: every HTTP request gets a span |
| **OpenTelemetry (OTel)** | The open standard + SDKs for traces, metrics and logs, vendor-neutral | Same code works with Elastic, Jaeger, Datadog, ... |
| **SDK** | The OTel library inside your app that creates and sends spans | `@opentelemetry/sdk-node` |
| **Exporter** | The part of the SDK that sends spans out | OTLP exporter → `http://localhost:4318/v1/traces` |
| **OTLP** | The OpenTelemetry protocol, how telemetry travels over the network | Port 4317 (gRPC) and 4318 (HTTP) |
| **Collector** | A separate service that receives, processes and forwards telemetry | Like Logstash, but for OTel data |
| **Resource / `service.name`** | Who sent the data | `service.name: orders-api` |
| **APM** | Application Performance Monitoring: Elastic's UI for traces | Kibana > Observability > Applications |

### An example from real life

Think of a parcel delivery with a tracking number:

- The **tracking number** is the `trace_id`: the same on every step.
- Each **step** ("picked up", "at the warehouse", "out for delivery") is a **span**, with a time and a duration.
- "At the warehouse" might contain smaller steps ("sorted", "loaded"): those are **child spans**.

If the parcel is late, you look at the steps and see exactly where it waited. That's what a trace gives you for a request.

### What a trace looks like

```
trace_id: 4ec8934...
POST /orders                         ████████████████████████████  865ms   (root span)
└── request handler - /orders          ███████████████████████████  860ms   (child span)
```

Today you'll see these two spans. In the next lesson we'll create our own spans (like `process payment`) to see *inside* the handler.

### The new flow

```
                 ┌─(logs)──> app.log ──> Logstash ──────────────────────┐
NestJS + OTel SDK┤                                                      ├──> Elasticsearch ──> Kibana
                 └─(traces, OTLP)──> OTel Collector ──> APM Server ─────┘
```

Logs keep going through Logstash, exactly as in Stage 1. Traces take a new road.

## Code

### 1. The OTel setup: [`nest-app/src/instrumentation.ts`](../../01-elk-logs/nest-app/src/instrumentation.ts)

```ts
const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'orders-api', ... }),
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations({ ... })],
});
sdk.start();
```

- **resource**: the name you'll see in Kibana (`orders-api`).
- **traceExporter**: send spans with OTLP to the Collector.
- **instrumentations**: auto-instrumentation for `http`, `express`, `pino` and many more. We turned off the noisy ones (one span per middleware or per file read).

### 2. Why `--import`?

Auto-instrumentation works by **patching** libraries (`http`, `express`, ...) when they are loaded. So OTel must start **before** the app code:

```bash
node --import ./dist/instrumentation.js dist/main.js
```

Our app uses ES modules (`import`), so `instrumentation.ts` also registers a small hook (`@opentelemetry/instrumentation/hook.mjs`) that lets OTel patch modules loaded with `import`.

New npm scripts in `package.json`:

```json
"start:dev:otel": "nest start --watch --exec \"node --import ./dist/instrumentation.js\"",
"start:prod:otel": "node --import ./dist/instrumentation.js dist/main"
```

### 3. The Collector: [`otel-collector/config.yaml`](../otel-collector/config.yaml)

```yaml
receivers:  { otlp: ... 4317 / 4318 }        # like Logstash input
processors: { batch: {} }                     # like Logstash filter
exporters:
  debug:        { verbosity: normal }         # print spans in the collector logs
  otlphttp/apm: { endpoint: http://apm-server:8200 }   # send to Elastic APM
service:
  pipelines:
    traces: { receivers: [otlp], processors: [batch], exporters: [debug, otlphttp/apm] }
```

Same idea as the Logstash pipeline: **in → process → out**.

### 4. Docker Compose: [`02-opentelemetry/docker-compose.yml`](../docker-compose.yml)

It **includes** the Stage 1 compose file (Elasticsearch, Kibana, Logstash) and adds `otel-collector` and `apm-server`. It uses the same project name as Stage 1, so your data and your dashboard are kept.

## Run it

### 1. Pull, install the new packages

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning
git pull
cd 01-elk-logs/nest-app
npm install
```

### 2. Start everything (from the Stage 2 folder)

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/02-opentelemetry
docker compose up -d
docker compose ps        # elasticsearch, kibana, logstash, apm-server, otel-collector
```

Kibana was recreated with one new setting (an encryption key the APM app needs), so give it a minute.

### 3. Start the app with OpenTelemetry

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/01-elk-logs/nest-app
npm run start:dev:otel
```

### 4. Send traffic and watch the spans arrive

```bash
./scripts/generate-traffic.sh 20
```

In another terminal:

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/02-opentelemetry
docker compose logs -f otel-collector     # the debug exporter prints every span
```

### 5. See the trace in Kibana

1. Menu ☰ > **Observability** > **Applications** > **Service inventory**
2. Click **orders-api**
3. Open **Transactions** and click **POST /orders**
4. Scroll down to **Trace sample**: that's the waterfall, with the root span and its child

### 6. Bonus: logs now have a `trace_id`

Look at the log file:

```bash
tail -3 logs/app.log
```

```json
{"level":"info", ..., "trace_id":"4ec893439b940d3ba6773ae60f71ea65","span_id":"bee996ba8f5784d6", "message":"order created"}
```

The pino instrumentation added `trace_id` and `span_id` to every log line, automatically. Copy a `trace_id` and search it in Discover: `trace_id: "4ec8934..."`. You get **all the logs of that one request**, even across app restarts. We'll connect logs and traces properly in lesson 3.

## Exercise

1. In APM, find the **slowest** `POST /orders` trace. Then find the logs of that same trace in Discover using its `trace_id`. Which `durationMs` does the payment log show?
2. Compare `GET /orders/:id` and `POST /orders` in the APM **Transactions** list. Why is one so much slower?
3. Stop the Collector (`docker compose stop otel-collector`), send 5 requests, start it again. Does the app break? Are those 5 traces in Kibana? Compare with what happened to logs in Stage 1, lesson 3.
4. Open `instrumentation.ts`, enable the express middleware spans again (remove `ignoreLayersType`), restart, and look at a trace. Why did we turn them off?
