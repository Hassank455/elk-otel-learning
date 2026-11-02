# Lesson 5: Searching in Kibana and a first dashboard

Until now you had to **ask** Kibana every question ("show me errors"). A dashboard answers the important questions **all the time**, on one screen: open it and you see right away if something is wrong.

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Dashboard** | A page with several panels that update together, using the same time range and filters | "Orders API health" |
| **Panel** | One chart, number or table on a dashboard | "Errors in the last 15 minutes: 7" |
| **Lens** | Kibana's drag-and-drop editor for building visualizations | Drag `level.keyword` onto a bar chart |
| **Aggregation** | A calculation over many documents (lesson 2 used one: `terms`) | count, average, percentiles |
| **Metric aggregation** | Turns many documents into **one number** | `count`, `avg(durationMs)`, `max` |
| **Bucket aggregation** | Splits documents into **groups** | `terms` (per product), `date_histogram` (per minute) |
| **Percentile (p95)** | The value 95% of requests are faster than | p95 = 1400ms means 1 in 20 payments is slower than 1.4s |
| **`text` vs `keyword`** | `text` is split into words for full-text search; `keyword` is the exact whole value, used for grouping and exact filters | `message` is searched as text; `level.keyword` is grouped |

### `text` vs `keyword` (promised in lesson 2)

When Elasticsearch sees a new string field, it maps it **twice**:

```json
"product": {
  "type": "text",                                       // "gaming laptop" -> ["gaming", "laptop"]
  "fields": { "keyword": { "type": "keyword" } }        // "gaming laptop" as one exact value
}
```

- Search for a word inside → `text` (`message: declined`)
- Group, sort, or count per value → `keyword` (`product.keyword`). That's why charts in Lens show `.keyword` fields.

### Why p95 and not the average?

Average hides the slow ones. If 19 payments take 200ms and 1 takes 5000ms, the average is 440ms ("looks fine"), but one user in twenty waited 5 seconds. Percentiles show what real users feel.

## Code: the questions behind each panel

Every panel is just an aggregation. Run these in **Dev Tools** first so you understand what Kibana does for you:

### 1. Logs per minute, split by level (`date_histogram` + `terms`)

```
GET nest-app-logs-logstash/_search
{
  "size": 0,
  "query": { "range": { "@timestamp": { "gte": "now-1h" } } },
  "aggs": {
    "per_minute": {
      "date_histogram": { "field": "@timestamp", "fixed_interval": "1m" },
      "aggs": { "per_level": { "terms": { "field": "level.keyword" } } }
    }
  }
}
```

This is a **nested aggregation**: buckets (minutes) inside which there are more buckets (levels).

### 2. Payment duration: average vs p95 (metric aggregations)

```
GET nest-app-logs-logstash/_search
{
  "size": 0,
  "query": { "exists": { "field": "durationMs" } },
  "aggs": {
    "avg_ms": { "avg": { "field": "durationMs" } },
    "p95_ms": { "percentiles": { "field": "durationMs", "percents": [50, 95, 99] } }
  }
}
```

### 3. Which products fail the most? (`terms` + a filter)

```
GET nest-app-logs-logstash/_search
{
  "size": 0,
  "query": { "match": { "message": "payment failed" } },
  "aggs": { "per_product": { "terms": { "field": "product.keyword" } } }
}
```

## Build the dashboard

First, generate enough data (2 terminals):

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning && git pull
cd 01-elk-logs && docker compose up -d
cd nest-app && npm run start:dev
# second terminal:
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/01-elk-logs/nest-app
./scripts/generate-traffic.sh 100
```

Then in Kibana: menu ☰ > **Dashboards** > **Create dashboard**. Set the time range to **Last 1 hour**. For each panel: **Create visualization** (opens Lens), pick the data view `nest-app-logs-logstash` (or `nest-app-logs*`), build it, then **Save and return**.

| # | Panel | Chart type | How to build it in Lens |
|---|---|---|---|
| 1 | **Errors** | Metric | Vertical axis: `Count`. In the search bar of the panel: `level: "error"` |
| 2 | **Slow payments** | Metric | `Count`, search: `tags: "slow"` |
| 3 | **Logs over time by level** | Bar vertical stacked | Horizontal: `@timestamp`. Vertical: `Count`. Breakdown: `level.keyword` |
| 4 | **Payment duration p95** | Line | Horizontal: `@timestamp`. Vertical: `Percentile` of `durationMs`, 95. Add a second layer or metric: `Average` of `durationMs` |
| 5 | **Failed payments by product** | Bar horizontal | Vertical: `product.keyword` (top 5). Horizontal: `Count`. Search: `message: "payment failed"` |
| 6 | **HTTP status codes** | Donut | Slice by: `res.statusCode`. Size: `Count` |
| 7 | **Latest alerts** | Saved search | **Add from library** > your Discover search with `tags: "alert"` (save it in Discover first, with columns `message`, `product`, `orderId`) |

Save the dashboard as **Orders API health**.

### Try the dashboard like an on-call engineer

1. Click a bar of `error` in panel 3: Kibana adds a filter, and **every panel** now shows only errors.
2. Drag across a time range in panel 3 or 4: the whole dashboard zooms in.
3. Click `laptop` in panel 5: see only laptop logs everywhere.
4. Turn on auto-refresh (the time picker > **Refresh every 10 seconds**) and run `generate-traffic.sh 50` again. Watch it update.

## Exercise

1. Add a panel **Orders created per minute**: `Count` over `@timestamp`, search `message: "order created"`.
2. Add a panel **Error rate**: the share of logs that are errors. Hint: in Lens, use a **Formula**: `count(kql='level: "error"') / count()`, format as percent.
3. In Dev Tools, write the aggregation for panel 6 (HTTP status codes) yourself.
4. Stop the app for 2 minutes, then start it again. What does the dashboard show for those 2 minutes? Why is "no logs" also a signal?

## Stage 1 is done

You now have the full logging pipeline: **structured logs → file → Logstash → Elasticsearch → Kibana dashboard**.

What it can't tell you yet: *where* the time went inside a request, or what happened to the same request across two services. That's **Stage 2: OpenTelemetry** (traces, spans, metrics).
