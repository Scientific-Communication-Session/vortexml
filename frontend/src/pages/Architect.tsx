import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import HelpButton from '../components/help/HelpButton';
import AskButton from '../components/chatbot/AskButton';
import { ARCH_HELP_TOPIC } from '../components/help/help-content';
import {
    AutoConfigProvider,
    useAutoConfig,
    type AutoConfigProposal,
} from '../components/auto-config/AutoConfigContext';
import AutoConfigDrawer from '../components/auto-config/AutoConfigDrawer';

interface Architecture {
    key: string;
    name: string;
    short: string;
    desc: string;
    icon: string;
    beginner_friendly?: boolean;
}

interface ModelConfig {
    arch_type: string;
    layer_sizes?: number[];
    epochs?: number;
    lr?: number;
    batch_size?: number;
    optimizer?: string;
    activation?: string;
    project_name?: string;
    early_stopping?: { enabled?: boolean; patience?: number; min_delta?: number };
}

interface SavedProject {
    id: number;
    name: string;
    arch_type: string;
    layer_sizes: number[];
    final_val_acc: number | null;
}

const Architect: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const isBeginner = user?.is_beginner === true;

    // State
    const [architectures, setArchitectures] = useState<Architecture[]>([]);
    const [selectedArch, setSelectedArch] = useState<string | null>(null);
    // Beginner-friendly defaults: smaller layers + fewer epochs by default.
    const [layers, setLayers] = useState<number[]>(isBeginner ? [32, 16] : [128, 64]);

    // Hyperparameters
    const [epochs, setEpochs] = useState<number>(isBeginner ? 20 : 50);
    const [lr, setLr] = useState<number>(0.001);
    const [batchSize, setBatchSize] = useState<number>(32);
    const [optimizer, setOptimizer] = useState<string>('adam');
    const [activation, setActivation] = useState<string>('relu');
    const [projectName, setProjectName] = useState<string>('VortexProject');

    // Early Stopping
    const [esEnabled, setEsEnabled] = useState<boolean>(false);
    const [esPatience, setEsPatience] = useState<number>(10);
    const [esDelta, setEsDelta] = useState<number>(0.0001);

    // Beginner UX: hide all-archs / advanced controls behind explicit opt-ins
    const [showAllArchs, setShowAllArchs] = useState<boolean>(false);
    const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

    // Dataset gating for AI Auto-Configure
    const [hasDataset, setHasDataset] = useState(false);

    // Upload state
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [weightsLoaded, setWeightsLoaded] = useState(false);
    const [weightStatus, setWeightStatus] = useState<string>('');

    // Saved models from the signed-in user's account
    const [accountProjects, setAccountProjects] = useState<SavedProject[]>([]);
    const [loadingProject, setLoadingProject] = useState(false);
    const weightInputRef = useRef<HTMLInputElement>(null);
    const startTrainingBtnRef = useRef<HTMLButtonElement>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);

    const visibleArchs = useMemo(() => {
        if (!isBeginner || showAllArchs) return architectures;
        return architectures.filter((a) => a.beginner_friendly);
    }, [architectures, isBeginner, showAllArchs]);

    // Initial load
    useEffect(() => {
        let mounted = true;

        const init = async () => {
            try {
                const archs = await apiGet('/api/architectures');
                if (mounted) setArchitectures(archs);

                const state = await apiGet('/api/state');
                if (mounted) setHasDataset(Boolean(state?.has_dataset));
                if (mounted && state.has_model && state.model_config) {
                    const cfg = state.model_config as ModelConfig;
                    setSelectedArch(cfg.arch_type);
                    setLayers(cfg.layer_sizes || [128, 64]);
                    setEpochs(cfg.epochs || 50);
                    setLr(cfg.lr || 0.001);
                    setBatchSize(cfg.batch_size || 32);
                    setOptimizer(cfg.optimizer || 'adam');
                    setActivation(cfg.activation || 'relu');
                    setProjectName(cfg.project_name || 'VortexProject');

                    if (cfg.early_stopping && cfg.early_stopping.enabled) {
                        setEsEnabled(true);
                        setEsPatience(cfg.early_stopping.patience || 10);
                        setEsDelta(cfg.early_stopping.min_delta || 0.0001);
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };
        init();

        return () => { mounted = false; };
    }, []);

    // Saved models for the "load from your account" picker
    useEffect(() => {
        if (!user) { setAccountProjects([]); return; }
        apiGet('/api/projects')
            .then((d) => setAccountProjects(d.projects || []))
            .catch(() => { });
    }, [user]);

    // Canvas drawing
    useEffect(() => {
        if (!selectedArch || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        // Ensure size matches CSS exactly
        if (rect.width === 0 || rect.height === 0) return;

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset transform instead of scale

        const W = rect.width;
        const H = rect.height;

        ctx.clearRect(0, 0, W, H);

        const allLayers = [4, ...layers, 2];
        const numLayers = allLayers.length;
        const layerSpacing = W / (numLayers + 1);
        const maxDisplay = 8;

        const positions: { x: number, y: number }[][] = [];

        for (let l = 0; l < numLayers; l++) {
            const x = layerSpacing * (l + 1);
            const n = Math.min(allLayers[l], maxDisplay);
            const neuronSpacing = Math.min(40, (H - 60) / (n + 1));
            const startY = H / 2 - (neuronSpacing * (n - 1)) / 2;
            const layerPositions = [];

            for (let i = 0; i < n; i++) {
                layerPositions.push({ x, y: startY + i * neuronSpacing });
            }
            positions.push(layerPositions);
        }

        // Draw connections
        for (let l = 0; l < positions.length - 1; l++) {
            for (const from of positions[l]) {
                for (const to of positions[l + 1]) {
                    ctx.beginPath();
                    ctx.moveTo(from.x, from.y);
                    ctx.lineTo(to.x, to.y);
                    ctx.strokeStyle = 'rgba(99, 102, 241, 0.12)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        // Draw neurons
        for (let l = 0; l < positions.length; l++) {
            const isInput = l === 0;
            const isOutput = l === positions.length - 1;

            for (const pos of positions[l]) {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);

                if (isInput) {
                    ctx.fillStyle = 'rgba(6, 182, 212, 0.6)';
                    ctx.strokeStyle = 'rgba(6, 182, 212, 0.8)';
                } else if (isOutput) {
                    ctx.fillStyle = 'rgba(249, 115, 22, 0.6)';
                    ctx.strokeStyle = 'rgba(249, 115, 22, 0.8)';
                } else {
                    ctx.fillStyle = 'rgba(139, 92, 246, 0.5)';
                    ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)';
                }

                ctx.lineWidth = 2;
                ctx.fill();
                ctx.stroke();
            }

            // Label
            if (positions[l].length > 0) {
                const x = positions[l][0].x;
                const bottomY = positions[l][positions[l].length - 1].y + 28;
                ctx.fillStyle = 'rgba(157, 157, 186, 0.8)';
                ctx.font = '11px "Space Grotesk", sans-serif';
                ctx.textAlign = 'center';

                if (isInput) {
                    ctx.fillText('Input', x, bottomY);
                } else if (isOutput) {
                    ctx.fillText('Output', x, bottomY);
                } else {
                    ctx.fillText(`${allLayers[l]}n`, x, bottomY);
                }

                // Truncation indicator
                if (allLayers[l] > maxDisplay) {
                    ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
                    ctx.fillText('⋮', x, H / 2 + 4);
                }
            }
        }
    }, [layers, selectedArch]);

    // Resize listener for canvas
    useEffect(() => {
        const handleResize = () => {
            // Force re-render of canvas by updating a dummy state or just triggering drawing if possible
            // Using layers reference in dependency array covers most redraws, but window resize needs a trigger
            setLayers(l => [...l]);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const uploadWeightFile = async (file: File) => {
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/weights/upload', {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            const data = await res.json();

            if (data.error) {
                showToast(data.error, 'error');
                setIsUploading(false);
                return;
            }

            const cfg = data.config as ModelConfig;
            setWeightsLoaded(true);
            setSelectedArch(cfg.arch_type);
            setLayers(cfg.layer_sizes || [128, 64]);
            setEpochs(cfg.epochs || 50);
            setLr(cfg.lr || 0.001);
            setBatchSize(cfg.batch_size || 32);
            setOptimizer(cfg.optimizer || 'adam');
            setActivation(cfg.activation || 'relu');
            setProjectName(cfg.project_name || 'VortexProject');

            setWeightStatus(`Loaded: ${file.name} — ${cfg.arch_type.toUpperCase()}, ${(cfg.layer_sizes || []).join('→')} neurons`);
            showToast(`Weights loaded! Architecture auto-configured as ${cfg.arch_type.toUpperCase()}`, 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Error uploading weights: ' + msg, 'error');
        }
        setIsUploading(false);
    };

    const loadFromAccount = async (projectId: number) => {
        setLoadingProject(true);
        try {
            const res = await apiPost(`/api/projects/${projectId}/load`, {});
            if (res.error) {
                showToast(res.error, 'error');
                return;
            }
            const cfg = res.config as ModelConfig;
            setWeightsLoaded(true);
            setSelectedArch(cfg.arch_type);
            setLayers(cfg.layer_sizes || [128, 64]);
            setEpochs(cfg.epochs || 50);
            setLr(cfg.lr || 0.001);
            setBatchSize(cfg.batch_size || 32);
            setOptimizer(cfg.optimizer || 'adam');
            setActivation(cfg.activation || 'relu');
            setProjectName(cfg.project_name || 'VortexProject');

            if (cfg.early_stopping?.enabled) {
                setEsEnabled(true);
                setEsPatience(cfg.early_stopping.patience || 10);
                setEsDelta(cfg.early_stopping.min_delta || 0.0001);
                if (isBeginner) setShowAdvanced(true);
            } else {
                setEsEnabled(false);
            }
            // Reveal an advanced architecture if the saved model uses one.
            if (isBeginner) {
                const a = architectures.find((x) => x.key === cfg.arch_type);
                if (a && !a.beginner_friendly) setShowAllArchs(true);
            }

            setWeightStatus(
                `Loaded from your account — ${(cfg.arch_type || '').toUpperCase()}, ` +
                `${(cfg.layer_sizes || []).join('→')} neurons · ${res.weight_filename}`,
            );
            showToast('Saved model loaded ✓', 'success');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Load failed: ' + msg, 'error');
        } finally {
            setLoadingProject(false);
        }
    };

    const handleClear = async () => {
        const isDirty = selectedArch !== null || weightsLoaded;
        if (isDirty && !confirm('Clear the current architecture and hyperparameters? This cannot be undone.')) return;
        try {
            await apiPost('/api/state/reset', { scope: 'model' });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Failed to clear: ' + msg, 'error');
            return;
        }
        setSelectedArch(null);
        setLayers(isBeginner ? [32, 16] : [128, 64]);
        setEpochs(isBeginner ? 20 : 50);
        setLr(0.001);
        setBatchSize(32);
        setOptimizer('adam');
        setActivation('relu');
        setProjectName('VortexProject');
        setEsEnabled(false);
        setEsPatience(10);
        setEsDelta(0.0001);
        setWeightsLoaded(false);
        setWeightStatus('');
        if (weightInputRef.current) weightInputRef.current.value = '';
        showToast('Architecture cleared', 'success');
    };

    const handleAddLayer = () => {
        const last = layers[layers.length - 1] || 64;
        setLayers([...layers, Math.max(16, Math.floor(last / 2))]);
    };

    const handleRemoveLayer = (index: number) => {
        if (layers.length <= 1) return;
        setLayers(layers.filter((_, i) => i !== index));
    };

    const updateLayer = (index: number, val: number) => {
        const newLayers = [...layers];
        newLayers[index] = Math.max(1, Math.min(2048, val || 64));
        setLayers(newLayers);
    };

    const handleApplyAutoConfig = useCallback((cfg: AutoConfigProposal) => {
        setSelectedArch(cfg.arch_type);
        if (Array.isArray(cfg.layer_sizes) && cfg.layer_sizes.length) {
            setLayers(cfg.layer_sizes);
        }
        if (typeof cfg.epochs === 'number') setEpochs(cfg.epochs);
        if (typeof cfg.lr === 'number') setLr(cfg.lr);
        if (typeof cfg.batch_size === 'number') setBatchSize(cfg.batch_size);
        if (cfg.optimizer) setOptimizer(cfg.optimizer);
        if (cfg.activation) setActivation(cfg.activation);

        const es = cfg.early_stopping;
        if (es) {
            setEsEnabled(Boolean(es.enabled));
            if (typeof es.patience === 'number') setEsPatience(es.patience);
            if (typeof es.min_delta === 'number') setEsDelta(es.min_delta);
            // Make sure the (beginner-hidden) Early Stopping panel is visible
            // when the AI turned it on, so the user can see what it did.
            if (isBeginner && es.enabled) setShowAdvanced(true);
        }

        // If the AI picked an architecture hidden in beginner mode, reveal it.
        if (isBeginner) {
            const a = architectures.find(x => x.key === cfg.arch_type);
            if (a && !a.beginner_friendly) setShowAllArchs(true);
        }

        showToast(
            `AI configured: ${cfg.arch_type.toUpperCase()} · [${(cfg.layer_sizes || []).join(', ')}]`,
            'success'
        );
    }, [architectures, isBeginner]);

    const handleStartTraining = async () => {
        if (!selectedArch) {
            showToast('Please select a network architecture.', 'error');
            return;
        }

        const config = {
            arch_type: selectedArch,
            layer_sizes: layers,
            epochs,
            lr,
            batch_size: batchSize,
            optimizer,
            activation,
            project_name: projectName,
            early_stopping: {
                enabled: esEnabled,
                patience: esPatience,
                min_delta: esDelta,
            }
        };

        const btn = startTrainingBtnRef.current;
        try {
            if (btn) btn.disabled = true;

            const res = await apiPost('/api/model/configure', config);
            if (res.error) {
                showToast(res.error, 'error');
                if (btn) btn.disabled = false;
                return;
            }

            showToast('Model configured! Redirecting to training...', 'success');
            setTimeout(() => navigate('/training'), 800);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            showToast('Error: ' + msg, 'error');
            if (btn) btn.disabled = false;
        }
    };

    return (
        <AutoConfigProvider onApply={handleApplyAutoConfig}>
            <div className="page-header" style={{ position: 'relative' }}>
                <h1>Architecture <em>Builder.</em></h1>
                <p>Choose a neural network type, configure layers, and set hyperparameters.</p>
                <button
                    type="button"
                    onClick={handleClear}
                    disabled={!selectedArch && !weightsLoaded}
                    title="Reset the architecture, hyperparameters and loaded weights"
                    className="btn btn-secondary btn-sm"
                    style={{ position: 'absolute', top: 0, right: 0 }}
                >
                    ↻ Clear
                </button>
            </div>

            {/* Weight Upload Zone */}
            <div className="glass-panel">
                <div className="panel-title"><span className="pt-icon">📦</span> Load a Model</div>
                <p className="text-muted mb-2">Continue from a model you've trained before, or upload a <code>.pt</code> weight file — either one restores the architecture and hyperparameters.</p>

                {user && (
                    <div style={{ marginBottom: weightsLoaded ? '0.5rem' : '1rem' }}>
                        <label className="form-label">Load a saved model from your account</label>
                        {accountProjects.length === 0 ? (
                            <p className="text-muted" style={{ fontSize: '0.82rem', margin: '0.3rem 0 0' }}>
                                No saved models yet — train one and it will appear here.
                            </p>
                        ) : (
                            <select
                                className="form-select"
                                value=""
                                disabled={loadingProject}
                                onChange={(e) => { if (e.target.value) loadFromAccount(parseInt(e.target.value)); }}
                            >
                                <option value="">
                                    {loadingProject ? 'Loading…' : '— Select one of your saved models —'}
                                </option>
                                {accountProjects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} · {p.arch_type.toUpperCase()} · {(p.layer_sizes || []).join('→')}
                                        {p.final_val_acc != null ? ` · ${p.final_val_acc.toFixed(1)}% acc` : ''}
                                    </option>
                                ))}
                            </select>
                        )}
                        {!weightsLoaded && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0.95rem 0 0.1rem' }}>
                                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                                <span className="text-muted" style={{ fontSize: '0.72rem' }}>or upload a file</span>
                                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
                            </div>
                        )}
                    </div>
                )}

                {!weightsLoaded && (
                    <div
                        className={`weight-upload-zone ${isDragging ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
                        onClick={() => weightInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={e => {
                            e.preventDefault();
                            setIsDragging(false);
                            const file = e.dataTransfer.files[0];
                            if (file && file.name.endsWith('.pt')) uploadWeightFile(file);
                            else showToast('Only .pt weight files are supported', 'error');
                        }}
                    >
                        <div className="upload-zone-content">
                            <span className="upload-zone-icon">⬆️</span>
                            <span className="upload-zone-text">Drag & drop a <strong>.pt</strong> file here, or <span className="upload-zone-link">browse</span></span>
                        </div>
                        <input
                            type="file"
                            ref={weightInputRef}
                            accept=".pt"
                            className="hidden-input"
                            style={{ display: 'none' }}
                            onChange={e => e.target.files && uploadWeightFile(e.target.files[0])}
                        />
                    </div>
                )}

                {weightsLoaded && (
                    <div className="weight-upload-status">
                        <span className="upload-status-icon">✅</span>
                        <span className="upload-status-text">{weightStatus}</span>
                    </div>
                )}
            </div>

            {/* AI Auto-Configure (dataset-gated) */}
            {hasDataset && <AutoConfigBanner />}

            {/* Architecture Selection */}
            <div className="glass-panel">
                <div className="panel-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span><span className="pt-icon">🔬</span> Select Architecture</span>
                    {isBeginner && architectures.length > 0 && (
                        <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setShowAllArchs((v) => !v)}
                            title={showAllArchs ? 'Show only beginner-friendly architectures' : 'Show every architecture (advanced)'}
                        >
                            {showAllArchs ? '◴ Beginner picks only' : '⚙ Show all architectures'}
                        </button>
                    )}
                </div>
                {isBeginner && !showAllArchs && architectures.length > 0 && (
                    <div className="info-banner" style={{ marginTop: '0.4rem' }}>
                        <span className="info-banner-icon">🌿</span>
                        <div>
                            <strong>Beginner mode:</strong> we're showing the most approachable architectures.
                            Start with <strong>MLP</strong> for any tabular problem — you can switch to “Show all” once you're comfortable.
                        </div>
                    </div>
                )}
                <div className="arch-grid">
                    {architectures.length === 0 ? (
                        <div className="text-center text-muted" style={{ gridColumn: '1/-1' }}>
                            <div className="spinner"></div>
                            <p className="mt-1">Loading architectures...</p>
                        </div>
                    ) : (
                        visibleArchs.map(a => (
                            <div
                                key={a.key}
                                className={`arch-card ${selectedArch === a.key ? 'selected' : ''}`}
                                onClick={() => setSelectedArch(a.key)}
                                style={{ position: 'relative' }}
                            >
                                <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                                    <HelpButton topic={ARCH_HELP_TOPIC[a.key] ?? 'arch_mlp'} />
                                    <AskButton topic={ARCH_HELP_TOPIC[a.key] ?? 'arch_mlp'} />
                                </div>
                                <div className="arch-icon">{a.icon}</div>
                                <div className="arch-name">{a.name}</div>
                                <div className="arch-short">{a.short}</div>
                                <div className="arch-desc">{a.desc}</div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {selectedArch && (
                <>
                    {/* Layer Configurator */}
                    <div className="glass-panel">
                        <div className="panel-title">
                            <span className="pt-icon">📐</span> Configure Layers
                            <HelpButton topic="layers" />
                            <AskButton topic="layers" />
                        </div>
                        <p className="text-muted mb-2">Add hidden layers and set the number of neurons in each.</p>

                        <div className="layer-list">
                            {layers.map((l, i) => (
                                <div key={i} className="layer-item">
                                    <span className="layer-label">Layer {i + 1}</span>
                                    <input
                                        type="number"
                                        value={l}
                                        min="1" max="2048"
                                        className="layer-neurons"
                                        onChange={e => updateLayer(i, parseInt(e.target.value) || 0)}
                                    />
                                    <span className="text-muted" style={{ fontSize: '0.8rem' }}>neurons</span>
                                    <button
                                        className="remove-layer"
                                        onClick={() => handleRemoveLayer(i)}
                                        disabled={layers.length <= 1}
                                        style={{ opacity: layers.length <= 1 ? 0.3 : 1 }}
                                    >×</button>
                                </div>
                            ))}
                        </div>
                        <div className="mt-2">
                            <button className="btn btn-secondary btn-sm" onClick={handleAddLayer}>+ Add Layer</button>
                        </div>
                    </div>

                    {/* Hyperparameters */}
                    <div className="glass-panel">
                        <div className="panel-title"><span className="pt-icon">⚙️</span> Hyperparameters</div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Epochs <HelpButton topic="epochs" /><AskButton topic="epochs" /></label>
                                <input type="number" className="form-input" value={epochs} onChange={e => setEpochs(parseInt(e.target.value) || 50)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Learning Rate <HelpButton topic="learning_rate" /><AskButton topic="learning_rate" /></label>
                                <input type="number" className="form-input" step="0.0001" value={lr} onChange={e => setLr(parseFloat(e.target.value) || 0.001)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Batch Size <HelpButton topic="batch_size" /><AskButton topic="batch_size" /></label>
                                <select className="form-select" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value) || 32)}>
                                    <option value="16">16</option>
                                    <option value="32">32</option>
                                    <option value="64">64</option>
                                    <option value="128">128</option>
                                    <option value="256">256</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Optimizer <HelpButton topic="optimizer" /><AskButton topic="optimizer" /></label>
                                <select className="form-select" value={optimizer} onChange={e => setOptimizer(e.target.value)}>
                                    <option value="adam">Adam</option>
                                    <option value="adamw">AdamW</option>
                                    <option value="sgd">SGD</option>
                                    <option value="rmsprop">RMSprop</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Activation <HelpButton topic="activation" /><AskButton topic="activation" /></label>
                                <select className="form-select" value={activation} onChange={e => setActivation(e.target.value)}>
                                    <option value="relu">ReLU</option>
                                    <option value="leaky_relu">Leaky ReLU</option>
                                    <option value="elu">ELU</option>
                                    <option value="selu">SELU</option>
                                    <option value="gelu">GELU</option>
                                    <option value="tanh">Tanh</option>
                                    <option value="sigmoid">Sigmoid</option>
                                </select>
                            </div>
                        </div>

                        {/* Advanced options — gated behind a toggle for beginners */}
                        {(!isBeginner || showAdvanced) && (
                            <div className="es-section">
                                <div className="es-header">
                                    <label className="toggle-switch">
                                        <input type="checkbox" checked={esEnabled} onChange={e => setEsEnabled(e.target.checked)} />
                                        <span className="toggle-slider"></span>
                                    </label>
                                    <span className="es-label">Early Stopping</span>
                                    <HelpButton topic="early_stopping" />
                                    <AskButton topic="early_stopping" />
                                </div>
                                {esEnabled && (
                                    <div className="es-params">
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label className="form-label">Patience <HelpButton topic="patience" /><AskButton topic="patience" /></label>
                                                <input type="number" className="form-input" value={esPatience} onChange={e => setEsPatience(parseInt(e.target.value) || 10)} />
                                                <span className="form-hint">Epochs to wait for improvement</span>
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Min Delta <HelpButton topic="min_delta" /><AskButton topic="min_delta" /></label>
                                                <input type="number" className="form-input" step="0.0001" value={esDelta} onChange={e => setEsDelta(parseFloat(e.target.value) || 0.0001)} />
                                                <span className="form-hint">Minimum change to qualify as improvement</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {isBeginner && (
                            <div className="mt-2">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setShowAdvanced((v) => !v)}
                                    title="Show / hide expert-only settings"
                                >
                                    {showAdvanced ? '▴ Hide advanced options' : '▾ Show advanced options (Early Stopping)'}
                                </button>
                            </div>
                        )}

                        {/* Project Name */}
                        <div className="form-row mt-2">
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label">Project Name <HelpButton topic="project_name" /><AskButton topic="project_name" /></label>
                                <input type="text" className="form-input" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="MyProject" />
                                <span className="form-hint">Used in the weight filename</span>
                            </div>
                        </div>
                    </div>

                    {/* Canvas Preview */}
                    <div className="glass-panel">
                        <div className="panel-title"><span className="pt-icon">👁️</span> Architecture Preview</div>
                        <canvas ref={canvasRef} className="network-viz" style={{ width: '100%', height: '300px' }}></canvas>
                    </div>

                    <div className="action-row">
                        <button className="btn btn-secondary" onClick={() => navigate('/dataset')}>← Back to Dataset</button>
                        <button className="btn btn-primary" ref={startTrainingBtnRef} onClick={handleStartTraining}>Start Training ⚡</button>
                    </div>
                </>
            )}

            <AutoConfigDrawer />
        </AutoConfigProvider>
    );
};

// Small consumer used inside the Architect tree so it can call `useAutoConfig`.
const AutoConfigBanner: React.FC = () => {
    const { open, isAvailable, unavailableReason } = useAutoConfig();
    return (
        <div className="glass-panel auto-config-banner">
            <div className="auto-config-banner__text">
                <div className="panel-title"><span className="pt-icon">🪄</span> Not sure what to pick?</div>
                <p className="text-muted mb-0">
                    Let an AI co-pilot choose the architecture and hyperparameters that
                    best fit your dataset and goal — describe your problem in plain words.
                </p>
                {!isAvailable && unavailableReason && (
                    <p className="text-muted mb-0" style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
                        ⚠️ {unavailableReason}
                    </p>
                )}
            </div>
            <button
                type="button"
                className="btn btn-primary auto-config-banner__btn"
                onClick={open}
                disabled={!isAvailable}
                title={isAvailable ? 'Open the AI Auto-Configure assistant' : unavailableReason || 'Unavailable'}
            >
                🪄 AI Auto-Configure
            </button>
        </div>
    );
};

export default Architect;
