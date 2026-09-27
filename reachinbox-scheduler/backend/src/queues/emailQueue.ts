import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "../config/redis";

export const EMAIL_QUEUE_NAME = "email-send-queue";

// One shared Queue instance. Jobs are added with a BullMQ `delay` computed from
// scheduled_time, and with `jobId` set to the email_jobs.id (Postgres row id).
// Using the DB row id as the BullMQ jobId is what gives us idempotency:
// BullMQ refuses to add a second job with the same jobId while one exists,
// so re-running the recovery scan on every boot can never create duplicates.
export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 3600 * 24 }, // keep 24h for the Bull Board dashboard
    removeOnFail: false,
  },
});

export const emailQueueEvents = new QueueEvents(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
});

export interface EmailJobPayload {
  emailJobId: string; // Postgres email_jobs.id — also used as BullMQ jobId
  senderId: string;
  userId: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

export async function enqueueEmailJob(payload: EmailJobPayload, runAt: Date) {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  await emailQueue.add("send-email", payload, {
    jobId: payload.emailJobId, // idempotency key
    delay,
  });
}
