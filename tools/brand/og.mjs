#!/usr/bin/env node
/**
 * Renders the link-preview image (the picture WhatsApp, Slack, X… show next to
 * a shared link) from og.html into frontend/public/og.jpg.
 *
 *   node og.mjs          # needs Chromium, ImageMagick, and tutorial-recorder's npm install
 *
 * shot.png is a frame of the Training page; replace it after a redesign.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '../tutorial-recorder/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../frontend/public/og.jpg');
const png = path.join(HERE, 'og.tmp.png');

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'],
});
try {
    const page = await browser.newPage();
    // 1200 × 630 is the size every preview crawler expects.
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.goto(`file://${path.join(HERE, 'og.html')}`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: png });
} finally {
    await browser.close();
}
// JPEG keeps it under 100 kB; WhatsApp ignores preview images that are too heavy.
execFileSync('magick', [png, '-quality', '86', '-sampling-factor', '4:2:0', '-interlace', 'JPEG', OUT]);
fs.rmSync(png);
console.log(`${OUT} — ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
