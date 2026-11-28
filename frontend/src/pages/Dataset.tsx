import React, { useState, useEffect, useRef } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import HelpButton from '../components/help/HelpButton';
import AskButton from '../components/chatbot/AskButton';
import { Check, FolderOpen, HeartPulse, Info, Lightbulb, RotateCcw, Table2, Target, TriangleAlert, Upload } from 'lucide-react';

interface ColumnInfo {
    name: string;
    dtype: string;
    is_numeric: boolean;
    unique: number;
}

interface DatasetInfo {
    rows: number;
    cols: number;
    columns: ColumnInfo[];
    preview: Record<string, unknown>[];
}

interface SampleDataset {
    key: string;
    title: string;
    file: string;
    rows: number;
    features: string[];
    task_type: string;
    synthetic: boolean;
    available: boolean;
}

interface HealthWarning {
    level: 'warning' | 'info';
    code: string;
    title: string;
    detail: string;
    columns: string[];
}

const Dataset: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const isBeginner = user?.is_beginner === true;
    const [step, setStep] = useState<number>(1);

    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadStatusText, setUploadStatusText] = useState('Uploading...');

    const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
    const [filename, setFilename] = useState('');

    const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
    const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
    const [health, setHealth] = useState<HealthWarning[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Bundled sample datasets — a way to try the app without a file of your own
    const [samples, setSamples] = useState<SampleDataset[]>([]);
    const [loadingSample, setLoadingSample] = useState<string | null>(null);

    useEffect(() => {
        apiGet('/api/demo/datasets')
            .then((d) => setSamples((d.datasets || []).filter((s: SampleDataset) => s.available)))
            .catch(() => { });
    }, []);

    // Loads the sample exactly as if it had been uploaded: the columns and the
    // model are still the user's to choose.
    const loadSample = async (key: string) => {
        if (loadingSample) return;
        setLoadingSample(key);
        try {
            const data = await apiPost('/api/demo/load', { key, configure: false });
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            setFilename(data.filename);
            setDatasetInfo(data.info);
            setSelectedFeatures(new Set());
            setSelectedTarget(null);
            setStep(3);
            showToast(`Loaded ${data.filename}`, 'success');
        } catch (err) {
            showToast('Could not load the sample: ' + (err instanceof Error ? err.message : String(err)), 'error');
        } finally {
            setLoadingSample(null);
        }
    };

    // Initial state check
    useEffect(() => {
        let mounted = true;
        apiGet('/api/state')
            .then(state => {
                if (state.has_dataset && mounted) {
                    apiGet('/api/dataset/analyze').then(data => {
                        if (data.info && mounted) {
                            setDatasetInfo(data.info);
                            setFilename(data.filename);
                            setStep(3);

                            if (state.has_features) {
                                setSelectedFeatures(new Set(state.feature_cols));
                                if (state.target_col) {
                                    setSelectedTarget(state.target_col);
                                }
                            }
                        }
                    });
                }
            })
            .catch(() => { });

        return () => { mounted = false; };
    }, []);

    // Run data-quality checks (debounced) whenever the dataset or the live
    // feature/target selection changes.
    useEffect(() => {
        if (!datasetInfo) return;
        let cancelled = false;
        const t = setTimeout(() => {
            apiPost('/api/dataset/health', {
                feature_cols: Array.from(selectedFeatures),
                target_col: selectedTarget,
            })
                .then(res => {
                    if (!cancelled && Array.isArray(res?.warnings)) setHealth(res.warnings);
                })
                .catch(() => { });
        }, 350);
        return () => { cancelled = true; clearTimeout(t); };
    }, [datasetInfo, selectedFeatures, selectedTarget]);

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) uploadFile(file);
    };

    const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            uploadFile(e.target.files[0]);
        }
    };

    const openFileDialog = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const uploadFile = async (file: File) => {
        const valid = /\.(csv|tsv|xlsx|xls|json|parquet|docx|html?|htm)$/i.test(file.name);
        if (!valid) {
            showToast('Unsupported file. Upload CSV, TSV, Excel, JSON, Parquet, or a Word/HTML table.', 'error');
            return;
        }

        setUploading(true);
        setUploadProgress(30);
        setUploadStatusText(`Uploading ${file.name}...`);

        const formData = new FormData();
        formData.append('file', file);

        try {
            setUploadProgress(60);
            const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: formData });
            const data = await res.json();

            if (data.error) {
                showToast(data.error, 'error');
                setUploading(false);
                return;
            }

            setUploadProgress(100);
            setUploadStatusText('Upload complete!');

            setTimeout(() => {
                setFilename(data.filename);
                setDatasetInfo(data.info);
                setStep(3);
                setSelectedFeatures(new Set());
                setSelectedTarget(null);
                setUploading(false);
            }, 400);

        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast('Upload failed: ' + msg, 'error');
            setUploading(false);
        }
    };

    const toggleFeature = (colName: string) => {
        const newFeatures = new Set(selectedFeatures);
        if (newFeatures.has(colName)) {
            newFeatures.delete(colName);
        } else {
            if (selectedTarget === colName) setSelectedTarget(null);
            newFeatures.add(colName);
        }
        setSelectedFeatures(newFeatures);
    };

    const setTarget = (colName: string) => {
        const newFeatures = new Set(selectedFeatures);
        if (newFeatures.has(colName)) {
            newFeatures.delete(colName);
            setSelectedFeatures(newFeatures);
        }
        setSelectedTarget(colName);
    };

    const handleContinue = async (e: React.MouseEvent) => {
        e.preventDefault();
        if (selectedFeatures.size === 0 || !selectedTarget) {
            showToast('Select at least one feature and one target column.', 'error');
            return;
        }

        try {
            const res = await apiPost('/api/dataset/configure', {
                feature_cols: Array.from(selectedFeatures),
                target_col: selectedTarget,
            });

            if (res.error) {
                showToast(res.error, 'error');
                return;
            }

            showToast('Dataset configured! Redirecting...', 'success');
            navigate('/architect');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast('Error: ' + msg, 'error');
        }
    };

    const handleClear = async () => {
        if (datasetInfo && !confirm('Clear the current dataset and column selections? This cannot be undone.')) return;
        try {
            await apiPost('/api/state/reset', { scope: 'dataset' });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast('Failed to clear: ' + msg, 'error');
            return;
        }
        setDatasetInfo(null);
        setFilename('');
        setSelectedFeatures(new Set());
        setSelectedTarget(null);
        setHealth([]);
        setStep(1);
        setUploadProgress(0);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        showToast('Dataset cleared', 'success');
    };

    const isReady = selectedFeatures.size > 0 && selectedTarget !== null;

    return (
        <>
            <div className="page-header" style={{ position: 'relative' }}>
                <h1>Dataset <em>Designer.</em></h1>
                <p>Upload your data, preview it, and select the columns for training.</p>
                <button
                    type="button"
                    onClick={handleClear}
                    disabled={!datasetInfo && step === 1}
                    title="Reset dataset, feature/target picks, and start over"
                    className="btn btn-secondary btn-sm"
                    style={{ position: 'absolute', top: 0, right: 0 }}
                >
                    <RotateCcw size={13} aria-hidden="true" /> Clear
                </button>
            </div>

            <div className="steps">
                {[1, 2, 3].map((num) => (
                    <div key={num} className={`step ${step === num ? 'active' : ''} ${step > num ? 'completed' : ''}`}>
                        <div className="step-number">{num}</div>
                        <span className="step-text">
                            {num === 1 ? 'Upload File' : num === 2 ? 'Preview Data' : 'Select Columns'}
                        </span>
                    </div>
                ))}
            </div>

            {/* Step 1: Upload */}
            <div className={`glass-panel ${step >= 2 ? 'hidden' : ''}`} id="upload-section">
                <div className="panel-title"><span className="pt-icon"><FolderOpen size={18} strokeWidth={1.75} /></span> Upload Dataset</div>
                <div
                    className={`upload-zone ${isDragging ? 'dragover' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={openFileDialog}
                >
                    <div className="upload-icon"><Upload size={22} strokeWidth={1.75} aria-hidden="true" /></div>
                    <h2>Drag & drop your file here</h2>
                    {/* (The button's click reaches the zone, which opens the file dialog.) */}
                    <p>or <button type="button" className="btn-text" aria-label="click to browse for a dataset file">click to browse</button> — CSV, TSV, Excel, JSON, Parquet, Word/HTML tables (max 100 MB)</p>
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        accept=".csv,.tsv,.xlsx,.xls,.json,.parquet,.docx,.html,.htm"
                        onChange={handleFileInput}
                    />
                </div>

                {samples.length > 0 && !uploading && (
                    <div className="sample-row">
                        <span className="sample-row__label">No file handy? Try a sample:</span>
                        {samples.map((s) => (
                            <button
                                key={s.key}
                                type="button"
                                className="sample-chip"
                                onClick={() => loadSample(s.key)}
                                disabled={loadingSample !== null}
                                title={`${s.rows} rows · ${s.features.length} features · ${s.task_type}`}
                            >
                                {loadingSample === s.key ? 'Loading…' : s.title}
                                <span>{s.rows} rows</span>
                            </button>
                        ))}
                        <Link to="/tutorial" className="sample-row__link">New here? Follow the 10-minute tutorial →</Link>
                    </div>
                )}

                {uploading && (
                    <div className="upload-progress active">
                        <div className="progress-bar-container">
                            <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
                        </div>
                        <p className="text-muted mt-1 text-center">{uploadStatusText}</p>
                    </div>
                )}
            </div>

            {/* Step 2 & 3 Combined View (once dataset is loaded) */}
            {datasetInfo && (
                <>
                    <div className="glass-panel">
                        <div className="flex-between mb-2">
                            <div className="panel-title mb-0"><span className="pt-icon"><Table2 size={18} strokeWidth={1.75} /></span> Data Preview</div>
                            <div>
                                <span className="badge badge-success"><Check size={12} aria-hidden="true" /> {filename}</span>
                            </div>
                        </div>

                        <div className="summary-row">
                            <div className="summary-item"><div className="si-label">Rows</div><div className="si-value">{datasetInfo.rows.toLocaleString()}</div></div>
                            <div className="summary-item"><div className="si-label">Columns</div><div className="si-value">{datasetInfo.cols}</div></div>
                            <div className="summary-item"><div className="si-label">Numeric</div><div className="si-value">{datasetInfo.columns.filter(c => c.is_numeric).length}</div></div>
                            <div className="summary-item"><div className="si-label">Categorical</div><div className="si-value">{datasetInfo.columns.filter(c => !c.is_numeric).length}</div></div>
                        </div>

                        <div className="data-table-wrapper">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        {datasetInfo.columns.map(c => <th key={c.name}>{c.name}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {datasetInfo.preview.map((row, i) => (
                                        <tr key={i}>
                                            {datasetInfo.columns.map(c => <td key={c.name}>{String(row[c.name] ?? '')}</td>)}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {health.length > 0 && (
                        <div className="glass-panel">
                            <div className="panel-title"><span className="pt-icon"><HeartPulse size={18} strokeWidth={1.75} /></span> Dataset Health</div>
                            <p className="text-muted mb-2">
                                Automatic checks on your data — worth a look before training.
                                {selectedTarget ? '' : ' Pick a target column to also check class balance and leakage.'}
                            </p>
                            {health.map((w, i) => (
                                <div
                                    key={`${w.code}-${i}`}
                                    className={`info-banner${w.level === 'warning' ? ' info-banner--warning' : ''}`}
                                    style={{ marginBottom: 'var(--space-2)' }}
                                >
                                    <span className="info-banner-icon">
                                        {w.level === 'warning'
                                            ? <TriangleAlert size={16} aria-label="Warning" />
                                            : <Info size={16} aria-label="Note" />}
                                    </span>
                                    <div>
                                        <strong>{w.title}</strong>
                                        <div className="text-muted">{w.detail}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="glass-panel">
                        <div className="panel-title">
                            <span className="pt-icon"><Target size={18} strokeWidth={1.75} /></span> Select Columns
                            <HelpButton topic="features_target" />
                            <AskButton topic="features_target" />
                        </div>

                        <div className="info-banner">
                            <span className="info-banner-icon"><Lightbulb size={16} aria-hidden="true" /></span>
                            <div>
                                <strong>Features</strong> are the inputs the model uses to make a prediction
                                (e.g. <em>hours_studied</em>, <em>attendance_rate</em>). The <strong>target</strong> is the value
                                you want the model to predict (e.g. <em>passed</em>).
                                {isBeginner && (
                                    <>
                                        {' '}Pick every column that looks like a useful input as a feature, and exactly{' '}
                                        <strong>one</strong> column as your target.
                                    </>
                                )}
                            </div>
                        </div>

                        <p className="text-muted mb-2">
                            Click <strong>Feature</strong> to mark input variables, and <strong>Target</strong> to select what the model
                            should predict.
                        </p>

                        <div className="column-picker">
                            {datasetInfo.columns.map(col => {
                                const isFeature = selectedFeatures.has(col.name);
                                const isTarget = selectedTarget === col.name;

                                return (
                                    <div key={col.name} className={`col-item ${isFeature ? 'selected-feature' : ''} ${isTarget ? 'selected-target' : ''}`}>
                                        <div className="col-info">
                                            <div className="col-name" title={col.name}>{col.name}</div>
                                            <div className="col-dtype">{col.dtype} {col.is_numeric ? `· ${col.unique} unique` : `· ${col.unique} categories`}</div>
                                        </div>
                                        <div className="col-controls">
                                            {/* Named with the column, so the twelve "Feature" and "Target" buttons can be told apart. */}
                                            <button
                                                className={`col-btn btn-feat ${isFeature ? 'active-feature' : ''}`}
                                                onClick={() => toggleFeature(col.name)}
                                                aria-label={`Feature: ${col.name}`}
                                                aria-pressed={isFeature}
                                            >
                                                Feature
                                            </button>
                                            <button
                                                className={`col-btn btn-tgt ${isTarget ? 'active-target' : ''}`}
                                                onClick={() => setTarget(col.name)}
                                                aria-label={`Target: ${col.name}`}
                                                aria-pressed={isTarget}
                                            >
                                                Target
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="action-row">
                            <button
                                className="btn btn-primary"
                                onClick={handleContinue}
                                style={{
                                    opacity: isReady ? 1 : 0.4,
                                    pointerEvents: isReady ? 'auto' : 'none'
                                }}
                            >
                                Continue to Architecture Builder →
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

export default Dataset;
