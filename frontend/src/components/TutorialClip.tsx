import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import './tutorial-clip.css';

// ── A recorded clip, shown in a browser frame ───────────────────────────────
// The (heavy) GIF is only fetched once the clip scrolls into view; until then,
// and for visitors who prefer reduced motion, a still frame stands in.
//
// `playing` / `onToggle` hand the play state to a caller that sequences several
// clips (the home-page walkthrough); left out, the clip keeps its own.
const TutorialClip: React.FC<{
    name: string;
    url: string;
    alt: string;
    caption?: React.ReactNode;
    playing?: boolean;
    onToggle?: () => void;
}> = ({ name, url, alt, caption, playing: controlled, onToggle }) => {
    const ref = useRef<HTMLDivElement>(null);
    // Without IntersectionObserver there is nothing to wait for — load right away.
    const [inView, setInView] = useState(() => !('IntersectionObserver' in window));
    const [own, setOwn] = useState(
        () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    );
    const playing = controlled ?? own;

    useEffect(() => {
        const el = ref.current;
        if (!el || !('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); }
        }, { rootMargin: '200px' });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <figure className="tt-clip" ref={ref}>
            <div className="tt-clip__bar">
                <span className="tt-clip__dots"><i /><i /><i /></span>
                <span className="tt-clip__url">{url}</span>
                <button
                    type="button"
                    className="tt-clip__toggle"
                    onClick={onToggle ?? (() => setOwn((p) => !p))}
                >
                    {playing ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Play</>}
                </button>
            </div>
            <div className="tt-clip__stage">
                <img
                    src={inView && playing ? `/tutorial/${name}.gif` : `/tutorial/${name}.png`}
                    alt={alt}
                    width={880}
                    height={550}
                    loading="lazy"
                />
            </div>
            <figcaption className="tt-clip__caption">
                {caption ?? 'Recorded from the running app — no mock-ups.'}
            </figcaption>
        </figure>
    );
};

export default TutorialClip;
