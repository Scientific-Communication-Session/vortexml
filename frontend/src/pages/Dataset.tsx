import React, { useState, useEffect, useRef } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import HelpButton from '../components/help/HelpButton';
import AskButton from '../components/chatbot/AskButton';

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
    const fileInputRef = useRef<HTMLInputElement>(null);

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
        const valid = /\.(csv|xlsx|xls)$/i.test(file.name);
        if (!valid) {
            showToast('Only CSV and Excel files are supported.', 'error');
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
                    ↻ Clear
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
                <div className="panel-title"><span className="pt-icon">📁</span> Upload Dataset</div>
                <div
                    className={`upload-zone ${isDragging ? 'dragover' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={openFileDialog}
                >
                    <div className="upload-icon">⬆️</div>
                    <h3>Drag & drop your file here</h3>
                    <p>or click to browse — CSV, XLSX, XLS supported (max 100 MB)</p>
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        accept=".csv,.xlsx,.xls"
                        onChange={handleFileInput}
                    />
                </div>

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
                            <div className="panel-title mb-0"><span className="pt-icon">👁️</span> Data Preview</div>
                            <div>
                                <span className="badge badge-success">✓ {filename}</span>
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

                    <div className="glass-panel">
                        <div className="panel-title">
                            <span className="pt-icon">🎯</span> Select Columns
                            <HelpButton topic="features_target" />
                            <AskButton topic="features_target" />
                        </div>

                        <div className="info-banner">
                            <span className="info-banner-icon">💡</span>
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
                                        <div>
                                            <div className="col-name">{col.name}</div>
                                            <div className="col-dtype">{col.dtype} {col.is_numeric ? `· ${col.unique} unique` : `· ${col.unique} categories`}</div>
                                        </div>
                                        <div className="col-controls">
                                            <button
                                                className={`col-btn btn-feat ${isFeature ? 'active-feature' : ''}`}
                                                onClick={() => toggleFeature(col.name)}
                                            >
                                                Feature
                                            </button>
                                            <button
                                                className={`col-btn btn-tgt ${isTarget ? 'active-target' : ''}`}
                                                onClick={() => setTarget(col.name)}
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
