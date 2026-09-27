import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getSlackAuthorizeUrl, exchangeSlackCode } from "../services/slackService";
import { Users } from "../db/models";
import { env } from "../config/env";

const router = Router();

// "Connect Slack" button in the dashboard hits this.
router.get("/oauth/start", requireAuth, (req: AuthedRequest, res) => {
  const url = getSlackAuthorizeUrl(req.userId!); // userId as `state` to identify the user on callback
  res.redirect(url);
});

router.get("/oauth/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    const userId = req.query.state as string;
    const result = await exchangeSlackCode(code);
    await Users.saveSlackConnection(userId, {
      accessToken: result.accessToken,
      webhookUrl: result.webhookUrl,
      teamName: result.teamName,
    });
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
  } catch (err: any) {
    console.error("[slack] oauth callback failed:", err.message);
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
  }
});

router.post("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  await Users.clearSlackConnection(req.userId!);
  res.json({ ok: true });
});

export default router;
