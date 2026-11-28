# VortexML — Deployment & Remote Training

This document covers running VortexML as a shared server and the
**"train on your own device"** feature: how a user links a personal machine
and trains on it through the web UI.

## Topology

```
        Browser (anyone, even a thin laptop)
                     │  https://vortexml.ro
                     ▼
        Cloudflare tunnel ──► 192.168.100.95:5173  (the built site, served by `vite preview`)
                                     │  proxies /api and /socket.io
                                     ▼
                          127.0.0.1:5050  (Flask + SocketIO)  ← the M4 Mac Mini
                                     ▲
                                     │  outbound SocketIO (works behind home NAT)
                          ┌──────────┴───────────┐
                     Node agent              Node agent
                  (user A's home Mac)     (user B's server)
```

The central M4 is an **orchestrator**:

- **Shared M4 card** → training runs in-process on the M4 itself.
- **A personal node** → the job is dispatched to that user's node agent, which
  trains locally and streams progress back through the central server to the
  browser. The browser sees identical live updates either way.

## Central server

`./start.sh` launches the Flask backend (`:5050`), builds the frontend and
serves it on `:5173`. `start.sh` sources `.env`, so set there:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the AI features: tutor, co-pilot, Explain Results, and the cloud option of the Assistant and Chat. |
| `VORTEX_PUBLIC_URL` | Public URL baked into downloaded node-agent bundles. Defaults to `https://vortexml.ro`. It is also the one public browser origin the API and sockets accept. |
| `VORTEX_USE_SQLITE` | Set `1` to skip the Postgres probe. |

### The frontend in production

The public site is a **build**, not the dev server. `npm run build` in
`frontend/` type-checks, bundles into `frontend/dist/` (minified, with
content-hashed file names under `assets/`), and then writes every page of
`public/sitemap.xml` out as static HTML (`scripts/prerender.mjs`), so crawlers,
link checkers and language models get the real text of `/privacy`, `/tutorial`
and the rest without running JavaScript. The browser hydrates that HTML.
`npm run preview` (`vite preview`) serves `dist/` on `:5173` and proxies `/api`
and `/socket.io` to the backend.

Pages that show data from the API are built with that data. The lessons are
Markdown files in `backend/courses/` (listed in `index.json`); the backend
serves them and the build reads the same files, so `/courses` and every
`/courses/<id>` are written out with their text. The data is embedded in the
page (`<script type="application/json" id="vx-data">`, read by
`src/preloaded.ts`) so the browser's first render matches. A lesson edited
there shows on the site after the next build.

Next to every page the build writes a **Markdown twin** (`dist/tutorial.md`,
`dist/index.md` for the home page, `dist/courses/<id>.md`): the same content
without the markup, for language models and agents. It is served at
`<page>.md` and at the page's own address to a request with
`Accept: text/markdown`. The build also appends every lesson to `llms-full.txt`.

**Publishing a frontend change** — no restart, so training runs are untouched:

```sh
cd frontend && npm run build
```

The server reads `dist/` from disk on every request, so the new build is live
as soon as the command ends. A failed build leaves the previous one in place.
Backend changes still need `systemctl --user restart vortexml`.

What the server adds (all in `frontend/vite.config.ts`):

- Security headers on every response: a Content-Security-Policy that only
  allows this origin (so anything loaded from another host — a font, a script,
  an image — will be blocked until it is listed there), HSTS, `nosniff`,
  `X-Frame-Options: DENY`, a Referrer-Policy and a Permissions-Policy.
- `http://` and `www.` are redirected to `https://vortexml.ro`.
- Caching: `assets/*` for a year (the names change with the content), pages
  never, other public files for four hours.
- An address the app has no page for answers 404 with the "Page not found"
  page; a missing file answers a plain 404, never the app shell.
- For crawlers and agents: every page carries a `Link` header naming
  `/llms.txt`, the sitemap and its Markdown twin; the twins are served as
  `text/markdown; charset=utf-8` with the page as their canonical address and
  `X-Robots-Tag: noindex`, so search engines index the page, not the copy.
- `dist/index.html` is the empty shell that pages outside the sitemap
  (`/profile`, `/survey`, the signed-in pages) start from.

For development use the dev server instead (`./start.sh --dev`, or the second
instance described further down): hot reload, no build step, no CSP.

### Tunnel

`vortexml.ro` is fronted by a Cloudflare tunnel pointing at that server
(`192.168.100.95:5173`, plain HTTP). It proxies `/api` and `/socket.io` on to
the backend, so the whole app is reachable through that one hostname and port
5050 never needs exposing.

Two things make this work and are already wired up:

