# Program Capacity

An authenticated NestJS backend and React operator workspace for invoice capacity reservation, full release and version-aware treasury reconciliation over Kafka. The API follows the self-contained NestJS Developer / NestJS Core standard. The interface uses an original Program Capacity identity with a light, blue-accented financial dashboard inspired by the supplied visual reference.

## Open the workspace

```sh
docker compose run --build --rm tools npm run dev:prepare
docker compose up --build -d --wait
docker compose run --rm -T tools npm run dev:credentials
```

Open **http://localhost:8080** and sign in with the locally generated credentials. The preparation command adds missing demo credentials to ignored `.dev/runtime.env` without replacing existing secrets. The seed creates the demo operator with USER and TREASURY roles, preserving an existing account and password. No credentials or tokens are embedded in the frontend bundle.

The workspace contains Overview, Reservations, Activity and Treasury. Choose a program from the selector. Each program begins in `RECONCILIATION_REQUIRED` after a service start. In **Treasury → Local demo controls**, click **Apply fresh snapshot** and wait for **Applied** before creating new reservations. Viewing a page never creates financial operations. The second program is reconciled independently.

The web container serves local static assets and proxies `/api/v1` to the existing API and `/demo-api` to the internal-only demo publisher. The API remains available on port 3000. The React package lives in `web/`, has a separate lockfile and uses plain CSS, self-hosted Inter and locally saved decorative images generated through the ChatGPT website. Its build and runtime use the existing pinned Node.js 24 base image.

### Browser session and commands

The access token stays in memory and the rotating refresh token stays in tab-scoped `sessionStorage`. A shared rotation request handles concurrent expiry; page reload restores the session through the normal refresh endpoint. Successful logout revokes the PostgreSQL session and clears all workspace state. A failed infrastructure request to logout is reported without claiming revocation succeeded.

Money and versions remain decimal strings; amount validation and display calculations use bigint minor units. Cross-currency reservation displays the **saved** FX rate and source after creation. FX quotes are fixtures, not live market data. Reserve and release retain the same idempotency key after an unknown/network outcome. Retry the exact request to retrieve its durable result; changing the invoice or amount constitutes a new command.

Reads refresh after commands, on window focus and every ten seconds while visible. A resource never has overlapping background polls. Lists include loading, empty, forbidden, validation, business-conflict and infrastructure-error states. Financial operations are always authorized by the API, even when their controls are hidden or disabled in the browser.

### Kafka demo from the interface

The local `demo-tools` container is a Kafka producer with no database connection or direct financial writes. It checks the current session and treasury permission on the exact core API resource before publishing, accepts only the two seeded demo programs in `demo-tenant`, validates the existing event schema and rejects envelopes exceeding 2 MiB. It has no published host port. Set `LOCAL_DEMO_ENABLED=false` when starting Compose to disable publication; this tool is intended solely for local demonstration.

1. Apply a fresh snapshot for the first program.
2. Publish a new program limit, then reserve an invoice in EUR from Reservations.
3. Capture a snapshot in Treasury. Create another reservation, then publish the captured snapshot.
4. Observe **State version conflict** in the durable event history. The reservation remains present and new reservations are paused.
5. Apply a fresh snapshot to recover, then release the invoice from its detail dialog.

**Published** means Kafka acknowledged delivery. **Applied** and rejection reasons come from the committed PostgreSQL inbox. An unknown publication can be retried with the exact same stored event ID/envelope. **Check result** reads the inbox without publishing again. A reconnection alone does not restore readiness.

### Additional read APIs

All routes require an active session and use the existing success/data/meta, numeric-error and 422-validation contracts. Collection queries accept `page` (default 1) and `perPage` (default 10, maximum 100). Tenant scope is enforced inside DA queries.

| Route after `/api/v1` | Access | Notes |
| --- | --- | --- |
| `GET /programs` | capacity read | Capacity summary and active count, ordered by ID |
| `GET /programs/:programId/reservations` | capacity read | Includes terminal rows; optional `status`, `currency`, case-insensitive invoice substring `invoiceId`; newest first with ID tie-breaker |
| `GET /programs/:programId/movements` | capacity read | Signed decimal-string deltas, newest state version first; internal actor/operation identity omitted |
| `GET /internal/programs/:programId/treasury-events` | treasury reconcile | Optional UUID `eventId`; newest first with ID tie-breaker; no payload, raw bytes, coordinates or fingerprints |

Program discovery reads all collection pages; the selector has no fixed 100-program truncation. Snapshot export uses the complete consistent reconciliation view and never reconstructs it from a paginated reservations list.

