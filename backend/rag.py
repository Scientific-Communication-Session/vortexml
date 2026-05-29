"""
Vortex ML — Retrieval-Augmented Generation (RAG).

A small, self-contained RAG stack:

  documents → chunk → embed → vector store → retrieve top-k → ground a local
  (or cloud) LLM on the retrieved context → answer with citations.

Design goals:
  * Works out of the box with NO model downloads: retrieval uses TF-IDF
    (scikit-learn, already a dependency) and generation can fall back to the
    cloud chatbot key. Everything else is an optional, *better* upgrade.
  * Pluggable generation backends (MLX / llama.cpp / Transformers / Ollama /
    cloud) chosen at query time, each lazily imported and availability-checked,
    with human-readable "what is this / use when" copy for the UI.
  * Apple-Silicon first: MLX is the recommended local backend on this M4.

Nothing here imports `app`, so it stays unit-testable on its own.
"""

import os
import json
import pickle
import platform
import shutil
import time
import urllib.request
from importlib.util import find_spec

import numpy as np

RAG_DIR = os.path.join(os.path.dirname(__file__), "uploads", "rag")
os.makedirs(RAG_DIR, exist_ok=True)

_IS_APPLE_SILICON = platform.system() == "Darwin" and platform.machine() == "arm64"

# Caches for lazily-loaded local models, keyed by model id.
_mlx_cache = {}
_hf_cache = {}
_llamacpp_cache = {}


# ─────────────────────────────────────────────────────────
# 1. Document extraction + chunking
# ─────────────────────────────────────────────────────────
SUPPORTED_EXTS = (".txt", ".md", ".markdown", ".text", ".csv", ".pdf")


def extract_text(filename, raw_bytes):
    """Pull plain text out of an uploaded document. Raises ValueError on
    unsupported types or missing optional parsers."""
    ext = "." + filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext in (".txt", ".md", ".markdown", ".text"):
        return raw_bytes.decode("utf-8", "ignore")
    if ext == ".csv":
        # Flatten rows into readable lines so each row becomes searchable text.
        return raw_bytes.decode("utf-8", "ignore")
    if ext == ".pdf":
        if find_spec("pypdf") is None:
            raise ValueError("PDF support needs the 'pypdf' package "
                             "(pip install pypdf). Upload .txt/.md/.csv instead.")
        import io
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    raise ValueError(f"Unsupported file type '{ext}'. Supported: "
                     f"{', '.join(SUPPORTED_EXTS)}")


def chunk_text(text, chunk_size=900, overlap=150):
    """Split text into overlapping character windows, preferring paragraph
    boundaries so chunks stay semantically coherent."""
    text = (text or "").strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks, buf = [], ""
    for para in paragraphs:
        if len(buf) + len(para) + 2 <= chunk_size:
            buf = f"{buf}\n\n{para}" if buf else para
        else:
            if buf:
                chunks.append(buf)
            if len(para) <= chunk_size:
                buf = para
            else:
                # Hard-wrap an oversized paragraph with overlap.
                start = 0
                while start < len(para):
                    chunks.append(para[start:start + chunk_size])
                    start += chunk_size - overlap
                buf = ""
    if buf:
        chunks.append(buf)

    # Add a sliding overlap between adjacent chunks for retrieval recall.
    if overlap > 0 and len(chunks) > 1:
        stitched = [chunks[0]]
        for i in range(1, len(chunks)):
            tail = chunks[i - 1][-overlap:]
            stitched.append((tail + "\n" + chunks[i]).strip())
        chunks = stitched
    return chunks


# ─────────────────────────────────────────────────────────
# 2. Embedders
# ─────────────────────────────────────────────────────────
EMBEDDERS = {
    "tfidf": {
        "label": "TF-IDF (fast, local, no download)",
        "description": "Classic keyword/term-frequency vectors via scikit-learn. "
                       "Runs instantly with zero downloads — great for getting "
                       "started or for keyword-heavy documents.",
        "needs": None,
    },
    "minilm": {
        "label": "MiniLM embeddings (semantic, local)",
        "description": "all-MiniLM-L6-v2 sentence embeddings (~80 MB). Understands "
                       "meaning, not just keywords — better retrieval quality. "
                       "Needs the 'sentence-transformers' package.",
        "needs": "sentence_transformers",
    },
}


