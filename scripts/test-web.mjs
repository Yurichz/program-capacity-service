import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Network, Wait } from "testcontainers";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import assert from "node:assert/strict";
import { database } from "../dist/core/providers/prisma/create-database.js";

// Every database/container here is owned by this harness. No Compose volumes or ordinary databases are reset.
const postgresImage =
  "postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3";
const kafkaImage =
  "apache/kafka:4.1.1@sha256:0bc1bb2478f45b6cea78864df86acdc11e8df2c5172477819a4d12942cbe5d40";
const owned = [];
let network;
let db;
try {
  network = await new Network().start();
  const postgres = await new PostgreSqlContainer(postgresImage)
    .withDatabase("app_test_web")
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .start();
  owned.push(postgres);
  const url = postgres.getConnectionUri();
  assert.ok(new URL(url).pathname.startsWith("/app_test_"));
  const env = {
    ...process.env,
    DATABASE_URL: url,
    DEMO_EMAIL: "operator@capacity.local",
    DEMO_PASSWORD: randomBytes(24).toString("base64url"),
    JWT_ACCESS_SECRET: randomUUID() + randomUUID(),
    JWT_REFRESH_SECRET: randomUUID() + randomUUID(),
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
  };
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env, stdio: "inherit" },
  );
  execFileSync(process.execPath, ["scripts/seed.mjs"], {
    env,
    stdio: "inherit",
  });
  db = database(url);
  const seeded = await db.user.findUniqueOrThrow({
    where: { email: env.DEMO_EMAIL },
  });
  execFileSync(process.execPath, ["scripts/seed.mjs"], {
    env,
    stdio: "inherit",
  });
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { email: env.DEMO_EMAIL } }))
      .passwordHash,
    seeded.passwordHash,
  );
  assert.equal(await db.program.count(), 2);
  const readPassword = randomBytes(24).toString("base64url");
  await db.user.create({
    data: {
      email: "reader@capacity.local",
      passwordHash: await hash(readPassword, 12),
      tenantId: "demo-tenant",
      clientId: "e2e-reader",
      roles: ["READ_ONLY"],
    },
  });
  const foreignPassword = randomBytes(24).toString("base64url");
  await db.user.create({
    data: {
      email: "foreign@capacity.local",
      passwordHash: await hash(foreignPassword, 12),
      tenantId: "foreign-tenant",
      clientId: "e2e-foreign",
      roles: ["USER", "TREASURY"],
    },
  });
  const broker = await new GenericContainer(kafkaImage)
    .withNetwork(network)
    .withNetworkAliases("kafka")
    .withExposedPorts(9092)
    .withEnvironment({
      KAFKA_NODE_ID: "1",
      KAFKA_PROCESS_ROLES: "broker,controller",
      KAFKA_LISTENERS: "PLAINTEXT://:9092,CONTROLLER://:9093",
      KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://kafka:9092",
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
        "PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT",
      KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@kafka:9093",
      KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: "0",
      KAFKA_MESSAGE_MAX_BYTES: "3145728",
      KAFKA_REPLICA_FETCH_MAX_BYTES: "4194304",
      CLUSTER_ID: "MkU3OEVBNTcwNTJENDM2Qk",
    })
    .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
    .withStartupTimeout(120000)
    .start();
  owned.push(broker);
  const topic = "treasury.capacity.v1";
  const created = await broker.exec([
    "/opt/kafka/bin/kafka-topics.sh",
    "--bootstrap-server",
    "kafka:9092",
    "--create",
    "--topic",
    topic,
    "--partitions",
    "3",
    "--replication-factor",
    "1",
    "--config",
    "max.message.bytes=3145728",
  ]);
  assert.equal(created.exitCode, 0);
  const internalEnv = {
    DATABASE_URL: `postgresql://${postgres.getUsername()}:${postgres.getPassword()}@postgres:5432/app_test_web`,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
    ACCESS_TOKEN_TTL_SECONDS: "3",
    KAFKA_BROKERS: "kafka:9092",
    KAFKA_TOPIC: topic,
    API_URL: "http://app:3000",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
  };
  const app = await new GenericContainer("program-capacity-service:local")
    .withNetwork(network)
    .withNetworkAliases("app")
    .withEnvironment(internalEnv)
    .withExposedPorts(3000)
    .withCommand(["node", "dist/main.js"])
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120000)
    .start();
  owned.push(app);
  const demo = await new GenericContainer("program-capacity-service:local")
    .withNetwork(network)
    .withNetworkAliases("demo-tools")
    .withEnvironment({ ...internalEnv, LOCAL_DEMO_ENABLED: "true" })
    .withExposedPorts(3001)
    .withCommand(["node", "scripts/demo-tools.mjs"])
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  owned.push(demo);
  const web = await new GenericContainer("program-capacity-web:local")
    .withNetwork(network)
    .withEnvironment({
      API_UPSTREAM: "http://app:3000",
      DEMO_UPSTREAM: "http://demo-tools:3001",
    })
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  owned.push(web);
  const testEnv = {
    ...process.env,
    WEB_TEST_URL: `http://${web.getHost()}:${web.getMappedPort(8080)}`,
    E2E_EMAIL: env.DEMO_EMAIL,
    E2E_PASSWORD: env.DEMO_PASSWORD,
    E2E_READER_PASSWORD: readPassword,
    E2E_FOREIGN_PASSWORD: foreignPassword,
  };
  console.log(
    "Browser tests use isolated app_test_web PostgreSQL, Kafka and Node 24 application containers.",
  );
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test"],
      { cwd: "web", env: testEnv, stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(result, 0, "Browser test failure");
  for (const p of await db.program.findMany()) {
    const active = await db.reservation.aggregate({
      where: { programId: p.id, status: "ACTIVE" },
      _sum: { reservedMinor: true },
    });
    const movements = await db.capacityMovement.aggregate({
      where: { programId: p.id },
      _sum: { reservedDelta: true },
    });
    assert.equal(p.reservedMinor, active._sum.reservedMinor ?? 0n);
    assert.equal(p.reservedMinor, movements._sum.reservedDelta ?? 0n);
  }
  const lost = await db.reservation.findMany({
    where: { invoiceId: { startsWith: "NETWORK-" } },
  });
  assert.equal(lost.length, 1);
  assert.ok((await db.idempotencyRequest.count()) > 0);
  assert.ok(
    (await db.treasuryInbox.count({
      where: { result: { path: ["code"], equals: "STATE_VERSION_CONFLICT" } },
    })) > 0,
  );
  console.log(
    "Database assertions passed: aggregates, ledger, one network-retried reservation, idempotency and stale-snapshot inbox outcome.",
  );
} finally {
  await db?.$disconnect();
  for (const container of owned.reverse())
    await container
      .stop()
      .catch((error) =>
        console.error("Test container cleanup failed:", error.message),
      );
  await network?.stop();
}
