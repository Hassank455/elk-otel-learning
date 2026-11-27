# payments-api

A second NestJS service for Stage 3. `orders-api` calls it to authorize payments.

```bash
npm install
npm run build
npm run start:dev:otel     # http://localhost:3001, with OpenTelemetry
```

| Endpoint | Description |
|---|---|
| `POST /payments` | `{ "orderId": 1, "amount": 900, "currency": "USD" }` → `201 { status: "authorized" }`, or `402 { status: "declined" }` (~30%) |

Logs go to the terminal and to `../../01-elk-logs/nest-app/logs/payments-api.log`, the folder Logstash already reads.

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `LOG_FILE` | `../../01-elk-logs/nest-app/logs/payments-api.log` | JSON log file |
| `DECLINE_RATE` | `0.3` | Share of payments the fake bank declines (lesson 2: set `0.9` to trigger alerts) |
| `EXTRA_DELAY_MS` | `0` | Extra delay per payment (lesson 2: set `2000` to trigger the latency alert) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | The OTel Collector |
