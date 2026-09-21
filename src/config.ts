export type AppConfig = {
  port: number;
  baseUrl: string;
  databaseUrl: string;
  sessionSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  secureCookies: boolean;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(): AppConfig {
  const baseUrl = required("BASE_URL").replace(/\/$/, "");
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return {
    port: Number(process.env.PORT ?? 3000),
    baseUrl,
    databaseUrl:
      process.env.DATABASE_URL?.trim() ||
      `postgresql://${encodeURIComponent(required("POSTGRES_USER"))}:${encodeURIComponent(required("POSTGRES_PASSWORD"))}@${required("PGHOST")}:${process.env.PGPORT ?? "5432"}/${encodeURIComponent(required("POSTGRES_DB"))}`,
    sessionSecret,
    githubClientId: required("GITHUB_CLIENT_ID"),
    githubClientSecret: required("GITHUB_CLIENT_SECRET"),
    secureCookies: baseUrl.startsWith("https://"),
  };
}
