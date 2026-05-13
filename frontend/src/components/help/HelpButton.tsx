import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import HelpModal from './HelpModal';
import { HELP_TOPICS, type HelpTopic } from './help-content';

interface Props {
    topic: HelpTopic;
    size?: number;
    className?: string;
}

const HelpButton: React.FC<Props> = ({ topic, size = 14, className }) => {
    const [open, setOpen] = useState(false);
    const entry = HELP_TOPICS[topic];
    if (!entry) return null;

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(true);
                }}
                title={entry.title}
                aria-label={`Help: ${entry.title}`}
                className={`help-button ${className ?? ''}`}
            >
                <HelpCircle size={size} strokeWidth={2} />
            </button>
            {open && <HelpModal title={entry.title} body={entry.body} onClose={() => setOpen(false)} />}
        </>
    );
};

export default HelpButton;
