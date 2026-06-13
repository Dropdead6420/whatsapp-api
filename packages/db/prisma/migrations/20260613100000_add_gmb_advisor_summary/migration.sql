-- Coach's note on advisor reports: LLM-written via the gmb.ranking_advisor
-- prompt with a deterministic fallback. Nullable — older reports have none.
ALTER TABLE "GmbAdvisorReport" ADD COLUMN "summary" TEXT;