- `frontend/vite.config.ts` lists `vortexml.ro` in `allowedHosts` (Vite answers
  "Blocked request. This host is not allowed" otherwise) and binds all
  interfaces.
- `VORTEX_PUBLIC_URL` is `https://vortexml.ro`. Moving to another domain means
  changing both, then `systemctl --user restart vortexml`.
- If the tunnel ever serves plain HTTP instead of HTTPS, change
  `VORTEX_PUBLIC_URL` accordingly — that string is what node agents dial.

### Auto-start (launchd service)

macOS has no `systemd` / `systemctl` — its equivalent is **launchd**, which
runs services defined by `.plist` files and managed with `launchctl`:

| Linux (systemd)         | macOS (launchd)                                  |
|-------------------------|--------------------------------------------------|
| `.service` unit file    | `.plist` (here `com.vortexml.server`)            |
| `systemctl start/stop`  | `launchctl kickstart` / `launchctl bootout`      |
| `systemctl enable`      | a `.plist` in `~/Library/LaunchAgents/`          |
| `journalctl`            | `logs/service.out.log`, `logs/service.err.log`   |

**1. Grant Full Disk Access.** The project lives under `~/Desktop`, which
macOS sandboxes — a `launchd` service is otherwise denied access to files
there (`Operation not permitted`). Grant `/bin/bash` Full Disk Access:

- open System Settings → Privacy & Security → **Full Disk Access**
  (`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"`)
- click **+**, press **⇧⌘G**, type `/bin/bash`, add it, and turn its toggle **on**

(Alternatively, move the project out of `~/Desktop` — e.g. to `~/vortexml` —
and no Full Disk Access is needed.)

**2. Install the service:**

```sh
bash deploy/install-service.sh
```

This writes a LaunchAgent to `~/Library/LaunchAgents/com.vortexml.server.plist`
and starts it. VortexML then starts automatically at login and is **restarted
automatically if it ever crashes** (`KeepAlive`).

For it to start at **boot with no manual login** (a true headless server),
also enable auto-login: System Settings → Users & Groups → *Automatically log
in as* → your user. A LaunchAgent runs in your user session; PostgreSQL —
installed via `brew services` — already auto-starts the same way.

Managing it:

```sh
launchctl print gui/$(id -u)/com.vortexml.server          # status
tail -f logs/service.out.log                              # logs
launchctl kickstart -k gui/$(id -u)/com.vortexml.server   # restart
bash deploy/uninstall-service.sh                          # remove
```

The Cloudflare tunnel is a separate process. On the Linux host it runs as its
own user service, `cloudflared-vortexml.service`, which reads the tunnel token
from `~/.config/cloudflared/vortexml.token` (mode 600, never in the repo):

```bash
systemctl --user status cloudflared-vortexml
journalctl --user -u cloudflared-vortexml -f     # routes pushed from the dashboard, origin errors
```

The routes (`vortexml.ro` and `www.vortexml.ro`, both → `http://localhost:5173`)
are set in the Cloudflare dashboard under the tunnel's public hostnames. `www`
is only an alias: a small plugin in `frontend/vite.config.ts` answers it (and
any `http://` request) with a 301 to `https://vortexml.ro`, so the login cookie
and the sockets have a single origin. Keep this tunnel on
one machine only: a second connector elsewhere receives a share of the traffic
and answers 502 because it cannot reach the origin.

## Train on your own device

### For the user

1. On the **Training** page, the **Compute Device** picker lists the shared
   M4 plus any of your linked machines. Pick one and press Start.
2. Press **Add your own device** → name it → a `.zip` bundle downloads.
3. On the machine you want to train on: unzip, then

   ```sh
   chmod +x run.sh && ./run.sh
   ```

   `run.sh` builds a virtualenv, installs dependencies, creates the folder
   layout, and launches the node agent. Leave the window open.
4. The device turns **Available** in the picker and on your **Profile**, where
   you can rename it, see its specs, or unlink it.

The bundle's `node_config.json` holds a pairing token unique to the account
that downloaded it — the node links to that account only. Unlinking the device
on the Profile page revokes the token.

### Data handling

- The dataset is uploaded to the central M4 and kept **only for the duration
  of the run** — for both local and remote training. When the run ends it is
  deleted from the central server (and from the node, for remote runs).
- Only **trained weights** (`.pt`) and **run stats** are persisted, as Project
  records under the user's account. Datasets are never stored long-term.

### Acceleration

Training auto-selects the best torch device: **Metal (MPS)** on Apple Silicon,
CUDA on NVIDIA, otherwise CPU. The node agent does the same on the user's
machine. Weights are always saved as a CPU-mapped `.pt` so they stay portable.