### Frontend verification

```sh
npm ci --prefix web
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix web test
npm --prefix web run build
npx --prefix web playwright install chromium
docker compose build app web
npm run web:test
```

`web:test` owns an ephemeral `app_test_web` database, a Kafka broker, and separate Node.js 24 API/demo/web containers. It never resets development Compose databases. Browser scenarios cover real login/refresh/logout, roles and tenant isolation, FX reserve/release, a lost response followed by the same idempotency key, error presentation, actual Kafka updates, stale snapshots and recovery. The harness also checks financial aggregates against reservations and the movement ledger, idempotency and inbox results. Targeted HTTP fault injection covers transport failures; ordinary financial and Kafka scenarios use the actual services.

Responsive checks cover 1440, 1280, 768 and 390 px, keyboard dialog focus and local asset loading. Set `WEB_SCREENSHOT_DIR` to save visual verification screenshots. Browser dependencies run on the test host; application containers use Node.js 24. Docker Engine must be running. For local frontend development use `npm --prefix web run dev` with the API on port 3000 and explicitly configured access to demo-tools; the default complete workflow remains Compose on port 8080.

## Run locally

Use Docker Desktop with Linux containers. From this directory:

```sh
docker compose run --build --rm tools npm run dev:prepare
docker compose up --build -d --wait
# Optional CLI-only demonstration:
docker compose run --rm tools npm run demo
```

Preparation creates two distinct signing secrets in ignored `.dev/runtime.env` and preserves an existing file. Compose mounts it read-only into runtime containers. A separate one-shot migration job runs the checked-in migrations and non-destructive seed before starting `node dist/main.js`. PostgreSQL and Kafka use persistent volumes; `docker compose stop` preserves data.

The seed creates two USD programs for `demo-tenant` with a USD 10,000,000 limit, without overwriting existing programs. Initial state requires reconciliation. The demo issues a real PostgreSQL-backed session, publishes the initial snapshot, updates the limit, reserves EUR 1,250.50 as USD 1,375.55, demonstrates a stale snapshot conflict and fresh recovery, then releases the reservation. Each run uses new invoice/event IDs and deliberately sets the first demo program's limit to USD 10,000,000.

Host addresses: API `http://localhost:3000`, PostgreSQL `localhost:15432`, Kafka `localhost:19092`. Containers use `postgres:5432` and `kafka:9092`. Host ports bind to loopback. Local credentials are demonstration credentials.

Every process start, detected consumer failure or rebalance requires a fresh snapshot. Run the demo after a restart to recover the first program. The second remains blocked until independently reconciled.

## Architecture

The core was generated using the installed skill's `create-project.mjs`, then integrated into the existing project. Its transaction, HTTP, Auth/Users and CASL implementations are the basis of this application.

```text
src/
  main.ts
  config/environment.config.ts
  constants/ decorators/ filters/ guards/ helpers/ interfaces/ interceptors/
  core/
    app/
      app.module.ts
      create-application.ts
      app-bl-imports.ts
      app-da-imports.ts
      app-cl-imports.ts
    providers/
      prisma/ token/ casl/ fx/ kafka/
    routes/
      auth/ user/ capacity/ treasury/
        dto/ entities/
        layers/
          <feature>-bl/
          <feature>-da/
          <feature>-cl/     # capacity and treasury coordination
```

Controllers call BL services. BL services express use cases, and CL services coordinate multi-write reserve/release, idempotency and treasury reconciliation. DA repositories own Prisma model queries, SQL, row locking and tenant predicates. Module imports are explicit within each feature; all layers also register in the three app import arrays. Dependencies use constructor DI, with no manually assembled production repositories or hidden modules inside the bootstrap.

Only Config, Prisma and CASL root options are global. Auth and Users use BL/DA; simple operations have no empty CL layer. FX and Kafka are injectable providers. ESM aliases resolve source paths for TypeScript and `dist` paths for Node.

### Transactions

`PrismaService.$tx` opens an interactive transaction and rejects nested `$tx`; `$txe` reuses an explicit or ambient client. AsyncLocalStorage isolates concurrent contexts. `repository.$` follows the current context, and `repository.tx(explicitClient)` returns a separate view without mutating the singleton.

Financial commands additionally use `FinancialTransactionService`: READ COMMITTED, program `SELECT … FOR UPDATE`, 2-second lock timeout, 8-second statement timeout, 10-second transaction ceiling and up to three attempts for classified deadlock/serialization conflicts. Financial write methods require the explicit transaction client. Lock order remains idempotency/inbox → program → reservations in stable ID order. FX is obtained before the financial transaction.

