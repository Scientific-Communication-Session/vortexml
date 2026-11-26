import React, { useId } from 'react';

// The VortexML mark: two open rings turning around a core. Drawn inline (not
// an <img>) so it stays sharp at any size and can be animated by its parent.
// Keep in sync with public/logo.svg and public/favicon.svg.
const Logo: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => {
    const gradient = useId();
    return (
        <svg
            viewBox="0 0 64 64"
            width={size}
            height={size}
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <linearGradient id={gradient} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#c9cbff" />
                    <stop offset="1" stopColor="#6a5dde" />
                </linearGradient>
            </defs>
            <g fill="none" stroke={`url(#${gradient})`} strokeLinecap="round" transform="rotate(18 32 32)">
                <path d="M48.26 15.74A23 23 0 1 1 15.74 15.74" strokeWidth="5.5" />
                <path d="M22.45 41.55A13.5 13.5 0 1 1 41.55 41.55" strokeWidth="5" />
            </g>
            <circle cx="32" cy="32" r="4.6" fill={`url(#${gradient})`} />
        </svg>
    );
};

export default Logo;
