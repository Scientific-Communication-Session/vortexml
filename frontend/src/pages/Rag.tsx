import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Database, Plus, Upload, Send, Trash2, Loader2, FileText, Cpu, Cloud, ChevronDown, Server, Download, Check, Gauge } from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

interface Backend {
    key: string; label: string; tagline: string; description: string; use_when: string;
    local: boolean; available: boolean; default_model: string; models: string[]; model_labels?: Record<string, string>; setup: string; recommended: boolean;
}
interface Embedder { key: string; label: string; description: string; available: boolean; }
interface DocItem { id: number; filename: string; char_count: number; chunk_count: number; }
interface KB { id: number; name: string; embedder: string; chunk_size: number; overlap: number; n_docs: number; n_chunks: number; documents?: DocItem[]; }
interface Citation { n: number; doc_name: string; score: number; preview: string; }
interface Chunk { n: number; doc_name: string; score: number; text: string; }
interface GenStats { tokens?: number; gen_time?: number; tokens_per_second?: number | null; }
interface QueryResult { answer: string; citations: Citation[]; chunks: Chunk[]; backend: string; model: string; stats?: GenStats | null; }
interface RagDevice { id: number; nickname: string; is_shared: boolean; online?: boolean; status?: string; }
interface CatalogModel { id: string; downloaded: boolean; size_bytes: number | null; }
interface CatalogEntry { backend: string; label: string; available: boolean; default_model: string; models: CatalogModel[]; }
interface InstalledModel { id: string; size_bytes: number | null; }
interface Installed { hf: InstalledModel[]; ollama: InstalledModel[]; }
interface LiveStats { cpu_percent?: number; gpu_percent?: number; ram_percent?: number; cpu_temp?: number; gpu_temp?: number; }

