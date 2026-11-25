# Stage 3, Lesson 1: Distributed tracing (two services, one trace)

## The problem

Until now, `orders-api` did everything itself, including a fake payment. Real systems are split into **services**: orders, payments, users, notifications... A single click by a user can travel through 5 services.

When that click is slow or fails, the question is: **which service?** Each service has its own logs and its own spans. If every service starts its **own** trace, you get 5 separate pieces and no way to connect them.

**Distributed tracing** means: one request = **one trace**, even when it crosses services.

```
            trace_id = f7ccde012266d6cad70d5005a3aea0ad

orders-api    POST /orders                               ███████████████████  812ms
orders-api    └ orders.create                             ██████████████████
orders-api      ├ payment.process                         ████████████████
orders-api      │ └ POST  (HTTP client, fetch)            ███████████████
              │      ── network: traceparent header ──▶
payments-api  │   └ POST /payments                         ██████████████    766ms
payments-api  │     └ payment.authorize                    █████████████
payments-api  │       └ fraud.check                        █
orders-api      └ orders.save                                             █
```

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Service** | One deployable app with its own job | `orders-api`, `payments-api` |
| **Microservices** | An architecture where the system is many small services talking over the network | Orders calls Payments over HTTP |
| **Distributed trace** | A trace whose spans come from **more than one** service | The tree above |
| **Context propagation (cross-process)** | Passing the trace context **over the network** so the next service continues the same trace | orders-api sends the trace id to payments-api in a header |
| **W3C Trace Context** | The standard that defines the header names and format, so any language/tool understands them | `traceparent`, `tracestate` |
| **`traceparent`** | The header that carries the context: `version-traceId-parentSpanId-flags` | `00-f7ccde012266d6cad70d5005a3aea0ad-c452db6dbe00685e-01` |
| **Propagator** | The OTel component that **injects** the context into outgoing requests and **extracts** it from incoming ones | The default W3C propagator in the Node SDK |
| **Inject / Extract** | Inject = write the header on the way out. Extract = read it on the way in | fetch instrumentation injects; HTTP server instrumentation extracts |
| **Span kind** | The role of a span: `SERVER` (handles an incoming request), `CLIENT` (makes an outgoing request), `INTERNAL` (our own code) | `POST /payments` is SERVER, the fetch `POST` is CLIENT |
| **Service map** | A diagram Kibana APM draws from traces, showing which service calls which | `orders-api → payments-api` |
| **Downstream / upstream** | Downstream = the service you call. Upstream = the one calling you | payments-api is downstream of orders-api |

## Part 1: Reading a `traceparent` header

This is a real header from our test run, received by `payments-api`:

```
traceparent: 00-f7ccde012266d6cad70d5005a3aea0ad-c452db6dbe00685e-01
             │  │                                │                │
             │  │                                │                └ flags: 01 = sampled (record it)
             │  │                                └ parent span id: the CLIENT span in orders-api
             │  └ trace id: the SAME as in orders-api's logs
             └ version: always 00 today
```

When `payments-api` receives this, its HTTP server span uses:
- the **same trace id** → it joins the existing trace
- `c452db6dbe00685e` as its **parent** → it hangs under the fetch span in the tree

## Part 2: The new service, `payments-api`

**Folder:** `03-distributed/payments-api` (a small NestJS app, same setup as orders-api, port **3001**)

```
POST /payments  { "orderId": 1, "amount": 900, "currency": "USD" }

201 { "paymentId": "pay_1", "orderId": 1, "status": "authorized" }
402 { "paymentId": "pay_2", "orderId": 2, "status": "declined", "reason": "card declined" }   (~30%)
```

`402 Payment Required` is the HTTP status that fits "the payment was refused".

### Its spans (`src/payments/payments.service.ts`)

```ts
const tracer = trace.getTracer('payments-api');

async authorize(dto) {
  return tracer.startActiveSpan('payment.authorize', async (span): Promise<PaymentResult> => {
    try {
      span.setAttributes({ 'payment.id': paymentId, 'payment.amount': dto.amount, 'order.id': dto.orderId });
      await this.fraudCheck(dto.amount);        // child span: fraud.check
      await sleep(durationMs);                  // the "bank"
      if (Math.random() < 0.3) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'card declined' });
        return { ..., status: 'declined' };
      }
      return { ..., status: 'authorized' };
    } finally {
      span.end();
    }
  });
}
```

Nothing new here: this is lesson 2 of Stage 2. The important point is what's **missing**: there is no code that reads the trace id from the request. The HTTP server instrumentation **extracts** `traceparent` before our controller runs, so `payment.authorize` is automatically part of orders-api's trace.

### Its instrumentation (`src/instrumentation.ts`)

A copy of orders-api's, with one difference:

```ts
[ATTR_SERVICE_NAME]: 'payments-api',
```

The **service name** is how Kibana tells the two services apart in the trace and draws the service map.

### Its logs

