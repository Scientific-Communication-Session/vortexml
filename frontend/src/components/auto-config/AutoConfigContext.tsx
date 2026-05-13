import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface AutoConfigMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface AutoConfigEarlyStopping {
    enabled: boolean;
    patience?: number;
    min_delta?: number;
}

export interface AutoConfigProposal {
    arch_type: string;
    layer_sizes: number[];
    epochs: number;
    lr: number;
    batch_size: number;
    optimizer: string;
    activation: string;
    early_stopping: AutoConfigEarlyStopping;
    justification: string;
}

interface AutoConfigContextValue {
    messages: AutoConfigMessage[];
    isOpen: boolean;
    isAvailable: boolean;
    unavailableReason: string | null;
    isSending: boolean;
    isDeciding: boolean;
    proposal: AutoConfigProposal | null;
    error: string | null;
    open: () => void;
    close: () => void;
    toggle: () => void;
    sendMessage: (text: string) => Promise<void>;
    generateConfig: () => Promise<void>;
    applyProposal: () => void;
    clear: () => void;
}

const GREETING: AutoConfigMessage = {
    role: 'assistant',
    content: "Describe your problem in a few words — what do you want the model to predict?",
};

const AutoConfigContext = createContext<AutoConfigContextValue>({
    messages: [GREETING],
    isOpen: false,
    isAvailable: false,
    unavailableReason: null,
    isSending: false,
    isDeciding: false,
    proposal: null,
    error: null,
    open: () => { },
    close: () => { },
    toggle: () => { },
    sendMessage: async () => { },
    generateConfig: async () => { },
    applyProposal: () => { },
    clear: () => { },
});

// eslint-disable-next-line react-refresh/only-export-components
export const useAutoConfig = () => useContext(AutoConfigContext);

interface ProviderProps {
    onApply: (config: AutoConfigProposal) => void;
    children: React.ReactNode;
}

export const AutoConfigProvider: React.FC<ProviderProps> = ({ onApply, children }) => {
    const [messages, setMessages] = useState<AutoConfigMessage[]>([GREETING]);
    const [isOpen, setIsOpen] = useState(false);
    const [isAvailable, setIsAvailable] = useState(false);
    const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [isDeciding, setIsDeciding] = useState(false);
    const [proposal, setProposal] = useState<AutoConfigProposal | null>(null);
    const [error, setError] = useState<string | null>(null);
    const sendingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/auto-config/status', { credentials: 'include' });
                const data = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (res.ok && data.available) {
                    setIsAvailable(true);
                    setUnavailableReason(null);
                } else {
                    setIsAvailable(false);
                    setUnavailableReason(data.reason || 'Auto-Configure is unavailable.');
                }
            } catch {
                if (cancelled) return;
                setIsAvailable(false);
                setUnavailableReason('Could not reach the Auto-Configure service.');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen(v => !v), []);

    const clear = useCallback(() => {
        setMessages([GREETING]);
        setProposal(null);
        setError(null);
    }, []);

    const sendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || sendingRef.current || !isAvailable) return;

        sendingRef.current = true;
        setIsSending(true);
        setError(null);

        const userMsg: AutoConfigMessage = { role: 'user', content: trimmed };
        const next = [...messages, userMsg];
        setMessages(next);

        const wire = next
            .filter(m => m !== GREETING)
            .map(m => ({ role: m.role, content: m.content }));

        try {
            const res = await fetch('/api/auto-config/chat', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: wire }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessages(prev => [
                    ...prev,
                    { role: 'assistant', content: `⚠️ ${data.error || `Auto-Configure error (HTTP ${res.status}).`}` },
                ]);
            } else {
                setMessages(prev => [
                    ...prev,
                    { role: 'assistant', content: data.content || '(no reply)' },
                ]);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setMessages(prev => [
                ...prev,
                { role: 'assistant', content: `⚠️ Network error: ${msg}` },
            ]);
        } finally {
            sendingRef.current = false;
            setIsSending(false);
        }
    }, [messages, isAvailable]);

    const generateConfig = useCallback(async () => {
        if (isDeciding || !isAvailable) return;
        setIsDeciding(true);
        setError(null);
        setProposal(null);

        const wire = messages
            .filter(m => m !== GREETING)
            .map(m => ({ role: m.role, content: m.content }));

        try {
            const res = await fetch('/api/auto-config/decide', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: wire }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || `Auto-Configure error (HTTP ${res.status}).`);
            } else if (data.config) {
                setProposal(data.config as AutoConfigProposal);
            } else {
                setError('Picker returned an empty configuration.');
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(`Network error: ${msg}`);
        } finally {
            setIsDeciding(false);
        }
    }, [messages, isDeciding, isAvailable]);

    const applyProposal = useCallback(() => {
        if (!proposal) return;
        onApply(proposal);
        setIsOpen(false);
    }, [proposal, onApply]);

    const value: AutoConfigContextValue = {
        messages,
        isOpen,
        isAvailable,
        unavailableReason,
        isSending,
        isDeciding,
        proposal,
        error,
        open,
        close,
        toggle,
        sendMessage,
        generateConfig,
        applyProposal,
        clear,
    };

    return <AutoConfigContext.Provider value={value}>{children}</AutoConfigContext.Provider>;
};
