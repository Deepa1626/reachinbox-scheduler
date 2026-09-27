export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  slackConnected: boolean;
}

export interface EmailJob {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_time: string;
  status: "scheduled" | "queued" | "sending" | "sent" | "failed" | "rescheduled";
  sent_at: string | null;
  error_message: string | null;
}
