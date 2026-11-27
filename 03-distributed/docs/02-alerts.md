# Stage 3, Lesson 2: Alerts in Kibana

## The problem

We have dashboards, traces, logs and metrics. But they only help if **someone is looking**. At 3 AM nobody is looking at a dashboard.

An **alert** turns that around: Kibana checks the data for you, every minute, and **tells you** when something is wrong. In real work, this is how most incidents are discovered.

```
every 1 minute:
  Kibana runs a query  ──▶  "how many payment declines in the last 5 minutes?"  ──▶  12
                                                                                     │
                                         12 > 5 ?  yes  ──▶  ALERT  ──▶  action: log / Slack / email / index
```

## Terms

| Term | Meaning | Example |
|---|---|---|
| **Rule** | The definition of what to check, how often, and what to do | "Every 1m, count error logs from payments-api in the last 5m; if > 5, write to the server log" |
| **Rule type** | The kind of check. Each type knows a kind of data | Elasticsearch query, APM latency threshold, Custom threshold |
| **Condition / threshold** | The test that decides if something is wrong | `count IS ABOVE 5` |
| **Time window** | How far back each check looks | `last 5 minutes` |
| **Check interval** | How often the rule runs | `every 1 minute` |
| **Alert** | One occurrence of a rule's condition being true. It has a state | `active`, then `recovered` |
| **Active / Recovered** | Active = condition is true now. Recovered = it was true and now it's false again | Declines dropped back to 2 → recovered |
| **Action** | What happens when an alert fires (or recovers) | Write a message, send to Slack |
| **Connector** | The configured destination an action uses: where and how to send | "Server log", "Index", "Slack #alerts" |
| **Action frequency** | When to run the action: on status change, or every check while active | "On status change" = once when it starts, once when it recovers |
| **Mustache variables** | Placeholders in the message, filled in by Kibana | `{{rule.name}}`, `{{context.value}}` |
| **Snooze / Mute** | Silence a rule for a while without deleting it | Snooze during a planned deploy |
| **Flapping** | An alert that keeps switching active ↔ recovered | Threshold too close to normal values |
| **Alert fatigue** | Too many alerts, so people start ignoring them. The #1 alerting mistake | 50 alerts a day, nobody reads them |

### What makes a good alert?

- It's about **user impact** (failed payments, slow checkout), not about internals nobody acts on.
- Someone can **do something** about it. If the answer is "nothing", it's not an alert, it's a dashboard panel.
- The threshold is clearly **above normal**. Our normal decline rate is ~30%, so alerting at 31% would fire all day.

## Part 1: Make the "bank" misbehave (on purpose)

To test alerts, we need a way to cause problems. `payments-api` now reads two environment variables.

**File:** `03-distributed/payments-api/src/payments/payments.service.ts`

```ts
// DECLINE_RATE=0.9  -> 90% of payments are declined (default 0.3)
// EXTRA_DELAY_MS=2000 -> every payment takes 2s longer (default 0)
const DECLINE_RATE = Number(process.env.DECLINE_RATE ?? 0.3);
const EXTRA_DELAY_MS = Number(process.env.EXTRA_DELAY_MS ?? 0);

// ...
const durationMs = Math.round(100 + Math.random() * 1400 + EXTRA_DELAY_MS);
// ...
if (Math.random() < DECLINE_RATE) { /* declined */ }
```

This is called **fault injection**: breaking things deliberately to test that monitoring catches it. Big companies do it in production ("chaos engineering").

## Part 2: Connectors (where alerts go)

On the free (Basic) license, Kibana gives you two connectors:

| Connector | What it does | Where you see it |
|---|---|---|
| **Server log** | Writes the alert message to Kibana's own log | `docker compose logs kibana` |
| **Index** | Writes the alert as a document into an Elasticsearch index | Discover, dashboards |

Slack, Email, Teams, PagerDuty, Webhook need a paid license. You can try them for 30 days with a free trial (**Stack Management → License management → Start trial**). The rule setup is exactly the same; only the connector changes.

### Create the connectors

1. **Stack Management → Connectors → Create connector**.
2. Pick **Server log**. Name: `Server log`. **Save**.
3. **Create connector** again → **Index**.
   - Name: `Alert history`
   - Index: `alerts-history-orders` (type it and pick "use as custom index" if asked)
   - Turn on **Define time field for each document**, time field: `@timestamp` (Kibana fills it with the time the alert fired)
   - **Save**.

> Alerting needs `xpack.encryptedSavedObjects.encryptionKey` in Kibana to store connectors safely. We already set it in Stage 1 (`XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY` in `01-elk-logs/docker-compose.yml`), so it just works.

## Part 3: Rule 1, too many payment declines (Elasticsearch query rule)

This rule works on **logs**. It's the most flexible rule type: if you can write a query, you can alert on it.

1. **Stack Management → Rules → Create rule** → **Elasticsearch query**.
2. **Name:** `Too many payment declines`
3. **Define your query:**
   - Query type: **KQL or Lucene**
   - Data view: `nest-app-logs-*`
   - Query:
     ```
     service : "payments-api" and level : "error"
     ```
4. **Set the threshold:**
   - `WHEN` **count()** `OVER` **all documents** `IS ABOVE` **5**
   - `FOR THE LAST` **5 minutes**
