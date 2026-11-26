import React, { useEffect, useRef } from 'react';

// ── The VortexML mark, drawn in particles ───────────────────────────────────
// The geometry is the logo's own (Logo.tsx, 64-unit viewBox): an outer ring of
// radius 23 open at the top, an inner ring of radius 13.5 open at the bottom,
// a core of radius 4.6, all turned 18°. Particles orbit along each ring and
// fade through the openings, so the mark holds its shape while it turns.
//
// On load the particles gather from a loose cloud into the mark (the one
// orchestrated moment of the page). The cursor parts them and tilts the mark
// slightly in 3D. Reduced motion: the settled mark, drawn once.

type P = {
    kind: 0 | 1 | 2 | 3;      // 0 outer ring, 1 inner ring, 2 core, 3 drifting dust
    a: number;                 // angle (rad)
    r: number;                 // radius, logo units
    z: number;                 // depth, logo units
    sx: number; sy: number;    // intro start, logo units
    delay: number;             // intro delay (s)
    size: number;              // px at 1x
    sprite: number;            // index into sprites
    tw: number;                // twinkle phase
    ox: number; oy: number;    // pointer displacement (px), eased
};

const DEG = Math.PI / 180;
const TURN = 18 * DEG;
const OUTER = { r: 23, from: -45 * DEG, to: 225 * DEG, speed: 0.16 };
const INNER = { r: 13.5, from: 135 * DEG, to: 405 * DEG, speed: -0.26 };
const CORE_R = 4.6;
const FADE = 22 * DEG;          // fade length at each end of an arc
const INTRO = 1.9;              // seconds

// Visible fraction of a particle at angle `a` on an arc [from, to]
const arcAlpha = (a: number, from: number, to: number) => {
    const span = to - from;
    let t = (a - from) % (Math.PI * 2);
    if (t < 0) t += Math.PI * 2;
    if (t > span) return 0;
    return Math.min(1, t / FADE, (span - t) / FADE);
};

