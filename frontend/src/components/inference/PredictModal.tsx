import React, { useEffect, useState } from 'react';
import { X, Loader2, Wand2, Upload } from 'lucide-react';
import { showToast } from '../../utils/helpers';

interface Field {
    name: string;
    kind: 'numeric' | 'categorical';
    options?: string[];
}

interface Schema {
    ready: boolean;
    reason?: string;
    task_type: string;
    target_col?: string;
    target_classes?: string[] | null;
    fields?: Field[];
}

interface Prediction {
    prediction: string | number;
    confidence?: number;
    probabilities?: Record<string, number>;
}

interface PredictModalProps {
    projectId: number;
    projectName: string;
    onClose: () => void;
}

const PredictModal: React.FC<PredictModalProps> = ({ projectId, projectName, onClose }) => {
    const [schema, setSchema] = useState<Schema | null>(null);
    const [loadingSchema, setLoadingSchema] = useState(true);
    const [values, setValues] = useState<Record<string, string>>({});
    const [predicting, setPredicting] = useState(false);
    const [results, setResults] = useState<Prediction[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/projects/${projectId}/inference`, { credentials: 'include' })
            .then((r) => r.json())
            .then((s: Schema) => {
                if (cancelled) return;
                setSchema(s);
                if (s.ready && s.fields) {
                    const init: Record<string, string> = {};
                    s.fields.forEach((f) => {
                        init[f.name] = f.kind === 'categorical' && f.options?.length ? f.options[0] : '';
                    });
                    setValues(init);
                }
            })
            .catch(() => { if (!cancelled) setSchema({ ready: false, reason: 'Could not load model info.', task_type: '' }); })
            .finally(() => { if (!cancelled) setLoadingSchema(false); });
        return () => { cancelled = true; };
    }, [projectId]);

    const submitRow = async () => {
        setPredicting(true);
        setResults(null);
        try {
            const res = await fetch(`/api/projects/${projectId}/predict`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: [values] }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                showToast(data.error || `Prediction failed (HTTP ${res.status})`, 'error');
                return;
            }
            setResults(data.predictions || []);
        } catch (e) {
            showToast('Prediction failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setPredicting(false);
        }
    };

    const submitCsv = async (file: File) => {
        setPredicting(true);
        setResults(null);
        const form = new FormData();
        form.append('file', file);
        try {
            const res = await fetch(`/api/projects/${projectId}/predict`, {
                method: 'POST', credentials: 'include', body: form,
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                showToast(data.error || `Prediction failed (HTTP ${res.status})`, 'error');
                return;
            }
            setResults(data.predictions || []);
            showToast(`Predicted ${data.count} row${data.count === 1 ? '' : 's'}`, 'success');
        } catch (e) {
            showToast('Prediction failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setPredicting(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '0.45rem 0.6rem', borderRadius: 8,
        background: 'rgba(255,255,255,0.05)', color: 'inherit',
        border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.88rem',
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(8,8,16,0.72)', backdropFilter: 'blur(6px)',
                display: 'grid', placeItems: 'center', padding: '1.5rem',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="glass-panel"
                style={{ width: '100%', maxWidth: 560, maxHeight: '82vh', overflowY: 'auto', padding: '1.6rem 1.7rem', position: 'relative' }}
            >
                <button onClick={onClose} aria-label="Close" className="btn btn-secondary btn-sm"
                    style={{ position: 'absolute', top: '1rem', right: '1rem', padding: '0.3rem' }}>
                    <X size={15} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.9rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(34,197,94,0.14)', color: '#22c55e' }}>
                        <Wand2 size={20} />
                    </div>
                    <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Predict with "{projectName}"</h2>
                </div>

                {loadingSchema && (
                    <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 0' }}>
                        <Loader2 size={16} className="chat-msg__spinner" /> Loading model inputs…
                    </div>
                )}

                {!loadingSchema && schema && !schema.ready && (
                    <div className="info-banner" style={{ borderLeft: '3px solid #f5a623' }}>
                        <span className="info-banner-icon">⚠️</span>
                        <div>{schema.reason || 'This model cannot be used for prediction.'}</div>
                    </div>
                )}

                {!loadingSchema && schema?.ready && (
                    <>
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                            Enter feature values to predict <strong>{schema.target_col}</strong>, or upload a CSV with these columns.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                            {schema.fields?.map((f) => (
                                <div key={f.name}>
                                    <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                                        {f.name}
                                    </label>
                                    {f.kind === 'categorical' && f.options?.length ? (
                                        <select
                                            value={values[f.name] ?? ''}
                                            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                                            style={inputStyle}
                                        >
                                            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    ) : (
                                        <input
                                            type={f.kind === 'numeric' ? 'number' : 'text'}
                                            step="any"
                                            value={values[f.name] ?? ''}
                                            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                                            style={inputStyle}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.1rem', flexWrap: 'wrap' }}>
                            <button className="btn btn-primary btn-sm" onClick={submitRow} disabled={predicting}>
                                {predicting ? <Loader2 size={14} className="chat-msg__spinner" style={{ marginRight: 5, verticalAlign: 'middle' }} /> : <Wand2 size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />}
                                Predict
                            </button>
                            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                                <Upload size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                                Upload CSV
                                <input
                                    type="file"
                                    accept=".csv,.xlsx,.xls"
                                    style={{ display: 'none' }}
                                    onChange={(e) => { if (e.target.files?.[0]) submitCsv(e.target.files[0]); }}
                                />
                            </label>
                        </div>

                        {results && results.length > 0 && (
                            <div style={{ marginTop: '1.2rem' }}>
                                <div className="panel-title" style={{ fontSize: '0.95rem' }}>Result{results.length > 1 ? `s (${results.length})` : ''}</div>
                                {results.length === 1 ? (
                                    <div className="glass-panel" style={{ padding: '1rem 1.2rem' }}>
                                        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#22c55e' }}>
                                            {String(results[0].prediction)}
                                        </div>
                                        {results[0].confidence != null && (
                                            <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                                                confidence {(results[0].confidence * 100).toFixed(1)}%
                                            </div>
                                        )}
                                        {results[0].probabilities && (
                                            <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                                {Object.entries(results[0].probabilities)
                                                    .sort((a, b) => b[1] - a[1]).slice(0, 5)
                                                    .map(([cls, p]) => (
                                                        <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
                                                            <span style={{ minWidth: 70, fontFamily: 'var(--font-mono)' }}>{cls}</span>
                                                            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 4 }}>
                                                                <div style={{ width: `${p * 100}%`, height: '100%', background: '#8b5cf6', borderRadius: 4 }} />
                                                            </div>
                                                            <span className="text-muted" style={{ minWidth: 42, textAlign: 'right' }}>{(p * 100).toFixed(1)}%</span>
                                                        </div>
                                                    ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="data-table-wrapper" style={{ maxHeight: 240 }}>
                                        <table className="data-table">
                                            <thead><tr><th>#</th><th>Prediction</th><th>Confidence</th></tr></thead>
                                            <tbody>
                                                {results.slice(0, 50).map((r, i) => (
                                                    <tr key={i}>
                                                        <td>{i + 1}</td>
                                                        <td>{String(r.prediction)}</td>
                                                        <td>{r.confidence != null ? `${(r.confidence * 100).toFixed(1)}%` : '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default PredictModal;
