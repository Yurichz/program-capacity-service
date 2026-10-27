# Final assessment after UUID fix — 27 October 2026

**Verdict: ready to submit within the documented single-runtime assignment scope, with the protocol and evidence limits below.** The only confirmed application defect from the independent audit, F-01 / AUD-UUID-01, is now closed by an independently rerun regression. No unclosed confirmed financial, data-loss or auth/tenant-bypass defect remains from this audit. Preliminary weighted assessment: **8.4/10** (unrounded8.35), medium-high confidence for this scope; this is not production certification.

The original [baseline report](README.md), [baseline evidence](evidence.json) and failing TAP remain historical evidence. Current grouped results are in [current matrix](test-matrix-current.json) and [post-fix manifest](post-fix-evidence.json).

**Exact state.** HEAD remains `65d837b073bcf1b2424ccf12a7f8cadc14fa9ea6`. The user's UUID fix is uncommitted in `src/core/routes/treasury/layers/treasury-cl/treasury-cl.service.ts`; eight related regression cases were added to `test/financial/integration.test.mjs`. The reviewer did not change either file. The manifest fingerprints their contents to identify the reviewed working-tree state. Original audit baseline was8f6cd01, followed by the separately reviewed CI-only commit65d837b.

**Fix review.** `prepareSnapshot` now normalizes local copies of reservation `id` and `programId` before sorting, duplicate detection, comparisons and restoration. The original event payload and fingerprints remain unchanged. Tenant and invoice IDs retain case-sensitive semantics. Added cases verify uppercase reservation/program IDs, saved payload/fingerprints, exact replay without additional financial effects, restoration of missing rows, duplicate UUID spellings, genuine foreign-program rejection and case-sensitive tenant/invoice IDs. The original independent failing test now passes without changing its assertion.

**Fresh post-fix runs.** All commands below returned exit0 against the corrected working tree. No repeated-run counts are added together.

| Runner | Pass | Fail |
| --- | ---: | ---: |
| Core node:test | 19 | 0 |
| Financial Jest unit | 19 | 0 |
| Financial Jest integration, including8 fix cases | 29 | 0 |
| Independent financial/auth audit | 7 | 0 |
| Independent real Kafka crash/quarantine/rebalance audit | 4 | 0 |
| Web node:test | 2 | 0 |
| Playwright against corrected API/tools images | 5 | 0 |
| **Runner total** | **85** | **0** |

Counts include node:test parent aggregates and two successful risk-characterization cases. They are not85 exhaustive independent business cases. The financial model includes360 operations, not360 extra runner tests. The mutation negative control is also not added to this total.

Fresh generation, API typecheck/build, root lint and architecture checks passed (96 source files, no architecture findings). New API/tools images were built from the dirty working tree with explicit local tag `audit-uuid-fixed-20261027`; the API revision label is `65d837b-dirty-uuid`, avoiding a false clean-commit identity. The unchanged web image uses the earlier audit tag. The corrected API image passed production smoke, real Kafka, CLI demo, nonroot/runtime hardening, empty-source runtime, SIGTERM/restart and reconciliation. Browser tests passed login/token rotation/logout, real Kafka reconciliation, cross-currency reserve/release, lost HTTP response, roles/tenants and responsive layouts. Fresh Trivy scan of the corrected API image passed the existing HIGH/CRITICAL policy gate.

**Earlier evidence still applicable.** Dependency manifests, migration files, Dockerfiles and web source did not change in the fix. The original audit proved clean migration deployment, representative upgrade preservation, repeated deployment, zero schema drift and SQL guards. Original source was also tested in the pinned Node26.12.1 tools container. The targeted mutation control killed a ceil-to-floor FX mutation in an isolated copy. Baseline financial coverage was88.24% lines /87.21% branches within the selected collection scope; these are baseline percentages, not recollected post-fix coverage. The original short load measurements were179.9ops/s, p95 41.4ms for one program and325.2ops/s, p95 15.0ms for four programs, each48 operations/concurrency4 on the documented local environment. They are not an SLA.

**Critical behavior established across the audit.**

