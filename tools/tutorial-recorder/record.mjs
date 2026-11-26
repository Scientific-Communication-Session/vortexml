#!/usr/bin/env node
/**
 * Records the Tutorial's clips by driving the real app.
 *
 * Nothing here is mocked: an account is created through the sign-up form, the
 * bundled sample dataset is uploaded through the real file input, the AI tutor
 * and the AI co-pilot are asked real questions, a model is trained on the
 * server and then used for predictions. Each scene is screen-recorded and
 * encoded as a short looping video (H.264 .mp4, plus a .png of its first frame
 * to stand in while it loads).
 *
 * Requirements: a running VortexML instance with ANTHROPIC_API_KEY set (most
 * scenes are about the AI features and make real LLM calls), Chromium/Chrome
 * and ffmpeg. Record against a scratch instance, not production: the run
 * creates an account, projects, a knowledge base and a linked device.
 *
 * Scenes, in order: account, upload, columns, autoconfig, parameters, train,
 * explain, background, predict, assistant, chat, leaderboard, learn, device.
 * They build on each other, so scenes that are not being recorded are still
 * performed where a later one needs them (just not captured).
 *
 * Time spent waiting for the AI to answer is fast-forwarded in the clips.
 *
 * Usage (from this directory):
 *   npm install
 *   VORTEX_URL=http://127.0.0.1:5173 node record.mjs            # all scenes
 *   node record.mjs --only upload,columns                       # some scenes
 *   node record.mjs --skip learn,device
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
// A real document for the Assistant scene: the notes that describe the sample datasets.
const NOTES = path.resolve(HERE, '../../sample-data/README.md');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-tutorial-'));

const VIEW = { width: 1280, height: 800 };
// Clip encoding. Video rather than GIF: at the full capture size and 30 frames
// a second an H.264 clip is still a fraction of the size of an 8 fps GIF.
const CLIP_FPS = 30;
const CLIP_CRF = 27; // x264 quality: lower is sharper and larger
// Waiting for an LLM is dead air: those stretches play this many times faster.
const WAIT_SPEED = 6;

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

/** Resolve a target to an element handle. Targets: CSS selector, {text, within}, or a handle. */
async function resolve(page, target) {
    if (typeof target?.boundingBox === 'function') return target;
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
// While a scene is being captured, `spans` collects the stretches spent waiting
// for an LLM (see `waiting`), as [start, end] in ms since the capture began.
let spans = null;
let captureStart = 0;

/** Run `fn`, which waits for the AI; that stretch is fast-forwarded in the clip. */
async function waiting(fn) {
    const from = Date.now();
    try {
        return await fn();
    } finally {
        if (spans) spans.push([from - captureStart, Date.now() - captureStart]);
    }
}

/** ffmpeg filter that plays the waiting stretches WAIT_SPEED times faster. */
function timeline(waits, total) {
    // Leave the moment a wait begins and the moment the answer lands at normal
    // speed, so the spinner and the reply are both seen arriving.
    const fast = waits.map(([a, b]) => [a / 1000 + 0.7, b / 1000 - 0.4]).filter(([a, b]) => b - a > 1.5);
    const tail = `fps=${CLIP_FPS},scale=${VIEW.width}:-2:flags=lanczos`;
    if (!fast.length) return { filter: tail, complex: false };
    const parts = [];
    let at = 0;
    for (const [a, b] of fast) {
        if (a > at) parts.push([at, a, 1]);
        parts.push([a, b, WAIT_SPEED]);
        at = b;
    }
    parts.push([at, total + 60, 1]);
    const split = parts.map((_, i) => `[v${i}]`).join('');
    const cuts = parts.map(([a, b, speed], i) =>
        `[v${i}]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[s${i}]`);
    const joined = parts.map((_, i) => `[s${i}]`).join('');
    return {
        filter: `[0:v]split=${parts.length}${split};${cuts.join(';')};${joined}concat=n=${parts.length}:v=1:a=0,${tail}[out]`,
        complex: true,
    };
}

/** Capture `scene` as <name>.mp4 — or, when the scene isn't wanted, just run it. */
async function record(page, name, scene, enabled = true) {
    if (!enabled) {
        await scene();
        return;
    }
    const webm = path.join(TMP, `${name}.webm`);
    const clip = path.join(OUT, `${name}.mp4`);
    process.stdout.write(`● ${name} … `);
    const recorder = await page.screencast({ path: webm, fps: CLIP_FPS });
    spans = [];
    captureStart = Date.now();
    try {
        await sleep(500);
        await scene();
        await sleep(1800); // hold the final frame before the loop restarts
    } finally {
        await recorder.stop();
    }
    const { filter, complex } = timeline(spans, (Date.now() - captureStart) / 1000);
    spans = null;
    // yuv420p + faststart: plays everywhere (Safari included) and starts
    // before the whole file has arrived.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm,
        ...(complex ? ['-filter_complex', filter, '-map', '[out]'] : ['-vf', filter]),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(CLIP_CRF),
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', clip]);
    // The first frame, as the poster: it holds the layout while the clip loads
    // and the clip then starts from exactly that picture.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', clip,
        '-frames:v', '1', '-update', '1', path.join(OUT, `${name}.png`)]);
    if (process.env.TUTORIAL_VIDEO) {
        fs.mkdirSync(process.env.TUTORIAL_VIDEO, { recursive: true });
        fs.copyFileSync(webm, path.join(process.env.TUTORIAL_VIDEO, `${name}.webm`));
    }
    console.log(`${(fs.statSync(clip).size / 1048576).toFixed(2)} MB`);
}

