import { pool } from "../config/db";

export interface User {
  id: string;
  google_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  slack_access_token: string | null;
  slack_webhook_url: string | null;
  slack_team_name: string | null;
}

export interface EmailJobRow {
  id: string;
  campaign_id: string;
  user_id: string;
  sender_id: string | null;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_time: string;
  status: string;
  attempts: number;
  error_message: string | null;
  sent_at: string | null;
}

export const Users = {
  async findOrCreateByGoogle(profile: {
    googleId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }): Promise<User> {
    const existing = await pool.query<User>(
      `SELECT * FROM users WHERE google_id = $1`,
      [profile.googleId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const inserted = await pool.query<User>(
      `INSERT INTO users (google_id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [profile.googleId, profile.email, profile.name || null, profile.avatarUrl || null]
    );
    return inserted.rows[0];
  },

  async findById(id: string): Promise<User | null> {
    const r = await pool.query<User>(`SELECT * FROM users WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  async saveSlackConnection(
    userId: string,
    data: { accessToken?: string; webhookUrl: string; teamName?: string }
  ) {
    await pool.query(
      `UPDATE users SET slack_access_token = $1, slack_webhook_url = $2, slack_team_name = $3 WHERE id = $4`,
      [data.accessToken || null, data.webhookUrl, data.teamName || null, userId]
    );
  },

  async clearSlackConnection(userId: string) {
    await pool.query(
      `UPDATE users SET slack_access_token = NULL, slack_webhook_url = NULL, slack_team_name = NULL WHERE id = $1`,
      [userId]
    );
  },
};

export const Senders = {
  async getOrCreateDefault(userId: string, opts: { minDelayMs: number; maxEmailsPerHour: number }) {
    const existing = await pool.query(
      `SELECT * FROM senders WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [userId]
    );
    if (existing.rows[0]) {
  const updated = await pool.query(
    `UPDATE senders
     SET max_emails_per_hour = $1,
         min_delay_ms = $2
     WHERE id = $3
     RETURNING *`,
    [opts.maxEmailsPerHour, opts.minDelayMs, existing.rows[0].id]
  );
  return updated.rows[0];
}

    // In a real system each sender would have distinct Ethereal creds.
    // Here we lazily create one Ethereal test account per sender via emailSender.createEtherealAccount().
    const { createEtherealAccount } = await import("../services/emailSender");
    const acct = await createEtherealAccount();

    const inserted = await pool.query(
      `INSERT INTO senders (user_id, name, smtp_user, smtp_pass, smtp_host, smtp_port, max_emails_per_hour, min_delay_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, "Default Sender", acct.user, acct.pass, acct.smtp.host, acct.smtp.port, opts.maxEmailsPerHour, opts.minDelayMs]
    );
    return inserted.rows[0];
  },
};

export const Campaigns = {
  async create(data: {
    userId: string;
    senderId: string;
    subject: string;
    body: string;
    startTime: Date;
    minDelayMs: number;
    maxEmailsPerHour: number;
  }) {
    const r = await pool.query(
      `INSERT INTO campaigns (user_id, sender_id, subject, body, start_time, min_delay_ms, max_emails_per_hour)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [data.userId, data.senderId, data.subject, data.body, data.startTime, data.minDelayMs, data.maxEmailsPerHour]
    );
    return r.rows[0];
  },
};

export const EmailJobs = {
  async bulkCreate(
    rows: Array<{
      campaignId: string;
      userId: string;
      senderId: string;
      recipientEmail: string;
      subject: string;
      body: string;
      scheduledTime: Date;
    }>
  ): Promise<EmailJobRow[]> {
    if (rows.length === 0) return [];
    const values: string[] = [];
    const params: any[] = [];
    rows.forEach((r, i) => {
      const base = i * 6;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
      params.push(r.campaignId, r.userId, r.senderId, r.recipientEmail, r.subject, r.scheduledTime);
    });
    // body is identical across the campaign; bind once via a join to keep the query short.
    // NOTE: params bound through `VALUES (...)` arrive with an "unknown"/text type as far as
    // Postgres' planner is concerned, so we must cast each column explicitly in the SELECT list -
    // otherwise inserting into typed columns (uuid, timestamptz) fails with
    // "column ... is of type uuid but expression is of type text".
    const query = `
      INSERT INTO email_jobs (campaign_id, user_id, sender_id, recipient_email, subject, scheduled_time, body)
      SELECT
        v.campaign_id::uuid,
        v.user_id::uuid,
        v.sender_id::uuid,
        v.recipient_email,
        v.subject,
        v.scheduled_time::timestamptz,
        $${params.length + 1}
      FROM (VALUES ${values.join(",")}) AS v(
        campaign_id,
        user_id,
        sender_id,
        recipient_email,
        subject,
        scheduled_time
      )
      RETURNING *`;
    params.push(rows[0].body);
    const result = await pool.query<EmailJobRow>(query, params);
    return result.rows;
  },

  async setStatus(id: string, status: string, extra?: { error?: string; sentAt?: Date }) {
    await pool.query(
      `UPDATE email_jobs
       SET status = $1, error_message = COALESCE($2, error_message), sent_at = COALESCE($3, sent_at),
           attempts = attempts + 1, updated_at = now()
       WHERE id = $4`,
      [status, extra?.error || null, extra?.sentAt || null, id]
    );
  },

  async rescheduleTo(id: string, newTime: Date) {
    await pool.query(
      `UPDATE email_jobs SET status = 'rescheduled', scheduled_time = $1, updated_at = now() WHERE id = $2`,
      [newTime, id]
    );
  },

  async markQueued(id: string) {
    await pool.query(`UPDATE email_jobs SET status = 'queued', updated_at = now() WHERE id = $1`, [id]);
  },

  async getById(id: string): Promise<EmailJobRow | null> {
    const r = await pool.query<EmailJobRow>(`SELECT * FROM email_jobs WHERE id = $1`, [id]);
    return r.rows[0] || null;
  },

  async listByUser(userId: string, status: "scheduled" | "sent" | "all") {
    if (status === "all") {
      const r = await pool.query(
        `SELECT * FROM email_jobs WHERE user_id = $1 ORDER BY scheduled_time DESC LIMIT 500`,
        [userId]
      );
      return r.rows;
    }
    const statuses =
      status === "sent" ? ["sent", "failed"] : ["scheduled", "queued", "sending", "rescheduled"];
    const r = await pool.query(
      `SELECT * FROM email_jobs WHERE user_id = $1 AND status = ANY($2) ORDER BY scheduled_time ASC LIMIT 500`,
      [userId, statuses]
    );
    return r.rows;
  },

  // Every scheduled/queued job not yet picked up gets re-enqueued on boot.
  // This is how we survive restarts without duplicating anything already
  // sent, and without losing anything that was pending (see worker.ts + queues/emailQueue.ts).
  async listPendingForRecovery() {
    const r = await pool.query<EmailJobRow>(
      `SELECT * FROM email_jobs WHERE status IN ('scheduled','queued','rescheduled') ORDER BY scheduled_time ASC`
    );
    return r.rows;
  },
};
