import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Database, Plus, Upload, Send, Trash2, Loader2, FileText, Cpu, Cloud, ChevronDown } from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

interface Backend {
    key: string; label: string; tagline: string; description: string; use_when: string;
    local: boolean; available: boolean; default_model: string; models: string[]; setup: string; recommended: boolean;
}
interface Embedder { key: string; label: string; description: string; available: boolean; }
interface DocItem { id: number; filename: string; char_count: number; chunk_count: number; }
interface KB { id: number; name: string; embedder: string; chunk_size: number; overlap: number; n_docs: number; n_chunks: number; documents?: DocItem[]; }
interface Citation { n: number; doc_name: string; score: number; preview: string; }
interface Chunk { n: number; doc_name: string; score: number; text: string; }
interface QueryResult { answer: string; citations: Citation[]; chunks: Chunk[]; backend: string; model: string; }

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem 0.65rem', borderRadius: 8,
    background: 'rgba(255,255,255,0.05)', color: 'inherit',
    border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.9rem',
};

const Rag: React.FC = () => {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const isBeginner = user?.is_beginner === true;

    const [backends, setBackends] = useState<Backend[]>([]);
    const [embedders, setEmbedders] = useState<Embedder[]>([]);
    const [recommended, setRecommended] = useState<string>('cloud');
    const [kbs, setKbs] = useState<KB[]>([]);
    const [selected, setSelected] = useState<KB | null>(null);
    const [loading, setLoading] = useState(true);

    // create-KB form
    const [newName, setNewName] = useState('');
    const [newEmbedder, setNewEmbedder] = useState('tfidf');

    // query controls
    const [backend, setBackend] = useState<string>('');
    const [model, setModel] = useState<string>('');
    const [topK, setTopK] = useState(4);
    const [temperature, setTemperature] = useState(0.2);
    const [showBackends, setShowBackends] = useState(false);

    const [query, setQuery] = useState('');
    const [asking, setAsking] = useState(false);
    const [result, setResult] = useState<QueryResult | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { navigate('/signin'); return; }
        Promise.all([apiGet('/api/rag/backends'), apiGet('/api/rag/kb')])
            .then(([bl, kl]) => {
                setBackends(bl.backends || []);
                setEmbedders(bl.embedders || []);
                setRecommended(bl.recommended || 'cloud');
                setBackend(bl.recommended || 'cloud');
                const rec = (bl.backends || []).find((b: Backend) => b.key === (bl.recommended || 'cloud'));
                setModel(rec?.default_model || '');
                setKbs(kl.knowledge_bases || []);
            })
            .catch((e) => showToast('Failed to load RAG: ' + (e instanceof Error ? e.message : String(e)), 'error'))
            .finally(() => setLoading(false));
    }, [user, authLoading, navigate]);

    const refreshKbs = () => apiGet('/api/rag/kb').then((d) => setKbs(d.knowledge_bases || [])).catch(() => { });
    const selectKb = (id: number) => {
        apiGet(`/api/rag/kb/${id}`).then((d) => { setSelected(d.knowledge_base); setResult(null); }).catch(() => { });
    };

    const createKb = async () => {
        const body: Record<string, unknown> = { name: newName.trim() || 'Knowledge Base' };
        if (!isBeginner) body.embedder = newEmbedder;
        const d = await apiPost('/api/rag/kb', body);
        if (d.error) { showToast(d.error, 'error'); return; }
        setNewName('');
        await refreshKbs();
        selectKb(d.knowledge_base.id);
        showToast('Knowledge base created', 'success');
    };

    const deleteKb = async (kb: KB) => {
        if (!confirm(`Delete "${kb.name}" and all its documents?`)) return;
        const res = await fetch(`/api/rag/kb/${kb.id}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok) { showToast('Delete failed', 'error'); return; }
        if (selected?.id === kb.id) setSelected(null);
        refreshKbs();
        showToast('Deleted', 'success');
    };

    const uploadDocs = async (files: FileList) => {
        if (!selected) return;
        setUploading(true);
        const fd = new FormData();
        Array.from(files).forEach((f) => fd.append('file', f));
        try {
            const res = await fetch(`/api/rag/kb/${selected.id}/documents`, { method: 'POST', credentials: 'include', body: fd });
            const data = await res.json();
            if (!res.ok || data.error) { showToast(data.error || `Upload failed (HTTP ${res.status})`, 'error'); return; }
            setSelected(data.knowledge_base);
            refreshKbs();
            showToast(`Added ${data.added.length} document${data.added.length === 1 ? '' : 's'}`, 'success');
        } catch (e) {
            showToast('Upload failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
    };

    const ask = async () => {
        if (!selected || !query.trim()) return;
        setAsking(true); setResult(null);
        try {
            const body: Record<string, unknown> = { query: query.trim(), top_k: topK, temperature };
            if (!isBeginner) { body.backend = backend; body.model = model || undefined; }
            const res = await fetch(`/api/rag/kb/${selected.id}/query`, {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || data.error) { showToast(data.error || `Query failed (HTTP ${res.status})`, 'error'); return; }
            setResult(data);
        } catch (e) {
            showToast('Query failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally { setAsking(false); }
    };

    const pickBackend = (b: Backend) => {
        setBackend(b.key);
        setModel(b.default_model);
        setShowBackends(false);
        if (!b.available) showToast(`${b.label} isn't installed yet — ${b.setup}`, 'warning');
    };

    if (authLoading || loading) return <div className="page-header"><h1>Loading assistant…</h1></div>;

    const activeBackend = backends.find((b) => b.key === backend);

    return (
        <>
            <div className="page-header">
                <h1>Knowledge <em>Assistant.</em></h1>
                <p>Upload documents and ask questions — answers are grounded in your files (RAG) with citations.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: '1.25rem', alignItems: 'start' }}>
                {/* ── Knowledge bases ── */}
                <div className="glass-panel">
                    <div className="panel-title"><span className="pt-icon"><Database size={16} style={{ verticalAlign: 'middle' }} /></span> Knowledge bases</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.9rem' }}>
                        {kbs.length === 0 && <p className="text-muted" style={{ fontSize: '0.84rem' }}>None yet — create one below.</p>}
                        {kbs.map((kb) => (
                            <div key={kb.id}
                                onClick={() => selectKb(kb.id)}
                                style={{
                                    cursor: 'pointer', padding: '0.6rem 0.7rem', borderRadius: 10,
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    background: selected?.id === kb.id ? 'rgba(139,92,246,0.14)' : 'rgba(255,255,255,0.03)',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem',
                                }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kb.name}</div>
                                    <div className="text-muted" style={{ fontSize: '0.72rem' }}>{kb.n_docs} docs · {kb.n_chunks} chunks · {kb.embedder}</div>
                                </div>
                                <button className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}
                                    onClick={(e) => { e.stopPropagation(); deleteKb(kb); }} title="Delete"><Trash2 size={13} /></button>
                            </div>
                        ))}
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.8rem' }}>
                        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New knowledge base name"
                            onKeyDown={(e) => { if (e.key === 'Enter') createKb(); }} style={{ ...inputStyle, marginBottom: '0.5rem' }} />
                        {!isBeginner && (
                            <select value={newEmbedder} onChange={(e) => setNewEmbedder(e.target.value)} style={{ ...inputStyle, marginBottom: '0.5rem' }}>
                                {embedders.map((em) => (
                                    <option key={em.key} value={em.key} disabled={!em.available}>
                                        {em.label}{em.available ? '' : ' — not installed'}
                                    </option>
                                ))}
                            </select>
                        )}
                        <button className="btn btn-primary btn-sm" onClick={createKb} style={{ width: '100%' }}>
                            <Plus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Create
                        </button>
                    </div>
                </div>

                {/* ── Workspace ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0 }}>
                    {!selected ? (
                        <div className="glass-panel" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📚</div>
                            <h3>Pick or create a knowledge base</h3>
                            <p className="text-muted" style={{ fontSize: '0.88rem' }}>Then upload documents and start asking questions.</p>
                        </div>
                    ) : (
                        <>
                            {/* documents */}
                            <div className="glass-panel">
                                <div className="flex-between mb-1">
                                    <div className="panel-title mb-0"><span className="pt-icon"><FileText size={15} style={{ verticalAlign: 'middle' }} /></span> {selected.name}</div>
                                    <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
                                        {uploading ? <Loader2 size={14} className="chat-msg__spinner" style={{ marginRight: 4, verticalAlign: 'middle' }} /> : <Upload size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                                        Add documents
                                        <input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.csv,.pdf" style={{ display: 'none' }}
                                            onChange={(e) => { if (e.target.files?.length) uploadDocs(e.target.files); }} />
                                    </label>
                                </div>
                                {selected.documents && selected.documents.length > 0 ? (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                        {selected.documents.map((d) => (
                                            <span key={d.id} className="bento-tag bento-tag-sm" title={`${d.char_count} chars · ${d.chunk_count} chunks`}>
                                                📄 {d.filename}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-muted" style={{ fontSize: '0.84rem' }}>No documents yet. Add .txt, .md, .csv{embedders.length ? ', or .pdf' : ''} files to ground answers.</p>
                                )}
                            </div>

                            {/* backend selection (expert) or note (novice) */}
                            {!isBeginner ? (
                                <div className="glass-panel">
                                    <div className="flex-between mb-1">
                                        <div className="panel-title mb-0"><span className="pt-icon">{activeBackend?.local ? <Cpu size={15} style={{ verticalAlign: 'middle' }} /> : <Cloud size={15} style={{ verticalAlign: 'middle' }} />}</span> Generation backend</div>
                                        <button className="btn btn-secondary btn-sm" onClick={() => setShowBackends((s) => !s)}>
                                            {activeBackend?.label || backend} <ChevronDown size={13} style={{ verticalAlign: 'middle' }} />
                                        </button>
                                    </div>
                                    {showBackends && (
                                        <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.8rem' }}>
                                            {backends.map((b) => (
                                                <div key={b.key} onClick={() => pickBackend(b)}
                                                    style={{
                                                        cursor: 'pointer', padding: '0.7rem 0.85rem', borderRadius: 10,
                                                        border: `1px solid ${backend === b.key ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.1)'}`,
                                                        background: backend === b.key ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.02)',
                                                    }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <strong style={{ fontSize: '0.92rem' }}>{b.label}</strong>
                                                        {b.recommended && <span className="bento-tag bento-tag-sm">★ recommended</span>}
                                                        <span className="bento-tag bento-tag-sm" style={{ background: b.available ? 'rgba(34,197,94,0.15)' : 'rgba(245,166,35,0.15)' }}>
                                                            {b.available ? '● available' : '○ not installed'}
                                                        </span>
                                                        <span className="text-muted" style={{ fontSize: '0.74rem' }}>{b.tagline}</span>
                                                    </div>
                                                    <div className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>{b.description}</div>
                                                    <div style={{ fontSize: '0.76rem', marginTop: '0.25rem' }}><strong>Use when:</strong> {b.use_when}</div>
                                                    {!b.available && <div className="text-muted" style={{ fontSize: '0.74rem', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>↳ {b.setup}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.6rem' }}>
                                        <div>
                                            <label style={{ fontSize: '0.74rem', fontWeight: 600 }}>Model</label>
                                            <input value={model} onChange={(e) => setModel(e.target.value)} list="rag-models" style={inputStyle} />
                                            <datalist id="rag-models">{(activeBackend?.models || []).map((m) => <option key={m} value={m} />)}</datalist>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.74rem', fontWeight: 600 }}>Top-k passages</label>
                                            <input type="number" min={1} max={12} value={topK} onChange={(e) => setTopK(Number(e.target.value))} style={inputStyle} />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.74rem', fontWeight: 600 }}>Temperature</label>
                                            <input type="number" min={0} max={1.5} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} style={inputStyle} />
                                        </div>
                                    </div>
                                    {activeBackend && !activeBackend.available && (
                                        <div className="info-banner" style={{ borderLeft: '3px solid #f5a623', marginTop: '0.7rem' }}>
                                            <span className="info-banner-icon">⚠️</span>
                                            <div>{activeBackend.label} isn't installed. {activeBackend.setup} — or switch to a ● available backend.</div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="info-banner">
                                    <span className="info-banner-icon">🤖</span>
                                    <div>Answers are generated with <strong>{backends.find((b) => b.key === recommended)?.label || 'the recommended model'}</strong> and grounded in this knowledge base. Switch to Expert mode to choose a local model (MLX, Ollama, …).</div>
                                </div>
                            )}

                            {/* ask */}
                            <div className="glass-panel">
                                <div className="panel-title"><span className="pt-icon">💬</span> Ask</div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask a question about your documents…"
                                        onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} style={inputStyle} disabled={selected.n_chunks === 0} />
                                    <button className="btn btn-primary btn-sm" onClick={ask} disabled={asking || !query.trim() || selected.n_chunks === 0}>
                                        {asking ? <Loader2 size={15} className="chat-msg__spinner" /> : <Send size={15} />}
                                    </button>
                                </div>
                                {selected.n_chunks === 0 && <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Add documents first.</p>}

                                {result && (
                                    <div style={{ marginTop: '1rem' }}>
                                        <div className="markdown-body" style={{ fontSize: '0.92rem', lineHeight: 1.6 }}>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
                                        </div>
                                        {result.citations.length > 0 && (
                                            <div style={{ marginTop: '0.8rem' }}>
                                                <div className="text-muted" style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Sources</div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                    {result.citations.map((c) => (
                                                        <div key={c.n} style={{ fontSize: '0.8rem', padding: '0.45rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
                                                            <strong>[{c.n}] {c.doc_name}</strong> <span className="text-muted">· score {c.score}</span>
                                                            <div className="text-muted" style={{ marginTop: '0.2rem' }}>{c.preview}…</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="text-muted" style={{ fontSize: '0.72rem', marginTop: '0.6rem' }}>
                                            Generated by {result.backend} · {result.model}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
};

export default Rag;
