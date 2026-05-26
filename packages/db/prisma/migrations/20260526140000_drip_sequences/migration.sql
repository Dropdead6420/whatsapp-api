-- Drip sequences (Phase 3). Multi-step WhatsApp campaigns triggered by
-- contact events; an Enrollment row tracks each contact's progress.

-- CreateEnum
CREATE TYPE "DripSequenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DripSequenceTrigger" AS ENUM ('MANUAL', 'CONTACT_CREATED', 'TAG_ADDED');

-- CreateEnum
CREATE TYPE "DripEnrollmentStatus" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "DripSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DripSequenceStatus" NOT NULL DEFAULT 'DRAFT',
    "trigger" "DripSequenceTrigger" NOT NULL DEFAULT 'MANUAL',
    "triggerTag" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DripSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DripEnrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" "DripEnrollmentStatus" NOT NULL DEFAULT 'RUNNING',
    "nextStepAt" TIMESTAMP(3),
    "lastStepAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DripEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DripSequence_tenantId_status_idx" ON "DripSequence"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DripSequence_trigger_status_idx" ON "DripSequence"("trigger", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DripEnrollment_sequenceId_contactId_key" ON "DripEnrollment"("sequenceId", "contactId");

-- CreateIndex
CREATE INDEX "DripEnrollment_tenantId_status_idx" ON "DripEnrollment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DripEnrollment_status_nextStepAt_idx" ON "DripEnrollment"("status", "nextStepAt");

-- AddForeignKey
ALTER TABLE "DripSequence" ADD CONSTRAINT "DripSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripEnrollment" ADD CONSTRAINT "DripEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripEnrollment" ADD CONSTRAINT "DripEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "DripSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DripEnrollment" ADD CONSTRAINT "DripEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
