import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Existing schema assertions inspect production PostgreSQL metadata.
    env: { DATABASE_URL: "postgres://localhost/runway_test" },
  },
});
