import React, { useEffect, useState } from 'react';
import { X, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ExplainModalProps {
    title: string;
    /** Body posted to /api/explain-results — either {project_id} or the
     *  just-finished run's {config, history, task_type, metrics}. */
    request: Record<string, unknown>;
    onClose: () => void;
}

const ExplainModal: React.FC<ExplainModalProps> = ({ title, request, onClose }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [explanation, setExplanation] = useState('');

    useEffect(() => {
        let cancelled = false;
        fetch('/api/explain-results', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!res.ok || data.error) {
                    setError(data.error || `Failed (HTTP ${res.status})`);
                } else {
                    setExplanation(data.explanation || 'No explanation returned.');
                }
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
        // request is built fresh by the parent on open; intentionally run once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
                style={{ width: '100%', maxWidth: 620, maxHeight: '80vh', overflowY: 'auto', padding: '1.6rem 1.7rem', position: 'relative' }}
            >
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="btn btn-secondary btn-sm"
                    style={{ position: 'absolute', top: '1rem', right: '1rem', padding: '0.3rem' }}
                >
                    <X size={15} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.9rem' }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center',
                        background: 'rgba(139,92,246,0.14)', color: '#8b5cf6',
                    }}>
                        <Sparkles size={20} />
                    </div>
                    <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Explain: {title}</h2>
                </div>

                {loading && (
                    <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 0' }}>
                        <Loader2 size={16} className="chat-msg__spinner" /> Reviewing your training run…
                    </div>
                )}
                {error && (
                    <div className="info-banner" style={{ borderLeft: '3px solid #ef4444' }}>
                        <span className="info-banner-icon">⚠️</span>
                        <div>{error}</div>
                    </div>
                )}
                {!loading && !error && (
                    <div className="markdown-body" style={{ fontSize: '0.92rem', lineHeight: 1.6 }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{explanation}</ReactMarkdown>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ExplainModal;
