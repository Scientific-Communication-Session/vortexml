import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Chart from 'chart.js/auto';
import { Trophy, BarChart3 } from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

interface HistoryPoint { epoch: number; train_loss: number | null; val_loss: number | null; val_acc: number | null; }

interface Project {
    id: number;
    name: string;
    arch_type: string;
    task_type: string;
    epochs: number;
    final_val_loss: number | null;
    final_val_acc: number | null;
    created_at: string;
    history?: HistoryPoint[];
}

const ARCH_LABEL: Record<string, string> = {
    mlp: 'MLP', dnn: 'DNN', cnn1d: 'CNN-1D', rnn: 'RNN', lstm: 'LSTM',
    gru: 'GRU', autoencoder: 'Autoencoder', resnet: 'ResNet',
    transformer: 'Transformer', wide_deep: 'Wide & Deep',
};

const PALETTE = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a855f7'];
const MAX_COMPARE = 6;

const Leaderboard: React.FC = () => {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [sortBy, setSortBy] = useState<'acc' | 'loss'>('acc');
    const [selected, setSelected] = useState<number[]>([]);

    const lossCanvasRef = useRef<HTMLCanvasElement>(null);
    const accCanvasRef = useRef<HTMLCanvasElement>(null);
    const lossChartRef = useRef<Chart | null>(null);
    const accChartRef = useRef<Chart | null>(null);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { navigate('/signin'); return; }
        apiGet('/api/projects')
            .then((data) => {
                const list: Project[] = data.projects ?? [];
                setProjects(list);
                // Preselect the top few so the charts aren't empty on arrival.
                setSelected(list.slice(0, Math.min(3, list.length)).map((p) => p.id));
            })
            .catch((e) => showToast('Failed to load projects: ' + (e instanceof Error ? e.message : String(e)), 'error'))
            .finally(() => setLoading(false));
    }, [user, authLoading, navigate]);

    // Build the two empty charts once.
    useEffect(() => {
        const mk = (canvas: HTMLCanvasElement | null, yTitle: string, yMax?: number) => {
            const ctx = canvas?.getContext('2d');
            if (!ctx) return null;
            return new Chart(ctx, {
                type: 'line',
                data: { datasets: [] },
                options: {
                    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
                    interaction: { mode: 'nearest', intersect: false },
                    plugins: { legend: { labels: { color: '#9d9dba', font: { size: 11 } } } },
                    scales: {
                        x: { type: 'linear', title: { display: true, text: 'Epoch', color: '#9d9dba' }, ticks: { color: '#5a5a7a' }, grid: { color: 'rgba(100,100,200,0.07)' } },
                        y: { title: { display: true, text: yTitle, color: '#9d9dba' }, ticks: { color: '#5a5a7a' }, grid: { color: 'rgba(100,100,200,0.07)' }, min: 0, ...(yMax ? { max: yMax } : {}) },
                    },
                },
            });
        };
        lossChartRef.current = mk(lossCanvasRef.current, 'Validation Loss');
        accChartRef.current = mk(accCanvasRef.current, 'Validation Accuracy %', 100);
        return () => {
            lossChartRef.current?.destroy();
            accChartRef.current?.destroy();
        };
    }, []);

    // Fetch histories for the selected projects and redraw the overlays.
    useEffect(() => {
        if (selected.length === 0) {
            if (lossChartRef.current) { lossChartRef.current.data.datasets = []; lossChartRef.current.update(); }
            if (accChartRef.current) { accChartRef.current.data.datasets = []; accChartRef.current.update(); }
            return;
        }
        let cancelled = false;
        apiPost('/api/projects/compare', { ids: selected })
            .then((data) => {
                if (cancelled) return;
                const list: Project[] = data.projects ?? [];
                const byId = new Map(list.map((p) => [p.id, p]));
                const ordered = selected.map((id) => byId.get(id)).filter(Boolean) as Project[];

                const lossSets = ordered.map((p, i) => ({
                    label: p.name,
                    data: (p.history ?? []).filter((h) => h.val_loss != null).map((h) => ({ x: h.epoch, y: h.val_loss as number })),
                    borderColor: PALETTE[i % PALETTE.length],
                    backgroundColor: 'transparent',
                    borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
                }));
                const accSets = ordered
                    .filter((p) => (p.history ?? []).some((h) => h.val_acc != null))
                    .map((p) => ({
                        label: p.name,
                        data: (p.history ?? []).filter((h) => h.val_acc != null).map((h) => ({ x: h.epoch, y: h.val_acc as number })),
                        borderColor: PALETTE[ordered.indexOf(p) % PALETTE.length],
                        backgroundColor: 'transparent',
                        borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
                    }));

                if (lossChartRef.current) { lossChartRef.current.data.datasets = lossSets; lossChartRef.current.update(); }
                if (accChartRef.current) { accChartRef.current.data.datasets = accSets; accChartRef.current.update(); }
            })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [selected]);

    const toggle = (id: number) => {
        setSelected((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (prev.length >= MAX_COMPARE) {
                showToast(`Compare up to ${MAX_COMPARE} at once.`, 'warning');
                return prev;
            }
            return [...prev, id];
        });
    };

    const ranked = [...projects].sort((a, b) => {
        if (sortBy === 'acc') {
            const av = a.final_val_acc ?? -Infinity, bv = b.final_val_acc ?? -Infinity;
            return bv - av;
        }
        const av = a.final_val_loss ?? Infinity, bv = b.final_val_loss ?? Infinity;
        return av - bv;
    });

    if (authLoading || loading) {
        return <div className="page-header"><h1>Loading leaderboard…</h1></div>;
    }

    return (
        <>
            <div className="page-header">
                <h1>Model <em>Leaderboard.</em></h1>
                <p>Rank your trained models and overlay their learning curves.</p>
            </div>

            {projects.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🏁</div>
                    <h3 style={{ marginBottom: '0.5rem' }}>No models yet</h3>
                    <p className="text-muted" style={{ marginBottom: '1.5rem' }}>Train a model to see it ranked here.</p>
                    <button className="btn btn-primary" onClick={() => navigate('/dataset')}>Start a new project →</button>
                </div>
            ) : (
                <>
                    <div className="glass-panel">
                        <div className="flex-between mb-1">
                            <div className="panel-title mb-0"><span className="pt-icon">🏆</span> Ranking</div>
                            <div className="flex gap-05" style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className={`btn btn-sm ${sortBy === 'acc' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSortBy('acc')}>By accuracy</button>
                                <button className={`btn btn-sm ${sortBy === 'loss' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSortBy('loss')}>By val loss</button>
                            </div>
                        </div>
                        <p className="text-muted mb-2" style={{ fontSize: '0.85rem' }}>
                            Tick up to {MAX_COMPARE} models to overlay their curves below.
                        </p>
                        <div className="data-table-wrapper">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Compare</th><th>#</th><th>Project</th><th>Architecture</th>
                                        <th>Task</th><th>Val Accuracy</th><th>Val Loss</th><th>Epochs</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ranked.map((p, i) => (
                                        <tr key={p.id} style={selected.includes(p.id) ? { background: 'rgba(139,92,246,0.08)' } : undefined}>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    checked={selected.includes(p.id)}
                                                    onChange={() => toggle(p.id)}
                                                    aria-label={`Compare ${p.name}`}
                                                />
                                            </td>
                                            <td>{i === 0 ? <Trophy size={14} style={{ color: '#f59e0b', verticalAlign: 'middle' }} /> : i + 1}</td>
                                            <td>{p.name}</td>
                                            <td>{ARCH_LABEL[p.arch_type] ?? p.arch_type}</td>
                                            <td>{p.task_type}</td>
                                            <td>{p.final_val_acc != null ? `${p.final_val_acc.toFixed(1)}%` : '—'}</td>
                                            <td>{p.final_val_loss != null ? p.final_val_loss.toFixed(4) : '—'}</td>
                                            <td>{p.epochs}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="training-grid">
                        <div className="glass-panel">
                            <div className="panel-title"><span className="pt-icon">📉</span> Validation Loss</div>
                            <div className="chart-container"><canvas ref={lossCanvasRef} /></div>
                        </div>
                        <div className="glass-panel">
                            <div className="panel-title"><BarChart3 size={15} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Validation Accuracy</div>
                            <div className="chart-container"><canvas ref={accCanvasRef} /></div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

export default Leaderboard;
