# Dongo Storefront — hardening checklist

This checklist describes the current Compose demo and the additional work required before an Internet-facing deployment. A checked item means it is present in the repository/configuration; it is not a security certification.

## Present in the demo configuration

- [x] Root `.env` is ignored; `.env.example` contains placeholders only.
- [x] Compose publishes the storefront and management UIs on `127.0.0.1`, not all host interfaces.
- [x] Backend is not published directly; Nginx is the public entry point for the local demo.
- [x] MySQL database network and monitoring network are internal Compose networks.
- [x] Backend runs as non-root with read-only root filesystem, temporary storage, dropped Linux capabilities, and `no-new-privileges`.
- [x] Frontend and Nginx use read-only filesystems and dropped capabilities where configured.
- [x] The public Nginx response applies a Content-Security-Policy for same-origin scripts/API, the storefront's HTTPS images, and its Google Fonts; HSTS is not enabled without TLS.
- [x] MySQL exporter uses a restricted monitor account; its password is written to a mode-restricted temporary client file, not command arguments.
- [x] Grafana Alloy mounts application log volumes read-only; it does not mount the Docker socket. It imports Promtail positions from a read-only mount when a legacy positions file exists, then stores its own positions in a separate volume.
- [x] Backend request logs omit bodies, cookies, and authorization headers; Nginx access logs omit client IP and query string.
- [x] Order prices are recalculated by the backend; admin authorization is enforced by API middleware; VNPay payment state requires a verified IPN.
- [x] SQLite backup/restore tooling verifies SQLite snapshots and requires confirmation before restore. It does not back up MySQL.

## Required before production

- [ ] Replace demo HTTP with TLS termination and a reviewed HTTPS configuration. Do not enable HSTS until HTTPS is correctly enforced.
- [ ] Set production cookie options (`Secure`, suitable `SameSite`), `NODE_ENV=production`, exact CORS origins, and only trusted proxy hops.
- [ ] Generate unique high-entropy credentials for MySQL, monitor user, Grafana, and session signing; store them in a secrets manager and define rotation procedures.
- [ ] Restrict or remove phpMyAdmin, Grafana, Prometheus, and other management endpoints from public access; add authentication/network controls appropriate to the deployment.
- [ ] Review firewall rules, ingress allowlists, rate limits, request-size limits, security headers, and dependency/image update policy.
- [ ] Review user, writeable filesystem, and capability settings for every stateful/admin/monitoring service; cAdvisor host mounts require particular care.
- [ ] Establish MySQL backup, retention, encryption, off-host storage, restore drills, and recovery objectives. A persistent Docker volume is not a backup.
- [ ] Verify log redaction against real traffic; do not put credentials, tokens, personal data, or sensitive identifiers in URLs or Loki labels.
- [ ] Add alert rules, notification routing, retention/capacity limits, and an operational response process.
- [x] Replace the default Promtail collector with Grafana Alloy v1.20.1; canary-tested against Loki and both LogQL streams. Keep the legacy Promtail config/positions volume for rollback.
- [ ] Validate per-container metrics on the target deployment. The current Docker Desktop run exposed only Linux VM host series through cAdvisor.
- [ ] Run security review, integration/load tests, and a restore rehearsal against the actual deployment environment.

## Operational cautions

- The Compose stack is for local demonstration, uses HTTP, and sets the session cookie for that environment. Do not expose its ports to the Internet.
- `docker compose down` preserves named volumes; `docker compose down -v` removes them. Confirm backup and intent before any volume deletion.
- The SQLite maintenance script is not a MySQL backup/restore mechanism. Do not switch `DB_DRIVER` for a database containing data without an explicit migration plan.
- The current MySQL init script for the exporter runs automatically only when the MySQL data volume is initialized for the first time. Existing volumes need a controlled grant procedure; do not delete a volume just to rerun initialization.
