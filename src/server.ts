import connectPgSimple from "connect-pg-simple";
import session from "express-session";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrateDatabase, PostgresTenantStore } from "./database.js";
import { GithubOAuth } from "./oauth.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrateDatabase(pool);
const store = new PostgresTenantStore(pool);
const PgSession = connectPgSimple(session);
const sessionMiddleware = session({
  name: "tenant_saas.sid",
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  cookie: {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});
const oauth = new GithubOAuth({
  clientId: config.githubClientId,
  clientSecret: config.githubClientSecret,
  callbackUrl: `${config.baseUrl}/auth/github/callback`,
});
const app = createApp({ store, sessionMiddleware, oauth, baseUrl: config.baseUrl });
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`TenantInvariant SaaS listening on port ${config.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
