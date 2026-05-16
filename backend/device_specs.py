"""
Vortex ML — Device Spec Detection

A cross-platform hardware probe. Used in two places:
  * the central server, to describe the shared M4 Mac Mini, and
  * node agents, to describe a user's own machine when it registers.

This file is bundled verbatim into the downloadable node agent, so it must
have no dependency on the rest of the backend. `torch` is imported lazily and
only to detect the available accelerator.
"""

import os
import platform
import subprocess
import re


def _run(cmd, timeout=10):
    """Run a command and return stripped stdout, or '' on any failure."""
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.stdout.strip()
    except Exception:
        return ""


def _macos_specs():
    specs = {}

    mem = _run(["sysctl", "-n", "hw.memsize"])
    if mem.isdigit():
        specs["ram_gb"] = round(int(mem) / (1024 ** 3))

    chip = _run(["sysctl", "-n", "machdep.cpu.brand_string"])
    if chip:
        specs["chip"] = chip

    ncpu = _run(["sysctl", "-n", "hw.ncpu"])
    if ncpu.isdigit():
        specs["cpu_cores"] = int(ncpu)

    # Apple Silicon reports its GPU core count in the Displays profile.
    disp = _run(["system_profiler", "SPDisplaysDataType"])
    m = re.search(r"Total Number of Cores:\s*(\d+)", disp)
    if m:
        specs["gpu_cores"] = int(m.group(1))

    return specs


def _linux_specs():
    specs = {}

    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    specs["ram_gb"] = round(int(line.split()[1]) / (1024 ** 2))
                    break
    except Exception:
        pass

    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if "model name" in line:
                    specs["chip"] = line.split(":", 1)[1].strip()
                    break
    except Exception:
        pass

    specs["cpu_cores"] = os.cpu_count() or 0
    return specs


def _accelerator():
    """Return (key, human_label). key is one of: mps, cuda, cpu."""
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps", "Apple Metal (MPS)"
        if torch.cuda.is_available():
            try:
                return "cuda", f"NVIDIA CUDA — {torch.cuda.get_device_name(0)}"
            except Exception:
                return "cuda", "NVIDIA CUDA"
    except Exception:
        pass
    return "cpu", "CPU only"


def detect_specs():
    """Probe the local machine and return a JSON-serialisable spec dict."""
    system = platform.system()

    specs = {
        "platform": system,
        "hostname": platform.node(),
        "ram_gb": None,
        "cpu_cores": os.cpu_count() or 0,
        "gpu_cores": None,
        "chip": platform.processor() or platform.machine() or "Unknown",
    }

    if system == "Darwin":
        specs.update(_macos_specs())
    elif system == "Linux":
        specs.update(_linux_specs())

    accel, accel_label = _accelerator()
    specs["accelerator"] = accel
    specs["accelerator_label"] = accel_label
    return specs


if __name__ == "__main__":
    import json
    print(json.dumps(detect_specs(), indent=2))