def embedder_available(name):
    needs = EMBEDDERS.get(name, {}).get("needs")
    return needs is None or find_spec(needs) is not None


def _embed_minilm(texts):
    from sentence_transformers import SentenceTransformer
    model = _hf_cache.get("__minilm__")
    if model is None:
        model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        _hf_cache["__minilm__"] = model
    arr = np.asarray(model.encode(texts, normalize_embeddings=True), dtype=np.float32)
    return arr


def _l2_normalize(mat):
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return mat / norms


# ─────────────────────────────────────────────────────────
# 3. Per-knowledge-base vector store (persisted under uploads/rag/<id>)
# ─────────────────────────────────────────────────────────
class KBStore:
    """Holds a knowledge base's chunks + embeddings on disk.

    Layout (one dir per KB):
      chunks.json     — [{id, doc_id, doc_name, text}]
      emb.npy         — float32 (n_chunks x d), L2-normalized
      meta.json       — {embedder, model, chunk_size, overlap}
      vectorizer.pkl  — fitted TfidfVectorizer (tfidf embedder only)
    """

    def __init__(self, kb_id):
        # The dir is created lazily by rebuild(); reads tolerate it being absent.
        self.dir = os.path.join(RAG_DIR, str(kb_id))

    # -- persistence helpers --
    def _p(self, name):
        return os.path.join(self.dir, name)

    def load_chunks(self):
        if os.path.exists(self._p("chunks.json")):
            with open(self._p("chunks.json"), encoding="utf-8") as f:
                return json.load(f)
        return []

    def _meta(self):
        if os.path.exists(self._p("meta.json")):
            with open(self._p("meta.json"), encoding="utf-8") as f:
                return json.load(f)
        return {}

    def destroy(self):
        if os.path.isdir(self.dir):
            shutil.rmtree(self.dir, ignore_errors=True)

    # -- ingest --
    def rebuild(self, chunks, embedder="tfidf", chunk_size=900, overlap=150):
        """(Re)compute embeddings for the full chunk list and persist them.

        TF-IDF must refit its vocabulary whenever the corpus changes, so ingest
        always rebuilds from all chunks — simple and correct for these sizes.
        """
        os.makedirs(self.dir, exist_ok=True)
        texts = [c["text"] for c in chunks]
        if not texts:
            E = np.zeros((0, 1), dtype=np.float32)
        elif embedder == "minilm":
            E = _embed_minilm(texts)
        else:
            from sklearn.feature_extraction.text import TfidfVectorizer
            vec = TfidfVectorizer(max_features=4096, stop_words="english")
            mat = vec.fit_transform(texts)  # already L2-normalized rows
            E = mat.toarray().astype(np.float32)
            with open(self._p("vectorizer.pkl"), "wb") as f:
                pickle.dump(vec, f)

        with open(self._p("chunks.json"), "w", encoding="utf-8") as f:
            json.dump(chunks, f)
        np.save(self._p("emb.npy"), E)
        with open(self._p("meta.json"), "w", encoding="utf-8") as f:
            json.dump({"embedder": embedder, "chunk_size": chunk_size,
                       "overlap": overlap, "n_chunks": len(chunks)}, f)

    # -- query --
    def _embed_query(self, query):
        meta = self._meta()
        if meta.get("embedder") == "minilm":
            return _embed_minilm([query])[0]
        with open(self._p("vectorizer.pkl"), "rb") as f:
            vec = pickle.load(f)
        return vec.transform([query]).toarray().astype(np.float32)[0]

    def search(self, query, k=4):
        chunks = self.load_chunks()
        if not chunks or not os.path.exists(self._p("emb.npy")):
            return []
        E = np.load(self._p("emb.npy"))
        if E.shape[0] == 0:
            return []
        q = self._embed_query(query)
        qn = np.linalg.norm(q)
        if qn > 0:
            q = q / qn
        scores = E @ q
        order = np.argsort(-scores)[:k]
        out = []
        for rank, idx in enumerate(order):
            score = float(scores[idx])
            if score <= 0:
                continue
            c = chunks[int(idx)]
            out.append({
                "n": rank + 1,
                "doc_name": c.get("doc_name"),
                "score": round(score, 4),
                "text": c["text"],
            })
        return out


