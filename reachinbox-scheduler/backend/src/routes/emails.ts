import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { Senders, Campaigns, EmailJobs } from "../db/models";
import { enqueueEmailJob } from "../queues/emailQueue";
import { indexEmailJob } from "../services/elasticsearch";
import { env } from "../config/env";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Parses either a proper CSV (with an "email" column) or a loose text/CSV
// blob and extracts every valid-looking email address via regex - robust to
// whatever leads format a user drops in.
function extractEmails(buffer: Buffer): string[] {
  const text = buffer.toString("utf-8");
  const found = new Set<string>();
  try {
    const records = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true });
    for (const row of records) {
      for (const val of Object.values(row)) {
        const matches = String(val).match(EMAIL_REGEX);
        matches?.forEach((m) => found.add(m.toLowerCase()));
      }
    }
  } catch {
    // fall through to plain regex scan below
  }
  const matches = text.match(EMAIL_REGEX);
  matches?.forEach((m) => found.add(m.toLowerCase()));
  return Array.from(found);
}

// POST /api/emails/parse-leads - upload CSV/text, return detected emails + count
router.post("/parse-leads", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const emails = extractEmails(req.file.buffer);
  res.json({ count: emails.length, emails });
});

// POST /api/emails/schedule - main compose/schedule endpoint
router.post("/schedule", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const {
      subject,
      body,
      recipients, // string[] of emails (from parsed CSV or manual entry)
      startTime, // ISO string
      delayMs, // min delay between sends, ms
      hourlyLimit, // max emails/hour for this campaign's sender
    } = req.body as {
      subject: string;
      body: string;
      recipients: string[];
      startTime: string;
      delayMs?: number;
      hourlyLimit?: number;
    };

    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0 || !startTime) {
      return res.status(400).json({ error: "subject, body, recipients[], and startTime are required" });
    }

    const minDelayMs = delayMs ?? env.DEFAULT_MIN_DELAY_MS;
    const maxEmailsPerHour = hourlyLimit ?? env.DEFAULT_MAX_EMAILS_PER_HOUR;

    const sender = await Senders.getOrCreateDefault(req.userId!, { minDelayMs, maxEmailsPerHour });

    const campaign = await Campaigns.create({
      userId: req.userId!,
      senderId: sender.id,
      subject,
      body,
      startTime: new Date(startTime),
      minDelayMs,
      maxEmailsPerHour,
    });

    // Stagger scheduled_time by (index * delayMs) so ordering + spacing is
    // visible up front, even before the hourly-limit reshuffling in the worker
    // potentially pushes some further out.
    const baseTime = new Date(startTime).getTime();
    const rows = recipients.map((email, i) => ({
      campaignId: campaign.id,
      userId: req.userId!,
      senderId: sender.id,
      recipientEmail: email,
      subject,
      body,
      scheduledTime: new Date(baseTime + i * minDelayMs),
    }));

    const created = await EmailJobs.bulkCreate(rows);

    // Enqueue every job as a BullMQ delayed job; jobId = row id => idempotent.
    for (const row of created) {
      await enqueueEmailJob(
        {
          emailJobId: row.id,
          senderId: sender.id,
          userId: req.userId!,
          recipientEmail: row.recipient_email,
          subject: row.subject,
          body: row.body,
        },
        new Date(row.scheduled_time)
      );
      await EmailJobs.markQueued(row.id);
      indexEmailJob({
        id: row.id,
        recipient_email: row.recipient_email,
        subject: row.subject,
        body: row.body,
        status: "queued",
        user_id: req.userId!,
        scheduled_time: row.scheduled_time,
      }).catch(() => {});
    }

    res.json({ campaignId: campaign.id, scheduled: created.length });
  } catch (err: any) {
    console.error("[emails] schedule failed:", err);
    res.status(500).json({ error: "Failed to schedule emails" });
  }
});

router.get("/scheduled", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await EmailJobs.listByUser(req.userId!, "scheduled");
  res.json({ items: rows });
});

router.get("/sent", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await EmailJobs.listByUser(req.userId!, "sent");
  res.json({ items: rows });
});

export default router;
