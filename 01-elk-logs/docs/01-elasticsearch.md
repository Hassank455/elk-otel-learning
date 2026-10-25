# Lesson 1: Elasticsearch

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Elasticsearch** | A database built for fast search over large amounts of text and JSON | Storing millions of logs and searching them in milliseconds |
| **Document** | A single JSON record (like a row in SQL) | `{"level":"error","message":"payment failed"}` |
| **Index** | A collection of similar documents (like a table in SQL) | `app-logs` |
| **Node / Cluster** | A node is one server running Elasticsearch; a cluster is a group of nodes | We use a single node (`single-node`) |
| **REST API** | You talk to Elasticsearch with plain HTTP requests | `GET /app-logs/_search` |

**Why Elasticsearch for logs?** Logs are huge in volume, and we need full-text search over them ("all errors mentioning payment in the last hour"). Regular databases are slow at this kind of search.

**Compared to SQL:**

```
SQL:            Database -> Table  -> Row
Elasticsearch:  Cluster  -> Index  -> Document
```

## Code

### 1. Start Elasticsearch

```bash
cd 01-elk-logs
docker compose up -d
docker compose ps        # wait until the status is healthy (about 30 seconds)
```

### 2. Check that it is running

```bash
curl http://localhost:9200
```

You should get JSON containing `"tagline" : "You Know, for Search"`.

### 3. Add your first documents

```bash
curl -X POST http://localhost:9200/app-logs/_doc \
  -H 'Content-Type: application/json' \
  -d '{"@timestamp":"2026-10-25T10:00:00Z","level":"info","service":"orders","message":"order created"}'

curl -X POST http://localhost:9200/app-logs/_doc \
  -H 'Content-Type: application/json' \
  -d '{"@timestamp":"2026-10-25T10:01:00Z","level":"error","service":"payments","message":"payment failed: card declined"}'
```

Notice that we never created the `app-logs` index. Elasticsearch created it automatically with the first document.

### 4. Search

```bash
# All documents
curl "http://localhost:9200/app-logs/_search?pretty"

# Errors only
curl -X GET "http://localhost:9200/app-logs/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{"query":{"match":{"level":"error"}}}'

# Full-text search: any log containing "payment"
curl "http://localhost:9200/app-logs/_search?q=message:payment&pretty"
```

### 5. Look at the mapping

```bash
curl "http://localhost:9200/app-logs/_mapping?pretty"
```

A **mapping** is the type of each field (`text`, `keyword`, `date`, ...). Elasticsearch guessed it automatically; later we will learn to define it ourselves.

## Exercise

1. Add 3 new logs from a service called `users`.
2. Search for all logs that belong to `users`.
3. Delete the whole index: `curl -X DELETE http://localhost:9200/app-logs`

## Stopping

```bash
docker compose down        # stop the containers, keep the data
docker compose down -v     # stop and delete the data too
```