- Program row locks across two independent Node processes prevent oversubscription. Five controlled lock-barrier repetitions admit one700 reserve against1000. Concurrent releases create one financial release. Another program remains independently writable.
- The independent bigint model checks reserve/release/retry/limit changes, fixed EUR conversion, aggregates, active rows, ledger, versions and availability after each of360 operations.
- The real consumer survives actual SIGKILL after durable DB commit but before broker offset commit. A new process replays without duplicating reservation/movement/version. Quarantine persistence failure blocks the failed and later message; restoration and restart safely replay both. Two live consumer members reassign the partition after its owner leaves.
- Fresh snapshots restore admission; stale baseStateVersion does not overwrite newer local operations. Terminal invoices, immutable money/FX, invoice uniqueness and atomic financial rollback remain protected.
- Authentication uses actual PostgreSQL sessions and current database roles. All14 private documented operations and three Swagger endpoints reject unauthenticated requests. Claims/signature/algorithm/issuer/audience/expiration/nbf, revoked permissions, tenant scope and stable idempotency across refresh are exercised.

**Remaining risks, not confirmed application failures.**

1. Malformed JSON with a valid resource key is quarantined and acknowledged while the program stays READY. The policy does not explicitly state whether the key alone should force reconciliation. No overspend or loss was demonstrated.
2. Invalid payload at a recognizable revision10 does not raise highestSeen; a fresh recovery revision2 can be accepted. Define the trust boundary for malformed-envelope revisions before choosing different behavior.
3. Financial Jest coverage collection excludes AuthGuard/Auth core/CASL/Kafka consumer. Behavioral tests exercise these components; coverage percentages do not quantify their branches.
4. Web shutdown has no explicit overall deadline for slow active connections. This remains a static availability concern without a runtime reproduction.

Four evidence records remain NOT RUN: actual GitHub runs/settings; production SIGTERM at the exact in-flight transaction/message window; slow-active-connection web shutdown; generated arbitrary snapshot/fault property sequences. Current matrix:43 PASS,0 FAIL,4 NOT RUN,1 NOT APPLICABLE,0 BLOCKED. F-01 is retained in the original matrix as a historical FAIL and recorded as resolved in the current matrix.

**Security limits.** Gitleaks found no leaks in18 local commits during baseline scanning. Both lockfiles had zero unsuppressed HIGH/CRITICAL findings. API and web runtime scans retain57 suppressed OS findings across12 CVEs per image, under the existing exact-package/version/architecture exceptions expiring2026-11-27. The corrected API was rescanned and still passes that policy. A passing gate does not mean zero vulnerabilities. The CI/release workflows were statically reviewed and actionlint passed; real GitHub execution, branch protection and registry publication were not confirmed or changed.

**Updated scores.** Only the Kafka/reconciliation score changes after closure of F-01; unresolved protocol questions and evidence limits remain reflected in it.

| Category | Weight | Score |
| --- | ---: | ---: |
| Financial correctness and concurrency | 30% | 9.0 |
| Kafka, reconciliation and recovery | 25% | 8.0 |
| Authentication, isolation and security | 15% | 8.0 |
| Test quality and reproducibility | 10% | 8.0 |
| Docker, migrations and CI/CD | 10% | 8.0 |
| Architecture, readability and documentation | 10% | 8.5 |

Strong interview topics: database serialization, durable idempotency/inbox/quarantine, saved FX and consistent reconciliation. Questions to prepare: malformed-envelope trust, treasury source authority, single-runtime readiness coordination, retention, snapshot protocol coordination and local-versus-GitHub evidence. No employer decision is predicted.

Before submission: document the two protocol decisions and present the exact tested state consistently. Desirable: extend critical coverage and test graceful production shutdown with work in flight. Optional: sustained load/soak tests and broader generated state/fault sequences. No Kubernetes/Redis/cloud/partial-release expansion is necessary for the assignment.

**Fresh commands.** Build first; all DB harnesses own disposable app_test_* infrastructure. Do not run ordinary development database resets.

```powershell
npm run db:generate
npm run typecheck
npm run build
npm run lint
npm run check:architecture
node scripts/test.mjs
node --test --test-reporter=tap test/verification/financial-audit.test.mjs
node --test --test-reporter=tap test/verification/kafka-crash.test.mjs
npm --prefix web test
docker build --target runtime --build-arg REVISION=65d837b-dirty-uuid -t program-capacity-service:audit-uuid-fixed-20261027 .
docker build --target tools -t program-capacity-tools:audit-uuid-fixed-20261027 .
$env:APP_IMAGE='program-capacity-service:audit-uuid-fixed-20261027'
$env:TOOLS_IMAGE='program-capacity-tools:audit-uuid-fixed-20261027'
$env:WEB_IMAGE='program-capacity-web:audit-20261027-8f6cd01'
node scripts/test-smoke.mjs
node scripts/test-web.mjs
```

The audit's standalone suites still require explicit invocation; existing npm test runs the core/Jest suites. New follow-up report/evidence files are under reports/verification. No commits/pushes, publication, remote deployment, repository settings or production data changes were performed by the reviewer.
