# Independent verification — 27 October 2026

**Latest status: F-01 was fixed by the user and independently reverified. All85 runner results now pass, including corrected production-image/browser and real Kafka checks. Updated verdict and score: ready to submit within documented assignment scope, preliminary8.4/10. See the [final post-fix assessment](post-fix.md), [current matrix](test-matrix-current.json) and [post-fix evidence](post-fix-evidence.json). The report below preserves the original pre-fix findings and results.**

**Verdict: fix the confirmed UUID reconciliation defect before submission.** The demonstrated single-instance financial core is strong: no double reserve/release, accepted-operation loss, wrong FX or authentication/tenant bypass was reproduced. This is an assignment assessment, not production certification. Preliminary weighted score: **8.2/10**, with medium-high confidence within the tested scope.

The report deliberately retains one failing regression test. Passing characterization tests below establish observed behavior, not an approved security or recovery policy.

**Baseline and provenance.** Audit started on clean commit `8f6cd013a838a954641157e5bf2738484523457b`. During the audit, an external commit advanced HEAD to `65d837b073bcf1b2424ccf12a7f8cadc14fa9ea6` (`fix: speed up Chromium setup in CI`). The auditor created no commits. The only intervening tracked change is `.github/workflows/ci.yml`; API/web source, lockfiles, Prisma, scripts and Dockerfiles are byte-identical between these commits. Runtime image labels and original tests refer to `8f6cd01`. The new workflow delta received a second independent static review and actionlint run; its Ubuntu package-download steps were not executed locally.

Host: Windows 11 build 26200, Intel i9-14900KF, 32 logical CPUs, 64 GiB RAM, Node26.3.1/npm11.16.0. Pinned tools/runtime images use Node26.12.1. Docker Desktop4.93.0 / Engine29.8.1, Linux containers. Real PostgreSQL17.6 and Kafka4.1.1 images use the committed digests. The complete original backend suite also passed inside the pinned Node26.12.1 tools image.

All database tests used owned disposable `app_test_*` databases and containers. New harnesses use unique database/topic/group/tenant identifiers. Original harnesses sometimes reuse a database name inside a newly created isolated container. No ordinary `.env` database or existing Compose broker was reset or fault-injected. Pre-existing Compose services were left running. Test containers/networks were cleaned up; unique audit image tags remain available for reproduction.

**Executed results.** Counts are runner-reported totals, including node:test parent aggregates; they are not a claim of that many independent business scenarios. Repeated runs are not added together.

| Runner / harness | Existing or added | Result |
| --- | --- | --- |
| Core node:test | Existing | 19 passed |
| Financial Jest unit | Existing | 19 passed |
| Financial Jest integration | Existing | 21 passed, real PostgreSQL and Kafka |
| Web node:test | Existing | 2 passed |
| Playwright | Existing | 5 passed against final containers, real DB/Kafka |
| Migration harness | Existing | Clean deployment, upgrade fixture preservation, repeated deploy, drift and SQL guards passed |
| Production image smoke | Existing | HTTP/auth/FX/idempotency/Kafka/reconciliation/demo/SIGTERM/restart passed |
| Independent financial/auth audit | Added | 6 passed, 1 failed (`AUD-UUID-01`) |
| Independent Kafka crash/recovery audit | Added | 4 passed, real broker and separate processes |
| Targeted mutation control | Added harness | Existing 19 unit tests pass on control; ceil→floor mutation fails the intended FX assertion |

The original suites therefore report **66 passed**. Added suites report **10 passed / 1 failed**; the mutation control is a separate successful harness, not an application defect. Two of the added passing tests characterize protocol risks. In the [risk matrix](test-matrix.json), 48 grouped verification records comprise **42 PASS, 1 FAIL, 4 NOT RUN, 1 NOT APPLICABLE, 0 BLOCKED**. Every record includes evidence type; static-review PASS is not runtime proof. See [CSV matrix](test-matrix.csv) for risk → implementation → test → actual result → evidence mappings.

**Confirmed finding F-01 — Medium: schema-valid UUID spelling falsely blocks reconciliation.** Case `AUD-UUID-01`, evidence **REAL DB**, reproduced repeatedly. Location: `src/core/routes/treasury/layers/treasury-cl/treasury-cl.service.ts:268`; related existing-reservation comparison at line290.

