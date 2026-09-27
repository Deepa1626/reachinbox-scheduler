import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import { env } from "./config/env";
import { emailQueue } from "./queues/emailQueue";
import authRoutes from "./routes/auth";
import emailRoutes from "./routes/emails";
import slackRoutes from "./routes/slack";
import searchRoutes from "./routes/search";
import { ensureIndex } from "./services/elasticsearch";

const app = express();

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// --- Live BullMQ dashboard, per assignment requirement ---
// Available at GET /admin/queues - real-time view of every scheduled,
// active, completed, and failed job in the email-send-queue.
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  // Cast avoids a benign type-def mismatch between @bull-board and the
  // installed bullmq version's Job.progress type; runtime behavior is fine.
  queues: [new BullMQAdapter(emailQueue) as any],
  serverAdapter,
});
app.use("/admin/queues", serverAdapter.getRouter());

app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/slack", slackRoutes);
app.use("/api/search", searchRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

ensureIndex().catch(() => {});

export default app;
