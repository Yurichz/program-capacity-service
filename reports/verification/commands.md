# Verification commands and evidence

Working directory: `G:\My projects\program-capacity-service`. PowerShell commands below. Baseline source8f6cd013a838a954641157e5bf2738484523457b; external CI-only final HEAD65d837b073bcf1b2424ccf12a7f8cadc14fa9ea6. Commands were executed without commits/push/publication. Temporary test credentials are generated inside harnesses and are not printed.

## Installation and static checks

```powershell
npm ci
npm ci --prefix web
node node_modules/prisma/build/index.js validate
npm run db:generate
npm run lint
npm --prefix web run lint
npm run typecheck
npm run build
npm run check:architecture
npm --prefix web run build
npm --prefix web test
```

All passed. The web build includes its typecheck. There is no standalone format script. Root ESLint covers web/scripts/tests. A first npm-test invocation hit transient Windows EBUSY; the retry below and pinned Node container both passed.

## Original tests, coverage and migration checks

```powershell
npm test
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns=unit --coverage --coverageDirectory=coverage/verification-unit --json --outputFile=.ci-artifacts/verification/unit-results.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns=integration --coverage --coverageDirectory=coverage/verification-integration --json --outputFile=.ci-artifacts/verification/integration-results.json
node scripts/test-migrations.mjs
```

Direct migration/coverage commands are the actual commands executed after the successful build, using the same script bodies as the npm scripts. `npm test` invokes the real existing core and Jest suites. DB URLs are provisioned by Testcontainers; no user DATABASE_URL is reset. Raw logs: `.ci-artifacts/verification/baseline-tests-retry.log`, `unit-coverage.log`, `integration-coverage.log`, `migrations.log`.

## Final images and exact Node26.12.1 tests

```powershell
docker build --target runtime --build-arg REVISION=8f6cd013a838a954641157e5bf2738484523457b -t program-capacity-service:audit-20261027-8f6cd01 .
docker build --target tools -t program-capacity-tools:audit-20261027-8f6cd01 .
docker build -t program-capacity-web:audit-20261027-8f6cd01 web
docker run --rm --user 0 -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal program-capacity-tools:audit-20261027-8f6cd01 npm test
$env:APP_IMAGE='program-capacity-service:audit-20261027-8f6cd01'
$env:TOOLS_IMAGE='program-capacity-tools:audit-20261027-8f6cd01'
$env:WEB_IMAGE='program-capacity-web:audit-20261027-8f6cd01'
node scripts/test-smoke.mjs
node web/node_modules/@playwright/test/cli.js install chromium
node scripts/test-web.mjs
```

All passed. Test-smoke executes the documented CLI demo and repeated scenario, starts the production image without source/dev mounts, verifies nonroot/runtime hardening, sends SIGTERM, restarts and reconciles. Web-test provisions isolated PostgreSQL/Kafka/app/demo/web and runs five browser cases plus database invariants. Docker socket access is for trusted local test tooling; the actual service image runs as node. Do not rebuild an image with the old REVISION label after modifying production source.

## Added audit checks

```powershell
node --test --test-reporter=tap --test-reporter-destination=.ci-artifacts/verification/financial-audit.tap test/verification/financial-audit.test.mjs
# Expected current result: 6 PASS, 1 FAIL (AUD-UUID-01), exit1.
node --test --test-name-pattern=AUD-UUID-01 test/verification/financial-audit.test.mjs
# Minimal regression: expected current exit1.
node --test --test-reporter=tap test/verification/kafka-crash.test.mjs
# 4 PASS, exit0; includes actual process crash, quarantine fault and two-member reassignment.
node test/verification/mutation-check.mjs
# Harness exit0: control passes; targeted ceil-to-floor mutation fails as intended.
```

The financial audit includes independent-process lock barriers, model seeds1/20261027/3735928559, bounded load measurement, malformed high-revision characterization, nbf/claim/auth-route coverage and refresh/permission replay. Helpers must not be invoked independently against ordinary databases. New source was styled using ESLint only. Raw machine-readable TAP/Jest/coverage results are preserved under `reports/verification/results/`; larger originals remain ignored.

## Static workflow/security checks

```powershell
docker run --rm -v 'G:\My projects\program-capacity-service:/repo:ro' -w /repo rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 .github/workflows/ci.yml .github/workflows/release.yml
docker run --rm -v 'G:\My projects\program-capacity-service:/src:ro' -v 'G:\My projects\program-capacity-service\.ci-artifacts\verification:/reports' -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/src ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f git /src --log-opts=--all --redact --report-format json --report-path /reports/secrets.json
docker run --rm -v 'G:\My projects\program-capacity-service:/src:ro' -v 'G:\My projects\program-capacity-service\.ci-artifacts\verification:/reports' aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c fs --scanners vuln --include-dev-deps --severity HIGH,CRITICAL --exit-code 1 --format json --output /reports/dependencies.json /src
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v 'G:\My projects\program-capacity-service\.ci-artifacts\verification:/reports' -v 'G:\My projects\program-capacity-service\.trivyignore.yaml:/policy/ignore.yaml:ro' -v trivy-cache:/root/.cache aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --ignorefile /policy/ignore.yaml --show-suppressed --format json --output /reports/api-vulnerabilities.json program-capacity-service:audit-20261027-8f6cd01
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v 'G:\My projects\program-capacity-service\.ci-artifacts\verification:/reports' -v 'G:\My projects\program-capacity-service\.trivyignore.yaml:/policy/ignore.yaml:ro' -v trivy-cache:/root/.cache aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --ignorefile /policy/ignore.yaml --show-suppressed --format json --output /reports/web-vulnerabilities.json program-capacity-web:audit-20261027-8f6cd01
```

All gates passed under the existing expiring suppression policy. These scans use the real scanner database, with zero unsuppressed HIGH/CRITICAL. The 57 suppressed findings per runtime image remain visible in JSON and the summary. The dependency scan sees both lockfiles. Gitleaks final scan covers18 commits. Actionlint was rerun after external CI-only commit65d837b. Individual Ubuntu APT downloads and a real GitHub Actions run were not executed locally.

Negative control, intentionally expected nonzero:

```powershell
docker run --rm -e DOCKER_HOST=tcp://127.0.0.1:1 program-capacity-tools:audit-20261027-8f6cd01 node scripts/test-migrations.mjs
```

It exited1 with `Could not find a working container runtime strategy`. This is a passed negative control, not a failed application scenario. No real Docker service was stopped.

OpenAPI was exported with newly generated test secrets, dummy unreachable `postgresql://audit:audit@127.0.0.1:1/app_test_openapi`, `OPENAPI_OUTPUT=.ci-artifacts/verification/openapi-current.json`, and compared by parsed deep equality with committed `openapi.json`. No DB connection or contract rewrite occurred. A final root lint and checks for unchanged tracked production files passed.