// ── The AI tutor (the floating chat, Novice accounts only) ──────────────────
const TUTOR = 'aside.chat-drawer:not(.auto-config-drawer)';

/** Wait for the tutor to finish answering, then read the answer top to bottom. */
async function tutorAnswers(page, { read = 3200 } = {}) {
    await page.waitForSelector(`${TUTOR}.chat-drawer--open`, { timeout: 15000 });
    const before = await page.$$eval(`${TUTOR} .chat-msg--assistant`, (els) => els.length);
    await waiting(() => page.waitForFunction((sel, n) => {
        const d = document.querySelector(sel);
        return d && !d.querySelector('.chat-msg__bubble--typing')
            && d.querySelectorAll('.chat-msg--assistant').length > n - 1
            && d.querySelector('.chat-msg:last-child')?.classList.contains('chat-msg--assistant');
    }, { timeout: 90000 }, TUTOR, before));
    // Start at the top of the reply, then drift down through it.
    await page.evaluate(async (sel, ms) => {
        const box = document.querySelector(`${sel} .chat-drawer__messages`);
        const last = box.querySelector('.chat-msg:last-child');
        const from = Math.max(0, last.offsetTop - box.offsetTop - 8);
        const to = box.scrollHeight - box.clientHeight;
        box.scrollTop = from;
        await new Promise((r) => setTimeout(r, 1300));
        const t0 = performance.now();
        await new Promise((resolve) => {
            const step = (now) => {
                const k = Math.min(1, (now - t0) / ms);
                box.scrollTop = from + (to - from) * k;
                if (k < 1) requestAnimationFrame(step); else resolve();
            };
            requestAnimationFrame(step);
        });
    }, TUTOR, read);
    await sleep(1200);
}

async function closeTutor(page) {
    await click(page, `${TUTOR} button[aria-label="Close"]`, 600);
}

/** Start the next scene with an empty tutor conversation (done off camera). */
async function resetTutor(page) {
    if (!(await page.$('button.chat-fab'))) return;
    await page.evaluate((sel) => {
        document.querySelector('button.chat-fab:not(.chat-fab--open)')?.click();
        return new Promise((r) => setTimeout(() => {
            document.querySelector(`${sel} button[aria-label="Clear conversation"]`)?.click();
            document.querySelector(`${sel} button[aria-label="Close"]`)?.click();
            setTimeout(r, 400);
        }, 400));
    }, TUTOR);
}

