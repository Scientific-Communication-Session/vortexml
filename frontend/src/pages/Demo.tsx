import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import {
    ArrowRight, BookOpen, Check, CircleCheck, Cpu, Download, Flower2, GraduationCap, HeartPulse,
    Hourglass, LayoutDashboard, Loader2, Microscope, Play, Quote, RotateCcw, Rows3, Shuffle, Timer,
    Upload, X,
} from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import { useTrainingSession } from '../context/TrainingSessionContext';
import { queueLine } from '../components/session/format';
import { isActive } from '../components/session/types';
import '../components/session/session.css';
import './demo.css';

interface DemoConfig {
    arch_type: string;
    layer_sizes: number[];
    epochs: number;
    lr: number;
    batch_size: number;
    optimizer: string;
    activation: string;
    project_name: string;
}

interface DemoDataset {
    key: string;
    file: string;
    title: string;
    tagline: string;
    description: string;
    source: string;
    synthetic: boolean;
    task_type: 'classification' | 'regression';
    target: string;
    config: DemoConfig;
    available: boolean;
    rows: number;
    features: string[];
    columns: string[];
    preview: Record<string, unknown>[];
    classes: Record<string, number> | null;
}

interface InferenceField {
    name: string;
    kind: 'numeric' | 'categorical';
    options?: string[];
}

interface Inference {
    ready: boolean;
    job_id?: string;
    task_type?: string;
    target_col?: string;
    target_classes?: string[] | null;
    fields?: InferenceField[];
    examples?: Record<string, unknown>[];
}

interface Prediction {
    prediction: string | number;
    confidence?: number;
    probabilities?: Record<string, number>;
}

interface BatchResult {
    predictions: Prediction[];
    rows: Record<string, unknown>[];
    accuracy: number | null;
    mae: number | null;
}

const ICONS: Record<string, React.ElementType> = {
    iris: Flower2,
    breast_cancer: Microscope,
    diabetes: HeartPulse,
    student_performance: GraduationCap,
};

const CLASS_COLORS = ['#8b5cf6', '#06b6d4', '#f97316', '#22c55e', '#ec4899'];

const fmt = (v: unknown) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
    return String(v);
};

