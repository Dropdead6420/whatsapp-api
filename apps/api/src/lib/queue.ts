import { Queue, Worker, JobsOptions, ConnectionOptions } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires `maxRetriesPerRequest: null` on the underlying ioredis
// client. We pass the URL + flag and let BullMQ own the connection lifecycle.
export function getQueueConnection(): ConnectionOptions {
  return { url: REDIS_URL, maxRetriesPerRequest: null };
}

export const QueueNames = {
  CAMPAIGN_DISPATCH: "campaign-dispatch",
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

interface CampaignDispatchData {
  campaignId: string;
}
interface CampaignScanData {
  kind: "scan-scheduled";
}
export type CampaignJobData = CampaignDispatchData | CampaignScanData;

let campaignQueueSingleton: Queue<CampaignJobData> | null = null;

export function getCampaignQueue(): Queue<CampaignJobData> {
  if (!campaignQueueSingleton) {
    campaignQueueSingleton = new Queue<CampaignJobData>(
      QueueNames.CAMPAIGN_DISPATCH,
      {
        connection: getQueueConnection(),
        defaultJobOptions: {
          // Keep last 1k completed for the /admin/queues view; drop older to
          // bound Redis memory.
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
        },
      },
    );
  }
  return campaignQueueSingleton;
}

// Test/shutdown helper. Closes the singleton + all registered workers.
const registeredWorkers = new Set<Worker>();

export function trackWorker(w: Worker): void {
  registeredWorkers.add(w);
}

export async function closeQueues(): Promise<void> {
  const workers = Array.from(registeredWorkers);
  registeredWorkers.clear();
  await Promise.allSettled(workers.map((w) => w.close()));
  if (campaignQueueSingleton) {
    await campaignQueueSingleton.close().catch(() => undefined);
    campaignQueueSingleton = null;
  }
}

export async function queueDepth(
  queue: Queue,
): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}> {
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "failed",
    "completed",
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    failed: counts.failed ?? 0,
    completed: counts.completed ?? 0,
  };
}

export type { JobsOptions };
