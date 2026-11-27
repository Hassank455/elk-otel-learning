# Stage 3: Distributed systems

| Lesson | File | Status |
|---|---|---|
| 1. Distributed tracing: two services, one trace | [docs/01-distributed-tracing.md](docs/01-distributed-tracing.md) | ✅ |
| 2. Alerts in Kibana: rules, connectors, fault injection | [docs/02-alerts.md](docs/02-alerts.md) | 🚧 |
| 3. Logging to stdout and collecting container logs | coming soon | |

Services:

| Service | Folder | Port |
|---|---|---|
| `orders-api` | [`../01-elk-logs/nest-app`](../01-elk-logs/nest-app) | 3000 |
| `payments-api` | [`payments-api`](payments-api) | 3001 |

The Docker side (Elasticsearch, Kibana, Logstash, APM Server, Collector) is still started from [`../02-opentelemetry`](../02-opentelemetry).
