import React from 'react';
import { Sparkles } from 'lucide-react';
import { useChat } from './ChatContext';
import { HELP_TOPICS, type HelpTopic } from '../help/help-content';

interface Props {
    topic: HelpTopic;
    /** Optional override question. If omitted, derived from the topic title. */
    question?: string;
    size?: number;
    className?: string;
}

const AskButton: React.FC<Props> = ({ topic, question, size = 14, className }) => {
    const { isAvailable, openWithQuestion } = useChat();
    const entry = HELP_TOPICS[topic];
    if (!isAvailable || !entry) return null;

    const q = question ?? `Can you explain "${entry.title}" to me in simple terms — what it does, when to care about it, and what value is sensible for a first run?`;

    return (
        <button
            type="button"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openWithQuestion(q);
            }}
            title={`Ask the tutor about ${entry.title}`}
            aria-label={`Ask the tutor about ${entry.title}`}
            className={`ask-button ${className ?? ''}`}
        >
            <Sparkles size={size} strokeWidth={2} />
        </button>
    );
};

export default AskButton;
