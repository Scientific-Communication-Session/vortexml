import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import Chart from 'chart.js/auto';
import { apiGet, formatTime, showToast } from '../utils/helpers';
import HelpButton from '../components/help/HelpButton';

interface LogEntry {
    id: number;
    html: string;
    type?: string;
}

const Training: React.FC = () => {
    // Top Stats
    const [epoch, setEpoch] = useState(0);
    const [totalEpochs, setTotalEpochs] = useState(0);
    const [trainLoss, setTrainLoss] = useState<string>('—');
    const [valLoss, setValLoss] = useState<string>('—');
    const [valAcc, setValAcc] = useState<string>('—');
    const [eta, setEta] = useState<string>('—');
    const [hasAcc, setHasAcc] = useState(false);

    // Progress
    const [progressPct, setProgressPct] = useState(0);
    const [esInfo, setEsInfo] = useState<{ patience: number, counter: number } | null>(null);

    // Flow
    const [isTraining, setIsTraining] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const [lastWeightFilename, setLastWeightFilename] = useState<string | null>(null);
    const [btnState, setBtnState] = useState<'idle' | 'starting' | 'training' | 'complete'>('idle');

    // Logs
    const [logs, setLogs] = useState<LogEntry[]>([{ id: 0, html: '<span class="text-muted">Waiting to start training...</span>' }]);
    const logCounter = useRef(1);
    const logEndRef = useRef<HTMLDivElement>(null);

    // Network & Chart Refs
    const chartRef = useRef<Chart | null>(null);
    const chartCanvasRef = useRef<HTMLCanvasElement>(null);
    const networkCanvasRef = useRef<HTMLCanvasElement>(null);
    const socketRef = useRef<Socket | null>(null);

    // State refs to share with network drawer (since it uses requestAnimationFrame)
    const isTrainingRef = useRef(false);
    const layerSizesRef = useRef<number[]>([4, 128, 64, 2]);

    useEffect(() => {
        isTrainingRef.current = isTraining;
    }, [isTraining]);

    // Add log helper
    const addLog = (html: string, type?: string) => {
        setLogs(prev => [...prev, { id: logCounter.current++, html, type }]);
    };

    // Log container ref for scoped scrolling
    const logContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs — scroll only within the log container, not the whole page
    useEffect(() => {
        const container = logContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [logs]);

    // Init Socket & Chart
    useEffect(() => {
        socketRef.current = io();

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

        // Socket listeners
        socketRef.current.on('training_update', (data) => {
            const { epoch: ep, total_epochs, train_loss, val_loss, val_acc, eta_seconds } = data;

            setEpoch(ep);
            setTotalEpochs(total_epochs);
            setTrainLoss(train_loss.toFixed(4));
            setEta(formatTime(eta_seconds));

            setProgressPct(Math.round((ep / total_epochs) * 100));

            const hasAccuracyData = val_acc !== null && val_acc !== undefined;
            setHasAcc(hasAccuracyData);

            if (hasAccuracyData) {
                setValAcc(val_acc.toFixed(1) + '%');
                if (chartRef.current) chartRef.current.data.datasets[2].hidden = false;
            } else {
                setValLoss(val_loss.toFixed(4));
            }

            if (data.es_patience !== undefined) {
                setEsInfo({ patience: data.es_patience, counter: data.es_patience_counter });
            }

            // Update chart
            if (chartRef.current) {
                chartRef.current.data.labels?.push(ep.toString());
                chartRef.current.data.datasets[0].data.push(train_loss);
                chartRef.current.data.datasets[1].data.push(val_loss);
                chartRef.current.data.datasets[2].data.push(val_acc);
                chartRef.current.update('none');
            }

            // Log entry
            let logLine = `<span class="log-epoch">Epoch ${ep}/${total_epochs}</span>`;
            logLine += ` — <span class="log-loss">loss: ${train_loss.toFixed(4)}</span>`;
            logLine += ` · <span class="log-loss">val_loss: ${val_loss.toFixed(4)}</span>`;
            if (hasAccuracyData) logLine += ` · <span class="log-acc">acc: ${val_acc.toFixed(1)}%</span>`;
            if (data.es_patience !== undefined) logLine += ` · <span class="log-es">patience: ${data.es_patience_counter}/${data.es_patience}</span>`;

            addLog(logLine);
        });

        socketRef.current.on('training_complete', (data) => {
            setIsTraining(false);
            setBtnState('complete');
            setIsComplete(true);

            if (data.weight_filename) {
                setLastWeightFilename(data.weight_filename);
            }

            if (data.early_stopped) {
                showToast(`Early stopping at epoch ${data.stopped_epoch}! 🛑`, 'warning');
                addLog(`<span class="log-es-msg">🛑 Early stopping triggered at epoch ${data.stopped_epoch}. Best weights restored.</span>`, 'log-entry-es');
            } else {
                showToast('Training complete! 🎉', 'success');
            }

            addLog(`<span class="log-final">✅ ${data.message} — Final loss: ${data.final_train_loss.toFixed(4)} · Val loss: ${data.final_val_loss.toFixed(4)}</span>`, 'log-entry-final');
        });

        socketRef.current.on('training_stopped', () => {
            setIsTraining(false);
            setBtnState('idle');
            showToast('Training stopped.', 'warning');
        });

        socketRef.current.on('training_error', (data) => {
            setIsTraining(false);
            setBtnState('idle');
            showToast('Training error: ' + data.message, 'error');
        });

        return () => {
            socketRef.current?.disconnect();
            chartRef.current?.destroy();
        };
    }, []);

    // Load initial state for network viz
    useEffect(() => {
        apiGet('/api/state')
            .then((state) => {
                if (state.has_model && state.model_config) {
                    const cfg = state.model_config;
                    layerSizesRef.current = [cfg.input_dim || 4, ...(cfg.layer_sizes || [128, 64]), cfg.output_dim || 2];
                }
                if (state.last_weights_file) {
                    setLastWeightFilename(state.last_weights_file);
                    setIsComplete(true);
                }
            })
            .catch(() => { });
    }, []);

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

    const handleStart = async () => {
        try {
            setBtnState('starting');
            setIsComplete(false);
            setLogs([]);
            addLog('<span class="text-muted">Starting training...</span>');

            if (chartRef.current) {
                chartRef.current.data.labels = [];
                chartRef.current.data.datasets.forEach(ds => ds.data = []);
                chartRef.current.data.datasets[2].hidden = true;
                chartRef.current.update();
            }

            setEpoch(0); setTotalEpochs(0); setTrainLoss('—'); setValLoss('—');
            setValAcc('—'); setEta('—'); setProgressPct(0); setEsInfo(null); setHasAcc(false);

            const res = await fetch('/api/training/start', { method: 'POST', credentials: 'include' });
            const data = await res.json();

            if (data.error) {
                showToast(data.error, 'error');
                setBtnState('idle');
                return;
            }

            setIsTraining(true);
            setBtnState('training');

            if (data.info) {
                layerSizesRef.current = [
                    data.info.input_dim || 4,
                    ...(data.info.layer_sizes || [128, 64]),
                    data.info.output_dim || 2,
                ];
                if (data.info.early_stopping?.enabled) {
                    setEsInfo({ patience: data.info.early_stopping.patience, counter: 0 });
                }
            }

        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Error: ' + msg, 'error');
            setBtnState('idle');
        }
    };

    const handleStop = async () => {
        try {
            await fetch('/api/training/stop', { method: 'POST', credentials: 'include' });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Error: ' + msg, 'error');
        }
    };

    const handleSaveWeights = () => {
        if (!lastWeightFilename) {
            showToast('No weights file available.', 'error');
            return;
        }
        window.location.href = `/api/weights/file/${encodeURIComponent(lastWeightFilename)}`;
        showToast('Downloading: ' + lastWeightFilename, 'success');
    };

    return (
        <>
            <div className="page-header">
                <h1>Training <em>Dashboard.</em></h1>
                <p>Watch your neural network learn in real-time.</p>
            </div>

            {/* Top Stats */}
            <div className="training-top-bar">
                <div className="stat-card">
                    <div className="stat-value gradient">{epoch}/{totalEpochs}</div>
                    <div className="stat-label">Epoch <HelpButton topic="metric_epoch" size={12} /></div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-2)' }}>{trainLoss}</div>
                    <div className="stat-label">Train Loss <HelpButton topic="metric_train_loss" size={12} /></div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: hasAcc ? '#22c55e' : 'inherit' }}>
                        {hasAcc ? valAcc : valLoss}
                    </div>
                    <div className="stat-label">{hasAcc ? 'Val Accuracy' : 'Val Loss'} <HelpButton topic="metric_val" size={12} /></div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-4)' }}>{eta}</div>
                    <div className="stat-label">ETA <HelpButton topic="metric_eta" size={12} /></div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="glass-panel glass-panel-sm">
                <div className="flex-between mb-1">
                    <span className="text-muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Training Progress</span>
                    <div className="flex gap-05">
                        {esInfo && (
                            <span
                                className="es-badge"
                                title={`Early Stopping: ${esInfo.counter}/${esInfo.patience} patience`}
                            >
                                🛑 ES
                            </span>
                        )}
                        <span className="text-muted" style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>{progressPct}%</span>
                    </div>
                </div>
                <div className="progress-bar-container" style={{ height: '10px' }}>
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
                    <div className="flex gap-1" style={{ display: 'flex', gap: '1rem' }}>
                        {isComplete && lastWeightFilename && (
                            <button className="btn btn-save btn-sm" onClick={handleSaveWeights}>💾 Save Weights</button>
                        )}

                        {btnState === 'training' && (
                            <button className="btn btn-danger btn-sm" onClick={handleStop}>⏹ Stop Training</button>
                        )}

                        {btnState !== 'training' && (
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleStart}
                                disabled={btnState === 'starting' || btnState === 'complete'}
                            >
                                {btnState === 'starting' ? '⏳ Starting...' : btnState === 'complete' ? '✓ Complete' : '▶ Start Training'}
                            </button>
                        )}

                        {btnState === 'complete' && (
                            <button className="btn btn-primary btn-sm" onClick={() => { setBtnState('idle'); handleStart(); }}>▶ Restart</button>
                        )}
                    </div>
                </div>

                <div className="training-log" ref={logContainerRef}>
                    {logs.map(log => (
                        <div key={log.id} className={`log-entry ${log.type || ''}`} dangerouslySetInnerHTML={{ __html: log.html }} />
                    ))}
                    <div ref={logEndRef} />
                </div>
            </div>
        </>
    );
};

export default Training;
