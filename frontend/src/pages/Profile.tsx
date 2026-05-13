import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Trash2, FolderOpen, Layers, Activity, BarChart3 } from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

interface Project {
    id: number;
    name: string;
    arch_type: string;
    layer_sizes: number[];
    epochs: number;
    lr: number;
    batch_size: number;
    optimizer: string;
    activation: string;
    task_type: string;
    input_dim: number | null;
    output_dim: number | null;
    final_train_loss: number | null;
    final_val_loss: number | null;
    final_val_acc: number | null;
    early_stopped: boolean;
    stopped_epoch: number | null;
    weight_filename: string;
    created_at: string;
}

const ARCH_ICON: Record<string, string> = {
    mlp: '🔵', dnn: '🟣', cnn1d: '🟢', rnn: '🔴', lstm: '🟡',
    gru: '🟠', autoencoder: '🔷', resnet: '⬛', transformer: '💎', wide_deep: '🌐',
};

const ARCH_LABEL: Record<string, string> = {
    mlp: 'MLP', dnn: 'DNN', cnn1d: 'CNN-1D', rnn: 'RNN', lstm: 'LSTM',
    gru: 'GRU', autoencoder: 'Autoencoder', resnet: 'ResNet',
    transformer: 'Transformer', wide_deep: 'Wide & Deep',
};

const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
};

const Profile: React.FC = () => {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            navigate('/signin');
            return;
        }
        apiGet('/api/projects')
            .then((data) => setProjects(data.projects ?? []))
            .catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                showToast('Failed to load projects: ' + msg, 'error');
            })
            .finally(() => setLoading(false));
    }, [user, authLoading, navigate]);

    const handleDownload = (p: Project) => {
        window.location.href = `/api/weights/file/${encodeURIComponent(p.weight_filename)}`;
        showToast(`Downloading ${p.weight_filename}`, 'success');
    };

    const handleLoad = async (p: Project) => {
        setBusyId(p.id);
        try {
            const res = await apiPost(`/api/projects/${p.id}/load`, {});
            if (res.error) {
                showToast(res.error, 'error');
                return;
            }
            showToast(`Loaded "${p.name}" — redirecting to Architect`, 'success');
            setTimeout(() => navigate('/architect'), 600);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Load failed: ' + msg, 'error');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (p: Project) => {
        if (!confirm(`Delete project "${p.name}"? This also removes the weight file.`)) return;
        setBusyId(p.id);
        try {
            const res = await fetch(`/api/projects/${p.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || `Delete failed (HTTP ${res.status})`, 'error');
                return;
            }
            setProjects((prev) => prev.filter((x) => x.id !== p.id));
            showToast(`Deleted "${p.name}"`, 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Delete failed: ' + msg, 'error');
        } finally {
            setBusyId(null);
        }
    };

    const stats = {
        total: projects.length,
        bestAcc: projects
            .map((p) => p.final_val_acc)
            .filter((v): v is number => typeof v === 'number')
            .reduce((m, v) => (v > m ? v : m), 0),
        archCount: new Set(projects.map((p) => p.arch_type)).size,
    };

    if (authLoading || loading) {
        return (
            <div className="page-header">
                <h1>Loading profile…</h1>
            </div>
        );
    }

    return (
        <>
            <div className="page-header">
                <h1>Your <em>Profile.</em></h1>
                <p>Signed in as <strong>{user?.username}</strong> · {projects.length} saved {projects.length === 1 ? 'project' : 'projects'}</p>
            </div>

            {/* Summary cards */}
            <div className="training-top-bar">
                <div className="stat-card">
                    <div className="stat-value gradient">{stats.total}</div>
                    <div className="stat-label">Projects</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-2)' }}>
                        {stats.bestAcc > 0 ? `${stats.bestAcc.toFixed(1)}%` : '—'}
                    </div>
                    <div className="stat-label">Best Val Accuracy</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value" style={{ color: 'var(--accent-4)' }}>{stats.archCount}</div>
                    <div className="stat-label">Architectures Tried</div>
                </div>
            </div>

            {projects.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📁</div>
                    <h3 style={{ marginBottom: '0.5rem' }}>No projects yet</h3>
                    <p className="text-muted" style={{ marginBottom: '1.5rem' }}>
                        Train a model from the Architect page — completed runs are saved here automatically.
                    </p>
                    <button className="btn btn-primary" onClick={() => navigate('/dataset')}>
                        Start a new project →
                    </button>
                </div>
            ) : (
                <div className="glass-panel">
                    <div className="panel-title">
                        <span className="pt-icon">📦</span> Saved Projects
                    </div>

                    <div className="project-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {projects.map((p) => {
                            const icon = ARCH_ICON[p.arch_type] ?? '🧠';
                            const archLabel = ARCH_LABEL[p.arch_type] ?? p.arch_type;
                            const accuracy = p.final_val_acc !== null
                                ? `${p.final_val_acc.toFixed(1)}%`
                                : null;
                            const isBusy = busyId === p.id;

                            return (
                                <div
                                    key={p.id}
                                    className="glass-panel"
                                    style={{
                                        padding: '1.25rem 1.5rem',
                                        display: 'grid',
                                        gridTemplateColumns: 'auto 1fr auto',
                                        gap: '1.25rem',
                                        alignItems: 'center',
                                    }}
                                >
                                    <div style={{ fontSize: '2.25rem', lineHeight: 1 }}>{icon}</div>

                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <strong style={{ fontSize: '1.05rem' }}>{p.name}</strong>
                                            <span className="bento-tag bento-tag-sm">{archLabel}</span>
                                            {p.early_stopped && <span className="bento-tag bento-tag-sm">🛑 ES @ {p.stopped_epoch}</span>}
                                        </div>
                                        <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.35rem', fontFamily: 'var(--font-mono)' }}>
                                            <Layers size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                                            {p.layer_sizes.join('→')} neurons
                                            {' · '}
                                            {p.epochs}e · lr {p.lr} · bs {p.batch_size} · {p.optimizer} · {p.activation}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', marginTop: '0.45rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            {accuracy && (
                                                <span><Activity size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle', color: '#22c55e' }} />
                                                    val_acc <strong style={{ color: '#22c55e' }}>{accuracy}</strong></span>
                                            )}
                                            {p.final_val_loss !== null && (
                                                <span><BarChart3 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                                                    val_loss <strong>{p.final_val_loss.toFixed(4)}</strong></span>
                                            )}
                                            <span className="text-muted">· {formatDate(p.created_at)}</span>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleLoad(p)}
                                            disabled={isBusy}
                                            title="Restore this config in the Architect"
                                        >
                                            <FolderOpen size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            Load
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleDownload(p)}
                                            disabled={isBusy}
                                            title="Download .pt weights"
                                        >
                                            <Download size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            Weights
                                        </button>
                                        <button
                                            className="btn btn-danger btn-sm"
                                            onClick={() => handleDelete(p)}
                                            disabled={isBusy}
                                            title="Delete project + weights"
                                        >
                                            <Trash2 size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );
};

export default Profile;
