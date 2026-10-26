# Lesson 4: Logstash

## Before we start: the answer to lesson 3, exercise 4

When you stopped Elasticsearch and sent requests:

- **The app kept working.** Logging is asynchronous, so a broken log destination doesn't break your API. Good.
- **The logs written while Elasticsearch was down were lost.** `pino-elasticsearch` keeps logs in memory, retries a few times, then gives up. Restart the app and the memory is gone too. Bad.

There is a second problem: the app *knows* about Elasticsearch (its URL, the index name, the batch size). Every service you write would need that code, and changing anything means redeploying every service.

**The fix used in real systems:** the app only writes logs to a file (or stdout). A separate tool reads them and ships them. If Elasticsearch is down, the logs are still safe on disk, and the shipper continues from where it stopped.

```
Lesson 3:  NestJS ──(HTTP, in memory)──> Elasticsearch               ❌ logs lost if ES is down

Lesson 4:  NestJS ──> logs/app.log ──> Logstash ──> Elasticsearch    ✅ the file is the buffer
                       (on disk)       (reads, filters, retries)
```

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Logstash** | A data processing pipeline: it receives data, transforms it, and sends it somewhere | Read `app.log`, add a `slow` tag, write to Elasticsearch |
| **Pipeline** | The Logstash config: always 3 parts, `input` → `filter` → `output` | `logstash/pipeline/nest-app.conf` |
| **Input plugin** | Where data comes from | `file`, `beats`, `http`, `kafka` |
| **Filter plugin** | How each event is changed | `mutate` (add/remove/rename fields), `grok` (parse text), `date` |
| **Output plugin** | Where data goes | `elasticsearch`, `stdout`, `s3` |
| **Codec** | How raw bytes become an event | `json`: each line is a JSON object |
| **Event** | One piece of data moving through the pipeline (one log line here) | `{"level":"error","message":"payment failed",...}` |
| **sincedb** | A small file where the `file` input remembers how far it has read each file | After a restart, Logstash continues from the last line, not from the start |
| **Decoupling** | The app doesn't know or care where logs end up | Switch Elasticsearch to another tool by changing Logstash only |

**Example from real life:** think of a post office. You (the app) drop letters in the mailbox (the log file) and go back to work. The post office (Logstash) picks them up, sorts and stamps them (filter), and delivers them (output). If the road is closed, the letters wait at the post office instead of being thrown away.

## Code

### 1. The app now writes to a file

[`nest-app/src/logger.config.ts`](../nest-app/src/logger.config.ts) now has three streams:

```ts
// Stream 2: one JSON object per line in a file (Logstash tails this file)
const fileStream = pino.destination({ dest: LOG_FILE, mkdir: true, sync: false });

const streams = [{ stream: consoleStream }, { stream: fileStream }];

// Stream 3 (optional): the lesson 3 direct shipping, only if LOG_TO_ELASTICSEARCH=true
if (LOG_TO_ELASTICSEARCH) { ... }
```

By default the app writes to `nest-app/logs/app.log` and does **not** talk to Elasticsearch anymore.

This format, one JSON object per line, is called **NDJSON** (newline-delimited JSON). It's the same idea as the `_bulk` body from lesson 2.

### 2. The pipeline

[`logstash/pipeline/nest-app.conf`](../logstash/pipeline/nest-app.conf):

```ruby
input {
  file {
    path => "/var/log/nest-app/*.log"
    start_position => "beginning"
    sincedb_path => "/usr/share/logstash/data/sincedb-nest-app"
    codec => "json"
  }
}

filter {
  if [durationMs] and [durationMs] > 1000 {
    mutate { add_tag => ["slow"] }
  }
  if [level] == "error" {
    mutate { add_tag => ["alert"] }
  }
  mutate {
    add_field => { "shipper" => "logstash" "environment" => "local" }
    remove_field => ["[event][original]"]
  }
}

output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "nest-app-logs-logstash"
  }
  stdout { codec => rubydebug }
}
```

- `[durationMs]` is how Logstash refers to a field; `[req][url]` is a nested field.
- The `filter` block is where Logstash shines: the app stays simple, and the shipping rules live in one place.

### 3. Docker Compose

```yaml
logstash:
  image: docker.elastic.co/logstash/logstash:${ELK_VERSION:-9.1.0}
  volumes:
    - ./logstash/pipeline:/usr/share/logstash/pipeline:ro
    - ./nest-app/logs:/var/log/nest-app:ro
    - ls-data:/usr/share/logstash/data
```

The second volume is the key: the **same folder** is `nest-app/logs` on your Mac and `/var/log/nest-app` inside the Logstash container.

## Run it

### 1. Pull and start the app first (so the `logs/` folder exists)

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning
git pull
cd 01-elk-logs/nest-app
npm run start:dev
```

In a second terminal, check the file:

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/01-elk-logs/nest-app
tail -f logs/app.log        # Ctrl+C to exit
```

### 2. Start Logstash

```bash
cd ~/developer/NodeJsStudioProjects/elk-otel-learning/01-elk-logs
docker compose up -d
docker compose logs -f logstash    # wait for "Pipelines running", Ctrl+C to exit
```

### 3. Send traffic and watch it flow

```bash
cd nest-app && ./scripts/generate-traffic.sh 20
```

In `docker compose logs -f logstash` you'll see each event printed by the `stdout` output, with the new `tags`, `shipper` and `environment` fields.

```bash
curl "http://localhost:9200/nest-app-logs-logstash/_count?pretty"
curl "http://localhost:9600/_node/stats/pipelines?pretty"   # events in / filtered / out
```

### 4. Kibana

Create a data view for `nest-app-logs-logstash*` (or reuse `nest-app-logs*`, which matches both indices). Try:

```
tags: "slow"
tags: "alert"
shipper: "logstash"
product: "laptop" and level: "error"
```

The last one is exercise 3 from lesson 3: now every payment log carries `product`.

## Exercise

1. **Repeat the lesson 3 experiment:** `docker compose stop elasticsearch`, send 10 requests, wait 30 seconds, `docker compose start elasticsearch`. Count the documents. Were any logs lost this time? Why?
2. **sincedb:** `docker compose restart logstash`. Are the old logs sent again (duplicates)? Now look at what `sincedb_path` does.
3. **New filter:** add a tag `not_found` to every log where `[res][statusCode] == 404`.
4. **Drop noise:** use the `drop {}` filter to stop sending `debug` logs to Elasticsearch. Hint: `if [level] == "debug" { drop {} }`.

After every pipeline change: `docker compose restart logstash`.
