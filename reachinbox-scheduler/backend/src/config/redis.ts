import Redis from "ioredis";
import { env } from "./env";

// Single shared connection for BullMQ + rate-limit counters.
// BullMQ requires maxRetriesPerRequest: null on connections it manages.
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (err) => {
  console.error("[redis] connection error:", err.message);
});
