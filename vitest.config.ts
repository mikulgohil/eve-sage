import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "ingestion/**/*.test.ts", "evals/**/*.test.ts", "agent/**/*.test.ts"],
  },
});
