#!/usr/bin/env node
/**
 * Records the Tutorial page's GIFs by driving the real app.
 *
 * Nothing here is mocked: a throwaway account is created, the bundled sample
 * dataset is uploaded through the real file input, the AI co-pilot is asked the
 * tutorial's test prompt, a model is trained on the server and then used for
 * predictions. Each scene is screen-recorded and converted to a GIF.
 *
 * Requirements: a running VortexML instance, Chromium/Chrome, ffmpeg.
 *
 * Scenes: upload, columns, architect, autoconfig, train, background, predict.
 * `autoconfig` makes two real LLM calls, so it needs ANTHROPIC_API_KEY set on
 * the server; when the co-pilot is unavailable that scene is skipped with a
 * note and everything else is still recorded.
 *
 * Usage (from this directory):
 *   npm install
 *   VORTEX_URL=http://127.0.0.1:5173 node record.mjs            # all scenes
 *   node record.mjs --only upload,columns                       # some scenes
 *   node record.mjs --only autoconfig                           # once a key is set
 *
 * Environment:
 *   VORTEX_URL      app to record            (default http://127.0.0.1:5173)
 *   CHROME_PATH     browser executable       (default: first one found)
 *   TUTORIAL_OUT    output directory         (default ../../frontend/public/tutorial)
 *   TUTORIAL_VIDEO  also keep the raw .webm captures in this directory
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.VORTEX_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = path.resolve(process.env.TUTORIAL_OUT || path.join(HERE, '../../frontend/public/tutorial'));
const CSV = path.resolve(HERE, '../../sample-data/student_performance.csv');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-tutorial-'));

const VIEW = { width: 1280, height: 800 };
// GIF encoding. The UI is flat colour on a dark background, so a small palette
// with no dithering stays crisp and roughly halves the file size.
const GIF_WIDTH = 880;
const GIF_FPS = 8;
const GIF_COLORS = 128;

// Keep in sync with TEST_PROMPT in frontend/src/pages/Tutorial.tsx.
const TEST_PROMPT = 'I want to predict whether a student will pass their final exam from their '
    + 'study habits. It is a yes/no answer and every row is a different student. '
    + 'I am a beginner, so keep it simple and quick to train.';

const FEATURES = ['hours_studied', 'previous_score', 'attendance_rate', 'sleep_hours', 'assignments_done'];
const TARGET = 'passed';
const PROJECT = 'Exam-Predictor';

const args = process.argv.slice(2);
const listArg = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()) : null;
};
const only = listArg('--only');
const skip = listArg('--skip') || [];
const wants = (scene) => (only ? only.includes(scene) : !skip.includes(scene));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ].filter(Boolean);
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) throw new Error('No Chrome/Chromium found — set CHROME_PATH.');
    return found;
}

// ── A visible cursor ────────────────────────────────────────────────────────
// Headless screen captures have no mouse pointer, which makes a tutorial hard
// to follow. This draws one that tracks the real (synthetic) mouse events and
// ripples on click.
function installCursor() {
    const mount = () => {
        if (document.getElementById('__rec_cursor')) return;
        const style = document.createElement('style');
        style.textContent = `
            #__rec_cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 26px; height: 26px;
                pointer-events: none; transform: translate(-100px, -100px);
                filter: drop-shadow(0 2px 6px rgba(0,0,0,.65)); }
            .__rec_ripple { position: fixed; z-index: 2147483646; width: 14px; height: 14px; margin: -7px 0 0 -7px;
                border-radius: 50%; pointer-events: none; border: 2px solid rgba(196,181,253,.95);
                background: rgba(139,92,246,.35); animation: __rec_rip .55s ease-out forwards; }
            @keyframes __rec_rip { to { transform: scale(4.2); opacity: 0; } }
            /* keep the recording steady */
            html { scroll-behavior: auto !important; }
        `;
        document.head.appendChild(style);
        const c = document.createElement('div');
        c.id = '__rec_cursor';
        c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5v17.2l4.6-4.3 3 6.6 2.9-1.3-3-6.5h6.4z" fill="#fff" stroke="#0b0b18" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        document.documentElement.appendChild(c);
        const move = (e) => { c.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`; };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mousedown', (e) => {
            move(e);
            const r = document.createElement('div');
            r.className = '__rec_ripple';
            r.style.left = `${e.clientX}px`;
            r.style.top = `${e.clientY}px`;
            document.documentElement.appendChild(r);
            setTimeout(() => r.remove(), 600);
        }, true);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
}

