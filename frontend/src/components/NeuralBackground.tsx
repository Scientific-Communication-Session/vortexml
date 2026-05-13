import React, { useEffect, useRef } from 'react';

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
}

const NeuralBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        let animationFrameId = 0;
        let particles: Particle[] = [];
        let running = true;
        // Cap DPR to keep large monitors performant; 2 is plenty for these soft dots
        const DPR = Math.min(window.devicePixelRatio || 1, 2);

        // Tuned configuration — slightly fewer particles, slower drift = smoother feel
        const baseCount = 88;
        const isCoarse = window.matchMedia('(pointer: coarse)').matches;
        const particleCount = isCoarse ? 56 : baseCount;
        const connectionDistance = 148;
        const mouseRadius = 200;
        const mouseConnDist = connectionDistance * 1.5;

        const mouse = { x: -1e4, y: -1e4 };

        const resize = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            canvas.width = Math.floor(w * DPR);
            canvas.height = Math.floor(h * DPR);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
            initParticles(w, h);
        };

        const initParticles = (w: number, h: number) => {
            particles = [];
            for (let i = 0; i < particleCount; i++) {
                particles.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    vx: prefersReducedMotion ? 0 : (Math.random() - 0.5) * 0.85,
                    vy: prefersReducedMotion ? 0 : (Math.random() - 0.5) * 0.85,
                    radius: Math.random() * 1.6 + 0.9,
                });
            }
        };

        const draw = () => {
            if (!running) return;
            const w = window.innerWidth;
            const h = window.innerHeight;
            ctx.clearRect(0, 0, w, h);

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];

                p.x += p.vx;
                p.y += p.vy;

                // Wrap softly rather than hard bounce — visually smoother
                if (p.x < -10) p.x = w + 10;
                else if (p.x > w + 10) p.x = -10;
                if (p.y < -10) p.y = h + 10;
                else if (p.y > h + 10) p.y = -10;

                // Mouse push interaction (eased)
                const dx = mouse.x - p.x;
                const dy = mouse.y - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < mouseRadius && dist > 0.001) {
                    const force = (mouseRadius - dist) / mouseRadius;
                    const pushFactor = 2.4 * force; // ease-in by squaring via force multiplier
                    p.x -= (dx / dist) * pushFactor;
                    p.y -= (dy / dist) * pushFactor;
                }

                // Particle dot
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(167, 139, 250, 0.55)';
                ctx.fill();

                // Inter-particle connections
                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const ddx = p.x - p2.x;
                    const ddy = p.y - p2.y;
                    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
                    if (dd < connectionDistance) {
                        const alpha = 0.16 * (1 - dd / connectionDistance);
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(139, 92, 246, ${alpha})`;
                        ctx.lineWidth = 1;
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }
                }

                // Mouse connections
                if (dist < mouseConnDist) {
                    const alpha = 0.32 * (1 - dist / mouseConnDist);
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`;
                    ctx.lineWidth = 1.2;
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.stroke();
                }
            }

            animationFrameId = requestAnimationFrame(draw);
        };

        const handleMouseMove = (e: MouseEvent) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        };

        const handleMouseLeave = () => {
            mouse.x = -1e4;
            mouse.y = -1e4;
        };

        const handleVisibility = () => {
            if (document.hidden) {
                running = false;
                cancelAnimationFrame(animationFrameId);
            } else if (!running) {
                running = true;
                animationFrameId = requestAnimationFrame(draw);
            }
        };

        window.addEventListener('resize', resize);
        window.addEventListener('mousemove', handleMouseMove, { passive: true });
        window.addEventListener('mouseleave', handleMouseLeave);
        document.addEventListener('visibilitychange', handleVisibility);

        resize();
        animationFrameId = requestAnimationFrame(draw);

        return () => {
            running = false;
            window.removeEventListener('resize', resize);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
            document.removeEventListener('visibilitychange', handleVisibility);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none z-0"
            style={{ background: 'transparent' }}
            aria-hidden="true"
        />
    );
};

export default NeuralBackground;
