import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Trash2, FolderOpen, Layers, Activity, BarChart3, Sparkles, Laptop, Cpu, Pencil, Check, X, Plus } from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import AddDeviceModal from '../components/devices/AddDeviceModal';
import type { Device } from '../components/devices/types';

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
    const { user, isLoading: authLoading, checkAuth } = useAuth();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [togglingBeginner, setTogglingBeginner] = useState(false);

    // Devices
    const [devices, setDevices] = useState<Device[]>([]);
    const [editingDeviceId, setEditingDeviceId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [deviceBusyId, setDeviceBusyId] = useState<number | null>(null);
    const [showAddDevice, setShowAddDevice] = useState(false);

    const isBeginner = user?.is_beginner === true;

    const loadDevices = () => {
        apiGet('/api/devices')
            .then((data) => {
                const list: Device[] = data.devices || [];
                setDevices(list.filter((d) => !d.is_shared));
            })
            .catch(() => { });
    };

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            navigate('/signin');
            return;
        }
        loadDevices();
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

    const handleToggleBeginner = async () => {
        const next = !isBeginner;
        const verb = next ? 'enable' : 'disable';
        if (!confirm(`${next ? 'Enable' : 'Disable'} Novice mode? This will ${verb} simplified architectures, beginner defaults, and inline help hints.`)) return;
        setTogglingBeginner(true);
        try {
            const res = await fetch('/api/auth/beginner', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_beginner: next }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || `Failed (HTTP ${res.status})`, 'error');
                return;
            }
            await checkAuth();
            showToast(next ? 'Novice mode enabled' : 'Expert mode enabled', 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed: ' + msg, 'error');
        } finally {
            setTogglingBeginner(false);
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

    const handleRenameDevice = async (id: number) => {
        const name = editName.trim();
        if (!name) { setEditingDeviceId(null); return; }
        setDeviceBusyId(id);
        try {
            const res = await fetch(`/api/devices/${id}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname: name }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || `Rename failed (HTTP ${res.status})`, 'error');
                return;
            }
            setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, nickname: name } : d)));
            setEditingDeviceId(null);
            showToast('Device renamed', 'success');
        } catch (e) {
            showToast('Rename failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setDeviceBusyId(null);
        }
    };

    const handleDeleteDevice = async (d: Device) => {
        if (!confirm(`Unlink "${d.nickname}"? Its node agent will stop pairing with your account.`)) return;
        setDeviceBusyId(d.id);
        try {
            const res = await fetch(`/api/devices/${d.id}`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || `Delete failed (HTTP ${res.status})`, 'error');
                return;
            }
            setDevices((prev) => prev.filter((x) => x.id !== d.id));
            showToast(`Unlinked "${d.nickname}"`, 'success');
        } catch (e) {
            showToast('Delete failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setDeviceBusyId(null);
        }
    };

    const handleDownloadAgent = (d: Device) => {
        window.location.href = `/api/devices/${d.id}/agent.zip`;
        showToast(`Downloading agent for "${d.nickname}"`, 'success');
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

            {/* Experience level card */}
            <div
                className="glass-panel"
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: '1.25rem',
                    alignItems: 'center',
                    padding: '1.25rem 1.5rem',
                }}
            >
                <div style={{ fontSize: '2rem', lineHeight: 1 }}>
                    {isBeginner ? '🌿' : '🔥'}
                </div>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '1.05rem' }}>
                            {isBeginner ? 'Novice mode' : 'Expert mode'}
                        </strong>
                        <span className="bento-tag bento-tag-sm">
                            {isBeginner ? '🌿 Novice' : '🔥 Expert'}
                        </span>
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.88rem', marginTop: '0.25rem' }}>
                        {isBeginner ? (
                            <>
                                Architectures are filtered to the most approachable picks, hyperparameters use safer defaults,
                                and inline <strong>?</strong> hints appear next to settings.
                            </>
                        ) : (
                            <>
                                All architectures and advanced settings are unlocked. Inline hints are minimal.
                            </>
                        )}
                    </div>
                </div>
                <div>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleToggleBeginner}
                        disabled={togglingBeginner || user?.is_beginner === null || user?.is_beginner === undefined}
                        title={isBeginner ? 'Remove Novice status and unlock everything' : 'Re-enable Novice mode with simplified UI'}
                    >
                        <Sparkles size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                        {togglingBeginner ? 'Saving…' : isBeginner ? 'Switch to Expert' : 'Switch to Novice'}
                    </button>
                </div>
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

            {/* Your Devices */}
            <div className="glass-panel">
                <div className="flex-between mb-1">
                    <div className="panel-title mb-0"><span className="pt-icon">🖥️</span> Your Devices</div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowAddDevice(true)}>
                        <Plus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Link a device
                    </button>
                </div>

                {devices.length === 0 ? (
                    <p className="text-muted" style={{ fontSize: '0.88rem', padding: '0.4rem 0' }}>
                        No devices linked yet. Link one of your own machines — a home Mac, a server —
                        to train on it from anywhere, even from a laptop with no ML hardware.
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {devices.map((d) => {
                            const specs = d.specs || {};
                            const busy = deviceBusyId === d.id;
                            const editing = editingDeviceId === d.id;
                            const specLine = [
                                specs.chip,
                                specs.ram_gb != null ? `${specs.ram_gb} GB` : null,
                                specs.cpu_cores != null ? `${specs.cpu_cores} CPU` : null,
                                specs.gpu_cores != null ? `${specs.gpu_cores} GPU` : null,
                                specs.accelerator_label,
                            ].filter(Boolean).join(' · ');

                            return (
                                <div
                                    key={d.id}
                                    className="glass-panel"
                                    style={{
                                        padding: '1rem 1.2rem',
                                        display: 'grid',
                                        gridTemplateColumns: 'auto 1fr auto',
                                        gap: '1rem',
                                        alignItems: 'center',
                                    }}
                                >
                                    <div style={{
                                        position: 'relative', width: 40, height: 40, borderRadius: 10,
                                        display: 'grid', placeItems: 'center',
                                        background: 'rgba(139,92,246,0.14)', color: '#8b5cf6',
                                    }}>
                                        <Laptop size={20} />
                                        <span
                                            title={d.online ? 'Online' : 'Offline'}
                                            style={{
                                                position: 'absolute', right: -3, bottom: -3,
                                                width: 12, height: 12, borderRadius: '50%',
                                                border: '2px solid #0e0e1a',
                                                background: d.online ? '#22c55e' : '#5a5a7a',
                                            }}
                                        />
                                    </div>

                                    <div style={{ minWidth: 0 }}>
                                        {editing ? (
                                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                                <input
                                                    value={editName}
                                                    autoFocus
                                                    maxLength={80}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRenameDevice(d.id);
                                                        if (e.key === 'Escape') setEditingDeviceId(null);
                                                    }}
                                                    style={{
                                                        padding: '0.3rem 0.5rem', borderRadius: 8,
                                                        background: 'rgba(255,255,255,0.06)', color: 'inherit',
                                                        border: '1px solid rgba(255,255,255,0.15)', fontSize: '0.95rem',
                                                    }}
                                                />
                                                <button className="btn btn-secondary btn-sm" disabled={busy}
                                                    onClick={() => handleRenameDevice(d.id)} style={{ padding: '0.3rem' }}>
                                                    <Check size={14} />
                                                </button>
                                                <button className="btn btn-secondary btn-sm"
                                                    onClick={() => setEditingDeviceId(null)} style={{ padding: '0.3rem' }}>
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <strong style={{ fontSize: '1.02rem' }}>{d.nickname}</strong>
                                                <button className="btn btn-secondary btn-sm" title="Rename device"
                                                    onClick={() => { setEditingDeviceId(d.id); setEditName(d.nickname); }}
                                                    style={{ padding: '0.2rem 0.35rem' }}>
                                                    <Pencil size={12} />
                                                </button>
                                                <span className="bento-tag bento-tag-sm">
                                                    {d.online ? '🟢 Online' : '⚪ Offline'}
                                                </span>
                                            </div>
                                        )}
                                        <div className="text-muted" style={{
                                            fontSize: '0.8rem', marginTop: '0.35rem', fontFamily: 'var(--font-mono)',
                                        }}>
                                            <Cpu size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                                            {d.specs ? specLine : 'Specs appear once the node agent first connects.'}
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <button className="btn btn-secondary btn-sm" disabled={busy}
                                            onClick={() => handleDownloadAgent(d)} title="Re-download the node agent bundle">
                                            <Download size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            Agent
                                        </button>
                                        <button className="btn btn-danger btn-sm" disabled={busy}
                                            onClick={() => handleDeleteDevice(d)} title="Unlink this device">
                                            <Trash2 size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            Unlink
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
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

            {showAddDevice && (
                <AddDeviceModal
                    onClose={() => setShowAddDevice(false)}
                    onCreated={loadDevices}
                />
            )}
        </>
    );
};

export default Profile;
