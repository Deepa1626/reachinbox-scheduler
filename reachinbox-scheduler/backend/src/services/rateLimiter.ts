import { redisConnection } from "../config/redis";

/**
 * Redis-backed sliding-hour-window counter, keyed by sender + hour bucket.
 * This is safe across multiple worker processes/instances because the
 * INCR + EXPIRE happen atomically in Redis, not in worker memory.
 *
 * Key shape: ratelimit:{senderId}:{yyyyMMddHH}
 *
 * Trade-off: this is a *fixed* hour window (e.g. 2:00-2:59), not a rolling
 * 60-minute window. That's simpler and cheap (single INCR), and matches the
 * "MAX_EMAILS_PER_HOUR" framing in the spec. A rolling window (sorted-set based)
 * would be more precise but costs more Redis ops per send - noted as a
 * possible upgrade in the README.
 */

function hourBucket(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    String(date.getUTCDate()).padStart(2, "0") +
    String(date.getUTCHours()).padStart(2, "0")
  );
}

export function startOfNextHour(date: Date): Date {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

export async function tryConsumeSlot(
  senderId: string,
  maxPerHour: number,
  at: Date = new Date()
): Promise<{ allowed: boolean; currentCount: number }> {
  const key = `ratelimit:${senderId}:${hourBucket(at)}`;
  const count = await redisConnection.incr(key);
  if (count === 1) {
    // first increment in this bucket - set expiry so old buckets self-clean
    await redisConnection.expire(key, 3600 * 2);
  }
  if (count > maxPerHour) {
    // over budget - roll back our increment so we don't permanently inflate the counter
    await redisConnection.decr(key);
    return { allowed: false, currentCount: count - 1 };
  }
  return { allowed: true, currentCount: count };
}

// Simple per-sender "min delay between sends" enforcement using a Redis key
// storing the timestamp of the last send. Combined with BullMQ's own
// `limiter` option on the worker (see worker.ts) as a belt-and-braces guard.
export async function millisSinceLastSend(senderId: string): Promise<number> {
  const key = `lastsend:${senderId}`;
  const last = await redisConnection.get(key);
  if (!last) return Number.MAX_SAFE_INTEGER;
  return Date.now() - parseInt(last, 10);
}

export async function markSent(senderId: string) {
  await redisConnection.set(`lastsend:${senderId}`, Date.now().toString());
}
