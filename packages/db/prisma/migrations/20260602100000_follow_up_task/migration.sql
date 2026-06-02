-- FollowUpTask (PRD-v2 §7 — agent-authored reminders)
--
-- Lightweight task surface for the inbox; distinct from Lead.followUp*
-- which is AI-recommended lead-driven. Operator authors title + dueAt +
-- assignee; status transitions PENDING → DONE/CANCELLED.

CREATE TYPE "FollowUpTaskStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" VARCHAR(280) NOT NULL,
    "notes" TEXT,
    "status" "FollowUpTaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT,
    "contactId" TEXT,
    "conversationId" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FollowUpTask_tenantId_idx" ON "FollowUpTask"("tenantId");
CREATE INDEX "FollowUpTask_assigneeId_status_dueAt_idx" ON "FollowUpTask"("assigneeId", "status", "dueAt");
CREATE INDEX "FollowUpTask_contactId_idx" ON "FollowUpTask"("contactId");
CREATE INDEX "FollowUpTask_conversationId_idx" ON "FollowUpTask"("conversationId");

ALTER TABLE "FollowUpTask"
  ADD CONSTRAINT "FollowUpTask_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FollowUpTask"
  ADD CONSTRAINT "FollowUpTask_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FollowUpTask"
  ADD CONSTRAINT "FollowUpTask_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FollowUpTask"
  ADD CONSTRAINT "FollowUpTask_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FollowUpTask"
  ADD CONSTRAINT "FollowUpTask_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
