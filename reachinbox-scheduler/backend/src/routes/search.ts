import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { searchEmails } from "../services/elasticsearch";

const router = Router();

// GET /api/search?q=... - full text search over sent/scheduled emails via Elasticsearch
router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const q = (req.query.q as string) || "";
  if (!q.trim()) return res.json({ items: [] });
  const items = await searchEmails(req.userId!, q);
  res.json({ items });
});

export default router;