// ── Page helpers ────────────────────────────────────────────────────────────
let mouse = { x: 640, y: 420 };

async function newPage(browser) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(installCursor);
    return page;
}

const api = (page, method, url, body) => page.evaluate(async (m, u, b) => {
    const r = await fetch(u, {
        method: m, credentials: 'include',
        headers: b ? { 'Content-Type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, json: await r.json().catch(() => null) };
}, method, url, body);

const waitText = (page, text, timeout = 30000) =>
    page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

/** Smoothly scroll the window so `y` (page coordinate) is at the top. */
async function scrollTo(page, y, ms = 700) {
    await page.evaluate(async (target, duration) => {
        const start = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const end = Math.max(0, Math.min(target, max));
        const t0 = performance.now();
        await new Promise((resolve) => {
            const step = (now) => {
                const k = Math.min(1, (now - t0) / duration);
                const eased = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
                window.scrollTo(0, start + (end - start) * eased);
                if (k < 1) requestAnimationFrame(step); else resolve();
            };
            requestAnimationFrame(step);
        });
    }, y, ms);
    await sleep(150);
}

/** Resolve a target to an element handle. Targets: CSS selector, or {text, within}. */
async function resolve(page, target) {
    if (typeof target === 'string') {
        const el = await page.waitForSelector(target, { timeout: 15000 });
        return el;
    }
    const handle = await page.waitForFunction((t) => {
        const scope = t.within ? document.querySelector(t.within) : document;
        if (!scope) return null;
        const els = [...scope.querySelectorAll(t.sel || 'button, a, [role="button"]')];
        return els.find((e) => e.textContent.replace(/\s+/g, ' ').includes(t.text) && e.offsetParent !== null) || null;
    }, { timeout: 15000 }, target);
    return handle.asElement();
}

/** Bring an element comfortably into view (scrolling the page if needed). */
async function reveal(page, el) {
    const box = await el.boundingBox();
    if (!box) return;
    if (box.y < 110 || box.y + box.height > VIEW.height - 60) {
        const y = await page.evaluate(() => window.scrollY);
        await scrollTo(page, y + box.y - VIEW.height * 0.42);
    }
}

async function moveTo(page, target, { steps = 22 } = {}) {
    const el = await resolve(page, target);
    await reveal(page, el);
    const box = await el.boundingBox();
    if (!box) throw new Error(`Target has no box: ${JSON.stringify(target)}`);
    mouse = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(mouse.x, mouse.y, { steps });
    await sleep(220);
    return el;
}

async function click(page, target, pause = 500) {
    await moveTo(page, target);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
    await sleep(pause);
}

async function type(page, target, text, delay = 14) {
    await click(page, target, 200);
    await page.keyboard.type(text, { delay });
    await sleep(350);
}

async function setNumber(page, target, value) {
    const el = await moveTo(page, target);
    await el.click({ clickCount: 3 });
    await page.keyboard.type(String(value), { delay: 55 });
    await sleep(220);
}

// ── Recording ───────────────────────────────────────────────────────────────
async function record(page, name, scene) {
    const webm = path.join(TMP, `${name}.webm`);
    const gif = path.join(OUT, `${name}.gif`);
    process.stdout.write(`● ${name} … `);
    const recorder = await page.screencast({ path: webm });
    try {
        await sleep(500);
        await scene();
        await sleep(1500); // hold the final frame before the loop restarts
    } finally {
        await recorder.stop();
    }
    const filter = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];`
        + `[a]palettegen=max_colors=${GIF_COLORS}:stats_mode=diff[p];`
        + '[b][p]paletteuse=dither=none:diff_mode=rectangle';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-filter_complex', filter, gif]);
    // A still of the last frame: the page shows it to visitors who prefer
    // reduced motion, and it reserves the layout while the GIF loads.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.3', '-i', webm,
        '-vf', `scale=${GIF_WIDTH}:-1:flags=lanczos`, '-frames:v', '1', '-update', '1',
        path.join(OUT, `${name}.png`)]);
    if (process.env.TUTORIAL_VIDEO) {
        fs.mkdirSync(process.env.TUTORIAL_VIDEO, { recursive: true });
        fs.copyFileSync(webm, path.join(process.env.TUTORIAL_VIDEO, `${name}.webm`));
    }
    console.log(`${(fs.statSync(gif).size / 1048576).toFixed(2)} MB`);
}

// ── Scenes ──────────────────────────────────────────────────────────────────
async function sceneUpload(page) {
    await page.goto(`${BASE}/dataset`, { waitUntil: 'networkidle2' });
    await sleep(600);
    await record(page, '01-upload', async () => {
        await moveTo(page, '.upload-zone');
        await sleep(500);
        // The real upload path: hand the file to the page's own <input type=file>.
        const input = await page.$('.upload-zone input[type=file]');
        await input.uploadFile(CSV);
        await waitText(page, 'Data Preview');
        await sleep(1300);
        const top = await page.evaluate(() => document.querySelector('.data-table-wrapper').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, top - 190, 900);
        await sleep(1600);
    });
}

async function sceneColumns(page) {
    await record(page, '02-columns', async () => {
        const picker = await page.evaluate(() => document.querySelector('.column-picker').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, picker - 260, 800);
        await sleep(500);
        const colButton = (name, cls) => page.evaluateHandle((n, c) => {
            const item = [...document.querySelectorAll('.col-item')].find((i) => i.querySelector('.col-name').textContent.trim() === n);
            return item.querySelector(c);
        }, name, cls);
        for (const f of FEATURES) {
            const btn = (await colButton(f, '.btn-feat')).asElement();
            await reveal(page, btn);
            const box = await btn.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
            await sleep(140);
            await page.mouse.down(); await sleep(60); await page.mouse.up();
            await sleep(330);
        }
        const tgt = (await colButton(TARGET, '.btn-tgt')).asElement();
        const tb = await tgt.boundingBox();
        await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 18 });
        await sleep(200);
        await page.mouse.down(); await sleep(60); await page.mouse.up();
        await sleep(1500);
        await click(page, { text: 'Continue to Architecture Builder' }, 300);
        await page.waitForFunction(() => location.pathname === '/architect', { timeout: 15000 });
        await waitText(page, 'Select Architecture');
        await sleep(1200);
    });
}

async function sceneAutoConfig(page) {
    const status = await api(page, 'GET', '/api/auto-config/status');
    if (!status.json?.available) {
        console.log(`○ 03-autoconfig skipped — ${status.json?.reason || 'AI Auto-Configure is unavailable on this server.'}`);
        return;
    }
    await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('AI Auto-Configure'));
        return b && !b.disabled;
    }, { timeout: 15000 });
    await record(page, '03-autoconfig', async () => {
        await click(page, { text: 'AI Auto-Configure', sel: '.auto-config-banner button' }, 900);
        await page.waitForSelector('.auto-config-drawer.chat-drawer--open');
        await sleep(500);
        await type(page, '.auto-config-drawer textarea', TEST_PROMPT, 12);
        await page.keyboard.press('Enter');
        // Wait for the co-pilot's reply (user bubble + a new assistant bubble, no spinner).
        await page.waitForFunction(() => {
            const d = document.querySelector('.auto-config-drawer');
            return d.querySelectorAll('.chat-msg--assistant').length >= 2 && !d.querySelector('.chat-msg__bubble--typing');
        }, { timeout: 60000 });
        await sleep(2200);
        await click(page, { text: 'Generate Configuration', sel: '.auto-config-drawer button' }, 300);
        await page.waitForSelector('.auto-config-proposal', { timeout: 90000 });
        await sleep(600);
        await page.evaluate(() => {
            const m = document.querySelector('.auto-config-drawer .chat-drawer__messages');
            m.scrollTo({ top: m.scrollHeight, behavior: 'smooth' });
        });
        await sleep(3200);
        await click(page, { text: 'Apply to Architect', sel: '.auto-config-drawer button' }, 900);
        await sleep(700);
        const arch = await page.evaluate(() => document.querySelector('.arch-card.selected').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, arch - 200, 900);
        await sleep(1300);
        const layers = await page.evaluate(() => document.querySelector('.layer-list').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, layers - 170, 1000);
        await sleep(1800);
    });
}

/** The label → input lookup used on the Architect page's hyperparameter form. */
const formInput = (page, label) => page.evaluateHandle((l) => {
    const el = [...document.querySelectorAll('.form-label')].find((x) => x.textContent.trim().startsWith(l));
    return el.closest('.form-group').querySelector('input, select');
}, label);

async function setField(page, handle, value) {
    const el = handle.asElement();
    await reveal(page, el);
    const box = await el.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
    await sleep(200);
    await el.click({ clickCount: 3 });
    await page.keyboard.type(String(value), { delay: 60 });
    await sleep(450);
}

/** Configure the model by hand — the tutorial's main track. */
async function architectByHand(page) {
    await click(page, { text: 'Multi-Layer Perceptron', sel: '.arch-card' }, 900);
    const layers = await page.evaluate(() => document.querySelector('.layer-list').getBoundingClientRect().top + window.scrollY);
    await scrollTo(page, layers - 190, 900);
    await sleep(500);
    const inputs = await page.$$('.layer-list input.layer-neurons');
    const sizes = [32, 16];
    for (let i = 0; i < sizes.length && i < inputs.length; i++) await setField(page, inputs[i], sizes[i]);
    await setField(page, await formInput(page, 'Epochs'), 30);
    await setField(page, await formInput(page, 'Learning Rate'), 0.005);
    const nameInput = await page.$('input.form-input[placeholder="MyProject"]');
    await setField(page, nameInput, PROJECT);
    await sleep(700);
}

async function sceneArchitect(page) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    await record(page, '03-architect', () => architectByHand(page));
}

async function sceneTrain(page) {
    await record(page, '04-train', async () => {
        await click(page, { text: 'Start Training ⚡' }, 300);
        await page.waitForFunction(() => location.pathname === '/training', { timeout: 15000 });
        await waitText(page, 'Compute Device');
        await sleep(1400);
        await click(page, { text: 'Start Training', sel: '.glass-panel button.btn' }, 200);
        await sleep(350);
        const chart = await page.evaluate(() => document.querySelector('.training-top-bar').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, chart - 100, 700);
        await waitText(page, 'Final loss', 120000);
        await sleep(2600);
        await scrollTo(page, chart + 330, 900);
        await sleep(2200);
    });
}

async function scenePredict(page) {
    await page.goto(`${BASE}/predict`, { waitUntil: 'networkidle2' });
    await waitText(page, 'Choose a model');
    await sleep(500);
    await record(page, '06-predict', async () => {
        // The newest model is the one just trained.
        const select = await moveTo(page, '.glass-panel select');
        const value = await page.evaluate((s) => [...s.options].find((o) => o.value)?.value, select);
        await sleep(300);
        await select.select(value);
        await waitText(page, 'Enter a scenario');
        await sleep(900);
        const field = (name) => page.evaluateHandle((n) => {
            const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === n);
            return label.parentElement.querySelector('input');
        }, name);
        const fill = async (row) => {
            for (const [name, v] of Object.entries(row)) {
                const input = (await field(name)).asElement();
                await reveal(page, input);
                const box = await input.boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
                await input.click({ clickCount: 3 });
                await page.keyboard.type(String(v), { delay: 50 });
                await sleep(180);
            }
        };
        // A diligent student…
        await fill({ hours_studied: 8, previous_score: 82, attendance_rate: 0.95, sleep_hours: 7.5, assignments_done: 18 });
        await click(page, { text: 'Predict scenario' }, 300);
        await page.waitForFunction(() => [...document.querySelectorAll('.panel-title')].some((p) => p.textContent.includes('Prediction')), { timeout: 30000 });
        await sleep(600);
        const result = await page.evaluate(() => {
            const p = [...document.querySelectorAll('.panel-title')].find((x) => x.textContent.includes('Prediction'));
            return p.getBoundingClientRect().top + window.scrollY;
        });
        await scrollTo(page, result - 330, 800);
        await sleep(2400);
        // …and one who barely showed up. Same model, different answer.
        await fill({ hours_studied: 1, previous_score: 45, attendance_rate: 0.5 });
        await click(page, { text: 'Predict scenario' }, 300);
        await sleep(2800);
    });
}

async function sceneBackground(browser, owner, credentials) {
    // Set up a deliberately long run (thousands of epochs) so there is
    // something still training to come back to, and start it from the first
    // browser. Small datasets otherwise finish in about a second.
    const loaded = await api(owner, 'POST', '/api/demo/load', { key: 'student_performance' });
    await api(owner, 'POST', '/api/model/configure', { ...loaded.json.config, epochs: 6000, project_name: PROJECT });
    await owner.goto(`${BASE}/training`, { waitUntil: 'networkidle2' });
    await click(owner, { text: 'Start Training', sel: '.glass-panel button.btn' }, 300);
    await waitText(owner, 'Epoch 150/', 120000);

    // A second browser: no cookies, no history — like opening the site on
    // another computer and signing in.
    const page = await newPage(browser);
    await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle2' });
    await api(page, 'POST', '/api/auth/signin', credentials);
    await record(page, '05-background', async () => {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await waitText(page, 'still running');
        await sleep(3200);
        await moveTo(page, { text: 'Enroll your own server', sel: '.vx-choice' });
        await sleep(900);
        await moveTo(page, { text: 'Talk to sales', sel: '.vx-choice' });
        await sleep(900);
        await click(page, { text: 'See the progress', sel: '.vx-choice' }, 400);
        await waitText(page, 'Training Log');
        await sleep(1500);
        const chart = await page.evaluate(() => document.querySelector('.training-top-bar').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, chart - 100, 900);
        await sleep(3500);
    });
    const jobs = await api(owner, 'GET', '/api/training/active');
    for (const j of jobs.json?.jobs || []) await api(owner, 'POST', '/api/training/stop', { job_id: j.job_id });
    await page.browserContext().close();
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: 'new',
        args: ['--no-sandbox', `--window-size=${VIEW.width},${VIEW.height}`, '--hide-scrollbars'],
    });
    try {
        const page = await newPage(browser);
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });

        // A throwaway account: AI Auto-Configure, saved models and the Predict
        // page all need one (as the tutorial tells the reader).
        const stamp = Date.now().toString(36);
        const credentials = { email: `tutorial-${stamp}@example.com`, password: `rec-${stamp}-pw` };
        const signup = await api(page, 'POST', '/api/auth/signup', { ...credentials, username: `tutorial_${stamp}` });
        if (signup.status !== 201) throw new Error(`Could not create the recording account: ${JSON.stringify(signup.json)}`);
        await api(page, 'POST', '/api/auth/survey', { is_beginner: true });

        const flow = ['upload', 'columns', 'architect', 'autoconfig', 'train', 'predict'].some(wants);
        if (flow) {
            // The scenes build on each other, so the ones that aren't being
            // re-recorded are still performed (just not captured).
            if (wants('upload')) await sceneUpload(page);
            else {
                await page.goto(`${BASE}/dataset`, { waitUntil: 'networkidle2' });
                await (await page.$('.upload-zone input[type=file]')).uploadFile(CSV);
                await waitText(page, 'Data Preview');
            }
            if (wants('columns')) await sceneColumns(page);
            else {
                await api(page, 'POST', '/api/dataset/configure', { feature_cols: FEATURES, target_col: TARGET });
                await page.goto(`${BASE}/architect`, { waitUntil: 'networkidle2' });
            }
            await waitText(page, 'Select Architecture');
            // The co-pilot first (when there is one), then the by-hand settings,
            // which are what the tutorial trains with either way.
            if (wants('autoconfig')) await sceneAutoConfig(page);
            if (wants('architect')) await sceneArchitect(page);
            else await architectByHand(page);
            if (wants('train')) await sceneTrain(page);
            else if (wants('predict')) {
                await click(page, { text: 'Start Training ⚡' }, 300);
                await page.waitForFunction(() => location.pathname === '/training', { timeout: 15000 });
                await click(page, { text: 'Start Training', sel: '.glass-panel button.btn' }, 200);
                await waitText(page, 'Final loss', 120000);
            }
            if (wants('predict')) await scenePredict(page);
        }
        if (wants('background')) await sceneBackground(browser, page, credentials);
    } finally {
        await browser.close();
        fs.rmSync(TMP, { recursive: true, force: true });
    }
    console.log(`\nGIFs written to ${OUT}`);
}

main().catch((err) => {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
});
