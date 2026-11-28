import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { clipUrl } from './tutorialClips';
import './tutorial-clip.css';

// ── A recorded clip, shown in a browser frame ───────────────────────────────
// A short silent video that behaves like a GIF: it plays by itself and loops.
// It is only fetched and played while it is on screen (a page can hold a dozen
// of them); until then, and for visitors who prefer reduced motion, its first
// frame stands in.
//
// `playing` / `onToggle` hand the play state to a caller that sequences several
// clips (the home-page walkthrough). With `onEnded` the clip plays once and
// reports back instead of looping.
const TutorialClip: React.FC<{
    name: string;
    url: string;
    alt: string;
    caption?: React.ReactNode;
    playing?: boolean;
    onToggle?: () => void;
    onEnded?: () => void;
    onDuration?: (seconds: number) => void;
}> = ({ name, url, alt, caption, playing: controlled, onToggle, onEnded, onDuration }) => {
    const ref = useRef<HTMLElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    // Without IntersectionObserver there is nothing to wait for — play right away.
    // (`window` is absent while the build prerenders the page: wait there.)
    const [inView, setInView] = useState(() => typeof window !== 'undefined' && !('IntersectionObserver' in window));
    const [own, setOwn] = useState(
        () => typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    );
    const playing = controlled ?? own;
    // The poster (the clip's first frame) is only worth downloading once the
    // clip is about a screen away; the frame keeps its shape meanwhile.
    const [near, setNear] = useState(() => typeof window !== 'undefined' && !('IntersectionObserver' in window));

    useEffect(() => {
        const el = ref.current;
        if (!el || !('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver(
            (entries) => setInView(entries.some((e) => e.isIntersecting)),
            { threshold: 0.2 },
        );
        const ahead = new IntersectionObserver(
            (entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); ahead.disconnect(); } },
            { rootMargin: '100% 0px' },
        );
        io.observe(el);
        ahead.observe(el);
        return () => { io.disconnect(); ahead.disconnect(); };
    }, []);

    useEffect(() => {
        const v = video.current;
        if (!v) return;
        // play() rejects if the browser refuses autoplay or the clip is swapped
        // mid-load; the Play button is still there, so there is nothing to do.
        if (playing && inView) v.play().catch(() => {});
        else v.pause();
    }, [playing, inView, name]);

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
                <video
                    ref={video}
                    src={clipUrl(`${name}.mp4`)}
                    poster={near ? clipUrl(`${name}.webp`) : undefined}
                    aria-label={alt}
                    width={1600}
                    height={1000}
                    muted
                    playsInline
                    loop={!onEnded}
                    preload="none"
                    onEnded={onEnded}
                    onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration)}
                />
            </div>
            <figcaption className="tt-clip__caption">
                {caption ?? 'Recorded from the running app — no mock-ups.'}
            </figcaption>
        </figure>
    );
};

export default TutorialClip;
