import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "node tests/e2e/mock-gitlab.mjs",
      url: "http://localhost:4000/api/v4/user",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
