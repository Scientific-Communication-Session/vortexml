VortexML — Node Agent
=====================

This bundle turns this machine into a personal training device for your
VortexML account. Datasets and model settings you configure on the VortexML
website get dispatched here; training runs locally on this machine and streams
live progress back to the web UI.

This means you can sit on a thin laptop with no ML horsepower, open VortexML in
a browser, and have a beefier machine at home do the actual training.


KEEP THIS BUNDLE PRIVATE
------------------------
node_config.json contains a pairing token that is unique to YOUR account. It
links this machine to your account and no one else's. Anyone who obtains this
bundle could run training on this machine under your account — treat it like a
password. If it leaks, delete the device from your VortexML profile (that
revokes the token) and download a fresh bundle.


QUICK START  (macOS / Linux)
----------------------------
1. Unzip this bundle somewhere permanent, e.g. ~/vortexml-node
2. Open a terminal in that folder.
3. Run:

       chmod +x run.sh
       ./run.sh

4. Leave the window open. Once you see

       [node] idle — waiting for training jobs…

   the device appears as "Available" on the VortexML site, on the Training
   page's device picker and on your Profile.

5. To stop the node, press Ctrl+C in that window.


WHAT run.sh DOES
----------------
- Creates a Python virtual environment in venv/
- Installs the dependencies in requirements.txt (PyTorch, pandas, …)
- Creates the uploads/weights/ folder the training engine uses
- Launches node_agent.py


REQUIREMENTS
------------
- Python 3.9 or newer
- ~2-3 GB free disk for PyTorch and its dependencies
- Apple Silicon Macs train on the GPU automatically via Metal (MPS);
  other machines fall back to the CPU.


TROUBLESHOOTING
---------------
- "pairing rejected" — the device was deleted on the website, so its token
  was revoked. Download a fresh bundle from your VortexML profile.

- "connection failed" — check that the central_url in node_config.json is
  reachable from this machine. You can override it without editing the file:

       VORTEX_CENTRAL_URL=http://192.168.1.50:5173 ./run.sh

- A node handles one training job at a time. Start another run only after the
  current one finishes.


FILES IN THIS BUNDLE
--------------------
  node_agent.py        the agent itself
  node_config.json     your account's pairing token + server URL
  training_engine.py   the neural-network models + training loop
  data_processor.py    dataset loading / preprocessing
  device_specs.py      hardware probe (RAM / cores / accelerator)
  requirements.txt     Python dependencies
  run.sh               setup + launch script
  README.txt           this file
