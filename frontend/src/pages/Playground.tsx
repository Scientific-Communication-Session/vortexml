import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import Chart, { SERIES, tint, axis } from '../theme/chart';
import { Wand2, Upload, Loader2, Download, Boxes, Cpu, ChartColumn, Sparkles, SlidersHorizontal, TriangleAlert, Wand } from 'lucide-react';
import './predict.css';
import { apiGet, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

interface Project {
    id: number;
    name: string;
    arch_type: string;
    task_type: string;
    final_val_acc: number | null;
    final_val_loss: number | null;
}

interface Field { name: string; kind: 'numeric' | 'categorical'; options?: string[]; }
interface Schema {
    ready: boolean; reason?: string; task_type: string;
    target_col?: string; target_classes?: string[] | null; fields?: Field[];
}
interface Prediction { prediction: string | number; confidence?: number; probabilities?: Record<string, number>; }
interface Evaluation {
    task_type: string;
    classes?: string[]; confusion_matrix?: number[][]; accuracy?: number; n?: number;
    mae?: number; rmse?: number; r2?: number | null;
    residuals?: { true: number; pred: number; residual: number }[];
}
interface LiveStats { cpu_percent?: number; gpu_percent?: number; ram_percent?: number; cpu_temp?: number; gpu_temp?: number; }
interface ResourceInfo { inference_ms?: number; rows_per_sec?: number | null; stats?: LiveStats | null; }
interface PredictResponse { predictions: Prediction[]; evaluation: Evaluation | null; device?: string | null; resource?: ResourceInfo | null; }
interface RDevice { id: number; nickname: string; is_shared: boolean; online?: boolean; }

const ARCH_LABEL: Record<string, string> = {
    mlp: 'MLP', dnn: 'DNN', cnn1d: 'CNN-1D', rnn: 'RNN', lstm: 'LSTM',
    gru: 'GRU', autoencoder: 'Autoencoder', resnet: 'ResNet', transformer: 'Transformer', wide_deep: 'Wide & Deep',
};


const Playground: React.FC = () => {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const isBeginner = user?.is_beginner === true;
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [schema, setSchema] = useState<Schema | null>(null);
    const [values, setValues] = useState<Record<string, string>>({});
    const [result, setResult] = useState<PredictResponse | null>(null);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [devices, setDevices] = useState<RDevice[]>([]);
    const [deviceId, setDeviceId] = useState<number | null>(null);
    const [liveStats, setLiveStats] = useState<LiveStats | null>(null);

    const residualCanvasRef = useRef<HTMLCanvasElement>(null);
    const residualChartRef = useRef<Chart | null>(null);
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { navigate('/signin'); return; }
        apiGet('/api/projects')
            .then((d) => setProjects(d.projects ?? []))
            .catch((e) => showToast('Failed to load models: ' + (e instanceof Error ? e.message : String(e)), 'error'))
            .finally(() => setLoading(false));
        if (!isBeginner) apiGet('/api/rag/devices').then((d) => setDevices(d.devices || [])).catch(() => { });
    }, [user, authLoading, navigate, isBeginner]);

    // Socket: remote prediction results + live hardware stats while a node runs.
    useEffect(() => {
        if (!user) return;
        const s = io();
        socketRef.current = s;
        s.on('predict_result', (d: PredictResponse) => {
            setResult({ predictions: d.predictions || [], evaluation: d.evaluation || null, device: d.device, resource: d.resource });
            setBusy(false); setLiveStats(null);
        });
        s.on('predict_stats', (d: LiveStats) => setLiveStats(d));
        s.on('predict_error', (d: { error: string }) => { showToast(d.error, 'error'); setBusy(false); setLiveStats(null); });
        return () => { s.disconnect(); socketRef.current = null; };
    }, [user]);

    // Load the selected model's input schema. (The schema/result reset happens in
    // the model picker's onChange, so this effect only sets state asynchronously.)
    useEffect(() => {
        if (selectedId == null) return;
        let cancelled = false;
        fetch(`/api/projects/${selectedId}/inference`, { credentials: 'include' })
            .then((r) => r.json())
            .then((s: Schema) => {
                if (cancelled) return;
                setSchema(s);
                if (s.ready && s.fields) {
                    const init: Record<string, string> = {};
                    s.fields.forEach((f) => { init[f.name] = f.kind === 'categorical' && f.options?.length ? f.options[0] : ''; });
                    setValues(init);
                }
            })
            .catch(() => { if (!cancelled) setSchema({ ready: false, reason: 'Could not load model info.', task_type: '' }); });
        return () => { cancelled = true; };
    }, [selectedId]);

    // Draw the residual scatter when a regression evaluation is present.
    useEffect(() => {
        const ev = result?.evaluation;
        residualChartRef.current?.destroy();
        residualChartRef.current = null;
        if (!ev || ev.task_type !== 'regression' || !ev.residuals?.length) return;
        const ctx = residualCanvasRef.current?.getContext('2d');
        if (!ctx) return;
        residualChartRef.current = new Chart(ctx, {
            type: 'scatter',
            data: { datasets: [{ label: 'Residual (pred − true)', data: ev.residuals.map((r) => ({ x: r.true, y: r.residual })), backgroundColor: tint(SERIES[0], 0.7), pointRadius: 4, pointHoverRadius: 6 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: axis('True value'), y: axis('Residual') },
            },
        });
        return () => { residualChartRef.current?.destroy(); residualChartRef.current = null; };
    }, [result]);

    const runPrediction = async (body: BodyInit, isJson: boolean) => {
        if (selectedId == null) return;
        setBusy(true); setResult(null); setLiveStats(null);
        try {
            const res = await fetch(`/api/projects/${selectedId}/predict`, {
                method: 'POST', credentials: 'include',
                headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
                body,
            });
            const data = await res.json();
            if (!res.ok || data.error) { showToast(data.error || `Prediction failed (HTTP ${res.status})`, 'error'); setBusy(false); return; }
            if (data.mode === 'remote') return;  // result arrives over the socket (predict_result)
            setResult({ predictions: data.predictions || [], evaluation: data.evaluation || null, device: data.device, resource: data.resource });
            setBusy(false);
        } catch (e) {
            showToast('Prediction failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
            setBusy(false);
        }
    };

    const predictScenario = () => runPrediction(JSON.stringify({ rows: [values], device_id: deviceId, socket_id: socketRef.current?.id }), true);
    const predictCsv = (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        if (deviceId != null) fd.append('device_id', String(deviceId));
        if (socketRef.current?.id) fd.append('socket_id', socketRef.current.id);
        runPrediction(fd, false);
    };
    const exportModel = (fmt: 'onnx' | 'torchscript') => {
        if (selectedId == null) return;
        window.location.href = `/api/projects/${selectedId}/export?format=${fmt}`;
        showToast(`Exporting model as ${fmt.toUpperCase()}…`, 'success');
    };

    if (authLoading || loading) return <div className="page-header"><h1>Loading playground…</h1></div>;

    const single = result && result.predictions.length === 1 && !result.evaluation ? result.predictions[0] : null;

    return (
        <>
            <div className="page-header">
                <h1>Model <em>Playground.</em></h1>
                <p>Use a trained model to make predictions for a scenario, score a batch, or export it.</p>
            </div>

            {projects.length === 0 ? (
                <div className="glass-panel pr-empty">
                    <span className="pr-empty__icon"><Wand size={24} strokeWidth={1.75} aria-hidden="true" /></span>
                    <h3>No trained models yet</h3>
                    <p className="text-muted">Train a model first, then come back to make predictions with it.</p>
                    <button className="btn btn-primary" onClick={() => navigate('/dataset')}>Start a new project →</button>
                </div>
            ) : (
                <>
                    <div className="glass-panel">
                        <div className="panel-title"><span className="pt-icon"><Boxes size={18} strokeWidth={1.75} /></span> Choose a model</div>
                        <select
                            aria-label="Choose a model"
                            value={selectedId ?? ''}
                            onChange={(e) => { setSelectedId(e.target.value ? Number(e.target.value) : null); setSchema(null); setResult(null); setLiveStats(null); }}
                            className="form-select"
                            style={{ maxWidth: 460 }}
                        >
                            <option value="">— select a trained model —</option>
                            {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name} · {ARCH_LABEL[p.arch_type] ?? p.arch_type} · {p.task_type}
                                    {p.final_val_acc != null ? ` · ${p.final_val_acc.toFixed(1)}% acc` : p.final_val_loss != null ? ` · loss ${p.final_val_loss.toFixed(3)}` : ''}
                                </option>
                            ))}
                        </select>

                        {!isBeginner && devices.length > 1 && (
                            <div className="pr-row">
                                <span className="pr-hint">Run inference on:</span>
                                <select value={deviceId ?? ''} onChange={(e) => setDeviceId(e.target.value ? Number(e.target.value) : null)}
                                    className="form-select" style={{ maxWidth: 240 }} title="Where the forward pass runs" aria-label="Run inference on">
                                    <option value="">Shared device</option>
                                    {devices.filter((d) => !d.is_shared).map((d) => <option key={d.id} value={d.id}>{d.nickname}</option>)}
                                </select>
                            </div>
                        )}

                        {selectedId != null && (
                            <div className="pr-row">
                                <button className="btn btn-secondary btn-sm" onClick={() => exportModel('onnx')}>
                                    <Download size={14} aria-hidden="true" /> Export ONNX
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => exportModel('torchscript')}>
                                    <Download size={14} aria-hidden="true" /> Export TorchScript
                                </button>
                            </div>
                        )}
                    </div>

                    {schema && !schema.ready && (
                        <div className="glass-panel">
                            <div className="info-banner info-banner--warning">
                                <span className="info-banner-icon"><TriangleAlert size={16} aria-hidden="true" /></span>
                                <div>{schema.reason || 'This model cannot be used for prediction.'}</div>
                            </div>
                        </div>
                    )}

                    {schema?.ready && (
                        <div className="glass-panel">
                            <div className="panel-title"><span className="pt-icon"><SlidersHorizontal size={18} strokeWidth={1.75} /></span> Enter a scenario</div>
                            <p className="text-muted mb-2">
                                Fill in the features to predict <strong>{schema.target_col}</strong>, or upload a CSV
                                (include a <code>{schema.target_col}</code> column to also score accuracy).
                            </p>
                            <div className="pr-fields">
                                {schema.fields?.map((f) => (
                                    <div key={f.name}>
                                        <label className="form-label" htmlFor={`pf-${f.name}`}>{f.name}</label>
                                        {f.kind === 'categorical' && f.options?.length ? (
                                            <select id={`pf-${f.name}`} className="form-select" value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
                                                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                        ) : (
                                            <input id={`pf-${f.name}`} className="form-input" type={f.kind === 'numeric' ? 'number' : 'text'} step="any" value={values[f.name] ?? ''}
                                                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="pr-row pr-row--actions">
                                <button className="btn btn-primary btn-sm" onClick={predictScenario} disabled={busy}>
                                    {busy ? <Loader2 size={14} className="chat-msg__spinner" aria-hidden="true" /> : <Wand2 size={14} aria-hidden="true" />}
                                    Predict scenario
                                </button>
                                <label className="btn btn-secondary btn-sm">
                                    <Upload size={14} aria-hidden="true" /> Upload CSV (batch / evaluate)
                                    <input type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
                                        onChange={(e) => { if (e.target.files?.[0]) predictCsv(e.target.files[0]); }} />
                                </label>
                            </div>
                            {busy && !isBeginner && liveStats && (
                                <div className="pr-live">
                                    <Cpu size={12} aria-hidden="true" /> running on device…
                                    {liveStats.cpu_percent != null && <span>CPU {Math.round(liveStats.cpu_percent)}%</span>}
                                    {liveStats.gpu_percent != null && <span>GPU {Math.round(liveStats.gpu_percent)}%</span>}
                                    {liveStats.cpu_temp != null && <span>{Math.round(liveStats.cpu_temp)}°C</span>}
                                </div>
                            )}
                        </div>
                    )}

                    {!isBeginner && result && (result.resource || result.device) && (
                        <ResourcePanel device={result.device} resource={result.resource} />
                    )}

                    {single && (
                        <div className="glass-panel">
                            <div className="panel-title"><span className="pt-icon"><Sparkles size={18} strokeWidth={1.75} /></span> Prediction</div>
                            <div className="pr-answer">{String(single.prediction)}</div>
                            {single.confidence != null && <div className="pr-hint">confidence {(single.confidence * 100).toFixed(1)}%</div>}
                            {single.probabilities && (
                                <div className="pr-probs">
                                    {Object.entries(single.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([cls, p]) => (
                                        <div key={cls} className="pr-prob">
                                            <span className="pr-prob__class">{cls}</span>
                                            <div className="pr-prob__track"><div className="pr-prob__bar" style={{ width: `${p * 100}%` }} /></div>
                                            <span className="pr-prob__pct">{(p * 100).toFixed(1)}%</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {result && !single && (
                        <div className="glass-panel">
                            <div className="panel-title"><span className="pt-icon"><ChartColumn size={18} strokeWidth={1.75} /></span> Batch results ({result.predictions.length})</div>
                            {result.evaluation && <EvaluationView ev={result.evaluation} canvasRef={residualCanvasRef} />}
                            <div className="data-table-wrapper" style={{ maxHeight: 280, marginTop: 'var(--space-3)' }}>
                                <table className="data-table">
                                    <thead><tr><th>#</th><th>Prediction</th><th>Confidence</th></tr></thead>
                                    <tbody>
                                        {result.predictions.slice(0, 100).map((r, i) => (
                                            <tr key={i}><td>{i + 1}</td><td>{String(r.prediction)}</td><td>{r.confidence != null ? `${(r.confidence * 100).toFixed(1)}%` : '—'}</td></tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}
        </>
    );
};

const EvaluationView: React.FC<{ ev: Evaluation; canvasRef: React.RefObject<HTMLCanvasElement | null> }> = ({ ev, canvasRef }) => {
    if (ev.task_type === 'classification' && ev.confusion_matrix && ev.classes) {
        const classes = ev.classes;
        return (
            <div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                    <span className="pr-metric">{ev.accuracy != null ? `${(ev.accuracy * 100).toFixed(1)}%` : '—'}</span>
                    <span className="text-muted" style={{ fontSize: '0.82rem' }}>accuracy over {ev.n} labelled rows</span>
                </div>
                <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.3rem' }}>Confusion matrix (rows = actual, columns = predicted)</div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: 'auto' }}>
                        <thead>
                            <tr><th></th>{classes.map((c) => <th key={c}>pred {c}</th>)}</tr>
                        </thead>
                        <tbody>
                            {ev.confusion_matrix.map((row, i) => (
                                <tr key={i}>
                                    <th>actual {classes[i]}</th>
                                    {row.map((v, j) => (
                                        <td key={j} style={{
                                            textAlign: 'center',
                                            background: v === 0 ? undefined : i === j ? 'oklch(0.78 0.15 155 / 0.16)' : 'oklch(0.68 0.18 25 / 0.14)',
                                            fontWeight: i === j ? 700 : 400,
                                        }}>{v}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
    if (ev.task_type === 'regression') {
        return (
            <div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                    <Metric label="MAE" value={ev.mae} />
                    <Metric label="RMSE" value={ev.rmse} />
                    <Metric label="R²" value={ev.r2 ?? undefined} />
                    <Metric label="rows" value={ev.n} int />
                </div>
                <div style={{ height: 240 }}><canvas ref={canvasRef} /></div>
            </div>
        );
    }
    return null;
};

const Metric: React.FC<{ label: string; value?: number; int?: boolean }> = ({ label, value, int }) => (
    <div>
        <div className="pr-stat__value">{value == null ? '—' : int ? value : value.toFixed(4)}</div>
        <div className="pr-stat__label">{label}</div>
    </div>
);

// Resource-consumption readout for a forward pass — where it ran, how long it
// took, throughput, and the hardware snapshot taken during inference.
const ResourcePanel: React.FC<{ device?: string | null; resource?: ResourceInfo | null }> = ({ device, resource }) => {
    const s = resource?.stats || {};
    const chip = (label: string, value: string) => (
        <div className="pr-chip">
            <div className="pr-stat__value">{value}</div>
            <div className="pr-stat__label">{label}</div>
        </div>
    );
    return (
        <div className="glass-panel">
            <div className="panel-title"><span className="pt-icon"><Cpu size={18} strokeWidth={1.75} /></span> Resource consumption</div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {device && chip('Device', device)}
                {resource?.inference_ms != null && chip('Inference', `${resource.inference_ms} ms`)}
                {resource?.rows_per_sec != null && chip('Throughput', `${resource.rows_per_sec} rows/s`)}
                {s.cpu_percent != null && chip('CPU', `${Math.round(s.cpu_percent)}%`)}
                {s.gpu_percent != null && chip('GPU', `${Math.round(s.gpu_percent)}%`)}
                {s.ram_percent != null && chip('RAM', `${Math.round(s.ram_percent)}%`)}
                {s.cpu_temp != null && chip('CPU temp', `${Math.round(s.cpu_temp)}°C`)}
                {s.gpu_temp != null && chip('GPU temp', `${Math.round(s.gpu_temp)}°C`)}
            </div>
        </div>
    );
};

export default Playground;