const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Soft round dots, pre-rendered once: violet, light violet, near-white.
const makeSprites = () => ['140,134,252', '183,185,255', '238,238,255'].map((rgb) => {
    const s = 32;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.35, `rgba(${rgb},0.55)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return c;
});

const VortexField: React.FC<{ className?: string; label?: string }> = ({ className, label }) => {
    const wrap = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const box = wrap.current;
        const canvas = canvasRef.current;
        if (!box || !canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const DPR = Math.min(window.devicePixelRatio || 1, 2);
        const sprites = makeSprites();

        // ── Particles ──
        const count = coarse ? 1100 : 2000;
        const parts: P[] = [];
        for (let i = 0; i < count; i++) {
            const roll = Math.random();
            const kind: P['kind'] = roll < 0.5 ? 0 : roll < 0.8 ? 1 : roll < 0.88 ? 2 : 3;
            const ring = kind === 0 ? OUTER : INNER;
            const a = Math.random() * Math.PI * 2;
            let r = 0;
            if (kind === 0 || kind === 1) {
                // Most sit on the stroke; a few stray to give it a halo.
                const spread = Math.random() < 0.85 ? 1.1 : 3.2;
                r = ring.r + gauss() * spread;
            } else if (kind === 2) {
                r = Math.abs(gauss()) * CORE_R * 0.55;
            } else {
                r = 8 + Math.random() * 30;
            }
            const sa = Math.random() * Math.PI * 2;
            const sr = 20 + Math.random() * 26;
            parts.push({
                kind, a, r,
                z: gauss() * (kind === 3 ? 8 : 1.6),
                sx: Math.cos(sa) * sr, sy: Math.sin(sa) * sr,
                delay: Math.random() * 0.55,
                size: kind === 2 ? 1.6 + Math.random() * 2.2 : kind === 3 ? 0.8 + Math.random() * 1.1 : 1 + Math.random() * 1.9,
                sprite: kind === 2 ? 2 : Math.random() < 0.18 ? 2 : Math.random() < 0.5 ? 1 : 0,
                tw: Math.random() * Math.PI * 2,
                ox: 0, oy: 0,
            });
        }

        // ── Size ──
        let W = 0, H = 0, unit = 1;
        const resize = () => {
            const rect = box.getBoundingClientRect();
            W = rect.width; H = rect.height;
            canvas.width = Math.max(1, Math.floor(W * DPR));
            canvas.height = Math.max(1, Math.floor(H * DPR));
            canvas.style.width = `${W}px`;
            canvas.style.height = `${H}px`;
            // The outer ring plus its halo fills ~88% of the shorter side.
            unit = (Math.min(W, H) / 2) / 29;
            if (reduce || !running) draw(reduce ? INTRO + 1 : time);
        };

        // ── Pointer: parts particles and tilts the mark ──
        const pointer = { x: -1e4, y: -1e4, nx: 0, ny: 0 };
        const tilt = { x: 0, y: 0 };
        const onMove = (e: PointerEvent) => {
            const rect = box.getBoundingClientRect();
            pointer.x = e.clientX - rect.left;
            pointer.y = e.clientY - rect.top;
            pointer.nx = Math.max(-1, Math.min(1, (pointer.x - W / 2) / (W / 2)));
            pointer.ny = Math.max(-1, Math.min(1, (pointer.y - H / 2) / (H / 2)));
        };
        const onLeave = () => { pointer.x = pointer.y = -1e4; pointer.nx = pointer.ny = 0; };

        // ── Draw one frame at time t (s) ──
        const ease = (x: number) => 1 - Math.pow(1 - x, 4);
        const draw = (t: number) => {
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            ctx.clearRect(0, 0, W, H);
            ctx.globalCompositeOperation = 'lighter';

            const cx = W / 2, cy = H / 2;
            // Resting 3D attitude, nudged by the pointer
            tilt.x += ((0.22 + pointer.ny * 0.22) - tilt.x) * 0.06;
            tilt.y += ((pointer.nx * 0.32) - tilt.y) * 0.06;
            const cX = Math.cos(tilt.x), sX = Math.sin(tilt.x);
            const cY = Math.cos(tilt.y), sY = Math.sin(tilt.y);
            const focal = 140; // logo units
            const breathe = 1 + Math.sin(t * 0.9) * 0.012;

            const plot = (p: P, x0: number, y0: number, alpha: number, time: number) => {
                // Intro: gather from the cloud
                const k = reduce ? 1 : ease(Math.min(1, Math.max(0, (time - p.delay) / (INTRO - 0.4))));
                const lx = p.sx + (x0 - p.sx) * k;
                const ly = p.sy + (y0 - p.sy) * k;
                const lz = p.z;
                // Rotate around X then Y, then project
                const y1 = ly * cX - lz * sX;
                const z1 = ly * sX + lz * cX;
                const x2 = lx * cY + z1 * sY;
                const z2 = -lx * sY + z1 * cY;
                const persp = focal / (focal + z2);
                let px = cx + x2 * unit * persp;
                let py = cy + y1 * unit * persp;

                // Pointer: push away, then ease back
                const dx = px - pointer.x, dy = py - pointer.y;
                const d2 = dx * dx + dy * dy;
                const reach = 110;
                let tx = 0, ty = 0;
                if (d2 < reach * reach) {
                    const d = Math.sqrt(d2) || 1;
                    const f = Math.pow(1 - d / reach, 2) * 26;
                    tx = (dx / d) * f; ty = (dy / d) * f;
                }
                p.ox += (tx - p.ox) * 0.12;
                p.oy += (ty - p.oy) * 0.12;
                px += p.ox; py += p.oy;

                const twinkle = 0.75 + Math.sin(time * 2 + p.tw) * 0.25;
                const fadeIn = reduce ? 1 : Math.min(1, Math.max(0, (time - p.delay) / 0.6));
                ctx.globalAlpha = Math.max(0, Math.min(1, alpha * twinkle * fadeIn * (0.55 + 0.45 * persp)));
                const s = p.size * 3.2 * persp;
                ctx.drawImage(sprites[p.sprite], px - s / 2, py - s / 2, s, s);
            };

            for (const p of parts) {
                let angle = p.a, alpha = 1;
                if (p.kind === 0) {
                    angle = p.a + t * OUTER.speed;
                    alpha = arcAlpha(angle, OUTER.from, OUTER.to);
                } else if (p.kind === 1) {
                    angle = p.a + t * INNER.speed;
                    alpha = arcAlpha(angle, INNER.from, INNER.to);
                } else if (p.kind === 2) {
                    angle = p.a + t * 0.6;
                } else {
                    // Dust spirals inward and starts again at the edge
                    const life = ((t * 0.035 + p.delay) % 1);
                    const rr = p.r * (1 - life * 0.75);
                    angle = p.a + t * 0.12 + life * 2.2;
                    alpha = Math.sin(life * Math.PI) * 0.45;
                    const x0 = Math.cos(angle + TURN) * rr, y0 = Math.sin(angle + TURN) * rr;
                    plot(p, x0, y0, alpha, t);
                    continue;
                }
                if (alpha <= 0.01) continue;
                const rr = p.r * breathe;
                const x0 = Math.cos(angle + TURN) * rr;
                const y0 = Math.sin(angle + TURN) * rr;
                plot(p, x0, y0, alpha, t);
            }

            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        };

        // ── Loop: only while on screen and the tab is visible ──
        let raf = 0, running = false, visible = true, onScreen = true;
        let time = 0, last = 0;
        const frame = (now: number) => {
            const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
            last = now;
            time += dt;
            draw(time);
            raf = requestAnimationFrame(frame);
        };
        const sync = () => {
            const should = !reduce && visible && onScreen;
            if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
            if (!should && running) { running = false; cancelAnimationFrame(raf); }
        };

        const ro = new ResizeObserver(resize);
        ro.observe(box);
        resize();

        const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); });
        io.observe(box);
        const onVis = () => { visible = document.visibilityState === 'visible'; sync(); };
        document.addEventListener('visibilitychange', onVis);
        if (!coarse) {
            window.addEventListener('pointermove', onMove, { passive: true });
            document.documentElement.addEventListener('pointerleave', onLeave);
        }
        if (reduce) draw(INTRO + 1);
        sync();

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('pointermove', onMove);
            document.documentElement.removeEventListener('pointerleave', onLeave);
        };
    }, []);

    return (
        <div ref={wrap} className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
            <canvas ref={canvasRef} style={{ display: 'block' }} />
        </div>
    );
};

export default VortexField;
