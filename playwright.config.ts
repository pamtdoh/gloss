import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  testMatch: /.*\.pw\.ts/,
  timeout: 30_000,
  workers: 1,
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