Minimal reproduction: create a READY USD program; reserve USD1; obtain its consistent reconciliation view; preserve all fields but uppercase `reservations[0].programId`; send a fresh revision1 snapshot based on the current stateVersion, with the original lowercase envelope/key. `eventSchema.safeParse(event).success` is true. Expected: the same program UUID is accepted. Actual: `CURRENCY_OR_PROGRAM_CONFLICT`, program becomes `RECONCILIATION_REQUIRED`; financial state and ledger remain intact. The handler compares UUID strings directly against PostgreSQL's normalized value. UUID hexadecimal text permits upper/lower/mixed case ([RFC9562, section4](https://www.rfc-editor.org/rfc/rfc9562.html#section-4)); the application does not document a lowercase-only restriction.

Impact: a valid treasury producer can close reservation admission by using a different legal spelling of the same ID. This is an availability/interoperability defect; the reproduction does not show financial corruption or access bypass.

Minimal correction: compare canonical UUID values for snapshot `programId` and reservation `id`, preserving case-sensitive tenant/invoice IDs. If canonicalizing the entire protocol boundary, apply one policy to comparisons, partition-key validation and fingerprints, and consider compatibility with already persisted inbox IDs. Do not silently change invoice identity semantics. No production correction was applied.

```powershell
npm run build
node --test --test-name-pattern=AUD-UUID-01 test/verification/financial-audit.test.mjs
# Expected current result: exit1; actual CURRENCY_OR_PROGRAM_CONFLICT versus expected APPLIED.
```

**Observed risks and contract questions.** These are distinct from F-01.

- `RISK-01` / `AUD-KAFKA-RISK-01`: malformed JSON with a valid `tenant:program` key is durably quarantined and its broker offset advances, while the keyed program remains READY. `treasury-cl.service.ts:90–104` derives targets only from parsed payload. If malformed source messages must invalidate affected capacity, safely deriving a target from the validated key is a small hardening measure. The current contract promises quarantine but does not explicitly specify admission after completely unparseable messages; no lost valid operation or overspend was demonstrated.
- `RISK-02` / `AUD-KAFKA-RISK-02`: a recognizable envelope with revision10 but invalid money syntax produces quarantine and blocks the program, yet `highestSeenTreasuryRevision` stays0. A fresh snapshot revision2 can restore READY. Decide whether a valid envelope's revision is trustworthy before payload validation. Blindly trusting arbitrary malformed revisions also permits a producer to pin recovery at an excessive revision, so this needs an explicit protocol decision.
- Coverage evidence gap: `jest.config.js:8–14` does not collect AuthGuard/Auth core/CASL/Kafka consumer coverage. Their behavior is exercised by real HTTP, core and added broker tests, but the published financial coverage percentages cannot establish branch coverage for those components.
- Static availability risk: `web/server.mjs:142–146` closes the server and idle connections without the API's explicit overall shutdown deadline. A slow active connection was not runtime-reproduced. Do not classify this as financial data loss.

**What the critical evidence establishes.**

`AUD-CONC-01` creates two independent Node processes, each with its own Prisma client. A parent-held PostgreSQL row lock queues both reserves; `pg_stat_activity` confirms two waiting connections before release. Five repetitions of700+700 against1000 produce one201 and one409. Six concurrent releases per repetition create one release movement and one version increment. A concurrent identical-key pair returns the same result with one effect. `AUD-CONC-02` proves another program can complete while the first program row is locked.

`AUD-MODEL-01` runs seeds1,20261027,3735928559 with120 operations each. The independent oracle uses bigint arithmetic, including rational EUR→USD ceiling, rather than production conversion helpers. Reserve, release, historical retry, business refusal and treasury limit changes are checked after every operation against active rows, aggregate, ledger, stateVersion, availability and over-limit amount. This model does not generate arbitrary reconciliation/fault interleavings; those have separate scenarios.

`KAFKA-CRASH-01` runs the actual production TreasuryConsumer and BL/CL/DA/transaction chain in a child process. Test-only instrumentation holds `commitOffsets` after processing has returned. The parent verifies committed inbox/ledger, a restored USD10 reservation and a changed limit, verifies the broker offset is still uncommitted, then kills the process. A new process in the same group redelivers the event, advances the offset and preserves exactly one effect/version. A fresh snapshot restores READY. This is an actual process crash, rather than only sending the event twice or throwing an offset exception.

