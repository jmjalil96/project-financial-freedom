import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 60_000,
  reporter: "list",
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node --input-type=module -e \"import { rmSync } from 'node:fs'; rmSync('.e2e-data', { force: true, recursive: true })\" && npm run build && NEXT_TELEMETRY_DISABLED=1 PFF_DATA_DIR=.e2e-data next start --hostname 127.0.0.1 --port 3100",
    reuseExistingServer: false,
    timeout: 180_000,
    url: "http://127.0.0.1:3100",
  },
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
