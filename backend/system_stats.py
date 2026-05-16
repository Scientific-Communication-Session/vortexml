"""
VortexML — System Stats

Live hardware telemetry sampled during a training run: CPU / GPU / RAM
utilisation and CPU / GPU temperature.

This file is bundled verbatim into the node agent, so it must not import
anything from the rest of the backend.

  * CPU% / RAM%  — psutil.
  * GPU%         — IOAccelerator on macOS, nvidia-smi elsewhere.
  * Temperature  — Apple Silicon exposes temperature sensors through the
                   IOKit HID event system, readable with NO privileges
                   (no sudo, no powermetrics). Linux uses /sys/class/thermal.
"""

import ctypes
import glob
import platform
import re
import subprocess

try:
    import psutil
except ImportError:  # degrade gracefully if psutil isn't installed
    psutil = None

_IS_MAC = platform.system() == "Darwin"
_IS_LINUX = platform.system() == "Linux"


def _run(cmd, timeout=5):
    try:
        return subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout).stdout
    except Exception:
        return ""


def gpu_percent():
    """GPU utilisation as a percentage, or None when it can't be read."""
    if _IS_MAC:
        out = _run(["ioreg", "-r", "-c", "IOAccelerator", "-d", "1", "-w", "0"],
                   timeout=3)
        for pat in (r'"Device Utilization %"\s*=\s*(\d+)',
                    r'"GPU Activity\(%\)"\s*=\s*(\d+)'):
            m = re.search(pat, out)
            if m:
                return float(m.group(1))
    else:
        out = _run(["nvidia-smi", "--query-gpu=utilization.gpu",
                    "--format=csv,noheader,nounits"], timeout=3)
        line = out.strip().splitlines()[0] if out.strip() else ""
        try:
            return float(line)
        except ValueError:
            pass
    return None


# ─────────────────────────────────────────────────────────
# Apple Silicon temperature sensors — IOKit HID, no privileges
# ─────────────────────────────────────────────────────────
_hid_ready = False
_UTF8 = 0x08000100
_TEMP_TYPE = 15            # kIOHIDEventTypeTemperature
_TEMP_FIELD = 15 << 16     # IOHIDEventFieldBase(kIOHIDEventTypeTemperature)

if _IS_MAC:
    try:
        _IOKIT = ctypes.CDLL("/System/Library/Frameworks/IOKit.framework/IOKit")
        _CF = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")

        _CF.CFArrayGetCount.restype = ctypes.c_long
        _CF.CFArrayGetCount.argtypes = [ctypes.c_void_p]
        _CF.CFArrayGetValueAtIndex.restype = ctypes.c_void_p
        _CF.CFArrayGetValueAtIndex.argtypes = [ctypes.c_void_p, ctypes.c_long]
        _CF.CFStringCreateWithCString.restype = ctypes.c_void_p
        _CF.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
        _CF.CFStringGetCString.restype = ctypes.c_bool
        _CF.CFStringGetCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]
        _CF.CFDictionaryCreateMutable.restype = ctypes.c_void_p
        _CF.CFDictionaryCreateMutable.argtypes = [ctypes.c_void_p, ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p]
        _CF.CFDictionarySetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        _CF.CFNumberCreate.restype = ctypes.c_void_p
        _CF.CFNumberCreate.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
        _CF.CFRelease.argtypes = [ctypes.c_void_p]

        _IOKIT.IOHIDEventSystemClientCreate.restype = ctypes.c_void_p
        _IOKIT.IOHIDEventSystemClientCreate.argtypes = [ctypes.c_void_p]
        _IOKIT.IOHIDEventSystemClientSetMatching.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        _IOKIT.IOHIDEventSystemClientCopyServices.restype = ctypes.c_void_p
        _IOKIT.IOHIDEventSystemClientCopyServices.argtypes = [ctypes.c_void_p]
        _IOKIT.IOHIDServiceClientCopyProperty.restype = ctypes.c_void_p
        _IOKIT.IOHIDServiceClientCopyProperty.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        _IOKIT.IOHIDServiceClientCopyEvent.restype = ctypes.c_void_p
        _IOKIT.IOHIDServiceClientCopyEvent.argtypes = [ctypes.c_void_p, ctypes.c_int64, ctypes.c_int32, ctypes.c_int64]
        _IOKIT.IOHIDEventGetFloatValue.restype = ctypes.c_double
        _IOKIT.IOHIDEventGetFloatValue.argtypes = [ctypes.c_void_p, ctypes.c_int32]

        def _cfstr(s):
            return _CF.CFStringCreateWithCString(None, s.encode(), _UTF8)

        def _cfnum(v):
            n = ctypes.c_int32(v)
            return _CF.CFNumberCreate(None, 3, ctypes.byref(n))  # kCFNumberSInt32Type

        # One persistent client matching temperature sensors (usage page 0xff00,
        # usage 5 = AppleVendor temperature sensor).
        _hid_client = _IOKIT.IOHIDEventSystemClientCreate(None)
        _matching = _CF.CFDictionaryCreateMutable(None, 0, None, None)
        _CF.CFDictionarySetValue(_matching, _cfstr("PrimaryUsagePage"), _cfnum(0xff00))
        _CF.CFDictionarySetValue(_matching, _cfstr("PrimaryUsage"), _cfnum(5))
        _IOKIT.IOHIDEventSystemClientSetMatching(_hid_client, _matching)
        _product_key = _cfstr("Product")
        _hid_ready = bool(_hid_client)
    except Exception:
        _hid_ready = False