// ── Scenes ──────────────────────────────────────────────────────────────────
async function sceneAccount(page, account, enabled) {
    if (!enabled) {
        const signup = await api(page, 'POST', '/api/auth/signup', account);
        if (signup.status !== 201) throw new Error(`Could not create the recording account: ${JSON.stringify(signup.json)}`);
        await api(page, 'POST', '/api/auth/survey', { is_beginner: true });
        return;
    }
    await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle2' });
    await sleep(600);
    await record(page, '01-account', async () => {
        await type(page, 'input[placeholder="neural@vortex.ai"]', account.email, 22);
        await type(page, 'input[placeholder="VortexCoder99"]', account.username, 30);
        await type(page, 'input[placeholder="6+ characters"]', account.password, 22);
        await type(page, 'input[placeholder="Repeat password"]', account.password, 22);
        await click(page, 'button[type=submit]', 300);
        await page.waitForFunction(() => location.pathname === '/survey', { timeout: 20000 });
        await page.waitForSelector('.survey-question-card');
        await sleep(1500);
        // Two or more "beginner" answers make a Novice account — the kind that
        // gets the AI tutor.
        const cards = await page.$$eval('.survey-question-card', (els) => els.length);
        for (let i = 0; i < cards; i++) {
            await click(page, `.survey-question-card:nth-of-type(${i + 1}) label.survey-option:has(input[value="beginner"])`, 650);
        }
        await sleep(500);
        await click(page, 'button.survey-submit', 300);
        await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 });
        await waitText(page, 'Novice');
        await sleep(2600);
    });
}

async function sceneUpload(page, enabled) {
    await page.goto(`${BASE}/dataset`, { waitUntil: 'networkidle2' });
    await sleep(600);
    await record(page, '02-upload', async () => {
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
    }, enabled);
}

async function sceneColumns(page, enabled, tutor) {
    await record(page, '03-columns', async () => {
        const picker = await page.evaluate(() => document.querySelector('.column-picker').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, picker - 260, 800);
        await sleep(500);
        if (tutor && enabled) {
            // Not sure which column is which? Ask.
            await click(page, 'button.ask-button[aria-label="Ask the tutor about Features and Target"]', 500);
            await tutorAnswers(page);
            await closeTutor(page);
        }
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
    }, enabled);
}

async function sceneAutoConfig(page, enabled) {
    await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('AI Auto-Configure'));
        return b && !b.disabled;
    }, { timeout: 15000 });
    await record(page, '04-autoconfig', async () => {
        await click(page, { text: 'AI Auto-Configure', sel: '.auto-config-banner button' }, 900);
        await page.waitForSelector('.auto-config-drawer.chat-drawer--open');
        await sleep(500);
        await type(page, '.auto-config-drawer textarea', TEST_PROMPT, 12);
        await page.keyboard.press('Enter');
        // Wait for the co-pilot's reply (user bubble + a new assistant bubble, no spinner).
        await waiting(() => page.waitForFunction(() => {
            const d = document.querySelector('.auto-config-drawer');
            return d.querySelectorAll('.chat-msg--assistant').length >= 2 && !d.querySelector('.chat-msg__bubble--typing');
        }, { timeout: 60000 }));
        await sleep(2600);
        await click(page, { text: 'Generate Configuration', sel: '.auto-config-drawer button' }, 300);
        await waiting(() => page.waitForSelector('.auto-config-proposal', { timeout: 90000 }));
        await sleep(600);
        await page.evaluate(() => {
            const m = document.querySelector('.auto-config-drawer .chat-drawer__messages');
            m.scrollTo({ top: m.scrollHeight, behavior: 'smooth' });
        });
        await sleep(3600);
        await click(page, { text: 'Apply to Architect', sel: '.auto-config-drawer button' }, 900);
        await sleep(700);
        const arch = await page.evaluate(() => document.querySelector('.arch-card.selected').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, arch - 200, 900);
        await sleep(1300);
        const layers = await page.evaluate(() => document.querySelector('.layer-list').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, layers - 170, 1000);
        await sleep(2000);
    }, enabled);
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

const nameProject = async (page) => setField(page, await page.$('input.form-input[placeholder="MyProject"]'), PROJECT);

/** Settings entered by hand — only used when the co-pilot isn't available. */
async function architectByHand(page) {
    await click(page, { text: 'Multi-Layer Perceptron', sel: '.arch-card' }, 900);
    const layers = await page.evaluate(() => document.querySelector('.layer-list').getBoundingClientRect().top + window.scrollY);
    await scrollTo(page, layers - 190, 900);
    const inputs = await page.$$('.layer-list input.layer-neurons');
    const sizes = [32, 16];
    for (let i = 0; i < sizes.length && i < inputs.length; i++) await setField(page, inputs[i], sizes[i]);
    await setField(page, await formInput(page, 'Epochs'), 30);
    await setField(page, await formInput(page, 'Learning Rate'), 0.005);
}

