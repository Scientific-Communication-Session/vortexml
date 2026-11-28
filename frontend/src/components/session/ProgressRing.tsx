import React from 'react';

interface Props {
    /** 0–100. */
    value: number;
    size?: number;
    stroke?: number;
    /** Show the percentage in the middle. */
    label?: boolean;
    /** Radiating pulse for a run that is live right now. */
    pulse?: boolean;
    color?: string;
    /** What is progressing, for screen readers. */
    name?: string;
}

const ProgressRing: React.FC<Props> = ({
    value, size = 22, stroke = 3, label = false, pulse = false, color, name = 'Training progress',
}) => {
    const pct = Math.max(0, Math.min(100, value || 0));
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    return (
        <span
            className={`vx-ring ${pulse ? 'vx-ring--pulse' : ''}`}
            style={{ width: size, height: size }}
            role="progressbar"
            aria-label={name}
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                <circle className="vx-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
                <circle
                    className="vx-ring__value"
                    cx={size / 2} cy={size / 2} r={r}
                    strokeWidth={stroke}
                    style={{ stroke: color || 'var(--color-accent)' }}
                    strokeDasharray={c}
                    strokeDashoffset={c * (1 - pct / 100)}
                />
            </svg>
            {label && (
                <span className="vx-ring__label" style={{ fontSize: Math.max(9, size * 0.24) }}>
                    {Math.round(pct)}%
                </span>
            )}
        </span>
    );
};

export default ProgressRing;
