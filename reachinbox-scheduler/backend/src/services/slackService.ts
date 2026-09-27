import axios from "axios";
import { env } from "../config/env";

export function getSlackAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: "incoming-webhook,chat:write",
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackCode(code: string) {
  const resp = await axios.post(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  if (!resp.data.ok) {
    throw new Error(`Slack OAuth exchange failed: ${resp.data.error}`);
  }
  return {
    accessToken: resp.data.access_token as string,
    webhookUrl: resp.data.incoming_webhook?.url as string,
    teamName: resp.data.team?.name as string,
  };
}

/**
 * Fires a real Slack message via the stored incoming-webhook URL.
 * Silently no-ops (returns false) if the user hasn't connected Slack yet -
 * this must never throw or block the email pipeline.
 */
export async function notifyRateLimitHit(
  webhookUrl: string | null,
  details: { senderName: string; maxPerHour: number; queuedUntil: string }
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    await axios.post(webhookUrl, {
      text: `:warning: *Rate limit reached* for sender *${details.senderName}* (${details.maxPerHour}/hr). Remaining emails are being rescheduled into the next available hour window (from ${details.queuedUntil}).`,
    });
    return true;
  } catch (err: any) {
    console.error("[slack] failed to deliver notification:", err.message);
    return false;
  }
}
