# LogQL queries — Dongo Storefront

The default Compose definition uses Grafana Alloy to send backend and Nginx JSON access logs to Loki. The currently running projects `dongo-acceptance-222040` and `dongo-observability-check` use Promtail 3.5.0 with the equivalent scrape paths and labels. Run these examples from **Grafana → Explore → Loki** and choose a time range that includes recent requests.

Each Compose project has its own log volumes, network, and Loki data volume. The default Compose stack uses Alloy, and the existing acceptance/observability stacks use Promtail. The course-demo logging overlay below deliberately uses Promtail for the rubric criterion; it does not imply Alloy and Promtail are interchangeable.

The course-demo overlay runs the rubric-specific Promtail agent and its own Loki. It reads both the Nginx access-log volume and the backend JSONL volume read-only; the backend writes `/var/log/dongo/backend.jsonl` to the external named volume `dongo-course-demo_backend_logs`.

The overlay also declares the dedicated Grafana-Loki network as external, so create it once before starting Loki:

```powershell
docker network create --driver bridge --internal dongo-course-demo_grafana_loki
```

```powershell
docker compose -p dongo-course-demo -f docker-compose.course-demo-logs.yml up -d loki promtail
```

This uses the existing internal `dongo-course-demo_monitoring` network and external log volumes; Loki storage and Promtail positions use separate project volumes. Nginx and backend log mounts in Promtail are read-only, and no Loki/Promtail host ports are published. If the backend image is stale and lacks `backend/server/logger.js`, rebuild and update only that service from the main Compose file before expecting file logs:

```powershell
docker compose -p dongo-course-demo build backend
docker compose -p dongo-course-demo up -d --no-deps --no-build backend
```

The acceptance Grafana can query course-demo Loki without publishing Loki by connecting it to the dedicated internal network `dongo-course-demo_grafana_loki`. The Compose overlay attaches Loki to this network; attach Grafana:

```powershell
docker network connect dongo-course-demo_grafana_loki dongo-acceptance-222040-grafana-1
```

The overlay connects Loki to this network when it starts. Keep only Grafana and Loki on it; do not connect Grafana to the broader `dongo-course-demo_monitoring` network, which also contains backend and reverse-proxy. Create a Loki datasource with UID `loki-course-demo` and URL `http://dongo-course-demo-loki-1:3100`. Do not use `http://loki:3100` from Grafana: that alias resolves to the acceptance Loki. Grafana's network attachment is runtime state and must be restored if Grafana is recreated. The configured datasource remains separate from the existing `loki` datasource.

To stop only the course-demo log services without deleting volumes, run:

```powershell
docker compose -p dongo-course-demo -f docker-compose.course-demo-logs.yml stop promtail loki
```

## Streams and common filters

```logql
{job="backend"} | json
{job="nginx"} | json
```

The course-demo Promtail jobs attach low-cardinality labels: `project`, `job`, `service`, `method`, `status`, `upstream_status` (Nginx), and `level` (backend). Paths and request IDs are not labels. Use labels to narrow the stream before parsing fields.

## Backend

```logql
# Backend error-level events (Pino level >= 50)
{job="backend"} | json | level >= 50

# Backend HTTP failures
{job="backend", status=~"5.."} | json

# Health endpoint requests
{job="backend"} | json path="req.url" | path = "/api/health"

# Narrow to a request method
{job="backend", method="POST"} | json
```

The backend path is nested in Pino's `req.url`, so the LogQL JSON parser needs the explicit `path="req.url"` alias shown above. Do not put secrets or personal data in URL query parameters. Request bodies, cookies, and authorization headers are not intended to be logged.

## Nginx

```logql
# Successful requests
{job="nginx", status="200"} | json

# Proxy/server errors
{job="nginx", status=~"5.."} | json

# Requests taking at least one second
{job="nginx"} | json | request_time >= 1

# Requests where the upstream also returned a 5xx status
{job="nginx", upstream_status=~"5.."} | json

# Course-demo Nginx 404 requests (Promtail overlay)
{job="nginx", project="dongo-course-demo"} | json | __error__="" | status="404"
```

Nginx access logs omit the query string and client IP. `request_time` is parsed as a numeric field; `status` and `upstream_status` are labels.

## Course-demo end-to-end verification

On 2026-10-16, the backend image was rebuilt from the current Dockerfile after verification showed that the running image did not contain `logger.js`. Only the backend was recreated; MySQL and its data volume were unchanged. A harmless GET to an unknown `/api/health/loki-backend-probe-<token>` route returned 404 and produced a matching JSONL record. A separate storefront GET to `/loki-nginx-probe-<token>` returned 200 and produced a matching Nginx JSON access-log record. The Nginx query uses a path token because the access log records `$uri` and intentionally omits query strings.

Both course-demo jobs were `1/1 ready`. Through the Grafana API using datasource `loki-course-demo`, each of the following probe queries returned exactly one log row:

```logql
{job="backend", project="dongo-course-demo"} |= "loki-backend-probe-<token>"
{job="nginx", project="dongo-course-demo"} |= "loki-nginx-probe-<token>"
```

These JSON parse-error queries returned zero rows:

```logql
{job="backend", project="dongo-course-demo"} | json | __error__!=""
{job="nginx", project="dongo-course-demo"} | json | __error__!=""
```

Grafana reported datasource health `OK`; the existing `dongo-operations` dashboard and its backend panel were left unchanged. Its current panel still queries the existing `loki` datasource, while course-demo logs are available through Explore using `loki-course-demo`. The shared dashboard is provisioned for multiple Grafana projects, so no panel tied to a datasource UID unavailable in the other projects was added.

## Operational checks

- Check which agent is running before troubleshooting: the default Compose service is `alloy`, while existing acceptance projects may still run `promtail`. Inspect only the matching service logs, for example `docker compose logs --tail 100 alloy loki` or `docker compose logs --tail 100 promtail loki`.
- Generate a harmless website/API request and widen the Explore time range. Agents read named log volumes; separate Compose projects do not share those volumes automatically.
- Keep labels low-cardinality. Do not add user IDs, emails, order IDs, full URLs, or arbitrary request fields as Loki labels.
- Loki uses a local filesystem volume and the configured retention period is 168 hours (7 days); this is not a durable audit archive. Loki's HTTP API is internal to its Compose network.
- All three running Loki instances were version 3.5.0 and continued to log `negative structured metadata bytes received` with `size=0`. The Promtail configs contain no structured-metadata stage; course-demo probe queries succeeded and its current Promtail drop counters were zero, but the warning remains unresolved and should not be hidden or described as fixed.
- Historical Promtail HTTP 500 retries in the acceptance and observability projects explicitly reported that no live ingester replica was available (`127.0.0.1:9096`). The current course-demo ring reports one active ingester and its probes are queryable, but the historical intermittent ring failures are not proven permanently resolved.
- Alloy v1.20.1 is the default Compose agent; the Promtail config and positions volume remain for compatibility/rollback. Promtail reached EOL on 2026-03-02: [Grafana Promtail documentation](https://grafana.com/docs/loki/latest/send-data/promtail/).