`AUD-KAFKA-QUARANTINE-01` renames only the owned test quarantine table, waits for actual KafkaJS CRASH following failed persistence, verifies offset3 and absence of the later event's inbox, restores the table and starts a new consumer. Both messages safely replay through offset5. `AUD-KAFKA-REBALANCE-01` verifies a Stable broker group with two live members, stops the partition owner, observes survivor GROUP_JOIN assignment and verifies a fresh snapshot through offset6 with one reservation and consistent financial state. Original integration tests additionally pause the isolated broker and check admission closure, release availability and required fresh reconciliation after reconnect.

`AUD-AUTH-01` uses real signing keys, an actual PostgreSQL session and the production guard. It checks all14 protected documented HTTP operations plus three Swagger routes without a token, future nbf, seven missing required claims and an unsupported HMAC algorithm. Real refresh preserves stable idempotency scope and the original response; removing write permissions prevents replay. Original tests additionally exercise wrong issuer/audience/signature, expiration, unsupported RSA, revoked/missing session, role/tenant scope, role injection and refresh races. No guard is bypassed. Consumer health is controlled only for the HTTP-only test's financial-admission precondition.

The complete API inventory has17 operations: three public authentication bootstrap operations and14 session-protected operations. [HTTP inventory](http-inventory.json) records method/path/DTO schema/parameters/permissions/statuses. Health/readiness and Swagger require authentication. No metrics route was found. OpenAPI regenerated into an ignored file exactly matches the committed export.

Financial transitions: reservation `ACTIVE → RELEASED` through full release or `ACTIVE → RECONCILED_CLOSED` through full snapshot; terminal invoices cannot revive. Programs enter `RECONCILIATION_REQUIRED` after startup/unavailability/revision or snapshot conflicts and return READY only through valid fresh snapshot. Full release remains available while reconciliation is required. Limit reductions can legitimately expose overLimit; reserved≤limit is not an unconditional invariant.

Financial writes are in capacity DA, treasury DA and Prisma infrastructure, coordinated by CL transactions. Program row locks serialize financial writers. Idempotency scope is tenant/client/key; fingerprints bind method/resource/body. Inbox uniqueness is source/eventId; revision conflict checks use source/tenant/program/revision. Commit ordering is database result first, then string bigint offset+1, then resolveOffset; automatic commit/batch resolution are disabled. Quarantine retains original bytes. The documented single-runtime readiness coordination is not assessed as a multi-replica availability guarantee. Outgoing business events are not required, so no outbox requirement is invented.

**Baseline commands and failures.** Both lockfile installs, root/web lint, Prisma validation/generation, API/web typecheck/build and architecture check passed. There is no separate format script: ESLint is the repository's formatting check, and production files were not autoformatted. Architecture checker reports96 source files and no findings. New audit files alone received ESLint fixes. The first `npm test` failed with Windows EBUSY unlinking a generated Prisma file during concurrent Docker build-context access. Sequential retry and the entire suite inside Node26.12.1 passed. The temporal correlation supports transient file contention; no application failure is inferred from it. No dependencies were updated.

Exact commands and retained raw-evidence paths are in [commands](commands.md). [Evidence manifest](evidence.json) records environment, both SHAs, runner totals, matrix totals, score weights, retained image tags and SHA256 digests of raw evidence. Jest results under `results/` retain runner fields but omit the large coverageMap; coverage-summary JSON is stored separately. Original JSON and scanner payloads remain under ignored `.ci-artifacts/verification/`. No secrets, database dumps or large raw application logs are added to tracked files.

**Security and CI scope.** Pinned actionlint passed for both the starting and current workflow. Independent static review found no mandatory-job bypass: Required checks requires all six dependencies to succeed; release checks the exact main-reachable SHA, tests/scans the image and transfers the same archive for publication. No commit, push, tag, image publication, remote deploy or repository-setting mutation was performed. GitHub jobs, permissions/branch protection and registry publication were not executed or independently confirmed. The current Chromium/Ubuntu download delta is syntax/static-reviewed only; mirror-file effectiveness depends on the hosted runner's APT sources.

Gitleaks scanned18 local commits/all refs with redaction and found no leaks. Trivy0.76.1 scanned both npm lockfiles including dev dependencies and final API/web images: **zero unsuppressed HIGH/CRITICAL**, with **57 suppressed OS findings /12 distinct CVEs per runtime image** under the existing exact-package/version/architecture exceptions expiring2026-11-27. See [security summary](security-summary.json). A passing gate is not a claim of zero vulnerabilities. Smoke checks confirm absent affected helper executables, nonroot user, stripped SUID/SGID and expected Node dynamic links. Debian's minizip applicability note supports the existing zlib exception ([Debian tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853)); the other individual upstream advisories were not independently re-adjudicated. The scanner databases were available, so no clean result was substituted for a scanner outage.