### Live system metrics

While a run trains, the machine doing the work streams CPU / GPU / RAM
utilisation and CPU / GPU temperature to the Training page — the top strip
plus the two **System Monitor** charts (temperature and utilisation).

Everything works with **no setup and no privileges** — no `sudo`, no
`powermetrics`. Temperature is read from the IOKit HID sensors on Apple
Silicon (`/sys/class/thermal` on Linux); GPU utilisation from IOAccelerator;
CPU/RAM from psutil. On a unified Apple Silicon SoC the CPU/GPU temperature
split is approximate — both come from on-die sensors.

## Local testing of the node feature

You can exercise the whole remote path on one machine — no tunnel needed:

1. Start the server: `./start.sh`.
2. In `.env`, set `VORTEX_PUBLIC_URL=http://127.0.0.1:5173`, or override per
   run with the `VORTEX_CENTRAL_URL` environment variable (below).
3. Sign in, **Add your own device**, download the bundle, unzip it elsewhere.
4. Run it pointed at your local server:

   ```sh
   VORTEX_CENTRAL_URL=http://127.0.0.1:5173 ./run.sh
   ```

5. The device appears as Available; pick it on the Training page and train.

## Background sessions, the queue and the demo

**Runs belong to the server, not to a browser tab.** Starting a run returns
immediately; the job trains in the background and records everything it emits
(model info, every epoch, recent hardware samples). Any browser that belongs to
the same account — or, for visitors without an account, the same browser — can
ask what is going on and re-attach:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/training/active` | The caller's running + queued runs, and their last finished run (kept 24 h). Polled by every page. |
| `POST /api/training/jobs/<id>/attach` | Join the run's socket room and get a snapshot to redraw it from the first epoch. |
| `DELETE /api/training/queue/<id>` | Leave the queue. |
| `POST /api/training/stop` | Stop a run (owner only). |

In the UI this is the **Training n%** pill in the navbar, the **Welcome back**
prompt shown when a tab discovers a run it did not start, and the Training
dashboard restoring the full curve.

**The queue.** Each device trains one model at a time; further runs wait in a
FIFO queue per device and start on their own. The shared Mac mini is the free
tier, so this is where queueing happens — a personal node only ever runs its
owner's jobs. Queued runs keep a private copy of their dataset.

**Limits to know about**

- Jobs, queues and the replay buffers live in the server process's memory.
  **Restarting the service ends any run in progress and empties the queue** —
  check `GET /api/devices` (or the Training page) is idle before deploying.
- Following a run from a *different* browser requires an account. An anonymous
  visitor's runs are tied to their session cookie.
- Fair-use caps (constants near the top of `backend/app.py`): one caller holds
  at most 3 runs training or waiting, a device's queue holds 25, and a network
  is refused when it is too large for the machine (the sum of neighbouring
  layer widths multiplied, or 50 million weights once built).
- A run whose loss stops being a number (learning rate too high) ends with
  "Training diverged" instead of carrying on.

**Things the backend relies on**

- **The visitor's address** comes from Cloudflare's `CF-Connecting-IP` header
  (every request reaches Flask from the frontend server on loopback). The rate
  limits on sign-in, sign-up, the contact form and the demo are per that
  address. If the site is ever served without Cloudflare in front, they fall
  back to one shared bucket.
- **Sessions** carry the account id and a mark derived from that account. A
  cookie whose account is gone, or was replaced by another with the same id,
  or whose password changed, is no longer a login.
- **Uploads and weights** are stored under names with a random part; the name
  a person sees is kept separately. Nothing a caller names can land on top of
  an existing file. An uploaded dataset is deleted when it is replaced, when
  the dataset is reset, when its run ends, when its owner's state expires, or
  when the server starts (nothing in memory points at it any more).
- **Node events** (`node_relay`, `node_complete`, …) are only accepted from the
  socket that registered as the node the run was sent to.
- **Which Claude model** is not written in the code. `backend/claude_models.py`
  asks the Models API for the newest Opus and the newest Sonnet when the server
  starts and every six hours after (the log line `Claude models in use: …` says
  what it found), so a new release is picked up by itself. The tutor, the
  co-pilot's questions and Explain Results use Sonnet; the co-pilot's decision
  and the default of the Assistant and Chat use Opus; a conversation saved under
  an older Opus or Sonnet continues on the current one. If the newest model
  turns a request down as malformed (new generations have dropped request
  options before), the request is answered by the generation pinned in that
  file (`PINNED`) and the log says so — that is the cue to test the new model
  and move the pin. Haiku in the model picker is a fixed version.
- **Calls to a language model** run in a worker thread (`_run_blocking` /
  `_iter_blocking`). The server is a single event loop: a handler that waits on
  the network itself stalls every other request until it returns.

**Tests.** `backend/test_*.py` run offline on a throwaway database
(`python test_smoke.py`, `test_authz.py`, `test_sessions.py`, `test_account.py`,
`test_hardening.py`, `test_auto_config_rules.py`). They write files into
`backend/uploads` next to the code, so run them in a worktree or a copy, not in
the live checkout. `test_auto_config.py` is different: it needs
`ANTHROPIC_API_KEY` and makes paid calls.

**Checks for crawlers and agents.** `frontend/e2e/` holds Playwright checks that
look at the site the way its non-human readers do. Run them against a server
that is up (the second instance described below, or the live site):

```sh
cd frontend
SITE_URL=http://127.0.0.1:5174 npm run test:agents   # everything, including the journey
SITE_URL=https://vortexml.ro npm run test:agents     # the read-only checks only
```

| File | Looks at the site as | Checks |
|---|---|---|
| `crawler.spec.ts` | a crawler or language model: plain HTTP, no browser | `robots.txt` admits search and AI crawlers and keeps them out of `/api`; every sitemap page is complete HTML with its own title, description, canonical URL, one `<h1>` and structured data; every page is reachable by links from the home page and no link is broken; every page has a Markdown twin; `llms.txt` links all work |
| `no-javascript.spec.ts` | a browser with JavaScript off | the pages are readable (nothing left invisible waiting for a script) and their links work |
| `agent.spec.ts` | an agent driving a browser through the accessibility tree | every control on every page has a role and a name, nothing clickable is a bare `<div>`, the menus work; then a whole journey by role and name only: sign up, load a sample dataset, pick columns, design, train, predict, delete the account |

The journey creates an account and a training run, so it only runs against a
local address (or with `AGENT_JOURNEY=1`). The checks use the Chromium
installed on the machine, or Playwright's own after
`npx playwright install chromium`.

What keeps them passing when the UI changes:

- **Every form field has a name**: a `<label htmlFor>`, or `aria-label` with
  the visible label's text. A button with only an icon gets an `aria-label`.
- **Anything that reacts to a click is a link or a button.** For a card or row
  that is clickable as a whole, put a `<button className="btn-text">` around
  its title (`styles/app.css`): its click reaches the card's handler, and
  keyboards, screen readers and agents get something to press. Use
  `aria-pressed` for a choice, `aria-haspopup="dialog"` for something that
  opens.
- **Navigation is a link** (`<Link to>`), not `navigate()` in a click handler:
  crawlers follow `href`s and nothing else.
- **A custom radio or switch keeps its real `<input>` on top**, invisible and
  covering the control, so a click lands on it.
- **A new public page** goes into `public/sitemap.xml` and `llms.txt`; a new
  lesson is a Markdown file plus an entry in `backend/courses/index.json`, and
  a line in both of those files.

**Demo + tutorial data.** `sample-data/` holds the datasets served by
`/api/demo/*` (see `sample-data/README.md`). The Demo page trains on the shared
device through the normal queue, so demo visitors and real users wait in the
same line.

**Account data.** Under "Your Data" on the Profile page a signed-in user can
download everything stored about them (`GET /api/auth/export`, one JSON file)
or delete the account (`DELETE /api/auth/account`, which asks for the password
again). Deletion is immediate and complete: it stops and dequeues the user's
jobs, removes their projects, weight files, knowledge bases (rows and the index
on disk), conversations, devices and enquiries, forgets their working state and
signs them out. `backend/test_account.py` checks all of that, and that nothing
belonging to another account is touched. The Privacy Policy promises both, so
keep them working.

**Sales enquiries.** The "Talk to sales" form stores rows in the
`sales_inquiries` table (`POST /api/sales/contact`, rate-limited to 5/hour per
caller). Nothing is emailed — read them from the database, e.g.

```sh
sqlite3 backend/vortex.db "SELECT created_at, name, email, company, interest, message FROM sales_inquiries ORDER BY id DESC;"
```

**Tutorial recordings.** The clips under `frontend/public/tutorial/` (silent
looping `.mp4` videos, each with a `.webp` of its first frame) are captured from
the running app by `tools/tutorial-recorder` (headless Chromium + ffmpeg).
Re-record after a UI change:

```sh
cd tools/tutorial-recorder && npm install
VORTEX_URL=http://127.0.0.1:5174 node record.mjs              # all 14 scenes
VORTEX_URL=http://127.0.0.1:5174 node record.mjs --only chat  # just one
```

The clips are recorded in a 1600 × 1000 window (`VIEW` in `record.mjs`) so a
whole page fits in the frame. After re-recording, raise `CLIPS_VERSION` in
`frontend/src/components/tutorialClips.ts`: the files keep their names, and
without a new address browsers and Cloudflare go on serving the old ones for
hours. Before re-recording, copy the clips being
replaced into `tools/tutorial-recorder/archive/` (see its README): earlier
recordings are kept there. Record against the second instance described below,
not the live one: the run
signs up an account and creates projects, a knowledge base and a linked device.
That instance needs `ANTHROPIC_API_KEY` in its environment, because most scenes
show the AI tutor, the co-pilot, Explain Results, the Assistant and Chat, and
make real LLM calls (a full run is roughly ten of them). Without a key those
scenes are skipped and the co-pilot's step falls back to settings typed by hand.

**Public-site files.** Everything a crawler, a link preview or an AI agent
reads lives in `frontend/public/` and `frontend/index.html`:

| File | For |
|---|---|
| `index.html` | The template of every page: Open Graph / Twitter tags (the WhatsApp, Slack and LinkedIn preview), JSON-LD for the site, and a `<noscript>` summary. The build fills in each page's own title, description and canonical URL, and adds the page's own JSON-LD (`WebPage`, breadcrumbs, and `LearningResource` for a lesson) and a link to its Markdown twin. |
| `og.jpg` | The 1200 × 630 preview picture. Regenerate with `node tools/brand/og.mjs` (edit `tools/brand/og.html`; `shot.png` there is the Demo page's finished training card). Messengers cache previews for days; raise the `?v=2` on the `og.jpg` URLs in `index.html` to force a refresh. |
| `logo.svg`, `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-*.png`, `site.webmanifest` | The mark and its icon sizes. The inline version is `src/components/Logo.tsx`; keep the drawings in sync, and re-render the `.png`/`.ico` sizes from `favicon.svg` when it changes. |
| `robots.txt`, `sitemap.xml` | Crawl rules and the list of public URLs. `robots.txt` names the AI crawlers and agents next to `*` (one group, the same rules) and carries a `Content-Signal` line allowing search and answering questions; it says nothing about training, which is yours to decide (`ai-train=yes` or `no`). **The sitemap is also the list of pages the build prerenders**: add a new public route there. Leave out pages that only redirect to the sign-in page. |
| `llms.txt`, `llms-full.txt` | A guide to the site for language models, linking to the Markdown twins, and the long version in one file. Update them when features or the tutorial change; the lessons at the end of `llms-full.txt` are added by the build. |

Per-page titles and descriptions are in `frontend/src/pageMeta.ts`. The
typefaces are served from the site itself (`frontend/src/assets/fonts`,
declared in `src/styles/fonts.css`), so no visitor's address goes to a font
host. Cabinet Grotesk's licence allows that but not keeping its files in a
repository, so they are git-ignored: `npm run dev` and `npm run build` first
run `scripts/fetch-fonts.mjs`, which downloads them from Fontshare once per
checkout (a first build therefore needs the network). The legal
pages (`/terms`, `/privacy`, `/cookies`, `/about`) take the operator's name, the
contact address and the "last updated" date from `frontend/src/site.ts`; while
`contactEmail` is empty they point readers to the contact form instead.

Cloudflare can override `robots.txt` and block AI crawlers on its own (Security
→ Bots → "Block AI bots" / "Manage robots.txt"). If agents report being blocked
while `robots.txt` here allows them, check that setting.

**A second instance for development.** To work on the app without touching the
live one, run a copy on other ports:

```sh
# backend (own database, own port)
VORTEX_PORT=5051 SQLALCHEMY_DATABASE_URI=sqlite:////tmp/vortex-dev.db \
VORTEX_ALLOWED_ORIGINS=http://127.0.0.1:5174 backend/venv/bin/python backend/app.py
# frontend dev server (hot reload), proxied to it
cd frontend && VORTEX_BACKEND_URL=http://127.0.0.1:5051 npx vite --port 5174 --host 127.0.0.1
# …or the production build, to test what will actually be served
cd frontend && npm run build && VORTEX_BACKEND_URL=http://127.0.0.1:5051 npx vite preview --port 5174 --host 127.0.0.1
```

## Notes / limitations

- The dataset + model configuration still use a single in-memory session on
  the server (pre-existing design), so the upload→configure→train flow is
  effectively one active session at a time. The **device registry and job
  tracking are fully per-user** — each node is private to its owner, and the
  shared M4 reports busy/ETA to everyone.
- A node runs one job at a time. While busy, its card shows the running job's
  progress, ETA and how many runs are waiting; picking it queues your run.
