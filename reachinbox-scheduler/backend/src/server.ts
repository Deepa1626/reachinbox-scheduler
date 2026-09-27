import app from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
  console.log(`[server] Bull Board dashboard: http://localhost:${env.PORT}/admin/queues`);
  console.log(`[server] NOTE: run "npm run worker" in a separate process to actually send emails.`);
});
