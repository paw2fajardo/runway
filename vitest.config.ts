import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Existing schema assertions inspect production PostgreSQL metadata.
    env: { DATABASE_URL: "postgres://localhost/runway_test" },
  },
});
