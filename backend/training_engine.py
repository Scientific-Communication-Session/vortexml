"""
Vortex ML — Training Engine
10 neural network architectures + training loop with live WebSocket updates.
"""

import os
import copy
import time
import math
import re
import threading
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "uploads", "weights")
os.makedirs(WEIGHTS_DIR, exist_ok=True)


# ─────────────────────────────────────────────────────────
# 1. Multi-Layer Perceptron (MLP)
# ─────────────────────────────────────────────────────────
class MLPModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        layers = []
        prev = input_dim
        act_fn = _get_activation(activation)
        for size in layer_sizes:
            layers.append(nn.Linear(prev, size))
            layers.append(act_fn())
            prev = size
        layers.append(nn.Linear(prev, output_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


# ─────────────────────────────────────────────────────────
# 2. Deep Neural Network (DNN) — with BatchNorm + Dropout
# ─────────────────────────────────────────────────────────
class DNNModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu", dropout=0.3):
        super().__init__()
        layers = []
        prev = input_dim
        act_fn = _get_activation(activation)
        for size in layer_sizes:
            layers.append(nn.Linear(prev, size))
            layers.append(nn.BatchNorm1d(size))
            layers.append(act_fn())
            layers.append(nn.Dropout(dropout))
            prev = size
        layers.append(nn.Linear(prev, output_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


# ─────────────────────────────────────────────────────────
# 3. 1D Convolutional Network
# ─────────────────────────────────────────────────────────
class CNN1DModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        act_fn = _get_activation(activation)
        # Reshape flat features into a 1D "sequence"
        self.input_dim = input_dim
        conv_layers = []
        in_channels = 1
        for out_channels in layer_sizes:
            conv_layers.append(nn.Conv1d(in_channels, out_channels, kernel_size=3, padding=1))
            conv_layers.append(act_fn())
            in_channels = out_channels
        self.conv = nn.Sequential(*conv_layers)
        self.fc = nn.Linear(in_channels * input_dim, output_dim)

    def forward(self, x):
        x = x.unsqueeze(1)  # (batch, 1, features)
        x = self.conv(x)     # (batch, channels, features)
        x = x.view(x.size(0), -1)
        return self.fc(x)


# ─────────────────────────────────────────────────────────
# 4. Recurrent Neural Network (RNN)
# ─────────────────────────────────────────────────────────
class RNNModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        hidden_size = layer_sizes[0] if layer_sizes else 64
        num_layers = len(layer_sizes) if layer_sizes else 1
        self.rnn = nn.RNN(input_size=input_dim, hidden_size=hidden_size,
                          num_layers=num_layers, batch_first=True, nonlinearity="tanh")
        self.fc = nn.Linear(hidden_size, output_dim)

    def forward(self, x):
        x = x.unsqueeze(1)  # (batch, seq_len=1, features)
        out, _ = self.rnn(x)
        return self.fc(out[:, -1, :])


# ─────────────────────────────────────────────────────────
# 5. Long Short-Term Memory (LSTM)
# ─────────────────────────────────────────────────────────
class LSTMModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        hidden_size = layer_sizes[0] if layer_sizes else 64
        num_layers = len(layer_sizes) if layer_sizes else 1
        self.lstm = nn.LSTM(input_size=input_dim, hidden_size=hidden_size,
                            num_layers=num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_dim)

    def forward(self, x):
        x = x.unsqueeze(1)
        out, _ = self.lstm(x)
        return self.fc(out[:, -1, :])


# ─────────────────────────────────────────────────────────
# 6. Gated Recurrent Unit (GRU)
# ─────────────────────────────────────────────────────────
class GRUModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        hidden_size = layer_sizes[0] if layer_sizes else 64
        num_layers = len(layer_sizes) if layer_sizes else 1
        self.gru = nn.GRU(input_size=input_dim, hidden_size=hidden_size,
                          num_layers=num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_dim)

    def forward(self, x):
        x = x.unsqueeze(1)
        out, _ = self.gru(x)
        return self.fc(out[:, -1, :])


# ─────────────────────────────────────────────────────────
# 7. Autoencoder
# ─────────────────────────────────────────────────────────
class AutoencoderModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        act_fn = _get_activation(activation)
        # Encoder
        enc_layers = []
        prev = input_dim
        for size in layer_sizes:
            enc_layers.append(nn.Linear(prev, size))
            enc_layers.append(act_fn())
            prev = size
        self.encoder = nn.Sequential(*enc_layers)

        # Decoder (mirror)
        dec_layers = []
        for size in reversed(layer_sizes[:-1]):
            dec_layers.append(nn.Linear(prev, size))
            dec_layers.append(act_fn())
            prev = size
        dec_layers.append(nn.Linear(prev, input_dim))
        self.decoder = nn.Sequential(*dec_layers)

        # Prediction head from bottleneck
        self.head = nn.Linear(layer_sizes[-1] if layer_sizes else input_dim, output_dim)

    def forward(self, x):
        encoded = self.encoder(x)
        return self.head(encoded)

    def reconstruct(self, x):
        return self.decoder(self.encoder(x))


# ─────────────────────────────────────────────────────────
# 8. Residual Network (ResNet-style for tabular)
# ─────────────────────────────────────────────────────────
class ResidualBlock(nn.Module):
    def __init__(self, dim, activation="relu", dropout=0.1):
        super().__init__()
        act_fn = _get_activation(activation)
        self.block = nn.Sequential(
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
            act_fn(),
            nn.Dropout(dropout),
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
        )
        self.act = act_fn()

    def forward(self, x):
        return self.act(x + self.block(x))


class ResNetModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        hidden = layer_sizes[0] if layer_sizes else 64
        self.input_proj = nn.Linear(input_dim, hidden)
        self.blocks = nn.Sequential(
            *[ResidualBlock(hidden, activation) for _ in layer_sizes]
        )
        self.head = nn.Linear(hidden, output_dim)

    def forward(self, x):
        x = self.input_proj(x)
        x = self.blocks(x)
        return self.head(x)


# ─────────────────────────────────────────────────────────
# 9. Transformer (for tabular data)
# ─────────────────────────────────────────────────────────
class TransformerModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        d_model = layer_sizes[0] if layer_sizes else 64
        n_heads = max(1, d_model // 16)
        # Make d_model divisible by n_heads
        d_model = n_heads * (d_model // n_heads) if d_model >= n_heads else n_heads
        num_layers = len(layer_sizes) if layer_sizes else 1

        self.input_proj = nn.Linear(input_dim, d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 4,
            dropout=0.1, batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.head = nn.Linear(d_model, output_dim)

    def forward(self, x):
        x = self.input_proj(x).unsqueeze(1)  # (batch, 1, d_model)
        x = self.transformer(x)
        return self.head(x[:, 0, :])


# ─────────────────────────────────────────────────────────
# 10. Wide & Deep Network
# ─────────────────────────────────────────────────────────
class WideDeepModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, activation="relu"):
        super().__init__()
        act_fn = _get_activation(activation)
        # Wide path: direct linear
        self.wide = nn.Linear(input_dim, output_dim)

        # Deep path: MLP
        deep_layers = []
        prev = input_dim
        for size in layer_sizes:
            deep_layers.append(nn.Linear(prev, size))
            deep_layers.append(act_fn())
            prev = size
        deep_layers.append(nn.Linear(prev, output_dim))
        self.deep = nn.Sequential(*deep_layers)

    def forward(self, x):
        return self.wide(x) + self.deep(x)


# ─────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────
def _get_activation(name):
    return {
        "relu": nn.ReLU,
        "tanh": nn.Tanh,
        "sigmoid": nn.Sigmoid,
        "leaky_relu": nn.LeakyReLU,
        "elu": nn.ELU,
        "selu": nn.SELU,
        "gelu": nn.GELU,
    }.get(name, nn.ReLU)


MODEL_REGISTRY = {
    "mlp": MLPModel,
    "dnn": DNNModel,
    "cnn1d": CNN1DModel,
    "rnn": RNNModel,
    "lstm": LSTMModel,
    "gru": GRUModel,
    "autoencoder": AutoencoderModel,
    "resnet": ResNetModel,
    "transformer": TransformerModel,
    "wide_deep": WideDeepModel,
}


def create_model(arch_type, layer_sizes, input_dim, output_dim, activation="relu"):
    """Factory: create a model by architecture key."""
    model_cls = MODEL_REGISTRY.get(arch_type)
    if model_cls is None:
        raise ValueError(f"Unknown architecture: {arch_type}. Choose from: {list(MODEL_REGISTRY.keys())}")
    return model_cls(input_dim, output_dim, layer_sizes, activation=activation)


def get_optimizer(model, name="adam", lr=0.001):
    """Create an optimizer by name."""
    opts = {
        "adam": optim.Adam,
        "sgd": optim.SGD,
        "rmsprop": optim.RMSprop,
        "adamw": optim.AdamW,
    }
    opt_cls = opts.get(name, optim.Adam)
    return opt_cls(model.parameters(), lr=lr)


# ─────────────────────────────────────────────────────────
# Training Loop (runs in background thread)
# ─────────────────────────────────────────────────────────
_stop_training = threading.Event()


def stop_training():
    """Signal the training loop to stop."""
    _stop_training.set()


def _build_weight_filename(config, unique_suffix=None):
    """
    Build a self-describing weight filename from the training config.
    Format: {project}_{arch}_{layers}_{epochs}e_{lr}lr_{batch}bs_{optim}_{activation}[_{suffix}].pt

    `unique_suffix` is appended right before .pt to keep multiple runs distinct on disk.
    """
    project = config.get("project_name", "VortexProject").replace(" ", "-")
    # Strip any characters that are not alphanumeric or hyphens
    project = re.sub(r"[^a-zA-Z0-9\-]", "", project) or "VortexProject"
    arch = config.get("arch_type", "mlp")
    layers = "-".join(str(s) for s in config.get("layer_sizes", [64]))
    epochs = config.get("epochs", 50)
    lr = config.get("lr", 0.001)
    batch = config.get("batch_size", 32)
    optim_name = config.get("optimizer", "adam")
    activation = config.get("activation", "relu")

    base = f"{project}_{arch}_{layers}_{epochs}e_{lr}lr_{batch}bs_{optim_name}_{activation}"
    if unique_suffix:
        base = f"{base}_{unique_suffix}"
    return f"{base}.pt"


def parse_weight_filename(filename):
    """
    Parse a weight filename back into a config dict.
    Expected format: {project}_{arch}_{layers}_{epochs}e_{lr}lr_{batch}bs_{optim}_{activation}[_{suffix}].pt
    Returns dict with keys: project_name, arch_type, layer_sizes, epochs, lr, batch_size, optimizer, activation
    Any trailing _<suffix> (e.g. timestamp) is silently dropped.
    """
    name = filename.replace(".pt", "")
    parts = name.split("_")

    # We need at least 8 parts: project, arch, layers, epochs, lr, batch, optim, activation
    if len(parts) < 8:
        raise ValueError(f"Invalid weight filename format: {filename}")

    # Tolerate a trailing unique suffix: if the last part doesn't look like an
    # activation name we recognise, treat it as the suffix and step back one.
    KNOWN_ACTIVATIONS = {"relu", "leaky_relu", "elu", "selu", "gelu", "tanh", "sigmoid"}
    if parts[-1] not in KNOWN_ACTIVATIONS and len(parts) >= 9:
        parts = parts[:-1]  # drop the suffix

    activation = parts[-1]
    optimizer = parts[-2]
    batch_size = int(parts[-3].replace("bs", ""))
    lr = float(parts[-4].replace("lr", ""))
    epochs = int(parts[-5].replace("e", ""))
    layer_sizes = [int(x) for x in parts[-6].split("-")]
    arch_type = parts[-7]
    project_name = "_".join(parts[:-7])

    return {
        "project_name": project_name,
        "arch_type": arch_type,
        "layer_sizes": layer_sizes,
        "epochs": epochs,
        "lr": lr,
        "batch_size": batch_size,
        "optimizer": optimizer,
        "activation": activation,
    }


def train_model(model, train_loader, val_loader, task_type, config, socketio,
                input_dim=None, output_dim=None):
    """
    Train the model and emit live updates via SocketIO.
    Runs in the calling thread (should be spawned as a background thread).

    Returns a dict with the final outcome (history, metrics, weight filename) so
    the caller can persist a record. Returns None if training was externally stopped.
    """
    _stop_training.clear()

    epochs = config.get("epochs", 50)
    lr = config.get("lr", 0.001)
    optimizer_name = config.get("optimizer", "adam")
    optimizer = get_optimizer(model, optimizer_name, lr)

    # Early stopping config
    es_cfg = config.get("early_stopping", {})
    es_enabled = es_cfg.get("enabled", False)
    es_patience = es_cfg.get("patience", 10)
    es_min_delta = es_cfg.get("min_delta", 0.0001)

    if task_type == "classification":
        criterion = nn.CrossEntropyLoss()
    else:
        criterion = nn.MSELoss()

    model.train()
    epoch_times = []
    history = []

    # Early stopping state
    best_val_loss = float("inf")
    patience_counter = 0
    best_model_state = None
    early_stopped = False
    stopped_epoch = 0

    for epoch in range(1, epochs + 1):
        if _stop_training.is_set():
            socketio.emit("training_stopped", {"epoch": epoch})
            return None

        epoch_start = time.time()

        # ---- Training ----
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for X_batch, y_batch in train_loader:
            optimizer.zero_grad()
            output = model(X_batch)

            if task_type == "regression":
                output = output.squeeze(-1)
                loss = criterion(output, y_batch.float())
            else:
                loss = criterion(output, y_batch.long())

            loss.backward()
            optimizer.step()

            train_loss += loss.item() * X_batch.size(0)
            train_total += X_batch.size(0)

            if task_type == "classification":
                preds = output.argmax(dim=1)
                train_correct += (preds == y_batch).sum().item()

        train_loss /= train_total
        train_acc = (train_correct / train_total * 100) if task_type == "classification" else None

        # ---- Validation ----
        model.eval()
        val_loss = 0.0
        val_correct = 0
        val_total = 0

        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                output = model(X_batch)
                if task_type == "regression":
                    output = output.squeeze(-1)
                    loss = criterion(output, y_batch.float())
                else:
                    loss = criterion(output, y_batch.long())

                val_loss += loss.item() * X_batch.size(0)
                val_total += X_batch.size(0)

                if task_type == "classification":
                    preds = output.argmax(dim=1)
                    val_correct += (preds == y_batch).sum().item()

        val_loss /= val_total if val_total > 0 else 1
        val_acc = (val_correct / val_total * 100) if task_type == "classification" else None
        model.train()

        # ---- Early Stopping Check ----
        if es_enabled:
            if val_loss < best_val_loss - es_min_delta:
                best_val_loss = val_loss
                patience_counter = 0
                best_model_state = copy.deepcopy(model.state_dict())
            else:
                patience_counter += 1
        else:
            # Always track best model even without early stopping
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_model_state = copy.deepcopy(model.state_dict())

        # ---- Timing ----
        epoch_time = time.time() - epoch_start
        epoch_times.append(epoch_time)
        avg_epoch_time = sum(epoch_times) / len(epoch_times)
        eta_seconds = avg_epoch_time * (epochs - epoch)

        # ---- Emit update ----
        update = {
            "epoch": epoch,
            "total_epochs": epochs,
            "train_loss": round(train_loss, 6),
            "val_loss": round(val_loss, 6),
            "train_acc": round(train_acc, 2) if train_acc is not None else None,
            "val_acc": round(val_acc, 2) if val_acc is not None else None,
            "eta_seconds": round(eta_seconds, 1),
            "epoch_time": round(epoch_time, 3),
        }
        if es_enabled:
            update["es_patience_counter"] = patience_counter
            update["es_patience"] = es_patience
        # Record for persistence (excludes ETA — not historically meaningful)
        history.append({
            "epoch": epoch,
            "train_loss": round(train_loss, 6),
            "val_loss": round(val_loss, 6),
            "train_acc": round(train_acc, 2) if train_acc is not None else None,
            "val_acc": round(val_acc, 2) if val_acc is not None else None,
        })
        socketio.emit("training_update", update)
        socketio.sleep(0)  # yield to event loop

        # ---- Trigger early stop ----
        if es_enabled and patience_counter >= es_patience:
            early_stopped = True
            stopped_epoch = epoch
            break

    # Restore best model weights
    if best_model_state is not None:
        model.load_state_dict(best_model_state)

    # ---- Save model with smart filename (unique per run via timestamp) ----
    unique_suffix = time.strftime("%Y%m%dT%H%M%S")
    weight_filename = _build_weight_filename(config, unique_suffix=unique_suffix)
    model_path = os.path.join(WEIGHTS_DIR, weight_filename)
    torch.save(model.state_dict(), model_path)

    final_val_acc = history[-1]["val_acc"] if history else None

    complete_data = {
        "message": "Training complete!" if not early_stopped
                   else f"Early stopping at epoch {stopped_epoch} (patience: {es_patience})",
        "model_path": model_path,
        "weight_filename": weight_filename,
        "final_train_loss": round(train_loss, 6),
        "final_val_loss": round(val_loss, 6),
        "final_val_acc": final_val_acc,
        "early_stopped": early_stopped,
        "task_type": task_type,
        "input_dim": input_dim,
        "output_dim": output_dim,
        "history": history,
    }
    if early_stopped:
        complete_data["stopped_epoch"] = stopped_epoch
    socketio.emit("training_complete", complete_data)
    return complete_data
