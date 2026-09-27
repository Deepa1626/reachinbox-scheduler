import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env";

export const esClient = new Client({ node: env.ELASTICSEARCH_URL });

export const EMAIL_INDEX = "email_jobs";

export async function ensureIndex() {
  try {
    const exists = await esClient.indices.exists({ index: EMAIL_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: EMAIL_INDEX,
        mappings: {
          properties: {
            recipient_email: { type: "keyword" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            user_id: { type: "keyword" },
            scheduled_time: { type: "date" },
            sent_at: { type: "date" },
          },
        },
      });
      console.log(`[elasticsearch] created index "${EMAIL_INDEX}"`);
    }
  } catch (err: any) {
    console.warn("[elasticsearch] index setup skipped (ES not reachable?):", err.message);
  }
}

export async function indexEmailJob(job: {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  user_id: string;
  scheduled_time: string;
  sent_at?: string | null;
}) {
  try {
    await esClient.index({
      index: EMAIL_INDEX,
      id: job.id,
      document: job,
      refresh: "wait_for",
    });
  } catch (err: any) {
    // Search indexing is best-effort - never let ES downtime break email sending.
    console.warn("[elasticsearch] index failed:", err.message);
  }
}

export async function searchEmails(userId: string, query: string) {
  try {
    const result = await esClient.search({
      index: EMAIL_INDEX,
      query: {
        bool: {
          must: [{ term: { user_id: userId } }],
          should: [
            { match: { subject: query } },
            { match: { body: query } },
            { wildcard: { recipient_email: `*${query.toLowerCase()}*` } },
          ],
          minimum_should_match: 1,
        },
      },
      size: 100,
    });
    return result.hits.hits.map((h) => h._source);
  } catch (err: any) {
    console.warn("[elasticsearch] search failed:", err.message);
    return [];
  }
}
