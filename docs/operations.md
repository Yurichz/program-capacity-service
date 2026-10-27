# Operations runbook

This service has a local Compose environment and a verified-image release workflow. There is no configured remote deployment platform. Use the production platform's own controls when one is introduced; do not treat local demo commands as production recovery tooling.

## Observe safely

- Send an active Bearer access token to `/api/v1/health/ready`. A 200 means PostgreSQL and the local Kafka consumer are available and shutdown has not started. A 503 means the instance is not ready. Authentication itself requires PostgreSQL, so a database outage can fail before the readiness handler. `/health` and the Docker TCP healthcheck are liveness only.
- Read the affected program's capacity, complete reconciliation view and redacted treasury-event history through their protected APIs. Program `acceptingReservations` and `syncStatus` distinguish admission readiness from process readiness. A zero balance or over-limit program is not an infrastructure outage.
- Logs include request IDs (also returned as X-Request-Id), bounded caller correlation IDs, operation, program/reservation/event IDs, duration and outcome. Database failures expose safe Prisma/SQLSTATE identifiers, not SQL/parameters, connection URLs or secrets. Retain logs without adding raw request/message bodies.
- Locally, use `docker compose ps`, `docker compose logs app kafka postgres` and `docker compose logs migrate`. Local credentials and `.dev/runtime.env` must stay private. Never paste access tokens into issue reports.

## PostgreSQL outage

**Symptoms:** authenticated requests/readiness fail; transient operations return 503; treasury processing fails without committing the failed offset. A failed transaction leaves no partial reservation, movement or idempotency result.

**Recovery:** restore the existing database and connectivity; do not recreate it. Check the configured connection URL, database logs and connection limits. Retry an unknown HTTP command with the original key and identical body after connectivity returns. The original result may already have committed. The consumer must regain readiness and affected programs require a fresh snapshot. If the consumer cannot recover, perform a controlled application restart after restoring the database. Check aggregates and durable outcomes through the API; never repair money with ad hoc UPDATE statements.

## Kafka outage or processing failure

**Symptoms:** consumer crash/disconnect/rebalance or missing heartbeats; readiness closes, programs require reconciliation and new reservations return a reconciliation conflict. Reads and full release remain available while PostgreSQL works.

**Recovery:** restore the same broker/topic and configured group, then verify connectivity. Offsets advance only after a durable database result. Redelivery of an already persisted event has no second financial effect. Reconnection alone does not clear reconciliation. If a consumer has exhausted recovery, restart the application safely, inspect highestSeen revision and obtain a new valid full-state snapshot. Do not manually advance offsets to bypass failures.

Malformed events are quarantined with original bytes/coordinates in PostgreSQL; public event history does not expose them. There is no automatic quarantine replay/deletion command. Investigate through authorized database access. Correct the source and publish a protocol-valid new event; preserve original evidence. For a successful event whose delivery was uncertain, resend the exact envelope/event ID rather than creating a second logical operation.

## Reconciliation conflict

**Symptoms:** `RECONCILIATION_REQUIRED` and durable result such as STATE_VERSION_CONFLICT, REVISION_GAP or REVISION_CONFLICT. A rejected stale snapshot preserves newer financial state.

**Recovery:** obtain `/api/v1/internal/programs/:programId/reconciliation-view` with treasury permission. Have the authorized treasury source account for local operations and produce a complete snapshot based on that exact consistent view. Use a new event ID and revision above highestSeen, preserve saved money/FX data and publish with key tenantId:programId. Poll the exact event ID until APPLIED, then verify capacity/admission. Concurrent changes can require another fresh attempt. Never attach a fresh version to an independently prepared old snapshot.

The local workspace's **Apply fresh snapshot** control supports only its seeded programs. The CLI demo also uses local development identity provisioning. Neither is a generic production treasury command.

## Failed database migration

**Symptoms:** the migration process exits nonzero; local Compose prevents dependent app startup. `prisma migrate status` reports pending/failed migration state. The API runtime never automatically migrates.

