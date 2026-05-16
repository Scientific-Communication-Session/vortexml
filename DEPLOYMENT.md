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

## Notes / limitations

- The dataset + model configuration still use a single in-memory session on
  the server (pre-existing design), so the upload→configure→train flow is
  effectively one active session at a time. The **device registry and job
  tracking are fully per-user** — each node is private to its owner, and the
  shared M4 reports busy/ETA to everyone.
- A node runs one job at a time. While busy, its card is unselectable and
  shows an ETA.