# ─────────────────────────────────────────────────────────
# 4. Generation backends (pluggable, lazily imported)
# ─────────────────────────────────────────────────────────
# Each backend entry carries the copy the UI shows to explain "what is this /
# when should I use it", plus a few recommended models. The default model is a
# ~3-4B instruct model per the brief (Gemma / Llama / Qwen).
BACKENDS = {
    "cloud": {
        "label": "Cloud (Claude)",
        "tagline": "Zero setup — works right now",
        "description": "Generates with Anthropic's Claude over the same API key "
                       "the tutor chatbot uses. Nothing to install or download. "
                       "Best for trying RAG immediately or when you don't want to "
                       "run a model locally.",
        "use_when": "You want it to just work, or your machine can't run a local LLM.",
        "local": False,
        "novice_default": True,
        "default_model": "claude-sonnet-4-6",
        "models": ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
        "setup": "Set ANTHROPIC_API_KEY in the server's .env.",
    },
    "mlx": {
        "label": "MLX (Apple Silicon)",
        "tagline": "Fastest local option on this Mac",
        "description": "Apple's MLX framework runs the model on the M-series GPU "
                       "with unified memory. The most efficient way to run a local "
                       "4B model (e.g. Gemma 3 4B, 4-bit) on this machine — fully "
                       "offline and private.",
        "use_when": "You're on Apple Silicon and want fast, private, local answers.",
        "local": True,
        "default_model": "mlx-community/gemma-3-4b-it-4bit",
        "models": [
            "mlx-community/gemma-3-4b-it-4bit",
            "mlx-community/Llama-3.2-3B-Instruct-4bit",
            "mlx-community/Qwen2.5-3B-Instruct-4bit",
        ],
        "setup": "pip install mlx-lm  (Apple Silicon only). The model downloads on first use.",
    },
    "llama_cpp": {
        "label": "llama.cpp (GGUF)",
        "tagline": "Cross-platform, runs quantized GGUF",
        "description": "Runs GGUF-quantized models via llama-cpp-python on CPU or "
                       "Metal/CUDA. Extremely portable and memory-light. Point it at "
                       "a GGUF file or a 'repo_id:filename' to auto-download.",
        "use_when": "You want a tiny, portable runtime or are not on Apple Silicon.",
        "local": True,
        "default_model": "bartowski/gemma-2-2b-it-GGUF:gemma-2-2b-it-Q4_K_M.gguf",
        "models": [
            "bartowski/gemma-2-2b-it-GGUF:gemma-2-2b-it-Q4_K_M.gguf",
            "bartowski/Llama-3.2-3B-Instruct-GGUF:Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        ],
        "setup": "pip install llama-cpp-python  (build can take a few minutes).",
    },
    "transformers": {
        "label": "Transformers (PyTorch)",
        "tagline": "Full-precision, any HF model",
        "description": "Hugging Face Transformers running on MPS/CUDA/CPU via "
                       "PyTorch. The most flexible (any model on the Hub) but the "
                       "heaviest in memory; full or half precision rather than "
                       "aggressive quantization.",
        "use_when": "You need a specific HF model or full precision, and have the RAM.",
        "local": True,
        "default_model": "Qwen/Qwen2.5-3B-Instruct",
        "models": [
            "Qwen/Qwen2.5-3B-Instruct",
            "meta-llama/Llama-3.2-3B-Instruct",
            "google/gemma-3-4b-it",
        ],
        "setup": "pip install transformers accelerate  (some models need a HF login).",
    },
    "ollama": {
        "label": "Ollama (local server)",
        "tagline": "Easiest local setup",
        "description": "Talks to a running Ollama server on this machine. Ollama "
                       "manages downloads and serving for you — the friendliest way "
                       "to run local models, no Python deps needed.",
        "use_when": "You already use Ollama, or want the simplest local setup.",
        "local": True,
        "default_model": "gemma2:2b",
        "models": ["gemma2:2b", "llama3.2", "qwen2.5:3b"],
        "setup": "Install Ollama (ollama.com), run `ollama pull gemma2:2b`, keep it running.",
    },
}

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")


def backend_available(key):
    if key == "cloud":
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    if key == "mlx":
        return _IS_APPLE_SILICON and find_spec("mlx_lm") is not None
    if key == "llama_cpp":
        return find_spec("llama_cpp") is not None
    if key == "transformers":
        return find_spec("transformers") is not None and find_spec("torch") is not None
    if key == "ollama":
        try:
            urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=0.4)
            return True
        except Exception:
            return False
    return False


