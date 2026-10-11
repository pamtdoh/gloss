import { defineConfig } from "@playwright/test";

// Behavior only: the suites assert what the viewer does, not how it looks
// pixel for pixel. PW_CHROMIUM points at a local Chromium when the one
// Playwright would download isn't available.
export default defineConfig({
  testDir: "tests/browser",
  testMatch: /.*\.pw\.ts/,
  timeout: 30_000,
  workers: 1,
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
      },
    },
  ],
});
