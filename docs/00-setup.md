# Stage 0: Project setup and core concepts

## 1. Observability

**Term:** Observability

**Meaning:** The ability to understand what is happening inside a system from the outside, using only the data it emits, without opening the code or adding a new `console.log` every time.

**Example:** A user says "checkout is slow". Without observability you guess. With it, you open Kibana and see that the `/payments` request took 4 seconds, 3.5 of which were spent in a database query.

## 2. The three pillars

| Term | Meaning | Example |
|---|---|---|
| **Logs** | A text or JSON line describing an event that happened at a point in time | `{"level":"error","msg":"payment failed","userId":42}` |
| **Metrics** | Numbers measured over time | Requests per second, memory usage |
| **Traces** | The journey of a single request across all services, split into spans | A `/checkout` request goes through `orders`, then `payments`, then the database |

## 3. Where ELK and OpenTelemetry fit

- **OpenTelemetry (OTel):** an open standard and set of tools for **collecting** logs, metrics, and traces from your application in a vendor-neutral way.
- **ELK:** where the data is **stored, searched, and visualized**:
  - **Elasticsearch**: the search and storage engine.
  - **Logstash**: receives data, transforms it, and ships it to Elasticsearch.
  - **Kibana**: the UI for searching data and building dashboards.

```
NestJS app ──(logs/traces/metrics)──> OTel / Logstash ──> Elasticsearch ──> Kibana
```

## 4. Code: set up the folder on your machine

```bash
cd ~/developer/NodeJsStudioProjects
git clone https://github.com/Hassank455/elk-otel-learning.git
cd elk-otel-learning
```

Check the tools:

```bash
node -v            # 20 or newer
docker -v
docker compose version
```
