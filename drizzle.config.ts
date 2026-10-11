import { defineConfig } from "drizzle-kit";
import { databaseConfig } from "./src/db/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: databaseConfig.sqlite ? "./src/db/migrations-sqlite" : "./src/db/migrations",
  dialect: databaseConfig.sqlite ? "sqlite" : "postgresql",
  dbCredentials: {
    url: databaseConfig.url,
  },
});