def list_backends():
    """Backend metadata + live availability, with a recommendation for the UI."""
    recommended = "mlx" if backend_available("mlx") else "cloud"
    out = []
    for key, meta in BACKENDS.items():
        out.append({
            "key": key,
            "label": meta["label"],
            "tagline": meta["tagline"],
            "description": meta["description"],
            "use_when": meta["use_when"],
            "local": meta["local"],
            "available": backend_available(key),
            "default_model": meta["default_model"],
            "models": meta["models"],
            "setup": meta["setup"],
            "recommended": key == recommended,
        })
    return {"backends": out, "recommended": recommended,
            "apple_silicon": _IS_APPLE_SILICON}


def default_backend():
    """Best available backend: prefer fast local MLX, else cloud, else any."""
    for key in ("mlx", "ollama", "llama_cpp", "transformers", "cloud"):
        if backend_available(key):
            return key
    return "cloud"


# ─────────────────────────────────────────────────────────
# Model inventory — what's downloaded on THIS machine
# ─────────────────────────────────────────────────────────
def _hf_cache_models():
    """{repo_id: {size_bytes}} for models in the local Hugging Face cache."""
    try:
        from huggingface_hub import scan_cache_dir
        info = scan_cache_dir()
        return {r.repo_id: {"size_bytes": int(r.size_on_disk)}
                for r in info.repos if r.repo_type == "model"}
    except Exception:
        return {}


