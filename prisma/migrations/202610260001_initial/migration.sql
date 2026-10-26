-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('READY', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'RECONCILED_CLOSED');

-- CreateTable
CREATE TABLE "Program" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "limitMinor" BIGINT NOT NULL,
    "reservedMinor" BIGINT NOT NULL DEFAULT 0,
    "stateVersion" BIGINT NOT NULL DEFAULT 0,
    "lastAppliedTreasuryRevision" BIGINT NOT NULL DEFAULT 0,
    "highestSeenTreasuryRevision" BIGINT NOT NULL DEFAULT 0,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'RECONCILIATION_REQUIRED',
    "lastTreasuryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" UUID NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceMinor" BIGINT NOT NULL,
    "invoiceCurrency" VARCHAR(3) NOT NULL,
    "reservedMinor" BIGINT NOT NULL,
    "fxRate" DECIMAL(38,18) NOT NULL,
    "fxDirection" TEXT NOT NULL,
    "fxSource" TEXT NOT NULL,
    "fxAsOf" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacityMovement" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" UUID NOT NULL,
    "reservationId" UUID,
    "limitDelta" BIGINT NOT NULL,
    "reservedDelta" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "stateVersion" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapacityMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRequest" (
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "programId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" INTEGER,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRequest_pkey" PRIMARY KEY ("tenantId","clientId","key")
);

-- CreateTable
CREATE TABLE "TreasuryInbox" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" UUID NOT NULL,
    "revision" BIGINT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "revisionFingerprint" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryQuarantine" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" TEXT NOT NULL,
    "rawBase64" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryQuarantine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Program_tenantId_id_key" ON "Program"("tenantId", "id");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_programId_status_id_idx" ON "Reservation"("tenantId", "programId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_tenantId_invoiceId_key" ON "Reservation"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityMovement_tenantId_programId_stateVersion_key" ON "CapacityMovement"("tenantId", "programId", "stateVersion");

-- CreateIndex
CREATE INDEX "TreasuryInbox_source_tenantId_programId_revision_idx" ON "TreasuryInbox"("source", "tenantId", "programId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryInbox_source_eventId_key" ON "TreasuryInbox"("source", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryQuarantine_source_topic_partition_offset_key" ON "TreasuryQuarantine"("source", "topic", "partition", "offset");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tenantId_programId_fkey" FOREIGN KEY ("tenantId", "programId") REFERENCES "Program"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityMovement" ADD CONSTRAINT "CapacityMovement_tenantId_programId_fkey" FOREIGN KEY ("tenantId", "programId") REFERENCES "Program"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
