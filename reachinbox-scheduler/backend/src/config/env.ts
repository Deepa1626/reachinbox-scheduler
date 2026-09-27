import dotenv from "dotenv";
dotenv.config();

function get(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  PORT: parseInt(process.env.PORT || "4000", 10),
  SESSION_SECRET: get("SESSION_SECRET", "dev_secret"),
  JWT_SECRET: get("JWT_SECRET", "dev_jwt_secret"),
  FRONTEND_URL: get("FRONTEND_URL", "http://localhost:3000"),

  DATABASE_URL: get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/reachinbox"),
  REDIS_URL: get("REDIS_URL", "redis://localhost:6379"),
  ELASTICSEARCH_URL: get("ELASTICSEARCH_URL", "http://localhost:9200"),

  SMTP_HOST: get("SMTP_HOST", "smtp.ethereal.email"),
  SMTP_PORT: parseInt(process.env.SMTP_PORT || "587", 10),
  SMTP_USER: get("SMTP_USER"),
  SMTP_PASS: get("SMTP_PASS"),

  GOOGLE_CLIENT_ID: get("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: get("GOOGLE_CLIENT_SECRET"),
  GOOGLE_CALLBACK_URL: get("GOOGLE_CALLBACK_URL", "http://localhost:4000/api/auth/google/callback"),

  SLACK_CLIENT_ID: get("SLACK_CLIENT_ID"),
  SLACK_CLIENT_SECRET: get("SLACK_CLIENT_SECRET"),
  SLACK_REDIRECT_URI: get("SLACK_REDIRECT_URI", "http://localhost:4000/api/slack/oauth/callback"),

  DEFAULT_MIN_DELAY_MS: parseInt(process.env.DEFAULT_MIN_DELAY_MS || "2000", 10),
  DEFAULT_MAX_EMAILS_PER_HOUR: parseInt(process.env.DEFAULT_MAX_EMAILS_PER_HOUR || "200", 10),
  WORKER_CONCURRENCY: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
};