const Demo: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const {
        ready, jobs, lastRun, getRun, start, cancel, hydrate, version, setFocus,
        openEnterprise, openAddDevice,
    } = useTrainingSession();

    const [datasets, setDatasets] = useState<DemoDataset[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [selectedKey, setSelectedKey] = useState<string>('iris');
    const [launching, setLaunching] = useState(false);
    // The demo run this page is showing (started here, or adopted on return).
    const [demoJobId, setDemoJobId] = useState<string | null>(null);

    const [inference, setInference] = useState<Inference | null>(null);
    const [values, setValues] = useState<Record<string, string>>({});
    const [exampleIdx, setExampleIdx] = useState<number | null>(null);
    const [prediction, setPrediction] = useState<Prediction | null>(null);
    const [predicting, setPredicting] = useState(false);
    const [batch, setBatch] = useState<BatchResult | null>(null);

    const liveRef = useRef<HTMLDivElement>(null);
    const chartCanvasRef = useRef<HTMLCanvasElement>(null);
    const chartRef = useRef<Chart | null>(null);

    const selected = datasets.find((d) => d.key === selectedKey) ?? null;
    const run = getRun(demoJobId);
    const job = run?.job ?? null;
    const runDataset = datasets.find((d) => d.key === job?.demo_key) ?? null;
    const history = run?.history ?? [];
    const running = job?.status === 'running';
    const queued = job?.status === 'queued';
    const complete = job?.status === 'complete';

    // ── Load the catalogue ──
    useEffect(() => {
        apiGet('/api/demo/datasets')
            .then((d) => setDatasets((d.datasets || []).filter((x: DemoDataset) => x.available)))
            .catch(() => setLoadError(true));
    }, []);

    // ── Coming back to the page: pick up a demo run that is already going, or
    //    the one that just finished, instead of showing an empty stage. ──
    useEffect(() => {
        if (!ready || demoJobId) return;
        const active = jobs.find((j) => j.demo_key);
        const adopt = active ?? (lastRun?.demo_key && lastRun.status === 'complete' ? lastRun : null);
        if (adopt) {
            setDemoJobId(adopt.job_id);
            if (adopt.demo_key) setSelectedKey(adopt.demo_key);
        }
    }, [ready, jobs, lastRun, demoJobId]);

    useEffect(() => {
        if (demoJobId && run && !run.hydrated) void hydrate(demoJobId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [demoJobId, run?.hydrated]);

    // ── The curve ──
    // Small datasets train in well under a second, so the epochs arrive in one
    // burst. They are drawn a few per frame so the curve can be followed; every
    // point is the real measurement, and the true training time is shown as-is.
    const [drawn, setDrawn] = useState(0);
    useEffect(() => { setDrawn(0); }, [demoJobId]);
    useEffect(() => {
        if (drawn > history.length) { setDrawn(0); return; }
        if (drawn === history.length) return;
        const t = window.setTimeout(() => {
            setDrawn((d) => Math.min(history.length, d + Math.max(1, Math.ceil((history.length - d) / 10))));
        }, 45);
        return () => window.clearTimeout(t);
    }, [drawn, history.length, version]);

    useEffect(() => {
        const ctx = chartCanvasRef.current?.getContext('2d');
        if (!ctx) return;
        const mono = "'JetBrains Mono'";
        chartRef.current = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Train loss', data: [], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.10)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
                    { label: 'Validation loss', data: [], borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.05)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
                    { label: 'Validation accuracy', data: [], borderColor: '#22c55e', borderWidth: 2, fill: false, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, yAxisID: 'y1', hidden: true },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: '#9d9dba', boxWidth: 10, boxHeight: 10, font: { size: 12 } } } },
                scales: {
                    x: { title: { display: true, text: 'Epoch', color: '#9d9dba' }, ticks: { color: '#5a5a7a', maxTicksLimit: 10, font: { family: mono, size: 10 } }, grid: { color: 'rgba(100,100,200,0.07)' } },
                    y: { title: { display: true, text: 'Loss', color: '#9d9dba' }, ticks: { color: '#5a5a7a', font: { family: mono, size: 10 } }, grid: { color: 'rgba(100,100,200,0.07)' } },
                    y1: { display: false, position: 'right', min: 0, max: 100, title: { display: true, text: 'Accuracy %', color: '#9d9dba' }, ticks: { color: '#5a5a7a', font: { family: mono, size: 10 } }, grid: { display: false } },
                },
            },
        });
        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const points = history.slice(0, drawn);
        const hasAcc = points.some((p) => p.val_acc != null);
        chart.data.labels = points.map((p) => String(p.epoch));
        chart.data.datasets[0].data = points.map((p) => p.train_loss);
        chart.data.datasets[1].data = points.map((p) => p.val_loss);
        chart.data.datasets[2].data = points.map((p) => p.val_acc);
        chart.data.datasets[2].hidden = !hasAcc;
        const y1 = chart.options.scales?.y1;
        if (y1) y1.display = hasAcc;
        chart.update('none');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drawn, demoJobId]);

    const shownPoint = drawn > 0 ? history[Math.min(drawn, history.length) - 1] : null;
    const replaying = drawn < history.length;
    const trainSeconds = useMemo(
        () => history.reduce((sum, p) => sum + (p.epoch_time || 0), 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [history.length, demoJobId],
    );

    // ── Launch ──
    const launch = async () => {
        if (!selected || launching) return;
        setLaunching(true);
        setInference(null);
        setPrediction(null);
        setBatch(null);
        try {
            const loaded = await apiPost('/api/demo/load', { key: selected.key });
            if (loaded.error) {
                showToast(loaded.error, 'error');
                return;
            }
            // `null` = the shared Mac mini, the same device every free run uses.
            const data = await start(null);
            if (data.error || !data.job_id) {
                showToast(data.error || 'Could not start the demo run.', 'error');
                return;
            }
            setDemoJobId(data.job_id);
            window.setTimeout(() => liveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        } catch (e) {
            showToast('Error: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setLaunching(false);
        }
    };

    // ── Try the model ──
    const loadExample = useCallback((inf: Inference, idx: number) => {
        const row = inf.examples?.[idx];
        if (!row) return;
        const next: Record<string, string> = {};
        for (const f of inf.fields || []) next[f.name] = row[f.name] == null ? '' : String(row[f.name]);
        setValues(next);
        setExampleIdx(idx);
    }, []);

    const runPrediction = useCallback(async (row: Record<string, string>) => {
        setPredicting(true);
        try {
            const res = await apiPost('/api/training/last-run/predict', { rows: [row] });
            if (res.error) {
                showToast(res.error, 'error');
                setPrediction(null);
            } else {
                setPrediction(res.predictions?.[0] ?? null);
            }
        } catch (e) {
            showToast('Prediction failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setPredicting(false);
        }
    }, []);

    // When the run completes, fetch the model's input form + real example rows
    // and make a first prediction straight away.
    useEffect(() => {
        if (!complete || !demoJobId) return;
        let cancelled = false;
        apiGet('/api/training/last-run/inference')
            .then((inf: Inference) => {
                if (cancelled || !inf.ready || inf.job_id !== demoJobId) return;
                setInference(inf);
                setBatch(null);
                if (inf.examples?.length) {
                    loadExample(inf, 0);
                    const first: Record<string, string> = {};
                    for (const f of inf.fields || []) first[f.name] = String(inf.examples[0][f.name] ?? '');
                    void runPrediction(first);
                }
            })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [complete, demoJobId, loadExample, runPrediction]);

    const nextExample = () => {
        if (!inference?.examples?.length) return;
        const idx = ((exampleIdx ?? -1) + 1) % inference.examples.length;
        loadExample(inference, idx);
        const row: Record<string, string> = {};
        for (const f of inference.fields || []) row[f.name] = String(inference.examples[idx][f.name] ?? '');
        void runPrediction(row);
    };

    const editValue = (name: string, v: string) => {
        setValues((prev) => ({ ...prev, [name]: v }));
        setExampleIdx(null); // no longer a real row → no known answer
        setPrediction(null);
    };

    const scoreAll = async () => {
        if (!inference?.examples?.length) return;
        setPredicting(true);
        try {
            const res = await apiPost('/api/training/last-run/predict', { rows: inference.examples });
            if (res.error) {
                showToast(res.error, 'error');
                return;
            }
            setBatch({
                predictions: res.predictions || [],
                rows: inference.examples,
                accuracy: res.evaluation?.accuracy ?? null,
                mae: res.evaluation?.mae ?? null,
            });
        } catch (e) {
            showToast('Prediction failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setPredicting(false);
        }
    };

    const target = inference?.target_col ?? '';
    const actual = exampleIdx != null ? inference?.examples?.[exampleIdx]?.[target] : undefined;
    const isClassification = inference?.task_type === 'classification';
    const correct = prediction && actual !== undefined && isClassification
        ? String(prediction.prediction) === String(actual)
        : null;

    const enroll = () => {
        if (!user) {
            showToast('Sign in to link your own server to your account.', 'info');
            navigate('/signin');
            return;
        }
        openAddDevice();
    };

    const busy = launching || running || queued;
    const totalClasses = selected?.classes ? Object.values(selected.classes).reduce((a, b) => a + b, 0) : 0;

    return (
        <div className="dm-page">
            <header className="dm-hero">
                <div className="vx-eyebrow" style={{ justifyContent: 'center' }}>
                    <span className="vx-dot" /> Live demo
                </div>
                <h1>Train a real model, <em>right now.</em></h1>
                <p>
                    Pick a dataset and press one button. VortexML loads the data, builds a small neural network and
                    trains it on our Mac mini while you watch — then hands you the model to try. Nothing on this
                    page is pre-recorded.
                </p>
                <div className="dm-hero__facts">
                    <span className="vx-chip vx-chip--violet">Real published datasets</span>
                    <span className="vx-chip vx-chip--cyan">Real training, live metrics</span>
                    <span className="vx-chip vx-chip--green">No account needed</span>
                </div>
            </header>

            {/* ── 1 · Dataset ── */}
            <section className="dm-section">
                <div className="dm-section__head">
                    <div>
                        <div className="dm-step">Step 01</div>
                        <h2>Choose a <em>dataset</em></h2>
                    </div>
                    <p className="dm-section__note">
                        Three are classic, published datasets used to teach and benchmark machine learning. The
                        fourth is the practice set from our tutorial.
                    </p>
                </div>

                {loadError && (
                    <div className="vx-banner vx-banner--muted">
                        <X size={18} /> <span>The sample datasets could not be loaded. Check that the server is running and reload.</span>
                    </div>
                )}

                <div className="dm-datasets">
                    {datasets.map((d) => {
                        const Icon = ICONS[d.key] || Rows3;
                        const active = d.key === selectedKey;
                        return (
                            <button
                                key={d.key}
                                type="button"
                                className={`dm-ds ${active ? 'dm-ds--active' : ''}`}
                                onClick={() => setSelectedKey(d.key)}
                                aria-pressed={active}
                            >
                                {active && <span className="dm-ds__check"><Check size={13} strokeWidth={3} /></span>}
                                <span className="dm-ds__icon"><Icon size={19} strokeWidth={1.7} /></span>
                                <span className="dm-ds__title">{d.title}</span>
                                <span className="dm-ds__tagline">{d.tagline}</span>
                                <span className="dm-ds__meta">
                                    <span className={`vx-chip ${d.synthetic ? '' : 'vx-chip--violet'}`}>
                                        {d.synthetic ? 'Practice data' : 'Real data'}
                                    </span>
                                    <span className="vx-chip">{d.task_type}</span>
                                    <span className="vx-chip">{d.rows} × {d.features.length}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {selected && (
                    <div className="glass-panel dm-detail">
                        <div className="dm-detail__about">
                            <p>{selected.description}</p>
                            <div className="dm-source"><Quote size={13} /> <span>{selected.source}</span></div>
                            <div className="dm-subhead">First rows of the actual file</div>
                            <div className="dm-table">
                                <table>
                                    <thead>
                                        <tr>
                                            {selected.columns.map((c) => (
                                                <th key={c} className={c === selected.target ? 'dm-col-target' : ''}>
                                                    {c}{c === selected.target ? ' ◎' : ''}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selected.preview.map((row, i) => (
                                            <tr key={i}>
                                                {selected.columns.map((c) => (
                                                    <td key={c} className={c === selected.target ? 'dm-col-target' : ''}>{fmt(row[c])}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div>
                            {selected.classes && (
                                <>
                                    <div className="dm-subhead">What the model must predict — {selected.target}</div>
                                    <div className="dm-balance">
                                        {Object.entries(selected.classes).map(([name, n], i) => (
                                            <span key={name} style={{ width: `${(n / totalClasses) * 100}%`, background: CLASS_COLORS[i % CLASS_COLORS.length] }} />
                                        ))}
                                    </div>
                                    <div className="dm-legend">
                                        {Object.entries(selected.classes).map(([name, n], i) => (
                                            <span key={name}>
                                                <i style={{ background: CLASS_COLORS[i % CLASS_COLORS.length] }} />
                                                {name} <b>{n}</b>
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                            {!selected.classes && (
                                <>
                                    <div className="dm-subhead">What the model must predict</div>
                                    <p className="dm-section__note" style={{ marginBottom: '1.1rem' }}>
                                        <code>{selected.target}</code> — a number, so this is a regression problem
                                        (measured by loss, not accuracy).
                                    </p>
                                </>
                            )}

                            <div className="dm-subhead">The model we will train</div>
                            <div className="dm-kv">
                                <div className="dm-kv__row"><span>Architecture</span><span>MLP · {selected.features.length} → {selected.config.layer_sizes.join(' → ')} → {selected.classes ? Object.keys(selected.classes).length : 1}</span></div>
                                <div className="dm-kv__row"><span>Epochs</span><span>{selected.config.epochs}</span></div>
                                <div className="dm-kv__row"><span>Learning rate</span><span>{selected.config.lr}</span></div>
                                <div className="dm-kv__row"><span>Batch size · optimizer</span><span>{selected.config.batch_size} · {selected.config.optimizer}</span></div>
                            </div>
                            <a
                                className="vx-ghost-btn"
                                style={{ marginTop: '1rem' }}
                                href={`/api/demo/datasets/${selected.key}/download`}
                            >
                                <Download size={14} /> Download {selected.file}
                            </a>
                        </div>
                    </div>
                )}

                <div className="dm-launch">
                    <div className="dm-launch__text">
                        {selected
                            ? <>Ready: <strong>{selected.title}</strong> — {selected.rows} rows, {selected.features.length} input columns, trained on the <strong>VortexML M4 Mac mini</strong>. The run goes through the same queue and engine as every other project.</>
                            : 'Loading datasets…'}
                    </div>
                    <button type="button" className="dm-cta" onClick={launch} disabled={!selected || busy}>
                        {launching || running
                            ? <Loader2 size={17} className="chat-msg__spinner" />
                            : queued ? <Hourglass size={17} /> : <Play size={16} fill="currentColor" />}
                        {launching ? 'Starting…' : running ? 'Training…' : queued ? 'In the queue…' : complete ? 'Train again' : 'Train it live'}
                    </button>
                </div>
            </section>

            {/* ── 2 · Live training ── */}
            <section className="dm-section" ref={liveRef}>
                <div className="dm-section__head">
                    <div>
                        <div className="dm-step">Step 02</div>
                        <h2>Watch it <em>learn</em></h2>
                    </div>
                    <p className="dm-section__note">
                        Each point is one pass over the training data, measured on the server as it happens. The
                        loss should fall; the accuracy on held-back rows should rise.
                    </p>
                </div>

                <div className="glass-panel dm-live">
                    <div className="dm-live__chart">
                        <canvas ref={chartCanvasRef} />
                        {drawn === 0 && (
                            <div className="dm-live__placeholder">
                                {queued
                                    ? <span>Waiting for the Mac mini…<br />the curve starts the moment it is your turn.</span>
                                    : running
                                        ? <span>Preparing the dataset…</span>
                                        : <span>Press <strong style={{ color: '#c4b5fd' }}>Train it live</strong> above<br />and the curves will draw here.</span>}
                            </div>
                        )}
                    </div>

                    <div>
                        {!job && (
                            <>
                                <div className="dm-status"><span className="vx-dot vx-dot--violet vx-dot--still" /> Standing by</div>
                                <p className="dm-status__sub">No run yet. The numbers below fill in live.</p>
                            </>
                        )}
                        {queued && job && (
                            <>
                                <div className="dm-status"><span className="vx-dot vx-dot--amber" /> In the queue — #{job.position}</div>
                                <p className="dm-status__sub">
                                    {queueLine(job)}. The Mac mini is the free, shared tier and trains one model at a
                                    time. You can leave this page — your place is kept.{' '}
                                    <button className="vx-link" onClick={enroll}>Enroll your own server</button> or{' '}
                                    <button className="vx-link" onClick={openEnterprise}>talk to sales</button> to skip the line.
                                </p>
                                <button className="vx-ghost-btn" onClick={() => cancel(job.job_id)} style={{ marginBottom: '1rem' }}>
                                    <X size={14} /> Leave the queue
                                </button>
                            </>
                        )}
                        {running && (
                            <>
                                <div className="dm-status"><span className="vx-dot" /> Training on the Mac mini</div>
                                <p className="dm-status__sub">{runDataset?.title || job?.project_name} — streaming epoch by epoch.</p>
                            </>
                        )}
                        {complete && (
                            <>
                                <div className="dm-status">
                                    <CircleCheck size={17} style={{ color: '#4ade80' }} />
                                    {replaying ? 'Trained — drawing the curve…' : 'Training complete'}
                                </div>
                                <p className="dm-status__sub">
                                    {runDataset?.title || job?.project_name}: a real model, trained a moment ago and saved on the server.
                                </p>
                            </>
                        )}
                        {job && (job.status === 'error' || job.status === 'stopped') && (
                            <>
                                <div className="dm-status"><span className="vx-dot vx-dot--red vx-dot--still" /> {job.status === 'error' ? 'The run failed' : 'Run stopped'}</div>
                                <p className="dm-status__sub">{run?.message || 'Press “Train it live” to try again.'}</p>
                            </>
                        )}

                        <div className="dm-tiles">
                            <div className="dm-tile">
                                <div className="dm-tile__value">{shownPoint ? `${shownPoint.epoch}/${shownPoint.total_epochs}` : '—'}</div>
                                <div className="dm-tile__label">Epoch</div>
                            </div>
                            <div className="dm-tile">
                                <div className="dm-tile__value" style={{ color: '#a78bfa' }}>{shownPoint ? shownPoint.train_loss.toFixed(shownPoint.train_loss >= 100 ? 0 : 4) : '—'}</div>
                                <div className="dm-tile__label">Train loss</div>
                            </div>
                            <div className="dm-tile">
                                <div className="dm-tile__value" style={{ color: shownPoint?.val_acc != null ? '#4ade80' : '#22d3ee' }}>
                                    {!shownPoint ? '—' : shownPoint.val_acc != null
                                        ? `${shownPoint.val_acc.toFixed(1)}%`
                                        : shownPoint.val_loss.toFixed(shownPoint.val_loss >= 100 ? 0 : 4)}
                                </div>
                                <div className="dm-tile__label">{shownPoint && shownPoint.val_acc == null ? 'Validation loss' : 'Validation accuracy'}</div>
                            </div>
                            <div className="dm-tile">
                                <div className="dm-tile__value">{complete && !replaying ? `${trainSeconds.toFixed(2)}s` : '—'}</div>
                                <div className="dm-tile__label">Compute time</div>
                            </div>
                        </div>

                        {run?.info && (
                            <div className="dm-facts">
                                <div><Rows3 size={14} /> <span><b>{run.info.train_size}</b> rows to learn from, <b>{run.info.val_size}</b> held back to validate, <b>{run.info.test_size}</b> for testing</span></div>
                                <div><Cpu size={14} /> <span>Ran on <b>{job?.device_name}</b> ({run.info.device})</span></div>
                                {complete && !replaying && (
                                    <div><Timer size={14} /> <span><b>{history.length}</b> epochs in <b>{trainSeconds.toFixed(2)}s</b> of compute — small datasets train fast</span></div>
                                )}
                            </div>
                        )}
                        {job && isActive(job.status) && (
                            <button className="vx-ghost-btn" style={{ marginTop: '1rem' }} onClick={() => { setFocus(job.job_id); navigate('/training'); }}>
                                <LayoutDashboard size={14} /> Open the full dashboard
                            </button>
                        )}
                    </div>
                </div>
            </section>

            {/* ── 3 · Try it ── */}
            <section className="dm-section">
                <div className="dm-section__head">
                    <div>
                        <div className="dm-step">Step 03</div>
                        <h2>Put the model <em>to work</em></h2>
                    </div>
                    <p className="dm-section__note">
                        The inputs are filled with a real row from the dataset, so you can compare the model's
                        answer with what actually happened. Change any value to ask your own question. (The rows
                        are drawn from the whole file, so the model saw some of them while training.)
                    </p>
                </div>

                {!inference && (
                    <div className="vx-banner vx-banner--muted" style={{ marginBottom: 0 }}>
                        <Hourglass size={18} />
                        <span>
                            {complete
                                ? 'Loading your model…'
                                : 'This unlocks as soon as a training run finishes — the form is built from the model you just trained.'}
                        </span>
                    </div>
                )}

                {inference && (
                    <div className="glass-panel dm-try">
                        <div>
                            <div className="dm-subhead">
                                Inputs {exampleIdx != null ? `— real row ${exampleIdx + 1} of ${inference.examples?.length}` : '— your own values'}
                            </div>
                            <div className="dm-fields">
                                {(inference.fields || []).map((f) => (
                                    <div className="dm-field" key={f.name}>
                                        <label htmlFor={`dm-f-${f.name}`} title={f.name}>{f.name}</label>
                                        {f.kind === 'categorical' ? (
                                            <select id={`dm-f-${f.name}`} value={values[f.name] ?? ''} onChange={(e) => editValue(f.name, e.target.value)}>
                                                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                        ) : (
                                            <input
                                                id={`dm-f-${f.name}`}
                                                type="number"
                                                step="any"
                                                value={values[f.name] ?? ''}
                                                onChange={(e) => editValue(f.name, e.target.value)}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="dm-try__actions">
                                <button className="btn btn-primary btn-sm" onClick={() => runPrediction(values)} disabled={predicting}>
                                    {predicting ? <Loader2 size={14} className="chat-msg__spinner" /> : <Play size={13} fill="currentColor" />} Predict
                                </button>
                                {!!inference.examples?.length && (
                                    <>
                                        <button className="btn btn-secondary btn-sm" onClick={nextExample} disabled={predicting}>
                                            <Shuffle size={14} /> Another real example
                                        </button>
                                        <button className="btn btn-secondary btn-sm" onClick={scoreAll} disabled={predicting}>
                                            <Rows3 size={14} /> Test on all {inference.examples.length}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="dm-result">
                            <div className="dm-result__label">The model says — {target}</div>
                            {prediction ? (
                                <>
                                    <div className="dm-result__value">
                                        {fmt(prediction.prediction)}
                                        {prediction.confidence != null && <small>{(prediction.confidence * 100).toFixed(1)}% confident</small>}
                                    </div>
                                    {actual !== undefined && (
                                        correct === null ? (
                                            <span className="dm-verdict dm-verdict--info">Actual value: {fmt(actual)}</span>
                                        ) : correct ? (
                                            <span className="dm-verdict dm-verdict--ok"><Check size={14} strokeWidth={3} /> Correct — the real answer is {fmt(actual)}</span>
                                        ) : (
                                            <span className="dm-verdict dm-verdict--miss"><X size={14} strokeWidth={3} /> Wrong — the real answer is {fmt(actual)}</span>
                                        )
                                    )}
                                    {prediction.probabilities && (
                                        <div className="dm-probs">
                                            {Object.entries(prediction.probabilities).map(([name, p]) => (
                                                <div key={name} className={`dm-prob ${name === String(prediction.prediction) ? 'dm-prob--top' : ''}`}>
                                                    <span title={name}>{name}</span>
                                                    <span className="dm-prob__bar"><i style={{ width: `${p * 100}%` }} /></span>
                                                    <b>{(p * 100).toFixed(1)}%</b>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="dm-status__sub" style={{ margin: 0 }}>
                                    {predicting ? 'Running the model…' : 'Press Predict to run the model on these values.'}
                                </div>
                            )}
                        </div>

                        {batch && (
                            <div className="dm-batch" style={{ gridColumn: '1 / -1' }}>
                                <div className="dm-subhead">
                                    {batch.rows.length} real rows —{' '}
                                    {batch.accuracy != null
                                        ? `${Math.round(batch.accuracy * batch.rows.length)} of ${batch.rows.length} correct (${(batch.accuracy * 100).toFixed(0)}%)`
                                        : batch.mae != null ? `off by ${batch.mae.toFixed(1)} on average` : 'predictions'}
                                </div>
                                <div className="dm-table">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Actual {target}</th>
                                                <th>Predicted</th>
                                                <th>{isClassification ? 'Confidence' : 'Error'}</th>
                                                {(inference.fields || []).slice(0, 5).map((f) => <th key={f.name}>{f.name}</th>)}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {batch.rows.map((row, i) => {
                                                const p = batch.predictions[i];
                                                const truth = row[target];
                                                const ok = isClassification ? String(p?.prediction) === String(truth) : null;
                                                return (
                                                    <tr key={i}>
                                                        <td>{i + 1}</td>
                                                        <td>{fmt(truth)}</td>
                                                        <td className={ok === null ? '' : ok ? 'dm-ok' : 'dm-miss'}>
                                                            {ok === true ? '✓ ' : ok === false ? '✗ ' : ''}{fmt(p?.prediction)}
                                                        </td>
                                                        <td>
                                                            {isClassification
                                                                ? (p?.confidence != null ? `${(p.confidence * 100).toFixed(1)}%` : '—')
                                                                : fmt(Number(p?.prediction) - Number(truth))}
                                                        </td>
                                                        {(inference.fields || []).slice(0, 5).map((f) => <td key={f.name}>{fmt(row[f.name])}</td>)}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ── 4 · Next ── */}
            <section className="dm-section">
                <div className="dm-section__head">
                    <div>
                        <div className="dm-step">Step 04</div>
                        <h2>Now make it <em>yours</em></h2>
                    </div>
                    {complete && (
                        <button className="vx-ghost-btn" onClick={launch} disabled={busy}>
                            <RotateCcw size={14} /> Run the demo again
                        </button>
                    )}
                </div>
                <div className="dm-next">
                    <Link to="/tutorial">
                        <span className="dm-next__title"><BookOpen size={17} /> Follow the tutorial <ArrowRight size={15} /></span>
                        <p>Build the same thing by hand in five minutes — upload, pick columns, design the network, train, predict. With recordings of every step.</p>
                    </Link>
                    <Link to="/dataset">
                        <span className="dm-next__title"><Upload size={17} /> Bring your own data <ArrowRight size={15} /></span>
                        <p>Upload a CSV, Excel, JSON or Parquet file and train on your own problem. Your runs keep going in the background if you close the tab.</p>
                    </Link>
                    <Link to={user ? '/profile' : '/signup'}>
                        <span className="dm-next__title">
                            <GraduationCap size={17} /> {user ? 'Find it in your profile' : 'Keep your models'} <ArrowRight size={15} />
                        </span>
                        <p>
                            {user
                                ? 'Every run you finish while signed in — this demo included — is saved to your account, ready to reuse, compare and export.'
                                : 'Create a free account and every model you train is saved to it, ready to reuse, compare, export and follow from any browser.'}
                        </p>
                    </Link>
                </div>
            </section>
        </div>
    );
};

export default Demo;
