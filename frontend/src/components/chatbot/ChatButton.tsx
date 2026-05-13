import React from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useChat } from './ChatContext';

const ChatButton: React.FC = () => {
    const { isOpen, toggle, isAvailable } = useChat();
    if (!isAvailable) return null;
    return (
        <button
            type="button"
            onClick={toggle}
            className={`chat-fab ${isOpen ? 'chat-fab--open' : ''}`}
            aria-label={isOpen ? 'Close tutor' : 'Open tutor'}
            title={isOpen ? 'Close tutor' : 'Ask the tutor'}
        >
            {isOpen ? <X size={22} /> : <MessageCircle size={22} />}
        </button>
    );
};

export default ChatButton;
