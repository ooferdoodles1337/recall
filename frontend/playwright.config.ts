import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const localChromePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/google-chrome";
const launchOptions = existsSync(localChromePath) ? { executablePath: localChromePath } : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "../.playwright-mcp/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../.playwright-mcp/html-report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions,
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
