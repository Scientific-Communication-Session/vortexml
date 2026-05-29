import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus, Send, Trash2, Loader2, MessageSquare, Cpu, Pencil } from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';

interface Backend { key: string; label: string; available: boolean; default_model: string; models: string[]; }
interface KB { id: number; name: string; }
interface RDevice { id: number; nickname: string; is_shared: boolean; online?: boolean; }
interface Conversation { id: number; title: string; backend: string; model: string | null; device_id: number | null; kb_id: number | null; }
interface Citation { n: number; doc_name: string; score: number; preview: string; }
interface Msg { id?: number; role: string; content: string; tokens_per_second?: number | null; model?: string | null; citations?: Citation[] | null; streaming?: boolean; }
interface LiveStats { cpu_percent?: number; gpu_percent?: number; ram_percent?: number; cpu_temp?: number; gpu_temp?: number; }

const inputStyle: React.CSSProperties = {
    padding: '0.45rem 0.6rem', borderRadius: 8, background: 'rgba(255,255,255,0.05)',
    color: 'inherit', border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.85rem',
};

const Chat: React.FC = () => {
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();
    const isBeginner = user?.is_beginner === true;

    const [backends, setBackends] = useState<Backend[]>([]);
    const [recommended, setRecommended] = useState('cloud');
    const [devices, setDevices] = useState<RDevice[]>([]);
    const [kbs, setKbs] = useState<KB[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [messages, setMessages] = useState<Msg[]>([]);
    const [loading, setLoading] = useState(true);

    const [settings, setSettings] = useState<{ backend: string; model: string; deviceId: number | null; kbId: number | null }>(
        { backend: 'cloud', model: '', deviceId: null, kbId: null });

    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState('');

    const socketRef = useRef<Socket | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { navigate('/signin'); return; }
        Promise.all([apiGet('/api/rag/backends'), apiGet('/api/conversations'), apiGet('/api/rag/kb')])
            .then(([bl, cl, kl]) => {
                setBackends(bl.backends || []);
                setRecommended(bl.recommended || 'cloud');
                const rec = (bl.backends || []).find((b: Backend) => b.key === (bl.recommended || 'cloud'));
                setSettings((s) => ({ ...s, backend: bl.recommended || 'cloud', model: rec?.default_model || '' }));
                setConversations(cl.conversations || []);
                setKbs(kl.knowledge_bases || []);
            })
            .catch((e) => showToast('Failed to load chat: ' + (e instanceof Error ? e.message : String(e)), 'error'))
            .finally(() => setLoading(false));
        if (!isBeginner) apiGet('/api/rag/devices').then((d) => setDevices(d.devices || [])).catch(() => { });
    }, [user, authLoading, navigate, isBeginner]);

    // Socket: remote answers + live hardware stats.
    useEffect(() => {
        if (!user) return;
        const s = io();
        socketRef.current = s;
        s.on('chat_token', (d: { delta: string }) => setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.streaming) {
                const copy = m.slice();
                copy[copy.length - 1] = { ...last, content: last.content + d.delta };
                return copy;
            }
            return [...m, { role: 'assistant', content: d.delta, streaming: true }];
        }));
        s.on('chat_answer', (d: { message: Msg }) => {
            setMessages((m) => {
                const last = m[m.length - 1];
                if (last && last.streaming) { const copy = m.slice(); copy[copy.length - 1] = d.message; return copy; }
                return [...m, d.message];
            });
            setSending(false); setLiveStats(null);
        });
        s.on('chat_error', (d: { error: string }) => {
            setMessages((m) => (m[m.length - 1]?.streaming ? m.slice(0, -1) : m));
            setSending(false); setLiveStats(null); showToast(d.error, 'error');
        });
        s.on('rag_stats', (d: LiveStats) => setLiveStats(d));
        return () => { s.disconnect(); socketRef.current = null; };
    }, [user]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, sending]);

    const newChat = async () => {
        const d = await apiPost('/api/conversations', {
            backend: settings.backend, model: settings.model || undefined,
            device_id: settings.deviceId, kb_id: settings.kbId,
        });
        if (d.error) { showToast(d.error, 'error'); return; }
        setConversations((c) => [d.conversation, ...c]);
        setActiveId(d.conversation.id);
        setMessages([]);
    };

    const openConversation = async (id: number) => {
        const d = await apiGet(`/api/conversations/${id}`);
        const c: Conversation & { messages: Msg[] } = d.conversation;
        setActiveId(id);
        setMessages(c.messages || []);
        setSettings({ backend: c.backend, model: c.model || '', deviceId: c.device_id, kbId: c.kb_id });
    };

    const deleteConversation = async (id: number) => {
        if (!confirm('Delete this conversation?')) return;
        await fetch(`/api/conversations/${id}`, { method: 'DELETE', credentials: 'include' });
        setConversations((c) => c.filter((x) => x.id !== id));
        if (activeId === id) { setActiveId(null); setMessages([]); }
    };

    const renameConversation = async (id: number) => {
        const title = editTitle.trim();
        setEditingId(null);
        if (!title) return;
        setConversations((c) => c.map((x) => (x.id === id ? { ...x, title } : x)));
        fetch(`/api/conversations/${id}`, {
            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        }).catch(() => { });
    };

    // Persist a settings change onto the active conversation.
    const patchSettings = (patch: Partial<typeof settings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        if (activeId != null) {
            fetch(`/api/conversations/${activeId}`, {
                method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backend: next.backend, model: next.model || null, device_id: next.deviceId, kb_id: next.kbId }),
            }).catch(() => { });
        }
    };

    const send = async () => {
        const text = input.trim();
        if (!text || sending) return;
        let convId = activeId;
        if (convId == null) {  // first message → create the conversation
            const d = await apiPost('/api/conversations', {
                backend: settings.backend, model: settings.model || undefined,
                device_id: settings.deviceId, kb_id: settings.kbId,
            });
            if (d.error) { showToast(d.error, 'error'); return; }
            convId = d.conversation.id;
            setConversations((c) => [d.conversation, ...c]);
            setActiveId(convId);
        }
        setInput('');
        // optimistic user bubble + an empty assistant placeholder that fills as
        // tokens stream in (chat_token), then is finalized by chat_answer.
        setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }]);
        setSending(true); setLiveStats(null);
        try {
            const res = await fetch(`/api/conversations/${convId}/message`, {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text, socket_id: socketRef.current?.id }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                showToast(data.error || `Chat failed (HTTP ${res.status})`, 'error');
                setMessages((m) => (m[m.length - 1]?.streaming ? m.slice(0, -1) : m));
                setSending(false); return;
            }
            if (data.title) setConversations((c) => c.map((x) => (x.id === convId ? { ...x, title: data.title } : x)));
            // The reply (streamed or whole) arrives over the socket.
        } catch (e) {
            showToast('Chat failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
            setMessages((m) => (m[m.length - 1]?.streaming ? m.slice(0, -1) : m));
            setSending(false);
        }
    };

    if (authLoading || loading) return <div className="page-header"><h1>Loading chat…</h1></div>;

    const activeBackend = backends.find((b) => b.key === settings.backend);

    return (
        <>
            <div className="page-header">
                <h1>Chat <em>with your models.</em></h1>
                <p>Have a conversation with a local or cloud model — optionally grounded in your documents.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(210px, 260px) 1fr', gap: '1.25rem', alignItems: 'start' }}>
                {/* sidebar */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <button className="btn btn-primary btn-sm" onClick={newChat} style={{ width: '100%' }}>
                        <Plus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} /> New chat
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '60vh', overflowY: 'auto' }}>
                        {conversations.length === 0 && <p className="text-muted" style={{ fontSize: '0.82rem' }}>No conversations yet.</p>}
                        {conversations.map((c) => (
                            <div key={c.id} onClick={() => openConversation(c.id)}
                                style={{
                                    cursor: 'pointer', padding: '0.5rem 0.6rem', borderRadius: 8,
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem',
                                    background: activeId === c.id ? 'rgba(139,92,246,0.14)' : 'transparent',
                                    border: '1px solid ' + (activeId === c.id ? 'rgba(139,92,246,0.3)' : 'transparent'),
                                }}>
                                {editingId === c.id ? (
                                    <input autoFocus value={editTitle} onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        onBlur={() => renameConversation(c.id)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') renameConversation(c.id); if (e.key === 'Escape') setEditingId(null); }}
                                        style={{ ...inputStyle, flex: 1, padding: '0.2rem 0.4rem', fontSize: '0.82rem' }} />
                                ) : (
                                    <span title="Double-click to rename"
                                        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditTitle(c.title); }}
                                        style={{ minWidth: 0, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <MessageSquare size={13} style={{ flexShrink: 0, opacity: 0.7 }} />{c.title}
                                    </span>
                                )}
                                <div style={{ display: 'flex', gap: '0.15rem', flexShrink: 0 }}>
                                    <button className="btn btn-secondary btn-sm" style={{ padding: '0.2rem' }} title="Rename"
                                        onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditTitle(c.title); }}><Pencil size={11} /></button>
                                    <button className="btn btn-secondary btn-sm" style={{ padding: '0.2rem' }} title="Delete"
                                        onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}><Trash2 size={12} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* main */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '72vh' }}>
                    {/* settings bar */}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', paddingBottom: '0.7rem', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '0.7rem' }}>
                        {!isBeginner ? (
                            <>
                                <select value={settings.backend} onChange={(e) => { const b = backends.find((x) => x.key === e.target.value); patchSettings({ backend: e.target.value, model: b?.default_model || '' }); }} style={inputStyle}>
                                    {backends.map((b) => <option key={b.key} value={b.key} disabled={!b.available}>{b.label}{b.available ? '' : ' (not installed)'}</option>)}
                                </select>
                                <input value={settings.model} onChange={(e) => patchSettings({ model: e.target.value })} list="chat-models" placeholder="model" style={{ ...inputStyle, width: 200 }} />
                                <datalist id="chat-models">{(activeBackend?.models || []).map((m) => <option key={m} value={m} />)}</datalist>
                                {devices.length > 1 && (
                                    <select value={settings.deviceId ?? ''} onChange={(e) => patchSettings({ deviceId: e.target.value ? Number(e.target.value) : null })} style={inputStyle} title="Run on">
                                        <option value="">🖥️ Shared M4</option>
                                        {devices.filter((d) => !d.is_shared).map((d) => <option key={d.id} value={d.id}>💻 {d.nickname}</option>)}
                                    </select>
                                )}
                            </>
                        ) : (
                            <span className="text-muted" style={{ fontSize: '0.82rem' }}>Chatting with <strong>{backends.find((b) => b.key === recommended)?.label}</strong></span>
                        )}
                        <select value={settings.kbId ?? ''} onChange={(e) => patchSettings({ kbId: e.target.value ? Number(e.target.value) : null })} style={inputStyle} title="Ground answers in a knowledge base">
                            <option value="">No documents</option>
                            {kbs.map((k) => <option key={k.id} value={k.id}>📚 {k.name}</option>)}
                        </select>
                    </div>

                    {/* messages */}
                    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.9rem', paddingRight: '0.3rem' }}>
                        {messages.length === 0 && !sending && (
                            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted, #9d9dba)' }}>
                                <div style={{ fontSize: '2.5rem' }}>💬</div>
                                <p>Ask anything to start the conversation.</p>
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={m.id != null ? `m${m.id}` : `i${i}`} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                                <div style={{
                                    maxWidth: '80%', padding: '0.7rem 0.95rem', borderRadius: 14, fontSize: '0.92rem', lineHeight: 1.5,
                                    background: m.role === 'user' ? 'rgba(139,92,246,0.22)' : 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}>
                                    {m.role === 'user' ? (
                                        <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                                    ) : m.streaming && !m.content ? (
                                        <span className="text-muted"><Loader2 size={14} className="chat-msg__spinner" style={{ verticalAlign: 'middle' }} /> Thinking…</span>
                                    ) : (
                                        <div className="markdown-body">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content + (m.streaming ? ' ▍' : '')}</ReactMarkdown>
                                        </div>
                                    )}
                                    {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                                        <div className="text-muted" style={{ fontSize: '0.74rem', marginTop: '0.4rem' }}>
                                            Sources: {m.citations.map((c) => `[${c.n}] ${c.doc_name}`).join('  ')}
                                        </div>
                                    )}
                                    {m.role === 'assistant' && !isBeginner && m.tokens_per_second != null && (
                                        <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.3rem' }}>{m.model} · {m.tokens_per_second} tok/s</div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {sending && !isBeginner && liveStats && (
                            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <span className="text-muted" style={{ fontSize: '0.74rem', display: 'inline-flex', gap: '0.7rem', alignItems: 'center' }}>
                                    <Cpu size={12} style={{ verticalAlign: 'middle' }} />
                                    {liveStats.cpu_percent != null && <span>CPU {Math.round(liveStats.cpu_percent)}%</span>}
                                    {liveStats.gpu_percent != null && <span>GPU {Math.round(liveStats.gpu_percent)}%</span>}
                                    {liveStats.cpu_temp != null && <span>{Math.round(liveStats.cpu_temp)}°C</span>}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* composer */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
                        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
                            placeholder="Message your model…  (Enter to send, Shift+Enter for newline)"
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                            style={{ ...inputStyle, flex: 1, resize: 'none', fontSize: '0.92rem' }} />
                        <button className="btn btn-primary" onClick={send} disabled={sending || !input.trim()}>
                            {sending ? <Loader2 size={16} className="chat-msg__spinner" /> : <Send size={16} />}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Chat;
