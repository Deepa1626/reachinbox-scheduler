import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { env } from "../config/env";
import { EMAIL_QUEUE_NAME, EmailJobPayload, enqueueEmailJob } from "./emailQueue";
import { EmailJobs } from "../db/models";
import { pool } from "../config/db";
import { sendEmail } from "../services/emailSender";
import { tryConsumeSlot, millisSinceLastSend, markSent, startOfNextHour } from "../services/rateLimiter";
import { notifyRateLimitHit } from "../services/slackService";
import { indexEmailJob } from "../services/elasticsearch";

/**
 * The worker is where concurrency, per-sender throttling, and hourly rate
 * limiting all come together. Flow for every job:
 *
 *  1. Load the sender + row from Postgres (source of truth).
 *  2. Check the hourly Redis counter for this sender. If it's exhausted,
 *     DO NOT fail the job - push it to the start of next hour's window
 *     and re-add it to BullMQ with a new delay, preserving relative order
 *     among jobs that get bumped together. Also fire the Slack webhook.
 *  3. Enforce the minimum delay between sends for this sender (belt and
 *     braces on top of BullMQ's own limiter option below).
 *  4. Actually send via Ethereal SMTP, update Postgres + Elasticsearch.
 *
 * Idempotency: the BullMQ jobId == email_jobs.id, so this exact job can only
 * exist once in the queue at a time. We also guard by checking the DB status
 * before sending - if it's already "sent" (e.g. a duplicate recovery pass
 * somehow got triggered) we skip re-sending.
 */

async function processJob(job: Job<EmailJobPayload>) {
  const { emailJobId, senderId, recipientEmail, subject, body } = job.data;

  const dbRow = await EmailJobs.getById(emailJobId);
  if (!dbRow) {
    console.warn(`[worker] email_jobs row ${emailJobId} missing, skipping`);
    return;
  }
  if (dbRow.status === "sent") {
    console.log(`[worker] ${emailJobId} already sent, skipping (idempotency guard)`);
    return;
  }

  const senderRes = await pool.query(`SELECT * FROM senders WHERE id = $1`, [senderId]);
  const sender = senderRes.rows[0];
  if (!sender) throw new Error(`sender ${senderId} not found`);

  // --- Hourly rate limit check (Redis-backed, safe across workers) ---
  const { allowed } = await tryConsumeSlot(senderId, sender.max_emails_per_hour);
  if (!allowed) {
    const nextWindow = startOfNextHour(new Date());
    await EmailJobs.rescheduleTo(emailJobId, nextWindow);
    await enqueueEmailJob(
      { emailJobId, senderId, userId: dbRow.user_id, recipientEmail, subject, body },
      nextWindow
    );

    const userRes = await pool.query(`SELECT slack_webhook_url FROM users WHERE id = $1`, [dbRow.user_id]);
    const webhookUrl = userRes.rows[0]?.slack_webhook_url || null;
    await notifyRateLimitHit(webhookUrl, {
      senderName: sender.name,
      maxPerHour: sender.max_emails_per_hour,
      queuedUntil: nextWindow.toISOString(),
    });

    console.log(`[worker] hourly limit hit for sender ${senderId}; rescheduled ${emailJobId} -> ${nextWindow.toISOString()}`);
    return; // do not mark failed - this is an intentional, graceful reschedule
  }

  // --- Minimum delay between sends for this sender ---
  const sinceLast = await millisSinceLastSend(senderId);
  if (sinceLast < sender.min_delay_ms) {
    const waitMs = sender.min_delay_ms - sinceLast;
    await new Promise((res) => setTimeout(res, waitMs));
  }

  // --- Actually send ---
  await EmailJobs.setStatus(emailJobId, "sending");
  try {
    await sendEmail(sender, { to: recipientEmail, subject, html: body });
    await markSent(senderId);
    const sentAt = new Date();
    await EmailJobs.setStatus(emailJobId, "sent", { sentAt });
    await indexEmailJob({
      id: emailJobId,
      recipient_email: recipientEmail,
      subject,
      body,
      status: "sent",
      user_id: dbRow.user_id,
      scheduled_time: dbRow.scheduled_time,
      sent_at: sentAt.toISOString(),
    });
    console.log(`[worker] sent ${emailJobId} -> ${recipientEmail}`);
  } catch (err: any) {
    await EmailJobs.setStatus(emailJobId, "failed", { error: err.message });
    await indexEmailJob({
      id: emailJobId,
      recipient_email: recipientEmail,
      subject,
      body,
      status: "failed",
      user_id: dbRow.user_id,
      scheduled_time: dbRow.scheduled_time,
    });
    throw err; // let BullMQ's retry/backoff handle transient SMTP errors
  }
}

export const emailWorker = new Worker<EmailJobPayload>(EMAIL_QUEUE_NAME, processJob, {
  connection: redisConnection,
  concurrency: env.WORKER_CONCURRENCY, // configurable parallelism, per assignment spec
  limiter: {
    // A second, cheap layer of throttling at the BullMQ level itself
    // (max N jobs started per `duration` ms) as a global safety net on top
    // of the per-sender Redis counters above.
    max: env.WORKER_CONCURRENCY,
    duration: 1000,
  },
});

emailWorker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

emailWorker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

console.log(`[worker] started with concurrency=${env.WORKER_CONCURRENCY}`);

/**
 * RESTART RECOVERY
 * On boot, scan Postgres for every job that is not yet in a terminal state
 * (sent/failed) and re-add it to BullMQ using its DB id as the jobId.
 * Because BullMQ jobIds are unique, any job that BullMQ *already* has
 * persisted in Redis (i.e. survived the restart on its own, which is the
 * common case since Redis is persistent via AOF in docker-compose) is
 * simply a no-op "duplicate add" and is ignored by BullMQ - so this is safe
 * to run every single time the worker boots, and nothing is ever double-sent.
 */
async function recoverPendingJobs() {
  const pending = await EmailJobs.listPendingForRecovery();
  let recovered = 0;
  for (const row of pending) {
    const existing = await job_lookup(row.id);
    if (existing) continue; // already tracked in BullMQ, nothing to do
    await enqueueEmailJob(
      {
        emailJobId: row.id,
        senderId: row.sender_id!,
        userId: row.user_id,
        recipientEmail: row.recipient_email,
        subject: row.subject,
        body: row.body,
      },
      new Date(row.scheduled_time)
    );
    recovered++;
  }
  if (recovered > 0) console.log(`[worker] recovery: re-enqueued ${recovered} pending job(s) after restart`);
}

async function job_lookup(id: string) {
  const { emailQueue } = await import("./emailQueue");
  return emailQueue.getJob(id);
}

recoverPendingJobs().catch((err) => console.error("[worker] recovery scan failed:", err));
