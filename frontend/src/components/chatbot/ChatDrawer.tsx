import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Trash2, Loader2 } from 'lucide-react';
import { useChat } from './ChatContext';

const ChatDrawer: React.FC = () => {
    const { messages, isOpen, isSending, isAvailable, close, sendMessage, clear } = useChat();
    const [draft, setDraft] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to latest message
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isSending]);

    // Focus the input when the drawer opens
    useEffect(() => {
        if (isOpen) {
            const t = setTimeout(() => inputRef.current?.focus(), 220);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    if (!isAvailable) return null;

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!draft.trim() || isSending) return;
        const text = draft;
        setDraft('');
        sendMessage(text);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <aside className={`chat-drawer ${isOpen ? 'chat-drawer--open' : ''}`} aria-hidden={!isOpen}>
            <header className="chat-drawer__header">
                <div className="chat-drawer__title">
                    <span className="chat-drawer__title-icon">🌿</span>
                    <div>
                        <div className="chat-drawer__title-main">Novice Tutor</div>
                        <div className="chat-drawer__title-sub">Powered by Claude</div>
                    </div>
                </div>
                <div className="chat-drawer__actions">
                    <button
                        type="button"
                        onClick={clear}
                        title="Clear conversation"
                        aria-label="Clear conversation"
                        className="chat-drawer__icon-btn"
                    >
                        <Trash2 size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={close}
                        title="Close"
                        aria-label="Close"
                        className="chat-drawer__icon-btn"
                    >
                        <X size={18} />
                    </button>
                </div>
            </header>

            <div className="chat-drawer__messages" ref={scrollRef}>
                {messages.map((m, i) => (
                    <div
                        key={i}
                        className={`chat-msg chat-msg--${m.role}`}
                    >
                        <div className="chat-msg__bubble">{m.content}</div>
                    </div>
                ))}
                {isSending && (
                    <div className="chat-msg chat-msg--assistant">
                        <div className="chat-msg__bubble chat-msg__bubble--typing">
                            <Loader2 size={14} className="chat-msg__spinner" />
                            <span>Thinking…</span>
                        </div>
                    </div>
                )}
            </div>

            <form className="chat-drawer__input" onSubmit={handleSubmit}>
                <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about epochs, loss, or anything ML…"
                    rows={2}
                    disabled={isSending}
                />
                <button
                    type="submit"
                    disabled={!draft.trim() || isSending}
                    aria-label="Send"
                    title="Send (Enter)"
                >
                    {isSending ? <Loader2 size={16} className="chat-msg__spinner" /> : <Send size={16} />}
                </button>
            </form>
        </aside>
    );
};

export default ChatDrawer;
