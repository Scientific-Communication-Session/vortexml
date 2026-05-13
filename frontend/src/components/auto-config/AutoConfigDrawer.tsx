import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Trash2, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { useAutoConfig } from './AutoConfigContext';

const ARCH_LABELS: Record<string, string> = {
    mlp: 'Multi-Layer Perceptron',
    dnn: 'Deep Neural Network',
    cnn1d: '1D Convolutional Network',
    rnn: 'Recurrent Neural Network',
    lstm: 'Long Short-Term Memory',
    gru: 'Gated Recurrent Unit',
    autoencoder: 'Autoencoder',
    resnet: 'Residual Network',
    transformer: 'Transformer',
    wide_deep: 'Wide & Deep Network',
};

const AutoConfigDrawer: React.FC = () => {
    const {
        messages, isOpen, isSending, isDeciding,
        isAvailable, unavailableReason, proposal, error,
        close, sendMessage, generateConfig, applyProposal, clear,
    } = useAutoConfig();
    const [draft, setDraft] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isSending, isDeciding, proposal, error]);

    useEffect(() => {
        if (isOpen) {
            const t = setTimeout(() => inputRef.current?.focus(), 220);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!draft.trim() || isSending) return;
        const text = draft;
        setDraft('');
        sendMessage(text);
    };

    const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const userHasDescribed = messages.some(m => m.role === 'user');
    const inputsDisabled = !isAvailable || isSending || isDeciding;

    return (
        <aside
            className={`chat-drawer auto-config-drawer ${isOpen ? 'chat-drawer--open' : ''}`}
            aria-hidden={!isOpen}
        >
            <header className="chat-drawer__header auto-config-drawer__header">
                <div className="chat-drawer__title">
                    <span className="chat-drawer__title-icon">🪄</span>
                    <div>
                        <div className="chat-drawer__title-main">AI Auto-Configure</div>
                        <div className="chat-drawer__title-sub">Two-bot model selection</div>
                    </div>
                </div>
                <div className="chat-drawer__actions">
                    <button
                        type="button"
                        onClick={clear}
                        title="Reset conversation"
                        aria-label="Reset conversation"
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
                {!isAvailable && unavailableReason && (
                    <div className="chat-msg chat-msg--assistant">
                        <div className="chat-msg__bubble">⚠️ {unavailableReason}</div>
                    </div>
                )}

                {messages.map((m, i) => (
                    <div key={i} className={`chat-msg chat-msg--${m.role}`}>
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

                {isDeciding && (
                    <div className="chat-msg chat-msg--assistant">
                        <div className="chat-msg__bubble chat-msg__bubble--typing">
                            <Loader2 size={14} className="chat-msg__spinner" />
                            <span>Picker is choosing the best configuration…</span>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="chat-msg chat-msg--assistant">
                        <div className="chat-msg__bubble auto-config-error">⚠️ {error}</div>
                    </div>
                )}

                {proposal && (
                    <div className="auto-config-proposal">
                        <div className="auto-config-proposal__header">
                            <Sparkles size={14} />
                            <span>Proposed configuration</span>
                        </div>

                        <div className="auto-config-proposal__row">
                            <span className="auto-config-proposal__key">Architecture</span>
                            <span className="auto-config-proposal__val">
                                {ARCH_LABELS[proposal.arch_type] || proposal.arch_type}
                                {' '}
                                <code>{proposal.arch_type}</code>
                            </span>
                        </div>

                        <div className="auto-config-proposal__row">
                            <span className="auto-config-proposal__key">Hidden layers</span>
                            <span className="auto-config-proposal__val">
                                <code>[{proposal.layer_sizes.join(', ')}]</code>
                            </span>
                        </div>

                        <div className="auto-config-proposal__row">
                            <span className="auto-config-proposal__key">Epochs · LR · Batch</span>
                            <span className="auto-config-proposal__val">
                                <code>{proposal.epochs}</code> · <code>{proposal.lr}</code> · <code>{proposal.batch_size}</code>
                            </span>
                        </div>

                        <div className="auto-config-proposal__row">
                            <span className="auto-config-proposal__key">Optimizer · Activation</span>
                            <span className="auto-config-proposal__val">
                                <code>{proposal.optimizer}</code> · <code>{proposal.activation}</code>
                            </span>
                        </div>

                        <div className="auto-config-proposal__row">
                            <span className="auto-config-proposal__key">Early stopping</span>
                            <span className="auto-config-proposal__val">
                                {proposal.early_stopping?.enabled ? (
                                    <>
                                        on (patience <code>{proposal.early_stopping.patience}</code>,
                                        {' '}delta <code>{proposal.early_stopping.min_delta}</code>)
                                    </>
                                ) : (
                                    'off'
                                )}
                            </span>
                        </div>

                        <div className="auto-config-proposal__just">
                            “{proposal.justification}”
                        </div>

                        <button
                            type="button"
                            className="auto-config-proposal__apply"
                            onClick={applyProposal}
                        >
                            <Wand2 size={14} />
                            <span>Apply to Architect</span>
                        </button>
                    </div>
                )}
            </div>

            <form className="chat-drawer__input" onSubmit={handleSubmit}>
                <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder={isAvailable ? 'Describe your problem…' : 'Auto-Configure unavailable'}
                    rows={2}
                    disabled={inputsDisabled}
                />
                <button
                    type="submit"
                    disabled={inputsDisabled || !draft.trim()}
                    aria-label="Send"
                    title="Send (Enter)"
                >
                    {isSending ? <Loader2 size={16} className="chat-msg__spinner" /> : <Send size={16} />}
                </button>
            </form>

            <div className="auto-config-drawer__cta">
                <button
                    type="button"
                    className="auto-config-cta-btn"
                    onClick={generateConfig}
                    disabled={inputsDisabled || !userHasDescribed}
                    title={
                        !userHasDescribed
                            ? 'Describe your problem first'
                            : 'Have the AI pick the best configuration'
                    }
                >
                    {isDeciding ? (
                        <Loader2 size={14} className="chat-msg__spinner" />
                    ) : (
                        <Wand2 size={14} />
                    )}
                    <span>{proposal ? 'Regenerate Configuration' : 'Generate Configuration'}</span>
                </button>
            </div>
        </aside>
    );
};

export default AutoConfigDrawer;
