import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatContextValue {
    messages: ChatMessage[];
    isOpen: boolean;
    isSending: boolean;
    isAvailable: boolean;
    unavailableReason: string | null;
    open: () => void;
    close: () => void;
    toggle: () => void;
    sendMessage: (text: string) => Promise<void>;
    openWithQuestion: (text: string) => Promise<void>;
    clear: () => void;
}

const ChatContext = createContext<ChatContextValue>({
    messages: [],
    isOpen: false,
    isSending: false,
    isAvailable: false,
    unavailableReason: null,
    open: () => { },
    close: () => { },
    toggle: () => { },
    sendMessage: async () => { },
    openWithQuestion: async () => { },
    clear: () => { },
});

// eslint-disable-next-line react-refresh/only-export-components
export const useChat = () => useContext(ChatContext);

const GREETING: ChatMessage = {
    role: 'assistant',
    content:
        "Hi! I'm your VortexML tutor. Ask me anything about machine-learning concepts (epochs, loss, learning rate…) or how to use this app. " +
        "Click any 💬 icon next to a setting to ask about that specific thing.",
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, isLoading: authLoading } = useAuth();
    const isBeginner = user?.is_beginner === true;

    const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
    const [isOpen, setIsOpen] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isAvailable, setIsAvailable] = useState(false);
    const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
    const sendingRef = useRef(false);

    // Probe availability once auth resolves and user is a novice.
    useEffect(() => {
        if (authLoading) return;
        if (!isBeginner) {
            setIsAvailable(false);
            setUnavailableReason(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/chat/status', { credentials: 'include' });
                const data = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (res.ok && data.available) {
                    setIsAvailable(true);
                    setUnavailableReason(null);
                } else {
                    setIsAvailable(false);
                    setUnavailableReason(data.reason || 'Chatbot unavailable.');
                }
            } catch {
                if (cancelled) return;
                setIsAvailable(false);
                setUnavailableReason('Could not reach the chatbot service.');
            }
        })();
        return () => { cancelled = true; };
    }, [isBeginner, authLoading]);

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    const toggle = useCallback(() => setIsOpen((v) => !v), []);
    const clear = useCallback(() => setMessages([GREETING]), []);

    const sendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || sendingRef.current) return;
        if (!isAvailable) return;

        sendingRef.current = true;
        setIsSending(true);
        const userMsg: ChatMessage = { role: 'user', content: trimmed };
        const nextHistory = [...messages.filter((m) => m !== GREETING || messages.length === 1 ? true : true), userMsg];
        // Always append user message; keep greeting at the top for context display
        const wireHistory = [...messages, userMsg]
            .filter((m) => m !== GREETING) // don't forward the local greeting to the API
            .map((m) => ({ role: m.role, content: m.content }));

        setMessages([...messages, userMsg]);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: wireHistory }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'assistant',
                        content: `⚠️ ${data.error || `Chatbot error (HTTP ${res.status}).`}`,
                    },
                ]);
            } else {
                setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: data.content || '(no reply)' },
                ]);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: `⚠️ Network error: ${msg}` },
            ]);
        } finally {
            sendingRef.current = false;
            setIsSending(false);
            // mute unused-var lint for `nextHistory`
            void nextHistory;
        }
    }, [messages, isAvailable]);

    const openWithQuestion = useCallback(async (text: string) => {
        setIsOpen(true);
        await sendMessage(text);
    }, [sendMessage]);

    const value: ChatContextValue = {
        messages,
        isOpen,
        isSending,
        isAvailable,
        unavailableReason,
        open,
        close,
        toggle,
        sendMessage,
        openWithQuestion,
        clear,
    };

    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