The consistent reconciliation view uses read-only REPEATABLE READ. Audit, aggregates, reservations and idempotency/inbox outcomes commit atomically. Savepoints ensure a cross-program invoice race cannot partially apply a snapshot.

## HTTP v2 contract

All versioned endpoints use `/api/v1`. Success is `{ "success": true, "data": ... }`; paginated results use explicit `ApiResult` and add `meta`. False, zero and empty strings survive serialization. `Serialize(Entity)` and class-transformer expose only public response properties. A 204 response is empty.

Errors use `{ "success": false, "error": { "code": 409100, "message": "...", "details": { "reason": "INSUFFICIENT_CAPACITY", "requestId": "..." } } }`. DTO failures return HTTP 422 / code 422000 with field paths. Unknown fields, invalid amounts/scales, role/tenant injection and missing idempotency headers are rejected. Domain failures retain their HTTP status; unexpected exceptions return a safe 500.

| Endpoint after `/api/v1` | Required access | Success |
| --- | --- | --- |
| `POST /auth/sign-up` | Public account bootstrap | 201, public User |
| `POST /auth/sign-in` | Credentials | 200, token pair |
| `POST /auth/token/refresh` | Valid single-use refresh token | 200, new pair |
| `POST /auth/logout` | Active access session | 204 |
| `GET /users/me` | Own user, CASL read | 200 |
| `PATCH /users/me` | Own user, CASL update | 200 |
| `GET /programs/:programId/capacity` | Tenant capacity read | 200 |
| `POST /programs/:programId/reservations` | Tenant reservation write | 201 |
| `GET /programs/:programId/reservations/:reservationId` | Tenant capacity read | 200 |
| `POST /programs/:programId/reservations/:reservationId/release` | Tenant reservation write | 200 |
| `GET /internal/programs/:programId/reconciliation-view` | Tenant treasury permission | 200 |
| `GET /health` | Active access session | 200 |

`/docs`, `/docs-json` and `/docs-yaml` also require a valid session Bearer token, including static Swagger assets. Use a Bearer-capable client or the checked-in `openapi.json` for documentation. Container health checks remain local TCP checks. The public exceptions are the core's sign-up/sign-in/refresh bootstrap endpoints.

Reserve accepts `invoiceId`, decimal-string `amount`, and `currency`. Release accepts `{}` and always releases the stored amount. Commands require `Idempotency-Key`, 1–128 characters from letters, digits, `_ . : -`.

Selected errors:

| HTTP | Numeric code | Meaning |
| --- | --- | --- |
| 401 | 401000 / 401001 | Unauthenticated / invalid credentials |
| 403 | 403000 | Missing permission on an accessible resource |
| 404 | 404000 / 404001 | Missing/foreign resource / missing user |
| 409 | 409001 | Duplicate account email |
| 409 | 409100 | Insufficient capacity |
| 409 | 409101 | Invoice already financed |
| 409 | 409102 | Idempotency key reused with a different request |
| 409 | 409103 | Fresh reconciliation required |
| 409 | 409104 / 409105 | Active-count limit / exhausted version |
| 422 | 422000 | DTO/header validation |
| 503 | 503000 / 503100 | Transient service / FX unavailability |

### Auth, sessions and CASL

Sign-up accepts normalized email/password and optional first/last name. Passwords use bcrypt with a 72-byte UTF-8 ceiling. The database assigns USER; registration cannot choose roles, tenant or API client identity. New registrations receive a server-generated tenant and client ID. Program provisioning remains a seed/integration responsibility.

Access and refresh JWTs use separate HS256 secrets, issuer/audience checks, expiration, `sub`, `sid`, token type and unique `jti`. Defaults: access 15 minutes, refresh 30 days. Sessions store only a refresh hash, expiry and revocation state in PostgreSQL. Atomic conditional refresh rotation permits one winner under replay/race. Logout revokes the session and both token types. Every authenticated request loads the active session and current roles/tenant/client ID from PostgreSQL.

USER permits own-user access, tenant capacity reads and reservation writes. READ_ONLY permits capacity reads; TREASURY permits capacity reads and reconciliation. APP_ADMIN gets the core's CASL manage permission; financial DA predicates still enforce the current tenant. Resource hooks check the actual program/reservation: foreign or absent resources return 404, missing rights on an accessible resource return 403. JWT claims cannot override database roles or tenant scope.