`payments-api` writes JSON logs to `01-elk-logs/nest-app/logs/payments-api.log`. That's the folder Logstash already tails (`*.log`), so its logs reach `nest-app-logs-logstash` with **no Logstash change**, with `service: "payments-api"` and the same `trace.id` as orders-api's logs. (In lesson 3 we'll do this the "real" way: logging to stdout and letting a collector pick it up.)

For learning, the controller also logs the incoming header:

```ts
this.logger.info({ traceparent }, 'incoming traceparent header');
```

## Part 3: orders-api calls payments-api

**File:** `01-elk-logs/nest-app/src/orders/orders.service.ts`

```ts
// Stage 3: where payments-api runs, e.g. http://localhost:3001 (unset = fake gateway)
const PAYMENTS_API_URL = process.env.PAYMENTS_API_URL;

// inside payment.process:
const declined = PAYMENTS_API_URL
  ? await this.callPaymentsApi(orderId, amount, currency)
  : await this.fakeGateway();      // Stage 2 behaviour, still works

private async callPaymentsApi(orderId: number, amount: number, currency: string): Promise<boolean> {
  const res = await fetch(`${PAYMENTS_API_URL}/payments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId, amount, currency }),
  });
  if (res.status === 402) return true;   // declined
  if (!res.ok) throw new Error(`payments-api returned ${res.status}`);
  return false;
}
```

Look at the headers: we only send `content-type`. **We never add `traceparent`.** The **undici instrumentation** (Node's `fetch` is built on undici) is part of `getNodeAutoInstrumentations()`. On every `fetch` it:

1. creates a **CLIENT** span (`POST`) as a child of the active span (`payment.process`)
2. **injects** `traceparent` with the trace id and that client span's id
3. ends the span when the response arrives

So distributed tracing needed **zero tracing code** in both services. Auto-instrumentation on both sides + the same standard header = one trace.

> If `PAYMENTS_API_URL` isn't set, orders-api uses the fake gateway from Stage 2, so everything from earlier lessons (and the e2e tests) still works.

### A bug fix while we're here

Both `instrumentation.ts` files had:

```ts
process.on('SIGTERM', () => void sdk.shutdown());
```

Adding a `SIGTERM` handler **replaces** Node's default behaviour (exit). So on `SIGTERM` (what `docker stop`, Kubernetes, and `timeout` send) the app flushed its spans but **kept running**. Fixed:

```ts
process.on('SIGTERM', () => void sdk.shutdown().finally(() => process.exit(0)));
```

## Part 4: Run it

You need **4 terminals** (Docker, payments-api, orders-api, traffic).

```bash
git pull

# Terminal 1: the Docker side (same as Stage 2)
cd 02-opentelemetry
docker compose up -d

# Terminal 2: payments-api on port 3001
cd 03-distributed/payments-api
npm install
npm run start:dev:otel

# Terminal 3: orders-api on port 3000, now calling payments-api
cd 01-elk-logs/nest-app
PAYMENTS_API_URL=http://localhost:3001 npm run start:dev:otel

# Terminal 4: traffic
cd 01-elk-logs/nest-app
./scripts/generate-traffic.sh 30
```

In terminal 2 you'll see payments-api's logs, including `incoming traceparent header`. Compare the trace id inside it with the `trace_id` printed by orders-api for the same order.

## Part 5: See it in Kibana

### 5a. The distributed trace

1. **Observability → APM → Services**. You now have **two** services: `orders-api` and `payments-api`.
2. Open **orders-api → Transactions → POST /orders**, scroll to the trace sample.
3. The waterfall now has spans in **two colours**, one per service. Find the fetch span `POST` and, under it, `POST /payments` → `payment.authorize` → `fraud.check` from payments-api.
4. Click the `POST` client span: you'll see the destination (`localhost:3001`) and the HTTP status (`201` or `402`).

### 5b. The service map

**APM → Service map** (or open a service and pick the **Service map** tab). Kibana draws `orders-api → payments-api` from the traces alone: no configuration, it learned the architecture by watching requests.

> On some Elastic license levels the service map is not available. If you don't see it, the waterfall in 5a shows the same information for one request.

### 5c. Logs from both services, one request

In **Discover** (`nest-app-logs-*`):

```
trace.id : "<a trace id from 5a>"
```

Add the columns `service`, `message`, `span.id`. You'll see orders-api and payments-api logs **mixed in time order**: one story across two services.

Or the other way: find a decline first.

```
service : "payments-api" and message : "payment declined by bank"
```

Copy the `trace.id` and open the trace: you see what orders-api did before and after the decline.

## Summary

| Before | After |
|---|---|
| One service did everything | `orders-api` calls `payments-api` over HTTP |
| One service = one trace | One request = one trace across **both** services |
| — | `traceparent` header carries the trace id and the parent span id |
| — | Auto-instrumentation injects (fetch) and extracts (HTTP server): no tracing code needed |
| — | Kibana shows a service map and mixed logs per `trace.id` |

## Exercises

1. **Read the header.** From payments-api's `incoming traceparent header` log, split the value into its 4 parts. Find the parent span id in the APM waterfall: which span is it?
2. **Kill the downstream.** Stop payments-api (Ctrl+C) and send an order. What does orders-api return? What does the trace look like (which span is red, what's the error)? What would a better behaviour be for the user?
3. **Make it slow.** In `payments.service.ts`, change the bank delay to `2000 + Math.random() * 1000`. In APM, compare the latency of `orders-api` and `payments-api`. How does the trace show you **which** service is slow?
4. **Break the propagation.** In orders-api, call payments-api with `fetch` but with tracing disabled for undici: add `'@opentelemetry/instrumentation-undici': { enabled: false }` to `getNodeAutoInstrumentations`. Restart and look at APM. How many traces do you get per order now? Why? (Turn it back on afterwards.)
5. **(Thinking)** payments-api is written in NestJS. If the payments team rewrote it in Go or Java, would the distributed trace still work? What do both sides need to agree on?
