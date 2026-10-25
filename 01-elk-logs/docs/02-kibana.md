# Lesson 2: Kibana

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Kibana** | The web UI for Elasticsearch: search, explore, and visualize data | Open `http://localhost:5601` and browse your logs |
| **Data view** | Tells Kibana which indices to read and which field is the time field | Data view `app-logs*` with time field `@timestamp` |
| **Discover** | The Kibana page for searching and filtering raw documents | "Show all errors from `payments` in the last 15 minutes" |
| **KQL** (Kibana Query Language) | A simple query language for the Discover search bar | `level: "error" and service: "payments"` |
| **Dev Tools / Console** | Run Elasticsearch REST requests from inside Kibana (instead of curl) | `GET app-logs/_search` |
| **Time picker** | Filters every query by time range | "Last 15 minutes", "Last 7 days" |

**Why Kibana?** curl is fine for one query, but when you investigate a problem you want to filter, zoom into a time range, and click through fields. Kibana gives you that on top of Elasticsearch, without storing any data itself.

**Docker networking note:** inside Docker Compose, containers reach each other by **service name**. That is why Kibana uses `http://elasticsearch:9200`, while you on your machine use `http://localhost:9200`.

```
Your browser ──> localhost:5601 (Kibana) ──> elasticsearch:9200 (inside Docker network)
```

## Code

### 1. Start Kibana

```bash
cd 01-elk-logs
docker compose up -d
docker compose ps        # kibana starts after elasticsearch is healthy
docker compose logs -f kibana   # wait for "Kibana is now available" (Ctrl+C to exit)
```

Open http://localhost:5601

### 2. Add sample logs with fresh timestamps

Discover only shows data inside the time picker range, so let's add logs timestamped *now*. Open **Dev Tools** (menu ☰ > Management > Dev Tools) and run:

```
POST app-logs/_bulk
{"index":{}}
{"@timestamp":"<NOW>","level":"info","service":"orders","message":"order created","orderId":101}
{"index":{}}
{"@timestamp":"<NOW>","level":"error","service":"payments","message":"payment failed: card declined","orderId":101}
{"index":{}}
{"@timestamp":"<NOW>","level":"warn","service":"payments","message":"payment retry","orderId":102}
{"index":{}}
{"@timestamp":"<NOW>","level":"info","service":"users","message":"user signed up","userId":7}
```

Replace `<NOW>` with the current UTC time, e.g. `2026-10-25T18:30:00Z` (`date -u +%Y-%m-%dT%H:%M:%SZ` prints it).

**Bulk API**: sends many documents in one request. Each document is two lines: an action line (`{"index":{}}`) and the document itself.

### 3. Create a data view

1. Menu ☰ > **Stack Management** > **Data Views** > **Create data view**
2. Name: `app-logs`, Index pattern: `app-logs*`
3. Timestamp field: `@timestamp`
4. Save

### 4. Explore in Discover

Menu ☰ > **Discover**, pick the `app-logs` data view, set the time picker to **Last 1 hour**.

Try these KQL queries:

```
level: "error"
service: "payments"
service: "payments" and not level: "info"
message: *declined*
orderId: 101
```

Click a field name on the left (e.g. `service`) to see its top values, and click ➕ to add it as a column.

## Exercise

1. In Dev Tools, add 5 more logs (mix of levels and services) using `_bulk`.
2. In Discover, find every `warn` or `error` log: `level: ("warn" or "error")`.
3. Save that search (Save button at the top) as **Problems**.
4. In Dev Tools, run a search that counts logs per service:

```
GET app-logs/_search
{
  "size": 0,
  "aggs": {
    "per_service": { "terms": { "field": "service.keyword" } }
  }
}
```

**Aggregation**: Elasticsearch's version of SQL `GROUP BY`. `service.keyword` is the exact (non-analyzed) version of the `service` field, which is what you group by. We'll go deeper into `text` vs `keyword` later.
