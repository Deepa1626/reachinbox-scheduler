import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { Users } from "../db/models";
import { signSession, requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_CALLBACK_URL);

// Step 1: redirect the browser to Google's consent screen.
router.get("/google", (req, res) => {
  const url = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    prompt: "consent",
  });
  res.redirect(url);
});

// Step 2: Google redirects back here with a ?code=...
router.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code as string;
    const { tokens } = await googleClient.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token!,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new Error("No payload from Google ID token");

    const user = await Users.findOrCreateByGoogle({
      googleId: payload.sub,
      email: payload.email!,
      name: payload.name,
      avatarUrl: payload.picture,
    });

    const sessionToken = signSession(user.id);
    res.cookie("session_token", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 3600 * 1000,
    });
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (err: any) {
    console.error("[auth] google callback failed:", err.message);
    res.redirect(`${env.FRONTEND_URL}/?error=auth_failed`);
  }
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await Users.findById(req.userId!);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    slackConnected: !!user.slack_webhook_url,
  });
});

router.post("/logout", (req, res) => {
  res.clearCookie("session_token");
  res.json({ ok: true });
});

export default router;