The local CLI provisions a development account/session using configured PostgreSQL and secrets. Its arguments remain tenant, comma-separated permissions and stable client ID:

```sh
docker compose run --rm -T tools node scripts/dev.mjs token
docker compose run --rm -T tools node scripts/dev.mjs token demo-tenant capacity:read read-only-client
```

A given tenant/client maps to a stable database identity. The CLI is an administrative development tool, requiring local database access; there is no HTTP token bypass.

### PowerShell example

Run the demo once to reconcile the program, then:

```powershell
$token = docker compose run --rm -T tools node scripts/dev.mjs token
$headers = @{ Authorization = "Bearer $token"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$base = 'http://localhost:3000/api/v1/programs/11111111-1111-4111-8111-111111111111'
$body = @{ invoiceId = [guid]::NewGuid().ToString(); amount = '1250.50'; currency = 'EUR' } | ConvertTo-Json
$reservation = (Invoke-RestMethod "$base/reservations" -Method Post -Headers $headers -ContentType 'application/json' -Body $body).data
Invoke-RestMethod "$base/capacity" -Headers $headers
$headers['Idempotency-Key'] = [guid]::NewGuid().ToString()
Invoke-RestMethod "$base/reservations/$($reservation.id)/release" -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
```

## Financial semantics

Money uses PostgreSQL BIGINT / TypeScript bigint minor units; JSON amounts and versions are strings. Scales: JPY 0, USD/EUR/GBP 2, KWD 3. Amount parsing rejects scientific notation, negative/zero invoice amounts, excess decimals and overflow.

FX direction is program major units per invoice major unit. The reserved amount is `ceil(invoiceMinor × rate × 10^programScale / 10^invoiceScale)`, using exact decimal arithmetic. FX is fixed on reservation; release never quotes again. Identity FX bypasses the provider. Fixture rates into USD are EUR 1.10, GBP 1.25, JPY 0.0067 and KWD 3.25. Quotes expire after 60 seconds. Fixtures are not market rates; unsupported pairs fail explicitly.

`Program.reservedMinor` equals the active reservation sum. Availability is `max(0, limit − reserved)` and over-limit is `max(0, reserved − limit)`. Treasury can lower a limit below existing reserves; new reserve fails and release remains available. Tenant-wide invoice uniqueness persists after RELEASED or RECONCILED_CLOSED. Database checks, composite foreign keys and history triggers protect financial relationships and append-only movements.

Idempotency scope remains tenant + stable database client ID + key. Fingerprints include method, action/resource and normalized body. Successes and final business refusals are durable; transient failures roll back. Replay returns original content, including historical state, without FX or another financial effect. Current state comes from GET. Numeric HTTP errors and the success envelope are applied at the HTTP boundary; stored financial outcomes remain intact.

## Treasury protocol

Topic `treasury.capacity.v1`, key `tenantId:programId`. Source identity comes from integration configuration. The event schema lives in `core/routes/treasury/types/treasury-event.types.ts` and is unchanged by the architecture migration:

```json
{
  "eventId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "schemaVersion": 1,
  "type": "ProgramLimitUpdated",
  "tenantId": "demo-tenant",
  "programId": "11111111-1111-4111-8111-111111111111",
  "treasuryRevision": "2",
  "occurredAt": "2026-10-26T12:00:00.000Z",
  "payload": { "currency": "USD", "limit": "10000000.00" }
}
```

An incremental revision must equal `lastApplied + 1` in READY. Gaps and conflicting event/revision content require reconciliation; older covered revisions never roll back state. Highest-seen revisions are tracked separately, including valid unapplied events. Malformed messages and conflicting deliveries are quarantined durably with original bytes and Kafka coordinates.

For recovery, obtain the protected reconciliation view. Its version, limit, revisions and complete active reservation list share one REPEATABLE READ snapshot. Build the full treasury snapshot from that exact view and accounted local operations; preserve monetary and FX metadata. Publish a fresh event ID and revision above highestSeen:

```json
{
  "eventId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "schemaVersion": 1,
  "type": "ProgramStateSnapshot",
  "tenantId": "demo-tenant",
  "programId": "11111111-1111-4111-8111-111111111111",
  "treasuryRevision": "3",
  "occurredAt": "2026-10-26T12:01:00.000Z",
  "payload": { "currency": "USD", "limit": "10000000.00", "baseStateVersion": "0", "reservations": [] }
}
```

Values above are illustrative: use actual view values. Each nonempty row is the complete reservation DTO from the view with ACTIVE status and null closedAt. An empty list means no active reservations. Attaching a fresh version to an independently prepared old snapshot violates the protocol.

