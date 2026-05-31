VortexML — Node Agent
=====================

This bundle turns this machine into a personal compute device for your VortexML
account — with the same capabilities the shared VortexML server runs. Work you
configure on the website gets dispatched here and runs locally, streaming live
progress and hardware telemetry back to the web UI. This node can:

  * TRAIN neural networks on your datasets (all 10 architectures).
  * RUN PREDICTIONS / inference with a trained model on this machine.
  * DOWNLOAD local LLMs onto this machine (from Hugging Face).
  * GENERATE locally — RAG answers and chat — on a downloaded model, fully
    offline and private (or via the cloud "Claude" backend if you prefer).

This means you can sit on a thin laptop with no ML horsepower, open VortexML in
a browser, and have a beefier machine at home do the actual training, model
downloads, and local generation.


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

   the device appears as "Available" on the VortexML site — on the Training
   page's device picker, the "Run on your own hardware" panel under RAG/Chat,
   and on your Profile.

5. To stop the node, press Ctrl+C in that window.


WHAT run.sh DOES
----------------
- Creates a Python virtual environment in venv/
- Installs the dependencies in requirements.txt (PyTorch, Transformers,
  Hugging Face Hub, …) — these give the node training + on-device model
  download + local generation.
- On Apple Silicon Macs, also installs mlx-lm — Apple's MLX framework is the
  fastest local LLM backend on M-series chips. (Skipped on other platforms,
  which generate locally via Transformers instead. If this optional step fails
  the node still works.)
- Creates the uploads/ folders the engine uses (weights/, llms/, models/)
- Launches node_agent.py


REQUIREMENTS
------------
- Python 3.9 or newer
- Several GB free disk for PyTorch / Transformers and their dependencies, plus
  more for any LLMs you download onto this machine.
- Apple Silicon Macs train and run MLX models on the GPU via Metal (MPS) and
  get mlx-lm automatically; other machines fall back to the CPU and use
  Transformers for local generation.


TROUBLESHOOTING
---------------
- "pairing rejected" — the device was deleted on the website, so its token
  was revoked. Download a fresh bundle from your VortexML profile.

- "connection failed" — check that the central_url in node_config.json is
  reachable from this machine. You can override it without editing the file:

       VORTEX_CENTRAL_URL=http://192.168.1.50:5173 ./run.sh

- A node handles one training job at a time. Start another run only after the
  current one finishes. (Model downloads and generation run independently.)

- The first local-model download and the first generation can take a while
  (downloading multi-GB weights, loading them into memory). Cloud "Claude"
  generation needs no download and works immediately.


FILES IN THIS BUNDLE
--------------------
  node_agent.py        the agent itself
  node_config.json     your account's pairing token + server URL
  training_engine.py   the neural-network models + training loop + inference
  data_processor.py    dataset loading / preprocessing
  device_specs.py      hardware probe (RAM / cores / accelerator)
  system_stats.py      live CPU / GPU / RAM / temperature telemetry
  rag.py               on-device model download + local RAG / chat generation
  requirements.txt     Python dependencies
  run.sh               setup + launch script
  README.txt           this file