5. **Rule schedule:** check every **1 minute**.
6. **Actions → Add action → Server log**:
   - Action frequency: **On status changes**
   - Run when: **Query matched**
   - Level: **Warning**
   - Message:
     ```
     🚨 {{rule.name}}: {{context.value}} declines in the last 5 minutes (threshold: 5)
     ```
7. Add a second action: **Server log**, run when **Recovered**, message:
   ```
   ✅ {{rule.name}} recovered
   ```
8. Add a third action: **Alert history** (Index), run when **Query matched**, document:
   ```json
   {
     "rule": "{{rule.name}}",
     "value": "{{context.value}}",
     "message": "{{context.message}}"
   }
   ```
9. **Save**.

| Mustache variable | Filled with |
|---|---|
| `{{rule.name}}` | The rule's name |
| `{{context.value}}` | The count that broke the threshold |
| `{{context.message}}` | A ready-made description from Kibana |
| `{{context.link}}` | A link to Discover with the matching documents |
| `{{date}}` | When the alert fired |

### Trigger it

```bash
# Terminal: restart payments-api with a terrible bank (Ctrl+C first)
cd 03-distributed/payments-api
DECLINE_RATE=0.9 npm run start:dev:otel

# Terminal: orders-api as in lesson 1
cd 01-elk-logs/nest-app
PAYMENTS_API_URL=http://localhost:3001 npm run start:dev:otel

# Terminal: traffic for a few minutes
./scripts/generate-traffic.sh 200
```

Within 1–2 minutes (Logstash has to ship the logs, then the rule has to run):

```bash
cd 02-opentelemetry
docker compose logs kibana --since 5m | grep "payment declines"
```

You should see your 🚨 message. And in **Stack Management → Rules → Too many payment declines** the alert is **Active**.

Now restart payments-api **without** `DECLINE_RATE` and keep the traffic running. After the 5-minute window passes with ≤ 5 declines, the alert becomes **Recovered** and the ✅ message appears.

## Part 4: Rule 2, slow payments (APM latency rule)

This rule works on **traces**. APM already computes latency from spans, so we don't write a query at all.

1. **Observability → APM → Services → payments-api**.
2. Top right: **Alerts and rules → Create threshold rule → Latency**.
3. Settings:
   - Service: `payments-api`, Environment: `local` (or All), Transaction type: `request`
   - Transaction name: `POST /payments` (optional)
   - **WHEN** **Average** latency **IS ABOVE** **1500 ms**
   - **FOR THE LAST** **5 minutes**
4. Check every **1 minute**.
5. Action: **Server log**, on status changes, message:
   ```
   🐢 {{rule.name}}: {{context.serviceName}} latency is {{context.triggerValue}} (threshold {{context.threshold}})
   ```
6. **Save**.

Normal payments take 100–1500ms (average ~800ms), so 1500ms average is clearly abnormal.

### Trigger it

```bash
cd 03-distributed/payments-api
EXTRA_DELAY_MS=2000 npm run start:dev:otel
```

Keep the traffic running. In a few minutes:

```bash
docker compose logs kibana --since 5m | grep "latency is"
```

> Notice this rule is on **payments-api**, but orders-api gets slow too (it waits for payments). If you alerted on both, one problem would page you twice. Alert on the service that **causes** the problem, or on the one **users** hit, and use the trace to find the rest. That's how distributed tracing reduces alert noise.

## Part 5: See all alerts in one place

- **Observability → Alerts**: every active and recovered alert from all rules, with a timeline. Click one to see details and a link back to the data.
- **Stack Management → Rules**: each rule's status, last run, how long it took, and errors.
- **Discover** on the `alerts-history-orders` index (create a data view for it): your Index connector's documents. You could add a panel to the "Orders API health" dashboard showing alerts over time.

## Part 6: What this looks like in real work

| Here | Real work |
|---|---|
| Server log connector | Slack channel `#alerts-payments`, PagerDuty to wake up the on-call engineer |
| One person creates rules in the UI | Rules created by API or Terraform, reviewed in pull requests ("alerts as code") |
| Thresholds picked by guessing | Thresholds based on **SLOs** (e.g. "99% of payments under 2s"), Kibana has an SLO feature for this |
| Every alert goes to everyone | Each team owns its service's alerts, with a **runbook** link: "what to do when this fires" |

## Summary

| Before | After |
|---|---|
| Problems found only if someone looks at a dashboard | Kibana checks every minute and notifies |
| — | Connectors: Server log and Index (free); Slack/Email with a license |
| — | Elasticsearch query rule on **logs**: too many declines |
| — | APM latency rule on **traces**: slow payments |
| — | `DECLINE_RATE` and `EXTRA_DELAY_MS` to inject faults and test alerts |

## Exercises

1. **Recovery.** Trigger rule 1, then fix the bank. How long does it take to go from Active to Recovered? Why that long? (Hint: time window.)
2. **Tune the threshold.** With the normal 30% decline rate and `generate-traffic.sh 200`, how many declines happen in 5 minutes? Is 5 a good threshold? What would you pick, and why?
3. **Use `context.link`.** Add `{{context.link}}` to rule 1's message. Trigger it, copy the link from the Kibana log, open it. Where does it take you?
4. **Snooze.** Snooze rule 2 for 1 hour, trigger it, and check: is the alert still created? Is the action still run?
5. **A third rule.** Create an Elasticsearch query rule for `level : "error"` on **any** service, but with a **group by** `service.keyword` (top 5). Trigger declines: how many alerts do you get, and why is grouping useful?