**Recovery:** stop rollout and retain logs, the failed migration name and database backup information. From the exact intended release source/tools image run `npm run db:migrate` only after investigating the cause. Inspect status with `npx --no-install prisma migrate status`. A previously successful deploy is safe to repeat. A partially failed migration needs an explicitly reviewed, database-specific forward repair and Prisma migration-history resolution; do not blindly mark it applied or repeat destructive SQL. Test the repair on a disposable restored database first.

The checked-in migration harness proves clean/upgrade deployment and preservation of financial/session/inbox data. It does not prove a backup restore or every possible interrupted DDL state. Never run migrate reset or db push as production recovery.

## Failed deployment or image startup

**Symptoms:** runtime exits nonzero, protected readiness stays unavailable, or a representative smoke fails. There is no repository deploy.yml or automatic remote rollback.

**Recovery:** stop the platform's rollout and preserve logs. Verify the image digest against release evidence, required environment variables, database migration status and topic/connectivity. Use the prior verified application digest only when it is compatible with the current schema. Do not reverse migrations automatically. Any future deployment controller must serialize changes to one environment and run migrations as a controlled separate step. Zero downtime is not promised.

## Safe restart

Locally, `docker compose stop app` grants a 40-second shutdown window; `docker compose up -d app` starts it again. Do not remove volumes. The runtime receives SIGTERM directly (Compose also uses init), rejects new financial writes, stops/disconnects the consumer and attempts HTTP/database cleanup even after a shutdown-step error. Steps are bounded within a 35-second overall deadline; forced/incomplete shutdown exits nonzero. Unknown command outcomes remain recoverable through durable idempotency.

Every startup marks programs as requiring reconciliation. Check authenticated instance readiness and independently recover affected programs with fresh snapshots. Restart alone never authorizes new reservations. Smoke tests verify clean SIGTERM, preserved financial state and snapshot recovery against the final image.

## Replay, release and security policy

- Keep original HTTP keys/bodies and Kafka event envelopes after ambiguous outcomes. A replay can return historical content; use GET for current state.
- Do not delete terminal reservations, movement history, inbox or quarantine to make a retry succeed. History triggers intentionally reject mutation/deletion of protected financial records.
- Releases use the stored reserved amount/FX even when the quote provider or Kafka is unavailable. Reconciliation/consumer failure does not authorize duplicate releases.
- Use a published digest from the successful release run. Inspect its SBOM, scan reports and commit label. Releases reject existing semantic-version/commit tags and do not rebuild an image after verification.
- Registry pushes of the version and commit tags are not atomic. If publication fails after one tag is pushed, inspect that tag/digest and retained run evidence before an explicitly controlled repair. A rerun intentionally refuses to overwrite an existing tag; do not delete or retag it blindly.
- HIGH/CRITICAL scanner findings block verification. An exception, if ever necessary, must name a specific finding/package, document why it is acceptable and expire. This repository installs only the reviewed, expiring Debian package/version assessments in [security.md](security.md), with no blanket exceptions. A scanner download/connectivity failure is a failed check, not a clean scan.
- SQLSTATE 55P03/57014 and transaction/deadlock/connection failures are transient at the HTTP boundary. Only classified deadlock/serialization transactions are retried internally; clients retain the idempotency key for retry.

## CI troubleshooting

Run the exact failing npm command with Node from `.node-version`. Rebuild before testing; stale dist artifacts can produce misleading contract failures. Confirm Docker is running and test database names start with app_test_. CI uses Testcontainers rather than the persistent local Compose volumes. Browser failures retain Playwright traces/screenshots; reports and unit/integration coverage are workflow artifacts. The `Required checks` job intentionally fails when any mandatory dependency failed, was cancelled or was skipped.

No GitHub check, package visibility, branch protection or remote deployment is configured by local tests. Set main's required check after observing its actual GitHub check name, restrict version tags, permit GITHUB_TOKEN package publication, and set GHCR access/visibility consistently with repository privacy before a deliberate release.
