# elk-otel-learning

Step-by-step learning journey for the **ELK Stack** (Elasticsearch, Logstash, Kibana) and **OpenTelemetry** with **NestJS** and **Docker**: logs, traces, and metrics.

## How each step works

1. **Term**: what is the thing we are learning called?
2. **Meaning**: what does it mean, and why do we need it?
3. **Example**: a simple real-world or real-project example.
4. **Code**: write the code, run it, and verify it works.

Each stage has its own folder with a `docs/` subfolder for the lessons and the code next to it.

## Stages

| Stage | Folder | Topic | Status |
|---|---|---|---|
| 0 | `docs/00-setup.md` | Project setup and core observability concepts | ✅ |
| 1 | `01-elk-logs/` | Run ELK with Docker, a NestJS app sending structured logs, searching in Kibana, first dashboard | 🚧 |
| 2 | `02-opentelemetry/` | Traces, spans, metrics, context propagation, OTel SDK, OTel Collector, Elastic APM | ⏳ |
| 3 | `03-full-observability/` | Two NestJS services, distributed tracing, correlating logs and traces via trace_id, alerts | ⏳ |
| 4 | `04-advanced/` | Sampling, index lifecycle management, production-ready setup (optional) | ⏳ |

## Requirements

- Node.js 20+
- Docker and Docker Compose
- NestJS CLI: `npm i -g @nestjs/cli`

## Learning log

| Date | Step | Notes |
|---|---|---|
| 2026-10-25 | Stage 0 | Created the repo and plan; verified Node v26 and Docker 29 |
| 2026-10-25 | Stage 1, lesson 1 | Elasticsearch: index, document, search; exercise done ✅ |
| 2026-10-25 | Stage 1, lesson 2 | Kibana: data view, Discover, KQL, Dev Tools ✅ |
| 2026-10-25 | Stage 1, lesson 3 | NestJS + pino structured logs shipped to Elasticsearch |
| 2026-10-26 | Stage 1, lesson 3 exercises | DELETE endpoint (Hassan), currency field, `assign()` for request-scoped fields ✅ |
| 2026-10-26 | Stage 1, lesson 4 | Logstash: file input, filters, decoupling the app from Elasticsearch |
