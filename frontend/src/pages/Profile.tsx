import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Trash2, FolderOpen, Layers, Activity, BarChart3, Sparkles, Laptop, Cpu, Pencil, Check, X, Plus, Wand2, ShieldCheck, Sprout, Flame, Monitor, Package, OctagonPause, ArrowRight, Boxes } from 'lucide-react';
import { ARCH_ICON } from '../components/archIcons';
import './profile.css';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import AddDeviceModal from '../components/devices/AddDeviceModal';
import DeleteAccountModal from '../components/account/DeleteAccountModal';
import ExplainModal from '../components/explain/ExplainModal';
import PredictModal from '../components/inference/PredictModal';
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
    const { user, isLoading: authLoading, checkAuth, setUser } = useAuth();
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
    const [explainProject, setExplainProject] = useState<Project | null>(null);
    const [predictProject, setPredictProject] = useState<Project | null>(null);
    const [showDeleteAccount, setShowDeleteAccount] = useState(false);
    // Set once the account has been deleted: we are on our way to the home page,
    // so the signed-out redirect below must not send us to Sign In instead.
    const accountDeleted = useRef(false);

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
            if (!accountDeleted.current) navigate('/signin');
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
                className="glass-panel pf-row"
                style={{
                    display: 'grid',
                    gap: '1.25rem',
                    alignItems: 'center',
                    padding: '1.25rem 1.5rem',
                }}
            >
                <span className="pf-tile">
                    {isBeginner ? <Sprout size={22} strokeWidth={1.75} aria-hidden="true" /> : <Flame size={22} strokeWidth={1.75} aria-hidden="true" />}
                </span>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '1.05rem' }}>
                            {isBeginner ? 'Novice mode' : 'Expert mode'}
                        </strong>
                        <span className="bento-tag bento-tag-sm">
                            {isBeginner ? 'Novice' : 'Expert'}
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
                    <div className="panel-title mb-0"><span className="pt-icon"><Monitor size={18} strokeWidth={1.75} /></span> Your Devices</div>
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
                                    className="glass-panel pf-row"
                                    style={{
                                        padding: '1rem 1.2rem',
                                        display: 'grid',
                                        gap: '1rem',
                                        alignItems: 'center',
                                    }}
                                >
                                    <div style={{
                                        position: 'relative', width: 40, height: 40, borderRadius: 10,
                                        display: 'grid', placeItems: 'center',
                                        background: 'oklch(0.68 0.17 283 / 0.14)', color: 'var(--color-accent)',
                                    }}>
                                        <Laptop size={20} />
                                        <span
                                            title={d.online ? 'Online' : 'Offline'}
                                            style={{
                                                position: 'absolute', right: -3, bottom: -3,
                                                width: 12, height: 12, borderRadius: '50%',
                                                border: '2px solid var(--color-bg-2)',
                                                background: d.online ? 'var(--color-success)' : 'var(--color-fg-3)',
                                            }}
                                        />
                                    </div>

                                    <div style={{ minWidth: 0 }}>
                                        {editing ? (
                                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                                <input
                                                    aria-label="Device nickname"
                                                    value={editName}
                                                    autoFocus
                                                    maxLength={80}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRenameDevice(d.id);
                                                        if (e.key === 'Escape') setEditingDeviceId(null);
                                                    }}
                                                    style={{
                                                        minHeight: 34, padding: '0 var(--space-2)', borderRadius: 'var(--radius-sm)',
                                                        background: 'var(--color-raised)', color: 'var(--color-fg)', fontFamily: 'inherit',
                                                        border: '1px solid var(--color-accent)', fontSize: 'var(--text-sm)', outline: 'none',
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
                                                    <i className={`pf-dot${d.online ? ' is-on' : ''}`} aria-hidden="true" />{d.online ? 'Online' : 'Offline'}
                                                </span>
                                            </div>
                                        )}
                                        <div className="text-muted" style={{
                                            fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums',
                                        }}>
                                            <Cpu size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                                            {d.specs ? specLine : 'Specs appear once the node agent first connects.'}
                                        </div>
                                    </div>

                                    <div className="pf-actions">
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
                <div className="glass-panel pr-empty">
                    <span className="pr-empty__icon"><FolderOpen size={24} strokeWidth={1.75} aria-hidden="true" /></span>
                    <h3>No projects yet</h3>
                    <p className="text-muted">
                        Train a model from the Architect page — completed runs are saved here automatically.
                    </p>
                    <button className="btn btn-primary" onClick={() => navigate('/dataset')}>
                        Start a new project <ArrowRight size={15} aria-hidden="true" />
                    </button>
                </div>
            ) : (
                <div className="glass-panel">
                    <div className="panel-title">
                        <span className="pt-icon"><Package size={18} strokeWidth={1.75} /></span> Saved Projects
                    </div>

                    <div className="project-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {projects.map((p) => {
                            const ArchIcon = ARCH_ICON[p.arch_type] ?? Boxes;
                            const archLabel = ARCH_LABEL[p.arch_type] ?? p.arch_type;
                            const accuracy = p.final_val_acc !== null
                                ? `${p.final_val_acc.toFixed(1)}%`
                                : null;
                            const isBusy = busyId === p.id;

                            return (
                                <div
                                    key={p.id}
                                    className="glass-panel pf-row"
                                    style={{
                                        padding: '1.25rem 1.5rem',
                                        display: 'grid',
                                        gap: '1.25rem',
                                        alignItems: 'center',
                                    }}
                                >
                                    <span className="pf-tile"><ArchIcon size={22} strokeWidth={1.75} aria-hidden="true" /></span>

                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <strong style={{ fontSize: '1.05rem' }}>{p.name}</strong>
                                            <span className="bento-tag bento-tag-sm">{archLabel}</span>
                                            {p.early_stopped && <span className="bento-tag bento-tag-sm"><OctagonPause size={11} aria-hidden="true" /> ES @ {p.stopped_epoch}</span>}
                                        </div>
                                        <div className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
                                            <Layers size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                                            {p.layer_sizes.join('→')} neurons
                                            {' · '}
                                            {p.epochs}e · lr {p.lr} · bs {p.batch_size} · {p.optimizer} · {p.activation}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', marginTop: '0.45rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            {accuracy && (
                                                <span><Activity size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle', color: 'var(--color-success)' }} />
                                                    val_acc <strong style={{ color: 'var(--color-success)' }}>{accuracy}</strong></span>
                                            )}
                                            {p.final_val_loss !== null && (
                                                <span><BarChart3 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                                                    val_loss <strong>{p.final_val_loss.toFixed(4)}</strong></span>
                                            )}
                                            <span className="text-muted">· {formatDate(p.created_at)}</span>
                                        </div>
                                    </div>

                                    <div className="pf-actions">
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
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setPredictProject(p)}
                                            disabled={isBusy}
                                            title="Run this model on new data"
                                        >
                                            <Wand2 size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            Predict
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setExplainProject(p)}
                                            disabled={isBusy}
                                            title="Get a plain-English verdict on this run"
                                        >
                                            <Sparkles size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                            Explain
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

            {/* ── Your data ── */}
            <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
                <div className="panel-title">
                    <span className="pt-icon"><ShieldCheck size={16} style={{ verticalAlign: 'middle' }} /></span> Your Data
                </div>
                <p className="text-muted" style={{ fontSize: '0.88rem', marginBottom: '1.1rem', maxWidth: '70ch' }}>
                    Everything in this account is yours. Take a copy whenever you like, or delete the account and
                    all of it for good. The <Link to="/privacy" style={{ color: 'var(--color-accent-text)', textDecoration: 'underline', textUnderlineOffset: 3 }}>Privacy Policy</Link> explains
                    what is stored and why.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem' }}>
                    <div style={{ flex: '1 1 300px', padding: '1rem 1.1rem', borderRadius: 14, border: '1px solid var(--color-line)', background: 'oklch(1 0 0 / 0.03)' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Download my data</div>
                        <p className="text-muted" style={{ fontSize: '0.84rem', marginBottom: '0.9rem' }}>
                            One file with your account details, projects and their training history, devices,
                            knowledge bases, conversations and enquiries.
                        </p>
                        <a className="btn btn-secondary btn-sm" href="/api/auth/export" download>
                            <Download size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                            Download as JSON
                        </a>
                    </div>
                    <div style={{ flex: '1 1 300px', padding: '1rem 1.1rem', borderRadius: 14, border: '1px solid oklch(0.68 0.18 25 / 0.25)', background: 'oklch(0.68 0.18 25 / 0.05)' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Delete my account</div>
                        <p className="text-muted" style={{ fontSize: '0.84rem', marginBottom: '0.9rem' }}>
                            Removes the account and everything in it from our servers, immediately and
                            permanently. You will be asked for your password.
                        </p>
                        <button className="btn btn-danger btn-sm" onClick={() => setShowDeleteAccount(true)}>
                            <Trash2 size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                            Delete account…
                        </button>
                    </div>
                </div>
            </div>

            {showDeleteAccount && user && (
                <DeleteAccountModal
                    username={user.username}
                    onClose={() => setShowDeleteAccount(false)}
                    onDeleted={() => {
                        accountDeleted.current = true;
                        setShowDeleteAccount(false);
                        setUser(null);
                        showToast('Your account and all its data have been deleted.', 'success');
                        navigate('/');
                    }}
                />
            )}

            {showAddDevice && (
                <AddDeviceModal
                    onClose={() => setShowAddDevice(false)}
                    onCreated={loadDevices}
                />
            )}

            {explainProject && (
                <ExplainModal
                    title={explainProject.name}
                    request={{ project_id: explainProject.id }}
                    onClose={() => setExplainProject(null)}
                />
            )}

            {predictProject && (
                <PredictModal
                    projectId={predictProject.id}
                    projectName={predictProject.name}
                    onClose={() => setPredictProject(null)}
                />
            )}
        </>
    );
};

export default Profile;
