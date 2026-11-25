# VortexML — Deployment & Remote Training

This document covers running VortexML as a shared server and the
**"train on your own device"** feature: how a user links a personal machine
and trains on it through the web UI.

## Topology

```
        Browser (anyone, even a thin laptop)
                     │  https://vortexml.andreinita.com
                     ▼
        Cloudflare tunnel ──► 192.168.100.95:5173  (Vite)
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

`./start.sh` launches the Flask backend (`:5050`) and the Vite frontend
(`:5173`). `start.sh` sources `.env`, so set there:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Novice-mode chatbot. |
| `VORTEX_PUBLIC_URL` | Public URL baked into downloaded node-agent bundles. Defaults to `https://vortexml.andreinita.com`. |
| `VORTEX_USE_SQLITE` | Set `1` to skip the Postgres probe. |

### Tunnel

`vortexml.andreinita.com` is fronted by a Cloudflare tunnel pointing at the Vite
dev server (`192.168.100.95:5173`). Vite proxies `/api` and `/socket.io` on to
the backend, so the whole app is reachable through that one hostname.

Two things make this work and are already wired up:

- `frontend/vite.config.ts` lists `vortexml.andreinita.com` in `allowedHosts`
  (Vite rejects unknown `Host` headers otherwise) and binds all interfaces.
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

The Cloudflare tunnel is a separate process — to auto-start it too, install
its own service with `cloudflared service install`.

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

**Demo + tutorial data.** `sample-data/` holds the datasets served by
`/api/demo/*` (see `sample-data/README.md`). The Demo page trains on the shared
device through the normal queue, so demo visitors and real users wait in the
same line.

**Sales enquiries.** The "Talk to sales" form stores rows in the
`sales_inquiries` table (`POST /api/sales/contact`, rate-limited to 5/hour per
caller). Nothing is emailed — read them from the database, e.g.

```sh
sqlite3 backend/vortex.db "SELECT created_at, name, email, company, interest, message FROM sales_inquiries ORDER BY id DESC;"
```

**Tutorial recordings.** The GIFs under `frontend/public/tutorial/` are
captured from the running app by `tools/tutorial-recorder` (headless Chromium
+ ffmpeg). Re-record after a UI change:

```sh
cd tools/tutorial-recorder && npm install
VORTEX_URL=http://127.0.0.1:5173 node record.mjs
```

The AI Auto-Configure clip is only recorded when the server has
`ANTHROPIC_API_KEY` set (`node record.mjs --only autoconfig`); the Tutorial page
shows it automatically once `03-autoconfig.gif` exists.

**A second instance for development.** To work on the app without touching the
live one, run a copy on other ports:

```sh
# backend (own database, own port)
VORTEX_PORT=5051 SQLALCHEMY_DATABASE_URI=sqlite:////tmp/vortex-dev.db \
VORTEX_ALLOWED_ORIGINS=http://127.0.0.1:5174 backend/venv/bin/python backend/app.py
# frontend, proxied to it
cd frontend && VORTEX_BACKEND_URL=http://127.0.0.1:5051 npx vite --port 5174 --host 127.0.0.1
```

## Notes / limitations

- The dataset + model configuration still use a single in-memory session on
  the server (pre-existing design), so the upload→configure→train flow is
  effectively one active session at a time. The **device registry and job
  tracking are fully per-user** — each node is private to its owner, and the
  shared M4 reports busy/ETA to everyone.
- A node runs one job at a time. While busy, its card shows the running job's
  progress, ETA and how many runs are waiting; picking it queues your run.