const fmtSize = (b: number | null) => (b ? `${(b / 1e9).toFixed(1)} GB` : '');

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

    // device + model catalog ("run on your hardware")
    const [devices, setDevices] = useState<RagDevice[]>([]);
    const [deviceId, setDeviceId] = useState<number | null>(null); // null = shared M4
    const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
    const [catalogOnline, setCatalogOnline] = useState(true);
    const [installed, setInstalled] = useState<Installed>({ hf: [], ollama: [] });
    const [downloading, setDownloading] = useState<string | null>(null);
    const [downloadStatus, setDownloadStatus] = useState<string>('');
    const [deleting, setDeleting] = useState<string | null>(null);
    const [customBackend, setCustomBackend] = useState('mlx');
    const [customModel, setCustomModel] = useState('');

    // live hardware stats (streamed during a query / download)
    const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
    const socketRef = useRef<Socket | null>(null);

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

    // Socket for live download progress + hardware stats + remote answers.
    useEffect(() => {
        if (isBeginner) return;  // device/stats UI is expert-only
        const s = io();
        socketRef.current = s;
        s.on('rag_stats', (d: LiveStats) => setLiveStats(d));
        s.on('rag_download', (d: { status: string }) => setDownloadStatus(d.status));
        s.on('rag_download_complete', (d: { catalog?: CatalogEntry[]; installed?: Installed }) => {
            setDownloading(null); setDownloadStatus('');
            if (d.catalog) setCatalog(d.catalog);
            if (d.installed) setInstalled(d.installed);
            showToast('Model downloaded', 'success');
        });
        s.on('rag_download_error', (d: { error: string }) => { setDownloading(null); setDownloadStatus(''); showToast(d.error, 'error'); });
        s.on('rag_answer', (d: QueryResult) => { setResult(d); setAsking(false); setLiveStats(null); });
        s.on('rag_error', (d: { error: string }) => { setAsking(false); setLiveStats(null); showToast(d.error, 'error'); });
        return () => { s.disconnect(); socketRef.current = null; };
    }, [isBeginner]);

    // Load devices (expert) and the model catalog for the chosen device.
    useEffect(() => {
        if (isBeginner || !user) return;
        apiGet('/api/rag/devices').then((d) => setDevices(d.devices || [])).catch(() => { });
    }, [isBeginner, user]);

    useEffect(() => {
        if (isBeginner) return;
        const id = deviceId ?? devices.find((d) => d.is_shared)?.id;
        if (id == null) return;
        apiGet(`/api/rag/devices/${id}/models`)
            .then((d) => { setCatalog(d.catalog || []); setInstalled(d.installed || { hf: [], ollama: [] }); setCatalogOnline(d.online !== false); })
            .catch(() => { setCatalog([]); setInstalled({ hf: [], ollama: [] }); setCatalogOnline(false); });
    }, [deviceId, devices, isBeginner]);

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
        setAsking(true); setResult(null); setLiveStats(null);
        try {
            const body: Record<string, unknown> = { query: query.trim(), top_k: topK, temperature };
            if (!isBeginner) {
                body.backend = backend; body.model = model || undefined;
                body.device_id = deviceId; body.socket_id = socketRef.current?.id;
            }
            const res = await fetch(`/api/rag/kb/${selected.id}/query`, {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || data.error) { showToast(data.error || `Query failed (HTTP ${res.status})`, 'error'); setAsking(false); return; }
            if (data.mode === 'remote') return;  // answer arrives via the rag_answer socket event
            setResult(data); setAsking(false); setLiveStats(null);
        } catch (e) {
            showToast('Query failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
            setAsking(false);
        }
    };

    const resolvedDeviceId = () => deviceId ?? devices.find((d) => d.is_shared)?.id ?? null;

    const downloadModel = async (be: string, mdl: string) => {
        const id = resolvedDeviceId();
        if (id == null || !mdl.trim()) return;
        setDownloading(mdl); setDownloadStatus('Starting…');
        const d = await apiPost(`/api/rag/devices/${id}/models/download`, { backend: be, model: mdl.trim(), socket_id: socketRef.current?.id });
        if (d.error) { setDownloading(null); showToast(d.error, 'error'); }
    };

    const deleteModel = async (be: string, mdl: string) => {
        const id = resolvedDeviceId();
        if (id == null) return;
        if (!confirm(`Delete ${mdl} from this device? You can re-download it later.`)) return;
        setDeleting(mdl);
        try {
            const res = await fetch(`/api/rag/devices/${id}/models`, {
                method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backend: be, model: mdl }),
            });
            const d = await res.json();
            if (!res.ok || d.error) { showToast(d.error || `Delete failed (HTTP ${res.status})`, 'error'); return; }
            if (d.catalog) setCatalog(d.catalog);
            if (d.installed) setInstalled(d.installed);
            showToast(`Deleted ${mdl}`, 'success');
        } catch (e) {
            showToast('Delete failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally { setDeleting(null); }
    };

    const selectModel = (be: string, mdl: string) => { setBackend(be); setModel(mdl); showToast(`Using ${mdl}`, 'success'); };

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
                                        <input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.pdf,.docx,.xlsx,.xls,.pptx,.rtf" style={{ display: 'none' }}
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
                                    <p className="text-muted" style={{ fontSize: '0.84rem' }}>No documents yet. Add text, Word, Excel, PowerPoint, PDF, HTML, Markdown, CSV/JSON, or RTF files to ground answers.</p>
                                )}
                            </div>

                            {/* device + model catalog ("run on your hardware") — expert */}
                            {!isBeginner && (
                                <div className="glass-panel">
                                    <div className="panel-title"><span className="pt-icon"><Server size={15} style={{ verticalAlign: 'middle' }} /></span> Run on your hardware</div>
                                    <p className="text-muted mb-2" style={{ fontSize: '0.84rem' }}>Pick a device, then see the models stored on it and download more. Generation runs there; retrieval stays here.</p>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                                        {devices.map((d) => {
                                            const active = (deviceId ?? devices.find((x) => x.is_shared)?.id) === d.id;
                                            return (
                                                <button key={d.id} onClick={() => setDeviceId(d.id)}
                                                    className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}>
                                                    {d.is_shared ? '🖥️' : '💻'} {d.nickname}
                                                    <span style={{ marginLeft: 6, opacity: 0.8 }}>{d.online === false ? '○' : '●'}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {!catalogOnline && <div className="info-banner" style={{ borderLeft: '3px solid #f5a623' }}><span className="info-banner-icon">⚠️</span><div>This device is offline or hasn't reported its models yet — start its node agent.</div></div>}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                                        {catalog.map((cat) => (
                                            <div key={cat.backend}>
                                                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                                                    {cat.label} <span className="text-muted" style={{ fontWeight: 400 }}>{cat.available ? '· runtime ready' : '· runtime not installed'}</span>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                                    {cat.models.map((m) => (
                                                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
                                                            <div style={{ minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {m.downloaded ? <Check size={12} style={{ color: '#22c55e', verticalAlign: 'middle', marginRight: 4 }} /> : null}{m.id}
                                                                {m.size_bytes ? <span className="text-muted"> · {fmtSize(m.size_bytes)}</span> : null}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                                                                {m.downloaded ? (
                                                                    <>
                                                                        <button className="btn btn-secondary btn-sm" disabled={!cat.available} onClick={() => selectModel(cat.backend, m.id)}>Use</button>
                                                                        <button className="btn btn-danger btn-sm" disabled={deleting === m.id} title="Delete to reclaim disk" onClick={() => deleteModel(cat.backend, m.id)}>
                                                                            {deleting === m.id ? <Loader2 size={12} className="chat-msg__spinner" /> : <Trash2 size={12} />}
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <button className="btn btn-secondary btn-sm" disabled={downloading === m.id} onClick={() => downloadModel(cat.backend, m.id)}>
                                                                        {downloading === m.id ? <Loader2 size={12} className="chat-msg__spinner" /> : <Download size={12} />}
                                                                        <span style={{ marginLeft: 4 }}>{downloading === m.id ? 'Downloading' : 'Download'}</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {downloading && downloadStatus && <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>⏳ {downloadStatus}</div>}

                                    {/* download any custom model */}
                                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.8rem', paddingTop: '0.8rem' }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Download a custom model</div>
                                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                            <select value={customBackend} onChange={(e) => setCustomBackend(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                                                {catalog.map((c) => <option key={c.backend} value={c.backend}>{c.label}</option>)}
                                            </select>
                                            <input value={customModel} onChange={(e) => setCustomModel(e.target.value)}
                                                placeholder={customBackend === 'ollama' ? 'e.g. qwen2.5:7b' : customBackend === 'llama_cpp' ? 'repo:file.gguf' : 'e.g. mlx-community/Qwen2.5-7B-Instruct-4bit'}
                                                onKeyDown={(e) => { if (e.key === 'Enter' && customModel.trim()) { downloadModel(customBackend, customModel); setCustomModel(''); } }}
                                                style={{ ...inputStyle, flex: 1, minWidth: 200, fontFamily: 'var(--font-mono)' }} />
                                            <button className="btn btn-secondary btn-sm" disabled={!customModel.trim() || downloading === customModel.trim()}
                                                onClick={() => { downloadModel(customBackend, customModel); setCustomModel(''); }}>
                                                <Download size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Download
                                            </button>
                                        </div>
                                    </div>

                                    {/* everything stored on this device */}
                                    {(installed.hf.length > 0 || installed.ollama.length > 0) && (
                                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '0.8rem', paddingTop: '0.8rem' }}>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                                                Installed on this device <span className="text-muted" style={{ fontWeight: 400 }}>· {installed.hf.length + installed.ollama.length} models</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                                {[...installed.hf.map((m) => ({ ...m, source: 'transformers' })), ...installed.ollama.map((m) => ({ ...m, source: 'ollama' }))].map((m) => (
                                                    <div key={m.source + m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
                                                        <div style={{ minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {m.id}{m.size_bytes ? <span className="text-muted"> · {fmtSize(m.size_bytes)}</span> : null}
                                                            <span className="text-muted"> · {m.source === 'ollama' ? 'Ollama' : 'HF'}</span>
                                                        </div>
                                                        <button className="btn btn-danger btn-sm" disabled={deleting === m.id} title="Delete to reclaim disk"
                                                            onClick={() => deleteModel(m.source, m.id)} style={{ flexShrink: 0 }}>
                                                            {deleting === m.id ? <Loader2 size={12} className="chat-msg__spinner" /> : <Trash2 size={12} />}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

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
                                            <datalist id="rag-models">{(activeBackend?.models || []).map((m) => <option key={m} value={m}>{activeBackend?.model_labels?.[m] || m}</option>)}</datalist>
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

                                {/* live hardware stats while generating (expert) */}
                                {!isBeginner && asking && liveStats && (
                                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.7rem', padding: '0.5rem 0.7rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                                        <span className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}><Gauge size={12} style={{ verticalAlign: 'middle' }} /> live</span>
                                        <Stat label="CPU" v={liveStats.cpu_percent} suffix="%" />
                                        <Stat label="GPU" v={liveStats.gpu_percent} suffix="%" />
                                        <Stat label="RAM" v={liveStats.ram_percent} suffix="%" />
                                        <Stat label="CPU °C" v={liveStats.cpu_temp} suffix="°" />
                                        <Stat label="GPU °C" v={liveStats.gpu_temp} suffix="°" />
                                    </div>
                                )}

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
                                            {result.stats?.tokens_per_second != null && (
                                                <> · <strong>{result.stats.tokens_per_second} tok/s</strong>
                                                    {result.stats.tokens != null ? ` (${result.stats.tokens} tokens` : ''}
                                                    {result.stats.gen_time != null ? ` in ${result.stats.gen_time}s)` : result.stats.tokens != null ? ')' : ''}</>
                                            )}
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

const Stat: React.FC<{ label: string; v?: number; suffix: string }> = ({ label, v, suffix }) => (
    <span style={{ fontSize: '0.78rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{v == null ? '—' : Math.round(v) + suffix}</span>
        <span className="text-muted" style={{ marginLeft: 4 }}>{label}</span>
    </span>
);

export default Rag;