/** Ask the tutor about a parameter, then about the values the co-pilot chose. */
async function sceneParameters(page, enabled) {
    await resetTutor(page);
    const lr = await page.evaluate((el) => el.value, await formInput(page, 'Learning Rate'));
    const epochs = await page.evaluate((el) => el.value, await formInput(page, 'Epochs'));
    const top = await page.evaluate(() => {
        const l = [...document.querySelectorAll('.form-label')].find((x) => x.textContent.trim().startsWith('Epochs'));
        return l.getBoundingClientRect().top + window.scrollY;
    });
    await scrollTo(page, top - 330, 600);
    await sleep(500);
    await record(page, '05-parameters', async () => {
        await moveTo(page, await formInput(page, 'Learning Rate').then((h) => h.asElement()));
        await sleep(700);
        await click(page, 'button.ask-button[aria-label="Ask the tutor about Learning Rate"]', 500);
        await tutorAnswers(page);
        // A follow-up about this model in particular.
        await type(page, `${TUTOR} textarea`,
            `My table has 800 rows and 5 features. The co-pilot set learning rate ${lr} and ${epochs} epochs — should I change either?`, 14);
        await page.keyboard.press('Enter');
        await sleep(400);
        await tutorAnswers(page);
        await closeTutor(page);
        await nameProject(page);
        await sleep(900);
    }, enabled);
}

async function sceneTrain(page, enabled) {
    await record(page, '06-train', async () => {
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
    }, enabled);
}

async function sceneExplain(page) {
    await record(page, '07-explain', async () => {
        await click(page, { text: 'Explain Results' }, 400);
        await waitText(page, 'Reviewing your training run', 10000).catch(() => {});
        await waiting(() => page.waitForFunction(
            () => [...document.querySelectorAll('.markdown-body')].some((m) => m.textContent.trim().length > 80),
            { timeout: 90000 }));
        await sleep(2800);
        // Read down through the verdict.
        await page.evaluate(async () => {
            const body = [...document.querySelectorAll('.markdown-body')].find((m) => m.textContent.trim().length > 80);
            let box = body;
            while (box && box.scrollHeight <= box.clientHeight + 4) box = box.parentElement;
            if (!box || box === document.body || box === document.documentElement) return;
            const to = box.scrollHeight - box.clientHeight;
            const t0 = performance.now();
            await new Promise((resolve) => {
                const step = (now) => {
                    const k = Math.min(1, (now - t0) / 4200);
                    box.scrollTop = to * k;
                    if (k < 1) requestAnimationFrame(step); else resolve();
                };
                requestAnimationFrame(step);
            });
        });
        await sleep(2400);
    });
    await page.evaluate(() => document.querySelector('button[aria-label="Close"]')?.click());
}

