import fs from 'node:fs'
import { defineConfig } from '@playwright/test'

// The checks in e2e/ look at the site the way crawlers, language models and
// browser-driving agents do. They run against a server that is already up:
//
//   npm run build && npm run preview        (in another terminal, with the backend running)
//   npm run test:agents
//
// SITE_URL points them somewhere else, e.g. SITE_URL=https://vortexml.ro for
// the read-only checks against the live site.

// Use the Chromium that is installed on the machine when there is one;
// otherwise Playwright's own (`npx playwright install chromium`).
const systemChromium = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((file) => fs.existsSync(file))

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: process.env.SITE_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? systemChromium },
    trace: 'retain-on-failure',
  },
})
