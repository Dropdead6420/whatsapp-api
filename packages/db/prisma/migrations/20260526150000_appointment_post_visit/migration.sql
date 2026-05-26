-- Appointment post-visit follow-up tracking. Mirrors reminderSentAt
-- so the worker can flip a one-shot stamp after sending.

ALTER TABLE "Appointment" ADD COLUMN "postVisitSentAt" TIMESTAMP(3);

CREATE INDEX "Appointment_postVisitSentAt_idx" ON "Appointment"("postVisitSentAt");