def _cf_to_str(cfs):
    if not cfs:
        return None
    buf = ctypes.create_string_buffer(512)
    if _CF.CFStringGetCString(cfs, buf, 512, _UTF8):
        return buf.value.decode(errors="replace")
    return None


def _hid_temperatures():
    """Return {sensor_name: celsius} from the IOKit HID temperature sensors."""
    out = {}
    if not _hid_ready:
        return out
    services = _IOKIT.IOHIDEventSystemClientCopyServices(_hid_client)
    if not services:
        return out
    try:
        for i in range(_CF.CFArrayGetCount(services)):
            svc = _CF.CFArrayGetValueAtIndex(services, i)
            if not svc:
                continue
            ev = _IOKIT.IOHIDServiceClientCopyEvent(svc, _TEMP_TYPE, 0, 0)
            if not ev:
                continue
            try:
                temp = _IOKIT.IOHIDEventGetFloatValue(ev, _TEMP_FIELD)
                nameref = _IOKIT.IOHIDServiceClientCopyProperty(svc, _product_key)
                name = _cf_to_str(nameref)
                if nameref:
                    _CF.CFRelease(nameref)
                if name:
                    out[name] = temp
            finally:
                _CF.CFRelease(ev)
    finally:
        _CF.CFRelease(services)
    return out


def _avg(values):
    vals = [v for v in values if isinstance(v, (int, float)) and 0 < v < 130]
    return round(sum(vals) / len(vals), 1) if vals else None


def read_temps():
    """(cpu_temp, gpu_temp) in °C. (None, None) when unreadable. No privileges."""
    if _IS_MAC:
        s = _hid_temperatures()
        if not s:
            return (None, None)
        # M1 / M2 expose explicitly-named CPU and GPU sensors.
        cpu = _avg([v for n, v in s.items()
                    if "CPU" in n.upper() or "ACC MTR" in n.upper()])
        gpu = _avg([v for n, v in s.items() if "GPU" in n.upper()])
        # M3 / M4 expose generic per-domain die sensors instead — the CPU/GPU
        # split is approximate on a unified SoC, but the readings are real.
        if cpu is None:
            cpu = _avg([v for n, v in s.items() if n.startswith("PMU ") and "tdie" in n])
        if gpu is None:
            gpu = _avg([v for n, v in s.items() if n.startswith("PMU2") and "tdie" in n])
        # Last resort — any die sensor that isn't storage or calibration.
        if cpu is None:
            cpu = _avg([v for n, v in s.items()
                        if "tdie" in n and "NAND" not in n and "tcal" not in n])
        if gpu is None:
            gpu = cpu
        return (cpu, gpu)

    if _IS_LINUX:
        temps = []
        for zone in glob.glob("/sys/class/thermal/thermal_zone*/temp"):
            try:
                temps.append(int(open(zone).read().strip()) / 1000.0)
            except Exception:
                pass
        t = _avg(temps)
        return (t, t)

    return (None, None)


def sample():
    """One full telemetry reading. Any field may be None."""
    cpu_temp, gpu_temp = read_temps()
    return {
        "cpu_percent": round(psutil.cpu_percent(interval=None), 1) if psutil else None,
        "ram_percent": round(psutil.virtual_memory().percent, 1) if psutil else None,
        "gpu_percent": gpu_percent(),
        "cpu_temp": cpu_temp,
        "gpu_temp": gpu_temp,
    }


class SystemMonitor:
    """Samples metrics on an interval and hands each reading to `emit_fn`.

    Call `loop()` from a greenlet (eventlet — pass socketio.sleep) or a daemon
    thread (the node agent — pass time.sleep).
    """

    def __init__(self, emit_fn, sleep_fn, interval=1.5):
        self.emit_fn = emit_fn
        self.sleep_fn = sleep_fn
        self.interval = interval
        self._running = False

    def loop(self):
        self._running = True
        if psutil:
            psutil.cpu_percent(interval=None)  # prime the % counter
        # Let a real delta accumulate before the first reading.
        self.sleep_fn(min(0.6, self.interval))
        while self._running:
            try:
                self.emit_fn(sample())
            except Exception:
                pass
            self.sleep_fn(self.interval)

    def stop(self):
        self._running = False