async function scenePredict(page) {
    await page.goto(`${BASE}/predict`, { waitUntil: 'networkidle2' });
    await waitText(page, 'Choose a model');
    await sleep(500);
    await record(page, '09-predict', async () => {
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

/** Train one more model through the API (no UI), and wait for it to finish. */
async function trainQuietly(page, overrides) {
    const loaded = await api(page, 'POST', '/api/demo/load', { key: 'student_performance' });
    await api(page, 'POST', '/api/model/configure', { ...loaded.json.config, ...overrides });
    const started = await api(page, 'POST', '/api/training/start', { device_id: null });
    if (!started.json?.job_id) throw new Error(`Could not start "${overrides.project_name}": ${JSON.stringify(started.json)}`);
    for (let i = 0; i < 240; i++) {
        const active = await api(page, 'GET', '/api/training/active');
        if (!(active.json?.jobs || []).length) return;
        await sleep(500);
    }
    throw new Error(`"${overrides.project_name}" did not finish training.`);
}

async function sceneBackground(browser, owner, account) {
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
    await api(page, 'POST', '/api/auth/signin', { email: account.email, password: account.password });
    await record(page, '08-background', async () => {
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

async function sceneAssistant(page) {
    await page.goto(`${BASE}/assistant`, { waitUntil: 'networkidle2' });
    await waitText(page, 'Knowledge bases');
    await sleep(600);
    await record(page, '10-assistant', async () => {
        await type(page, 'input[placeholder="New knowledge base name"]', 'Dataset notes', 30);
        await click(page, { text: 'Create', sel: 'button.btn-primary' }, 400);
        await waitText(page, 'No documents yet');
        await sleep(1100);
        await moveTo(page, { text: 'Add documents', sel: 'label.btn' });
        await sleep(500);
        const input = await page.$('label.btn input[type=file]');
        await input.uploadFile(NOTES);
        await waitText(page, '📄');
        await sleep(1500);
        await type(page, 'input[placeholder="Ask a question about your documents…"]',
            'Which of these datasets is synthetic, and where do the real ones come from?', 18);
        await page.keyboard.press('Enter');
        await waiting(() => page.waitForFunction(
            () => [...document.querySelectorAll('.markdown-body')].some((m) => m.textContent.trim().length > 60),
            { timeout: 120000 }));
        await sleep(900);
        const answer = await page.evaluate(() => document.querySelector('.markdown-body').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, answer - 220, 900);
        await sleep(3200);
        // …and the passages it was grounded in, at the end of the same panel.
        const end = await page.evaluate(() => document.querySelector('.markdown-body').closest('.glass-panel').getBoundingClientRect().bottom + window.scrollY);
        await scrollTo(page, end - VIEW.height + 40, 1600);
        await sleep(2600);
    });
}

async function sceneChat(page) {
    await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('textarea');
    // Bring the whole conversation panel, input included, onto the screen.
    await scrollTo(page, 80, 300);
    await sleep(700);
    await record(page, '11-chat', async () => {
        await type(page, 'textarea', 'My model scores 99% on training data but only 70% on validation. What is going on, and what should I try first?', 16);
        await page.keyboard.press('Enter');
        // Dead air until the first words arrive; the answer itself streams live.
        await waiting(() => page.waitForFunction(
            () => [...document.querySelectorAll('.markdown-body')].some((m) => m.textContent.replace('▍', '').trim().length > 20),
            { timeout: 120000 }));
        await page.waitForFunction(
            () => !document.body.innerText.includes('▍') && [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Regenerate')),
            { timeout: 180000 });
        await sleep(2800);
    });
}

async function sceneLeaderboard(page) {
    // Something to compare the tutorial model against: the same data with a
    // far too large learning rate, and with a tiny network.
    await trainQuietly(page, { lr: 1.0, project_name: 'Exam-Predictor-LR-1.0' });
    await trainQuietly(page, { layer_sizes: [2], project_name: 'Exam-Predictor-Tiny' });
    await page.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type=checkbox][aria-label^="Compare"]');
    // Those runs finished without this tab watching, so the site greets us with
    // "your training finished while you were away". Acknowledge it off camera.
    await waitText(page, 'while you were away', 6000).then(() => page.keyboard.press('Escape')).catch(() => {});
    await page.waitForFunction(() => !document.body.innerText.includes('while you were away'), { timeout: 5000 })
        .catch(() => page.evaluate(() => document.querySelector('.vx-modal button[aria-label="Close"], .vx-close')?.click()));
    await sleep(900);
    await record(page, '12-leaderboard', async () => {
        const boxes = await page.$$('input[type=checkbox][aria-label^="Compare"]');
        for (const box of boxes.slice(0, 4)) {
            await moveTo(page, box);
            await page.mouse.down(); await sleep(60); await page.mouse.up();
            await sleep(650);
        }
        await sleep(700);
        const charts = await page.evaluate(() => document.querySelector('.training-grid').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, charts - 140, 1000);
        await sleep(3400);
        await scrollTo(page, 0, 900);
        await click(page, { text: 'By val loss' }, 900);
        await sleep(2200);
    });
}

async function sceneLearn(page) {
    await page.goto(`${BASE}/learn`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.roadmap-node');
    await sleep(900);
    await record(page, '13-learn', async () => {
        await sleep(900);
        const first = await page.evaluate(() => document.querySelector('.roadmap-node').getBoundingClientRect().top + window.scrollY);
        await scrollTo(page, first - 250, 1400);
        await sleep(900);
        await scrollTo(page, first + 500, 2200);
        await sleep(700);
        // Any topic on screen opens a short explanation.
        const node = await page.evaluateHandle(() => [...document.querySelectorAll('.roadmap-node')]
            .find((n) => { const r = n.getBoundingClientRect(); return r.top > 180 && r.bottom < window.innerHeight - 120; }));
        await moveTo(page, node.asElement());
        await page.mouse.down(); await sleep(60); await page.mouse.up();
        await page.waitForSelector('.roadmap-popover');
        await sleep(2800);
        await click(page, '.popover-close', 700);
        await scrollTo(page, 0, 900);
        await click(page, { text: 'Courses', sel: 'button[role=tab]' }, 900);
        await page.waitForSelector('.bento-card');
        await sleep(1500);
        await click(page, '.bento-card', 400);
        await page.waitForSelector('.markdown-content');
        await sleep(1500);
        await scrollTo(page, 620, 2400);
        await sleep(1800);
    });
}

async function sceneDevice(page) {
    // The modal downloads the agent bundle; let it land in the temp directory.
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: TMP });
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle2' });
    await waitText(page, 'Your Devices');
    await sleep(700);
    await record(page, '14-device', async () => {
        await click(page, { text: 'Link a device' }, 700);
        await waitText(page, 'Link your own device');
        await type(page, 'input[placeholder="e.g. Home Mac Mini"]', 'Lab workstation', 40);
        await sleep(500);
        await click(page, { text: 'Create & Download Agent' }, 400);
        await waitText(page, 'is linked');
        await sleep(3400);
        await moveTo(page, 'button[title="Copy command to clipboard"]');
        await sleep(1800);
        await click(page, { text: 'Done' }, 800);
        await waitText(page, 'Offline');
        const row = await page.evaluate(() => {
            const el = [...document.querySelectorAll('.glass-panel')].find((p) => p.textContent.includes('Lab workstation') && p.textContent.includes('Offline'));
            return el.getBoundingClientRect().top + window.scrollY;
        });
        await scrollTo(page, row - 300, 800);
        await sleep(2600);
    });
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
        // Several buttons (delete, unlink, switch mode) ask with confirm().
        page.on('dialog', (d) => d.accept().catch(() => {}));
        await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });

        // The account everything is recorded with. AI Auto-Configure, the tutor,
        // saved models and the Predict page all need one — and the tutor needs
        // it to be a Novice account (as the tutorial tells the reader).
        const stamp = Date.now().toString(36).slice(-4);
        const account = { email: `ana.${stamp}@example.com`, username: `ana_${stamp}`, password: `learn-${stamp}-ml` };
        await sceneAccount(page, account, wants('account'));

        const tutor = Boolean((await api(page, 'GET', '/api/chat/status')).json?.available);
        const copilot = await api(page, 'GET', '/api/auto-config/status');
        if (!copilot.json?.available) {
            console.log(`○ AI scenes skipped — ${copilot.json?.reason || 'the AI features are unavailable on this server (no ANTHROPIC_API_KEY?).'}`);
        }
        const ai = Boolean(copilot.json?.available);

        const model = ['train', 'explain', 'predict', 'leaderboard'].some(wants);
        if (model || ['upload', 'columns', 'autoconfig', 'parameters'].some(wants)) {
            await sceneUpload(page, wants('upload'));
            await sceneColumns(page, wants('columns'), tutor);
            await waitText(page, 'Select Architecture');
            // The co-pilot designs the network. Without it (or when its clip
            // isn't being re-recorded) the same kind of model is entered by hand.
            if (ai && wants('autoconfig')) await sceneAutoConfig(page, true);
            else await architectByHand(page);
            if (tutor && wants('parameters')) await sceneParameters(page, true);
            else await nameProject(page);
            if (model) {
                await sceneTrain(page, wants('train'));
                if (ai && wants('explain')) await sceneExplain(page);
                if (wants('predict')) await scenePredict(page);
            }
        }
        if (wants('background')) await sceneBackground(browser, page, account);
        if (ai && wants('assistant')) await sceneAssistant(page);
        if (ai && wants('chat')) await sceneChat(page);
        if (wants('leaderboard')) await sceneLeaderboard(page);
        if (wants('learn')) await sceneLearn(page);
        if (wants('device')) await sceneDevice(page);
    } finally {
        await browser.close();
        fs.rmSync(TMP, { recursive: true, force: true });
    }
    console.log(`\nClips written to ${OUT}`);
}

main().catch((err) => {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
});