**Coverage and bounded load.** Selected financial integration scope:88.24% lines /87.21% branches. Capacity CL has100% lines /87.71% branches; Treasury CL97.06% /86.17%; transaction service96.96% /75%. These values exclude components described above. The ceil→floor mutation is killed by the existing FX test in a disposable dist/package copy; repository source and dist are not mutated.

| Local DA/CL load, no HTTP/Kafka overhead | Operations / concurrency | Throughput | p95 command latency | Refusals / technical errors |
| --- | --- | --- | --- | --- |
| One hot program | 48 /4 | 179.9 ops/s | 41.4ms | 0 /0 |
| Four independent programs | 48 /4 | 325.2 ops/s | 15.0ms | 0 /0 |

These short measurements used the Windows host Node26.3.1 and local Docker PostgreSQL on the hardware above while other audit work was active. They demonstrate a bounded contention comparison, not sustained capacity or an SLA. Raw measurements are in [load results](results/load.json).

**Scores.** Evidence-based, preliminary; an unclosed confirmed financial/data-loss/auth defect would block readiness regardless of the average. F-01 is an availability defect and still merits correction before submission.

| Category | Weight | Score | Basis |
| --- | --- | --- | --- |
| Financial correctness and concurrency | 30% | 9.0 | Real locks across processes, fixed FX, rollback/ledger/idempotency, independent360-operation model |
| Kafka, reconciliation and recovery | 25% | 7.5 | Actual crash window, quarantine failure and rebalance pass; F-01 and two protocol questions remain |
| Authentication, isolation and security | 15% | 8.0 | Real sessions/claims/CASL/tenants/refresh/replay; limited security branch coverage and explicit scanner exceptions |
| Test quality and reproducibility | 10% | 8.0 | Disposable infrastructure, independent oracle and killed mutation; audit suites require explicit invocation |
| Docker, migrations and CI/CD | 10% | 8.0 | Clean/upgrade/drift and final-image smoke/browser pass; remote GitHub gates and new Ubuntu download delta unverified |
| Architecture, readability and documentation | 10% | 8.5 | BL/DA/CL rules/DI checks, transaction context and useful runbook; normalization/policy gaps remain |

Weighted total8.225, rounded8.2/10. Confidence is stronger for the demonstrated financial invariants than for broader production operations/security. No probability of employer acceptance is predicted.

**Interviewer perspective and priorities.** Strong discussion points are transactional row locks instead of a local mutex, stable idempotency identity across refresh, immutable saved FX, durable inbox/quarantine and explicit version-aware reconciliation. Expect questions about malformed-envelope trust, source/revision authority, global readiness invalidation in a single-runtime design, snapshot coordination with treasury, retention of inbox/idempotency/history, and separating local CI equivalents from proven GitHub settings.

Before submission: correct F-01 and rerun its regression plus original reconciliation tests; decide and document the two malformed-message/revision policies. Desirable: include critical auth/CASL/Kafka modules in coverage and explicitly exercise production SIGTERM with an in-flight financial operation. Optional: sustained workload/soak testing and generated snapshot/fault model extensions. Kubernetes, Redis, cloud deployment and partial repayments are not required improvements for this assignment.

**Changed files.** Only new tests/harnesses under `test/verification/` and this report directory were added by the auditor. Tests: `financial-audit.test.mjs`, `kafka-crash.test.mjs`. Support: `service-process.mjs`, `kafka-child.mjs`, `mutation-check.mjs`. Production code, migrations, contracts, workflows, manifests and lockfiles were not changed by the auditor. The external CI-only commit is recorded separately above. Audit tests are intentionally not wired into existing npm scripts/workflows because this audit does not alter those files; use the explicit commands. Large ignored logs/scanner data and local audit images are not Git additions.

**Outstanding evidence.** Four matrix records are NOT RUN: actual GitHub execution/settings; production SIGTERM exactly during an in-flight transaction/message; slow-active-connection web shutdown; generated arbitrary snapshot/fault property sequences. Infrastructure did not block the local critical checks. No exhaustive test-of-all-executions claim is made.
