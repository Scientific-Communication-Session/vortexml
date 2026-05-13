import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
    title: string;
    body: string;
    onClose: () => void;
}

const HelpModal: React.FC<Props> = ({ title, body, onClose }) => {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = originalOverflow;
        };
    }, [onClose]);

    // Portal to <body> so the modal is never trapped by an ancestor with
    // transform/filter/will-change (which create a new containing block for
    // position:fixed descendants). The arch-card uses transform on :hover,
    // which is exactly what broke the inline render.
    return createPortal(
        <div
            className="help-modal-backdrop"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-modal-title"
        >
            <div className="help-modal" onClick={(e) => e.stopPropagation()}>
                <div className="help-modal-header">
                    <h3 id="help-modal-title" className="help-modal-title">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="help-modal-close"
                        aria-label="Close help"
                    >
                        <X size={18} strokeWidth={2.2} />
                    </button>
                </div>
                <p className="help-modal-body">{body}</p>
            </div>
        </div>,
        document.body,
    );
};

export default HelpModal;
