-- ReachInbox Email Scheduler - schema
-- Run via `npm run migrate` (executes this file idempotently with IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  slack_access_token TEXT,          -- OAuth bot/user token (nullable until connected)
  slack_webhook_url TEXT,           -- incoming webhook URL from Slack OAuth (nullable)
  slack_team_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- A "sender" represents one Ethereal/SMTP identity emails go out from.
-- Rate limiting (emails/hour) is enforced per sender, per the assignment spec.
CREATE TABLE IF NOT EXISTS senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  smtp_user TEXT NOT NULL,
  smtp_pass TEXT NOT NULL,
  smtp_host TEXT NOT NULL DEFAULT 'smtp.ethereal.email',
  smtp_port INT NOT NULL DEFAULT 587,
  max_emails_per_hour INT NOT NULL DEFAULT 200,
  min_delay_ms INT NOT NULL DEFAULT 2000,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One row per campaign / compose action.
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES senders(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  min_delay_ms INT NOT NULL,
  max_emails_per_hour INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One row per recipient/email job. This is the source of truth for state;
-- BullMQ jobs reference this row's id as their idempotency key (jobId).
CREATE TABLE IF NOT EXISTS email_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES senders(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  scheduled_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | queued | sending | sent | failed | rescheduled
  attempts INT NOT NULL DEFAULT 0,
  bullmq_job_id TEXT,                       -- == email_jobs.id, kept for cross-reference/debugging
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs(status);
CREATE INDEX IF NOT EXISTS idx_email_jobs_user ON email_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_jobs_scheduled_time ON email_jobs(scheduled_time);

-- Needed for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
