import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { CloudCog, History, Plus } from 'lucide-react';
import { apiGet, formatTime, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import { useTrainingSession } from '../context/TrainingSessionContext';
import HelpButton from '../components/help/HelpButton';
import AskButton from '../components/chatbot/AskButton';
import DeviceCard, { DEVICE_CARD_HEIGHT } from '../components/devices/DeviceCard';
import ExplainModal from '../components/explain/ExplainModal';
import ResumePrompt from '../components/session/ResumePrompt';
import { RunsPanel, TierStrip } from '../components/session/RunsPanel';
import { jobPercent, queueLine, timeAgo } from '../components/session/format';
import { isActive, isTerminal, type JobView } from '../components/session/types';
import type { Device } from '../components/devices/types';

interface AppState {
    has_dataset: boolean;
    has_features: boolean;
    has_model: boolean;
    model_config: Record<string, unknown> | null;
    last_weights_file: string | null;
}

interface LogLine {
    key: string;
    className?: string;
    content: React.ReactNode;
}

// The log keeps the page light on very long runs by showing the latest epochs.
const LOG_TAIL = 300;

const Training: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const {
        jobs, focusRun: run, setFocus, start, stop, cancel, hydrate, version,
        openEnterprise, openAddDevice, deviceEpoch,
    } = useTrainingSession();

    // The run on screen. Its data lives in the session provider (which follows
    // the server), so it survives leaving this page, closing the tab, or opening
    // the dashboard from another browser.
    const job = run?.job ?? null;
    const jobId = job?.job_id ?? null;
    const status = job?.status ?? null;
    const history = run?.history ?? [];
    const lastPoint = history.length ? history[history.length - 1] : null;
    const isTraining = status === 'running';
    const isQueued = status === 'queued';
    const isComplete = status === 'complete';

    // What is set up and ready to train (dataset + model in the working state)
    const [appState, setAppState] = useState<AppState | null>(null);
    const [starting, setStarting] = useState(false);
    const [busyPrompt, setBusyPrompt] = useState<JobView | null>(null);
    const [explainOpen, setExplainOpen] = useState(false);

    // Compute device selection
    const [devices, setDevices] = useState<Device[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);

    // Network & Chart Refs
    const chartRef = useRef<Chart | null>(null);
    const chartCanvasRef = useRef<HTMLCanvasElement>(null);
    const networkCanvasRef = useRef<HTMLCanvasElement>(null);
    const chartJobRef = useRef<string | null>(null);

    // System-monitor charts (temperature + utilization)
    const tempChartRef = useRef<Chart | null>(null);
    const tempCanvasRef = useRef<HTMLCanvasElement>(null);
    const utilChartRef = useRef<Chart | null>(null);
    const utilCanvasRef = useRef<HTMLCanvasElement>(null);

    // State refs to share with network drawer (since it uses requestAnimationFrame)
    const isTrainingRef = useRef(false);
    const layerSizesRef = useRef<number[]>([4, 128, 64, 2]);

    useEffect(() => {
        isTrainingRef.current = isTraining;
    }, [isTraining]);

    // Log container ref for scoped scrolling
    const logContainerRef = useRef<HTMLDivElement>(null);

    // ── Derived top stats ──
    const cfg = (run?.config ?? appState?.model_config ?? null) as Record<string, unknown> | null;
    const epoch = job?.epoch ?? 0;
    const totalEpochs = job?.total_epochs || (cfg?.epochs as number | undefined) || 0;
    const hasAcc = lastPoint?.val_acc != null;
    const progressPct = job ? jobPercent(job) : 0;
    const eta = isTraining && job?.eta_seconds != null ? formatTime(job.eta_seconds) : '—';
    const esInfo = lastPoint?.es_patience !== undefined
        ? { patience: lastPoint.es_patience, counter: lastPoint.es_patience_counter ?? 0 }
        : run?.info?.early_stopping?.enabled && isActive(status ?? 'complete')
            ? { patience: run.info.early_stopping.patience ?? 0, counter: 0 }
            : null;
    const lastStat = run?.stats.length ? run.stats[run.stats.length - 1] : null;
    const weightFilename = run?.final?.weight_filename
        ?? (!run ? appState?.last_weights_file ?? null : null);

    // Init charts
    useEffect(() => {
        const ctx = chartCanvasRef.current?.getContext('2d');
        if (ctx) {
            chartRef.current = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Train Loss',
                            data: [],
                            borderColor: '#8b5cf6',
                            backgroundColor: 'rgba(139, 92, 246, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                        },
                        {
                            label: 'Val Loss',
                            data: [],
                            borderColor: '#06b6d4',
                            backgroundColor: 'rgba(6, 182, 212, 0.05)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                        },
                        {
                            label: 'Val Accuracy',
                            data: [],
                            borderColor: '#22c55e',
                            backgroundColor: 'rgba(34, 197, 94, 0.05)',
                            borderWidth: 2,
                            fill: false,
                            tension: 0.3,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            yAxisID: 'y1',
                            hidden: true,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 300 },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { labels: { color: '#9d9dba', font: { family: "'Space Grotesk', sans-serif", size: 12 } } },
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Epoch', color: '#9d9dba', font: { family: "'Space Grotesk'" } },
                            ticks: { color: '#5a5a7a', font: { family: "'JetBrains Mono'", size: 10 } },
                            grid: { color: 'rgba(100,100,200,0.07)' },
                        },
                        y: {
                            title: { display: true, text: 'Loss', color: '#9d9dba', font: { family: "'Space Grotesk'" } },
                            ticks: { color: '#5a5a7a', font: { family: "'JetBrains Mono'", size: 10 } },
                            grid: { color: 'rgba(100,100,200,0.07)' },
                            position: 'left',
                        },
                        y1: {
                            title: { display: true, text: 'Accuracy %', color: '#9d9dba', font: { family: "'Space Grotesk'" } },
                            ticks: { color: '#5a5a7a', font: { family: "'JetBrains Mono'", size: 10 } },
                            grid: { display: false },
                            position: 'right',
                            min: 0,
                            max: 100,
                        },
                    },
                },
            });
        }

        // Temperature chart — CPU + GPU on one graph
        const tctx = tempCanvasRef.current?.getContext('2d');
        if (tctx) {
            tempChartRef.current = new Chart(tctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'CPU °C', data: [], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.10)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, spanGaps: true },
                        { label: 'GPU °C', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.07)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, spanGaps: true },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { labels: { color: '#9d9dba', font: { family: "'Space Grotesk', sans-serif", size: 11 } } },
                        tooltip: {
                            mode: 'index', intersect: false,
                            callbacks: {
                                title: () => '',
                                label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? '—' : c.parsed.y.toFixed(1) + ' °C'}`,
                            },
                        },
                    },
                    scales: {
                        x: { display: false },
                        y: { min: 0, max: 100, ticks: { color: '#5a5a7a', font: { family: "'JetBrains Mono'", size: 10 } }, grid: { color: 'rgba(100,100,200,0.07)' } },
                    },
                },
            });
        }

        // Utilization chart — CPU + GPU on one graph
        const uctx = utilCanvasRef.current?.getContext('2d');
        if (uctx) {
            utilChartRef.current = new Chart(uctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        { label: 'CPU %', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.12)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
                        { label: 'GPU %', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.09)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { labels: { color: '#9d9dba', font: { family: "'Space Grotesk', sans-serif", size: 11 } } },
                        tooltip: {
                            mode: 'index', intersect: false,
                            callbacks: {
                                title: () => '',
                                label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? '—' : c.parsed.y.toFixed(1) + ' %'}`,
                            },
                        },
                    },
                    scales: {
                        x: { display: false },
                        y: { min: 0, max: 100, ticks: { color: '#5a5a7a', font: { family: "'JetBrains Mono'", size: 10 } }, grid: { color: 'rgba(100,100,200,0.07)' } },
                    },
                },
            });
        }

        return () => {
            chartRef.current?.destroy();
            tempChartRef.current?.destroy();
            utilChartRef.current?.destroy();
        };
    }, []);

    // Keep the loss/accuracy chart in step with the run's history. It only ever
    // appends — unless the run on screen changed (or restarted), in which case
    // it is redrawn from the replayed history.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const labels = (chart.data.labels ?? []) as string[];
        if (chartJobRef.current !== jobId || labels.length > history.length
            || (labels.length > 0 && history.length > 0 && labels[0] !== String(history[0].epoch))) {
            chart.data.labels = [];
            chart.data.datasets.forEach((ds) => { ds.data = []; });
            chartJobRef.current = jobId;
        }
        const have = (chart.data.labels as string[]).length;
        for (let i = have; i < history.length; i++) {
            const p = history[i];
            chart.data.labels?.push(p.epoch.toString());
            chart.data.datasets[0].data.push(p.train_loss);
            chart.data.datasets[1].data.push(p.val_loss);
            chart.data.datasets[2].data.push(p.val_acc);
        }
        chart.data.datasets[2].hidden = !hasAcc;
        chart.update('none');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, jobId]);

    // Hardware telemetry from whichever machine is training (last ~90 seconds)
    useEffect(() => {
        const stats = run?.stats ?? [];
        const sync = (chart: Chart | null, a: (number | null)[], b: (number | null)[]) => {
            if (!chart) return;
            chart.data.labels = a.map(() => '');
            chart.data.datasets[0].data = a;
            chart.data.datasets[1].data = b;
            chart.update('none');
        };
        sync(utilChartRef.current, stats.map((s) => s.cpu_percent ?? null), stats.map((s) => s.gpu_percent ?? null));
        sync(tempChartRef.current, stats.map((s) => s.cpu_temp ?? null), stats.map((s) => s.gpu_temp ?? null));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, jobId]);

    // A run restored from the server (finished while away, or picked from the
    // list) arrives as a summary — pull its full history in.
    useEffect(() => {
        if (jobId && run && !run.hydrated) void hydrate(jobId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobId, run?.hydrated]);

    // Network viz follows the run on screen, else the model that is set up.
    useEffect(() => {
        const info = run?.info;
        if (info?.layer_sizes) {
            layerSizesRef.current = [info.input_dim || 4, ...info.layer_sizes, info.output_dim || 2];
        } else if (cfg?.layer_sizes) {
            layerSizesRef.current = [
                (cfg.input_dim as number) || 4,
                ...(cfg.layer_sizes as number[]),
                (cfg.output_dim as number) || 2,
            ];
        }
    }, [run?.info, cfg]);

    // ── Working state: is there a dataset + model ready to train? ──
    const loadState = useCallback(() => {
        apiGet('/api/state')
            .then((state) => setAppState(state))
            .catch(() => { });
    }, []);

    // Reload when a run ends (the server clears the finished run's dataset).
    useEffect(() => {
        loadState();
    }, [loadState, jobs.length, status]);

    // Load + poll the compute-device list (keeps status / ETA fresh)
    const loadDevices = useCallback(() => {
        apiGet('/api/devices')
            .then((data) => {
                const list: Device[] = data.devices || [];
                setDevices(list);
                setSelectedDeviceId((prev) => {
                    if (prev != null && list.some((d) => d.id === prev && d.status !== 'offline')) return prev;
                    const pick = list.find((d) => d.status === 'available')
                        ?? list.find((d) => d.status === 'busy');
                    return pick ? pick.id : null;
                });
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        loadDevices();
        const timer = setInterval(loadDevices, 5000);
        return () => clearInterval(timer);
    }, [loadDevices, deviceEpoch, jobs.length]);

    // Network visualization
    useEffect(() => {
        let frame: number;
        const canvas = networkCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const draw = () => {
            const dpr = window.devicePixelRatio || 1;
            // Use parent container dimensions to avoid canvas resize feedback loop
            const parent = canvas.parentElement;
            if (!parent) { frame = requestAnimationFrame(draw); return; }
            const W = parent.clientWidth;
            const H = 350; // Fixed height matching CSS .network-viz
            if (W === 0) { frame = requestAnimationFrame(draw); return; }

            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const layerSizes = layerSizesRef.current;
            const isTr = isTrainingRef.current;

            ctx.clearRect(0, 0, W, H);

            if (!layerSizes || layerSizes.length === 0) {
                frame = requestAnimationFrame(draw);
                return;
            }

            const numLayers = layerSizes.length;
            const layerSpacing = W / (numLayers + 1);
            const maxDisplay = 8;
            const positions: { x: number, y: number }[][] = [];

            for (let l = 0; l < numLayers; l++) {
                const x = layerSpacing * (l + 1);
                const n = Math.min(layerSizes[l], maxDisplay);
                const spacing = Math.min(36, (H - 80) / (n + 1));
                const startY = H / 2 - (spacing * (n - 1)) / 2;
                const lp = [];
                for (let i = 0; i < n; i++) lp.push({ x, y: startY + i * spacing });
                positions.push(lp);
            }

            const pulse = (Math.sin(Date.now() / 400) + 1) / 2;

            // Connections
            for (let l = 0; l < positions.length - 1; l++) {
                for (const from of positions[l]) {
                    for (const to of positions[l + 1]) {
                        ctx.beginPath();
                        ctx.moveTo(from.x, from.y);
                        ctx.lineTo(to.x, to.y);
                        const alpha = isTr ? 0.06 + pulse * 0.08 : 0.08;
                        ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }

            // Particles
            if (isTr) {
                const t = (Date.now() % 2000) / 2000;
                for (let l = 0; l < positions.length - 1; l++) {
                    const fromLayer = positions[l];
                    const toLayer = positions[l + 1];
                    for (let p = 0; p < 3; p++) {
                        if (fromLayer.length === 0 || toLayer.length === 0) continue;
                        const fi = (p * 37 + l * 13) % fromLayer.length;
                        const ti = (p * 23 + l * 7) % toLayer.length;
                        const from = fromLayer[fi];
                        const to = toLayer[ti];
                        const pt = (t + p * 0.33 + l * 0.1) % 1;
                        const px = from.x + (to.x - from.x) * pt;
                        const py = from.y + (to.y - from.y) * pt;

                        ctx.beginPath();
                        ctx.arc(px, py, 3, 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(139, 92, 246, ${0.4 + pulse * 0.4})`;
                        ctx.fill();
                    }
                }
            }

            // Neurons
            for (let l = 0; l < positions.length; l++) {
                const isInput = l === 0;
                const isOutput = l === positions.length - 1;

                for (const pos of positions[l]) {
                    if (isTr) {
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2);
                        const g = ctx.createRadialGradient(pos.x, pos.y, 4, pos.x, pos.y, 16);
                        if (isInput) g.addColorStop(0, `rgba(6, 182, 212, ${0.2 + pulse * 0.15})`);
                        else if (isOutput) g.addColorStop(0, `rgba(249, 115, 22, ${0.2 + pulse * 0.15})`);
                        else g.addColorStop(0, `rgba(139, 92, 246, ${0.2 + pulse * 0.15})`);
                        g.addColorStop(1, 'transparent');
                        ctx.fillStyle = g;
                        ctx.fill();
                    }

                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
                    if (isInput) {
                        ctx.fillStyle = 'rgba(6, 182, 212, 0.7)';
                        ctx.strokeStyle = 'rgba(6, 182, 212, 0.9)';
                    } else if (isOutput) {
                        ctx.fillStyle = 'rgba(249, 115, 22, 0.7)';
                        ctx.strokeStyle = 'rgba(249, 115, 22, 0.9)';
                    } else {
                        ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
                        ctx.strokeStyle = 'rgba(139, 92, 246, 0.9)';
                    }
                    ctx.lineWidth = 2;
                    ctx.fill();
                    ctx.stroke();
                }

                if (positions[l].length > 0) {
                    const x = positions[l][0].x;
                    const bottomY = positions[l][positions[l].length - 1].y + 24;
                    ctx.fillStyle = 'rgba(157, 157, 186, 0.7)';
                    ctx.font = '10px "Space Grotesk", sans-serif';
                    ctx.textAlign = 'center';
                    if (isInput) ctx.fillText('Input', x, bottomY);
                    else if (isOutput) ctx.fillText('Output', x, bottomY);
                    else ctx.fillText(`${layerSizes[l]}n`, x, bottomY);

                    if (layerSizes[l] > maxDisplay) {
                        ctx.fillStyle = 'rgba(139, 92, 246, 0.5)';
                        ctx.fillText('⋮', x, H / 2 + 3);
                    }
                }
            }

            frame = requestAnimationFrame(draw);
        };
        draw();

        return () => cancelAnimationFrame(frame);
    }, []);

    // ── Log: derived from the run, so a re-attached run shows its whole story ──
    const logLines = useMemo<LogLine[]>(() => {
        const muted = (key: string, text: React.ReactNode): LogLine => ({
            key, content: <span className="text-muted">{text}</span>,
        });
        if (!run || !job) return [muted('idle', 'Waiting to start training...')];

        const lines: LogLine[] = [];
        const device = job.device_name || 'the selected device';
        if (isQueued) {
            lines.push(muted('queued', `Queued on ${device} — ${queueLine(job)}. Training starts automatically.`));
            return lines;
        }
        if (history.length === 0 && isTraining) {
            lines.push(muted('prep', run.info
                ? `Training on ${device}…`
                : `Preparing the dataset on ${device}…`));
        }
        if (history.length > LOG_TAIL) {
            lines.push(muted('trimmed', `… ${history.length - LOG_TAIL} earlier epochs not shown`));
        }
        for (const p of history.slice(-LOG_TAIL)) {
            lines.push({
                key: `e${p.epoch}`,
                content: (
                    <>
                        <span className="log-epoch">Epoch {p.epoch}/{p.total_epochs}</span>
                        {' — '}<span className="log-loss">loss: {p.train_loss.toFixed(4)}</span>
                        {' · '}<span className="log-loss">val_loss: {p.val_loss.toFixed(4)}</span>
                        {p.val_acc != null && <>{' · '}<span className="log-acc">acc: {p.val_acc.toFixed(1)}%</span></>}
                        {p.es_patience !== undefined && (
                            <>{' · '}<span className="log-es">patience: {p.es_patience_counter}/{p.es_patience}</span></>
                        )}
                    </>
                ),
            });
        }
        const final = run.final;
        if (status === 'complete' && final) {
            if (final.early_stopped) {
                lines.push({
                    key: 'es', className: 'log-entry-es',
                    content: <span className="log-es-msg">🛑 Early stopping triggered at epoch {final.stopped_epoch}. Best weights restored.</span>,
                });
            }
            lines.push({
                key: 'final', className: 'log-entry-final',
                content: (
                    <span className="log-final">
                        ✅ {final.message || 'Training complete!'}
                        {final.final_train_loss != null && <> — Final loss: {final.final_train_loss.toFixed(4)}</>}
                        {final.final_val_loss != null && <> · Val loss: {final.final_val_loss.toFixed(4)}</>}
                    </span>
                ),
            });
        } else if (status === 'stopped') {
            lines.push({
                key: 'stopped', className: 'log-entry-es',
                content: <span className="log-es-msg">⏹ Training stopped{epoch ? ` at epoch ${epoch}` : ''}.</span>,
            });
        } else if (status === 'error') {
            lines.push({
                key: 'error', className: 'log-entry-es',
                content: <span className="log-es-msg">⚠️ {run.message || 'Training failed.'}</span>,
            });
        }
        return lines;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, jobId, status]);

    // Auto-scroll logs — scroll only within the log container, not the whole page
    useEffect(() => {
        const container = logContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [logLines]);

    // ── Actions ──
    const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;
    const setupReady = Boolean(appState?.has_dataset && appState.has_features && appState.has_model);
    const deviceUsable = selectedDevice != null && selectedDevice.status !== 'offline';
    const willQueue = selectedDevice?.status === 'busy' || (selectedDevice?.queue_length ?? 0) > 0;
    const hasActiveRun = jobs.length > 0;

    const launch = async (confirmedQueue = false) => {
        if (!selectedDevice) {
            showToast('Pick a compute device first.', 'warning');
            return;
        }
        // Free tier: the shared Mac mini trains one model at a time. If you
        // already have a run there, say so — and offer the ways around it —
        // before quietly lining up another.
        const mine = jobs.find((j) => j.device_id === selectedDevice.id);
        if (selectedDevice.is_shared && mine && !confirmedQueue) {
            setBusyPrompt(mine);
            return;
        }
        setBusyPrompt(null);
        setStarting(true);
        try {
            const data = await start(selectedDevice.id);
            if (data.error) {
                showToast(data.error, 'error');
            } else if (data.status === 'queued') {
                showToast(
                    data.ahead === 1
                        ? 'Queued — 1 run ahead of you. It starts automatically.'
                        : `Queued — ${data.ahead} runs ahead of you. It starts automatically.`,
                    'info',
                );
            }
        } catch (e) {
            showToast('Error: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setStarting(false);
            loadDevices();
            loadState();
        }
    };

    const enroll = () => {
        if (!user) {
            showToast('Sign in to link your own server to your account.', 'warning');
            navigate('/signin');
            return;
        }
        openAddDevice();
    };

    const handleSaveWeights = () => {
        if (!weightFilename) {
            showToast('No weights file available.', 'error');
            return;
        }
        window.location.href = `/api/weights/file/${encodeURIComponent(weightFilename)}`;
        showToast('Downloading: ' + weightFilename, 'success');
    };

    const buildExplainRequest = () => ({
        config: {
            ...(cfg || {}),
            arch_type: run?.info?.arch_type ?? cfg?.arch_type,
            layer_sizes: run?.info?.layer_sizes ?? cfg?.layer_sizes,
        },
        history: history.map((p) => ({
            epoch: p.epoch,
            train_loss: p.train_loss ?? null,
            val_loss: p.val_loss ?? null,
            val_acc: p.val_acc ?? null,
        })),
        task_type: run?.info?.task_type ?? run?.final?.task_type ?? (cfg?.task_type as string | undefined),
        metrics: {
            final_train_loss: run?.final?.final_train_loss,
            final_val_loss: run?.final?.final_val_loss,
            final_val_acc: run?.final?.final_val_acc ?? null,
            early_stopped: run?.final?.early_stopped,
            stopped_epoch: run?.final?.stopped_epoch ?? null,
        },
    });

    const sysMetric = (label: string, value: number | null | undefined, suffix: string, color: string) => (
        <div style={{ textAlign: 'center', flex: '1 1 70px', minWidth: 70 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 700, color }}>
                {value == null ? '—' : Math.round(value) + suffix}
            </div>
            <div className="text-muted" style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {label}
            </div>
        </div>
    );

    const startLabel = starting
        ? '⏳ Starting...'
        : hasActiveRun
            ? '＋ Queue another run'
            : willQueue ? '▶ Join the queue' : '▶ Start Training';
    const startTitle = !deviceUsable
        ? 'Select an online device above'
        : !setupReady
            ? 'Set up a dataset and a model first'
            : willQueue
                ? 'This device is busy — your run waits in its queue and starts automatically'
                : undefined;

    return (
        <>
            <div className="page-header">
                <h1>Training <em>Dashboard.</em></h1>
                <p>Watch your neural network learn in real-time.</p>
            </div>

            {/* Background-session notices */}
            {job && isActive(job.status) && (
                <div className="vx-banner">
                    <CloudCog size={18} />
                    <span>
                        <strong>{job.project_name || 'This run'}</strong> is{' '}
                        {isQueued ? 'queued for' : 'training on'} {job.device_name || 'the server'} as a background
                        session. You can close this tab or switch device — it keeps going, and this dashboard picks
                        it up wherever it is when you come back.
                    </span>
                </div>
            )}
            {job && isTerminal(job.status) && job.finished_at && (
                <div className="vx-banner vx-banner--muted">
                    <History size={18} />
                    <span>
                        Showing your last run — <strong>{job.project_name || 'Untitled'}</strong>,{' '}
                        {job.status === 'complete' ? 'finished' : job.status === 'stopped' ? 'stopped' : 'ended with an error'}{' '}
                        {timeAgo(job.finished_at)} on {job.device_name || 'the server'}.
                    </span>
                    <span className="vx-banner__actions">
                        <Link to="/dataset" className="vx-ghost-btn">＋ New run</Link>
                    </span>
                </div>
            )}
            {!job && appState && !setupReady && (
                <div className="vx-banner vx-banner--muted">
                    <History size={18} />
                    <span>
                        Nothing is set up to train yet. Upload a dataset and choose an architecture — or watch a
                        real model train in the live demo.
                    </span>
                    <span className="vx-banner__actions">
                        <Link to="/dataset" className="vx-ghost-btn">Upload a dataset</Link>
                        <Link to="/demo" className="vx-ghost-btn vx-ghost-btn--accent">Try the live demo</Link>
                    </span>
                </div>
            )}

            {/* Compute Device Picker */}
            <div className="glass-panel">
                <div className="flex-between mb-1">
                    <div className="panel-title mb-0"><span className="pt-icon">🖥️</span> Compute Device</div>
                    <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                        {selectedDevice
                            ? <>Selected: <strong>{selectedDevice.nickname}</strong>{willQueue ? ' — busy, your run will queue' : ''}</>
                            : 'Choose where to train'}
                    </span>
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(265px, 1fr))',
                    gap: '1rem',
                }}>
                    {devices.map((d) => (
                        <DeviceCard
                            key={d.id}
                            device={d}
                            selected={d.id === selectedDeviceId}
                            onSelect={setSelectedDeviceId}
                        />
                    ))}
                    <button
                        type="button"
                        onClick={enroll}
                        style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            justifyContent: 'center', gap: '0.4rem', height: DEVICE_CARD_HEIGHT,
                            borderRadius: 16, cursor: 'pointer', color: '#9d9dba',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1.5px dashed rgba(255,255,255,0.16)',
                            transition: 'border-color 0.2s, color 0.2s',
                        }}
                    >
                        <Plus size={22} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Add your own device</span>
                        <span style={{ fontSize: '0.74rem', opacity: 0.7 }}>Train on a machine you own — no queue</span>
                    </button>
                </div>
                <TierStrip onEnroll={enroll} onSales={openEnterprise} />
            </div>

            {/* Your runs: what is training and what is waiting in line */}
            {jobs.length > 0 && (
                <div className="glass-panel">
                    <div className="flex-between mb-1">
                        <div className="panel-title mb-0"><span className="pt-icon">📋</span> Your Runs</div>
                        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                            {jobs.length === 1 ? '1 background session' : `${jobs.length} background sessions`}
                        </span>
                    </div>
                    <RunsPanel
                        jobs={jobs}
                        focusedId={jobId}
                        onFocus={setFocus}
                        onStop={stop}
                        onCancel={cancel}
                    />
                </div>
            )}

            {/* Top Stats */}
            <div className="training-top-bar">
                <div className="stat-card">
                    <div className="stat-value gradient">{epoch}/{totalEpochs}</div>
                    <div className="stat-label">Epoch <HelpButton topic="metric_epoch" size={12} /><AskButton topic="metric_epoch" size={12} /></div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-2)' }}>
                        {lastPoint ? lastPoint.train_loss.toFixed(4) : '—'}
                    </div>
                    <div className="stat-label">Train Loss <HelpButton topic="metric_train_loss" size={12} /><AskButton topic="metric_train_loss" size={12} /></div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: hasAcc ? '#22c55e' : 'inherit' }}>
                        {!lastPoint ? '—' : hasAcc ? lastPoint.val_acc!.toFixed(1) + '%' : lastPoint.val_loss.toFixed(4)}
                    </div>
                    <div className="stat-label">{hasAcc ? 'Val Accuracy' : 'Val Loss'} <HelpButton topic="metric_val" size={12} /><AskButton topic="metric_val" size={12} /></div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-4)' }}>{eta}</div>
                    <div className="stat-label">ETA <HelpButton topic="metric_eta" size={12} /><AskButton topic="metric_eta" size={12} /></div>
                </div>
            </div>

            {/* Live system metrics from the training machine */}
            <div className="glass-panel glass-panel-sm">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', flexWrap: 'wrap' }}>
                    <span className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
                        ⚙ System
                    </span>
                    <div style={{ display: 'flex', flex: 1, gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'space-around' }}>
                        {sysMetric('CPU', lastStat?.cpu_percent, '%', '#8b5cf6')}
                        {sysMetric('GPU', lastStat?.gpu_percent, '%', '#06b6d4')}
                        {sysMetric('RAM', lastStat?.ram_percent, '%', '#22c55e')}
                        {sysMetric('CPU Temp', lastStat?.cpu_temp, '°', '#f59e0b')}
                        {sysMetric('GPU Temp', lastStat?.gpu_temp, '°', '#ef4444')}
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="glass-panel glass-panel-sm">
                <div className="flex-between mb-1">
                    <span
                        className="text-muted"
                        style={{ fontSize: '0.85rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        {isQueued ? 'Waiting in the queue' : 'Training Progress'}
                        {isTraining && (
                            <span
                                className="training-spinner"
                                role="status"
                                aria-label="Training in progress"
                                title={
                                    esInfo
                                        ? `Training (early-stopping patience ${esInfo.counter}/${esInfo.patience})`
                                        : 'Training in progress'
                                }
                            />
                        )}
                    </span>
                    <div className="flex gap-05">
                        {esInfo && (
                            <span
                                className="es-badge"
                                title={`Early Stopping: ${esInfo.counter}/${esInfo.patience} patience`}
                            >
                                🛑 ES
                            </span>
                        )}
                        <span className="text-muted" style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
                            {isQueued && job ? `#${job.position} in line` : `${progressPct}%`}
                        </span>
                    </div>
                </div>
                <div className={`progress-bar-container ${isQueued ? 'vx-bar--waiting' : ''}`} style={{ height: '10px' }}>
                    <div className="progress-bar" style={{ width: `${progressPct}%` }}></div>
                </div>
            </div>

            {/* Charts + Network Viz */}
            <div className="training-grid">
                <div className="glass-panel">
                    <div className="panel-title"><span className="pt-icon">📈</span> Loss & Accuracy</div>
                    <div className="chart-container">
                        <canvas ref={chartCanvasRef}></canvas>
                    </div>
                </div>
                <div className="glass-panel">
                    <div className="panel-title"><span className="pt-icon">🔮</span> Network Visualization</div>
                    <canvas ref={networkCanvasRef} className="network-viz"></canvas>
                </div>
            </div>

            {/* Log + Controls */}
            <div className="glass-panel">
                <div className="flex-between mb-1">
                    <div className="panel-title mb-0"><span className="pt-icon">📝</span> Training Log</div>
                    <div className="flex gap-1" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {(isComplete || !run) && weightFilename && (
                            <button className="btn btn-save btn-sm" onClick={handleSaveWeights}>💾 Save Weights</button>
                        )}

                        {isComplete && history.length > 0 && (
                            <button className="btn btn-secondary btn-sm" onClick={() => setExplainOpen(true)}>
                                ✨ Explain Results
                            </button>
                        )}

                        {isTraining && jobId && (
                            <button className="btn btn-danger btn-sm" onClick={() => stop(jobId)}>⏹ Stop Training</button>
                        )}

                        {isQueued && jobId && (
                            <button className="btn btn-secondary btn-sm" onClick={() => cancel(jobId)}>✕ Leave queue</button>
                        )}

                        {(setupReady || !job || !isTerminal(job.status)) && (
                            <button
                                className={`btn btn-sm ${hasActiveRun ? 'btn-secondary' : 'btn-primary'}`}
                                onClick={() => launch()}
                                disabled={starting || !deviceUsable || !setupReady}
                                title={startTitle}
                            >
                                {startLabel}
                            </button>
                        )}

                        {job && isTerminal(job.status) && !setupReady && (
                            <button className="btn btn-primary btn-sm" onClick={() => navigate('/dataset')}>＋ New Run</button>
                        )}
                    </div>
                </div>

                <div className="training-log" ref={logContainerRef}>
                    {logLines.map((line) => (
                        <div key={line.key} className={`log-entry ${line.className || ''}`}>{line.content}</div>
                    ))}
                </div>
            </div>

            {/* System Monitor — temperature + utilization */}
            <div className="glass-panel">
                <div className="panel-title"><span className="pt-icon">📊</span> System Monitor</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    <div>
                        <div className="text-muted" style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                            🌡️ Temperature — CPU vs GPU
                        </div>
                        <div style={{ height: 220 }}>
                            <canvas ref={tempCanvasRef}></canvas>
                        </div>
                    </div>
                    <div>
                        <div className="text-muted" style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                            ⚡ Utilization — CPU vs GPU
                        </div>
                        <div style={{ height: 220 }}>
                            <canvas ref={utilCanvasRef}></canvas>
                        </div>
                    </div>
                </div>
            </div>

            {busyPrompt && (
                <ResumePrompt
                    mode="busy"
                    job={jobs.find((j) => j.job_id === busyPrompt.job_id) ?? busyPrompt}
                    onClose={() => setBusyPrompt(null)}
                    onView={() => { setFocus(busyPrompt.job_id); setBusyPrompt(null); }}
                    onQueue={() => launch(true)}
                    onEnroll={() => { setBusyPrompt(null); enroll(); }}
                    onSales={() => { setBusyPrompt(null); openEnterprise(); }}
                />
            )}

            {explainOpen && (
                <ExplainModal
                    title={job?.project_name || (cfg?.project_name as string) || 'this run'}
                    request={buildExplainRequest()}
                    onClose={() => setExplainOpen(false)}
                />
            )}
        </>
    );
};

export default Training;
