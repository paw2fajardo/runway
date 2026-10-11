import * as dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"] });

export function resolveDatabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = env.DATABASE_URL || (env.NODE_ENV === "production"
    ? "postgres://app_user:change_me_secure_pw@127.0.0.1:5433/finance_platform"
    : "file:runway.sqlite");
  const sqlite = url.startsWith("file:");
  if (sqlite && env.NODE_ENV === "production") {
    throw new Error("SQLite is only supported for local development. Production requires PostgreSQL.");
  }
  if (!sqlite && !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("DATABASE_URL must be a local file: URL or a PostgreSQL URL.");
  }
  return { url, sqlite };
}

export const databaseConfig = resolveDatabaseConfig();