def _ollama_models():
    """{name: {size_bytes}} for models pulled into a local Ollama server."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=0.5) as r:
            data = json.loads(r.read())
        return {m["name"]: {"size_bytes": m.get("size")} for m in data.get("models", [])}
    except Exception:
        return {}


def local_model_inventory():
    """Raw inventory of models stored on this machine, by source."""
    return {"hf": _hf_cache_models(), "ollama": _ollama_models()}


def device_model_catalog(inventory=None):
    """Curated per-backend RAG model list ('variations') annotated with whether
    each is already downloaded on the device, plus its on-disk size.

    Pass a node's reported `inventory` to build the catalog for a remote device;
    omit it to build for this (the central) machine.
    """
    if inventory is None:
        inventory = local_model_inventory()
    hf = inventory.get("hf", {})
    oll = inventory.get("ollama", {})

    def lookup(backend, model_id):
        if backend == "ollama":
            tag = model_id.split(":")[0]
            for name, meta in oll.items():
                if name == model_id or name.split(":")[0] == tag:
                    return True, meta.get("size_bytes")
            return False, None
        # mlx / transformers use the HF repo id directly; llama.cpp uses repo:file
        repo = model_id.split(":")[0]
        if repo in hf:
            return True, hf[repo].get("size_bytes")
        return False, None

    catalog = []
    for key, meta in BACKENDS.items():
        if not meta["local"]:
            continue  # cloud has no local model files
        models = []
        for m in meta["models"]:
            downloaded, size = lookup(key, m)
            models.append({"id": m, "downloaded": downloaded, "size_bytes": size})
        catalog.append({
            "backend": key,
            "label": meta["label"],
            "available": backend_available(key),
            "default_model": meta["default_model"],
            "models": models,
        })
    return catalog


def download_model(backend, model, progress=None):
    """Download a model onto THIS machine. Blocking; meant to run in a background
    task. `progress(msg)` is an optional status callback. Raises on failure."""
    def emit(msg):
        if progress:
            progress(msg)
    if backend in ("mlx", "transformers", "llama_cpp"):
        from huggingface_hub import snapshot_download, hf_hub_download
        if backend == "llama_cpp" and ":" in model:
            repo, filename = model.split(":", 1)
            emit(f"Downloading {filename} from {repo}…")
            hf_hub_download(repo_id=repo, filename=filename)
        else:
            emit(f"Downloading {model} from Hugging Face…")
            snapshot_download(repo_id=model)
        emit("Download complete.")
    elif backend == "ollama":
        emit(f"Pulling {model} via Ollama…")
        payload = json.dumps({"model": model, "stream": False}).encode()
        req = urllib.request.Request(f"{OLLAMA_URL}/api/pull", data=payload,
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=3600)
        emit("Pull complete.")
    else:
        raise ValueError(f"Backend '{backend}' has no downloadable local model.")


# -- per-backend generation (all guarded; only called when available) --
# Each returns (text, completion_tokens|None). A None token count is estimated
# by the caller so tokens/sec is always reportable.
def _gen_cloud(system, user, model, temperature, max_tokens):
    import anthropic
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model or BACKENDS["cloud"]["default_model"],
        max_tokens=max_tokens,
        thinking={"type": "disabled"},
        output_config={"effort": "low"},
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
    )
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), "")
    ntok = getattr(getattr(resp, "usage", None), "output_tokens", None)
    return text, ntok


def _gen_mlx(system, user, model, temperature, max_tokens):
    from mlx_lm import load, generate
    key = model or BACKENDS["mlx"]["default_model"]
    if key not in _mlx_cache:
        _mlx_cache[key] = load(key)
    model_obj, tokenizer = _mlx_cache[key]
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)
    text = generate(model_obj, tokenizer, prompt=prompt, max_tokens=max_tokens, verbose=False)
    ntok = len(tokenizer.encode(text)) if text else 0
    return text, ntok


def _gen_transformers(system, user, model, temperature, max_tokens):
    from transformers import AutoModelForCausalLM, AutoTokenizer
    key = model or BACKENDS["transformers"]["default_model"]
    if key not in _hf_cache:
        tok = AutoTokenizer.from_pretrained(key)
        mdl = AutoModelForCausalLM.from_pretrained(key, torch_dtype="auto", device_map="auto")
        _hf_cache[key] = (mdl, tok)
    mdl, tok = _hf_cache[key]
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    inputs = tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt").to(mdl.device)
    out = mdl.generate(inputs, max_new_tokens=max_tokens, do_sample=temperature > 0,
                       temperature=max(temperature, 0.01))
    gen = out[0][inputs.shape[1]:]
    return tok.decode(gen, skip_special_tokens=True), int(gen.shape[0])


def _gen_llama_cpp(system, user, model, temperature, max_tokens):
    from llama_cpp import Llama
    key = model or BACKENDS["llama_cpp"]["default_model"]
    if key not in _llamacpp_cache:
        if ":" in key and not os.path.exists(key):
            repo, filename = key.split(":", 1)
            llm = Llama.from_pretrained(repo_id=repo, filename=filename, n_ctx=4096, verbose=False)
        else:
            llm = Llama(model_path=key, n_ctx=4096, verbose=False)
        _llamacpp_cache[key] = llm
    llm = _llamacpp_cache[key]
    resp = llm.create_chat_completion(
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=max_tokens, temperature=temperature,
    )
    text = resp["choices"][0]["message"]["content"]
    ntok = resp.get("usage", {}).get("completion_tokens")
    return text, ntok


def _gen_ollama(system, user, model, temperature, max_tokens):
    payload = json.dumps({
        "model": model or BACKENDS["ollama"]["default_model"],
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    return data["message"]["content"], data.get("eval_count")


_GENERATORS = {
    "cloud": _gen_cloud, "mlx": _gen_mlx, "transformers": _gen_transformers,
    "llama_cpp": _gen_llama_cpp, "ollama": _gen_ollama,
}


# ─────────────────────────────────────────────────────────
# 5. RAG orchestration
# ─────────────────────────────────────────────────────────
RAG_SYSTEM_PROMPT = (
    "You are a retrieval-augmented assistant. Answer the user's question using "
    "ONLY the numbered context passages provided. Cite the passages you use with "
    "bracketed numbers like [1] or [2]. If the answer is not contained in the "
    "context, say you don't know based on the provided documents — do not invent "
    "facts. Be concise and accurate."
)


def build_context(kb_id, query, top_k=4):
    """Retrieve top-k chunks and assemble the grounded prompt. Returns None when
    nothing relevant was found. Retrieval always happens centrally (the vector
    store lives here) — only the prompt is shipped to a remote device."""
    hits = KBStore(kb_id).search(query, k=top_k)
    if not hits:
        return None
    context = "\n\n".join(f"[{h['n']}] (from {h['doc_name']})\n{h['text']}" for h in hits)
    user = f"Context passages:\n{context}\n\nQuestion: {query}"
    citations = [{"n": h["n"], "doc_name": h["doc_name"], "score": h["score"],
                  "preview": h["text"][:240]} for h in hits]
    return {"system": RAG_SYSTEM_PROMPT, "user": user, "hits": hits, "citations": citations}


def generate(backend, model, system, user, temperature=0.2, max_tokens=700):
    """Run one generation on this machine. Returns
    {text, tokens, gen_time, tokens_per_second}. Used both by the central server
    and (via the bundled rag.py) by a node agent."""
    if backend not in _GENERATORS:
        raise ValueError(f"Unknown backend: {backend}")
    if not backend_available(backend):
        meta = BACKENDS.get(backend, {})
        raise RuntimeError(f"Backend '{backend}' isn't available. {meta.get('setup', '')}")
    t0 = time.time()
    text, ntok = _GENERATORS[backend](system, user, model, temperature, max_tokens)
    elapsed = time.time() - t0
    text = (text or "").strip()
    if not ntok:
        ntok = max(1, round(len(text) / 4))  # ~4 chars/token estimate
    return {"text": text, "tokens": int(ntok), "gen_time": round(elapsed, 3),
            "tokens_per_second": round(ntok / elapsed, 1) if elapsed > 0 else None}


def rag_answer(kb_id, query, backend="cloud", model=None, top_k=4,
               temperature=0.2, max_tokens=700):
    """Retrieve, ground, and generate locally. Returns answer + citations +
    chunks + generation stats (tokens/sec)."""
    ctx = build_context(kb_id, query, top_k=top_k)
    if ctx is None:
        return {"answer": "I couldn't find anything relevant in this knowledge "
                          "base. Add documents (or rephrase the question) and try again.",
                "citations": [], "chunks": [], "backend": backend, "model": model,
                "stats": None}
    gen = generate(backend, model, ctx["system"], ctx["user"], temperature, max_tokens)
    return {"answer": gen["text"], "citations": ctx["citations"], "chunks": ctx["hits"],
            "backend": backend, "model": model or BACKENDS[backend]["default_model"],
            "stats": {"tokens": gen["tokens"], "gen_time": gen["gen_time"],
                      "tokens_per_second": gen["tokens_per_second"]}}