Under the program lock, the service validates all rows and exact baseStateVersion. A conflict commits only rejection/synchronization metadata and preserves financial state. A successful snapshot restores missing active rows, closes omitted rows, recomputes the aggregate and sets READY. Terminal invoices cannot be revived or their FX rewritten.

Snapshots are bounded to 1,000 active rows and 2 MiB UTF-8 bytes; reserve enforces the active-count ceiling and views are never truncated. Kafka allows 3 MiB records; consumer fetch bounds are 3 MiB per partition and 6 MiB total. Larger programs require a staging protocol. Transactions retain the 10-second ceiling.

Processing is sequential per partition, with up to three partitions in parallel. Auto-commit and automatic batch resolution are disabled. A durable PostgreSQL application/rejection/quarantine precedes explicit commit of the next offset. Failed database work cannot acknowledge the failed or later message. A crash between DB commit and offset commit safely replays via inbox deduplication: at-least-once delivery plus idempotent PostgreSQL application.

Readiness closes on known disconnect/crash/rebalance or after 15 seconds without successful heartbeats. Reconnect alone does not clear required reconciliation. Reads and full release remain available when the database is available. Last-applied time is diagnostic and does not prove absence of Kafka lag.

## Migration from the original layout

The first two migrations are unchanged. Migration `202610260003_auth_core` adds only User/Session/Role storage. Existing financial rows, audit, idempotency results and inbox/quarantine entries are preserved. Startup changes synchronization metadata as before. Financial state was compared by row counts and hashes before and after the local migration.

HTTP clients must adopt `/api/v1`, success/data, numeric errors and DTO 422. Old RS256 development JWTs are replaced by active-session access tokens; old PEM files are unused and remain ignored. The local tenant/client arguments map to the same client ID, allowing previous idempotency results to replay under the new session model. New public users receive independent server-generated tenant/client IDs. No legacy-route aliases are retained.

Task-specific adaptations to the core: health/docs require authentication; issuer/audience/mandatory expiration checks are retained; CASL hooks preserve financial 404 tenant isolation; financial writes keep explicit clients and bounded row-lock transactions. These adaptations are covered by behavioral tests.

## Verification

```sh
docker compose run --rm tools npm run typecheck
docker compose run --rm tools npm run lint
docker compose run --rm tools npm run check:architecture
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal program-capacity-service:local npm test
```

On native Linux omit the host override or set a reachable Docker host. With Node.js 24 installed locally: `npm ci`, `npm run build`, `npm test`. `npm test` owns fresh PostgreSQL containers named `app_test_*`, applies migrations only there, runs the included core tests with TEST_DATABASE_URL, then runs the preserved financial suites against separate disposable PostgreSQL and Kafka. It never resets a supplied development database. `npm run test:unit`, `npm run test:integration` and `npm run test:core` are available separately.

Coverage includes HTTP contracts, DTO paths, hidden fields, pagination/falsy/204/streams, Auth refresh races and logout, current database roles, CASL tenant resources, ambient/nested/explicit-client transactions, independent-client financial concurrency, full rollback, idempotency replay, FX rounding/scales, snapshot conflicts/recovery/bounds, Kafka quarantine/offset failure/restart and consumer outage. The architecture checker checks paths, registrations, layer dependencies and runtime import cycles; runtime tests additionally validate DI and behavior.

Regenerate the checked-in OpenAPI with `npm run openapi` after building and configuring the environment, or export it from the tools container with `OPENAPI_OUTPUT` pointing to a writable bind mount.

## Limits and production work

The service is the sole admission writer for managed capacity. Upstream approves invoices; there is no payment processing or invoice authenticity check. Releases are full only; refinancing, partial repayments and program currency changes remain outside v1 business scope. Auth/Users are the new core's account/session baseline; broader IAM and tenant provisioning are not implemented.

Treasury must support the version-aware view/snapshot protocol. Continuous concurrent changes can require repeated reconciliation; an independent treasury needs a separate watermark/replay design. One application instance owns local consumer readiness; replica-wide coordination is additional work.

Production needs real FX, managed signing-secret rotation, Kafka TLS/SASL/ACLs, separate DB migration/runtime roles, retention/quarantine operations, backups, monitoring, resource limits and a reduced runtime image. Jest ESM uses experimental VM modules; KafkaJS 2.2.4 can emit its upstream TimeoutNegativeWarning during request-queue scheduling. Warnings remain visible in test output.
