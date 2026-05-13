import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { Database, Activity, ArrowRight, Layers, Cpu } from 'lucide-react';
import NeuralBackground from '../components/NeuralBackground';
import { cn } from '../utils/cn';

// Easing — one curve, used everywhere for a unified motion language
const GLIDE = [0.22, 1, 0.36, 1] as const;

// --- Shared Reusable Animation Component ---
const FadeIn = ({
    children,
    delay = 0,
    className,
    direction = "up",
    duration = 0.9,
}: {
    children: React.ReactNode;
    delay?: number;
    className?: string;
    direction?: "up" | "down" | "left" | "right";
    duration?: number;
}) => {
    const reduce = useReducedMotion();
    const directions = {
        up: { y: 32, x: 0 },
        down: { y: -32, x: 0 },
        left: { x: 32, y: 0 },
        right: { x: -32, y: 0 },
    };
    return (
        <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, ...directions[direction] }}
            whileInView={{ opacity: 1, y: 0, x: 0 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration, delay, ease: GLIDE }}
            className={cn("will-change-[transform,opacity]", className)}
        >
            {children}
        </motion.div>
    );
};

const GlassCard = ({
    title,
    description,
    icon: Icon,
    to,
    className,
    delay = 0,
    index,
}: {
    title: string;
    description: string;
    icon: React.ElementType;
    to: string;
    className?: string;
    delay?: number;
    index?: string;
}) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: 0.9, delay, ease: GLIDE }}
            className={cn(
                "group relative flex flex-col justify-between overflow-hidden rounded-[2rem] p-8 md:p-10",
                "bg-[#0a0a16]/40 backdrop-blur-2xl border border-white/[0.07]",
                "transition-[border-color,background,box-shadow] duration-700 ease-glide",
                "hover:border-accent-2/40 hover:bg-[#0f0f24]/55",
                "shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:shadow-[0_12px_44px_rgba(139,92,246,0.18)]",
                "will-change-transform",
                className
            )}
        >
            {/* Liquid glass sheen on hover */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

            {/* Top hairline that lights up on hover */}
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-accent-2/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

            <div className="relative z-10">
                {index && (
                    <div className="mb-5 font-mono text-[10px] tracking-[0.32em] uppercase text-white/35">
                        {index}
                    </div>
                )}
                <div className="mb-7 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/10 text-white shadow-inner transition-transform duration-500 ease-glide group-hover:scale-[1.08] group-hover:-rotate-3">
                    <Icon className="h-[22px] w-[22px]" strokeWidth={1.6} />
                </div>
                <h3 className="mb-3 text-2xl md:text-[1.7rem] font-semibold tracking-[-0.025em] text-white leading-[1.1]">
                    {title}
                </h3>
                <p className="text-text-secondary leading-relaxed font-light text-[15px] max-w-[42ch]">
                    {description}
                </p>
            </div>

            <div className="relative z-10 mt-10">
                <Link
                    to={to}
                    className="group/cta inline-flex items-center gap-2 text-[13px] font-medium tracking-wide text-white/70 hover:text-white transition-colors duration-300 no-underline hover:no-underline"
                >
                    <span className="font-mono uppercase tracking-[0.16em] text-[11px]">Explore</span>
                    <span className="h-px w-6 bg-white/30 group-hover/cta:w-10 group-hover/cta:bg-white/80 transition-all duration-500 ease-glide" />
                    <ArrowRight className="h-[14px] w-[14px] transform transition-transform duration-500 ease-glide group-hover/cta:translate-x-1" strokeWidth={1.8} />
                </Link>
            </div>

            {/* Corner glow */}
            <div className="pointer-events-none absolute -bottom-10 -right-10 w-40 h-40 bg-accent-1/20 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
        </motion.div>
    );
};

const ScrollIndicator = () => {
    const reduce = useReducedMotion();
    return (
        <motion.div
            className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 opacity-60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            transition={{ delay: 1.6, duration: 1.2, ease: GLIDE }}
        >
            <span className="font-mono text-[10px] tracking-[0.32em] uppercase text-white/70">
                Scroll
            </span>
            <div className="w-px h-12 bg-gradient-to-b from-white/40 to-transparent relative overflow-hidden">
                {!reduce && (
                    <motion.div
                        className="absolute inset-x-0 top-0 h-1/2 bg-white/90"
                        animate={{ y: ["-100%", "200%"] }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
                    />
                )}
            </div>
        </motion.div>
    );
};

// Compose the wordmark — "Intelligence," (sans, tight) + italic serif "Simplified."
const HeroHeadline: React.FC = () => (
    <h1 className="text-white mb-8 leading-[0.96]">
        <span className="block font-sans font-semibold tracking-[-0.045em]"
              style={{ fontSize: 'clamp(2.6rem, 7.4vw + 0.4rem, 6.5rem)' }}>
            Intelligence,
        </span>
        <span
            className="block font-display italic font-normal tracking-[-0.015em] text-transparent bg-clip-text bg-gradient-to-r from-accent-1 via-accent-3 to-accent-4 pb-2"
            style={{ fontSize: 'clamp(3.2rem, 8.8vw + 0.4rem, 7.8rem)' }}
        >
            Simplified.
        </span>
    </h1>
);

const Eyebrow: React.FC<{ number: string; label: string }> = ({ number, label }) => (
    <div className="flex items-center gap-3 mb-7 justify-center">
        <span className="font-mono text-[11px] tracking-[0.32em] uppercase text-white/50">
            {number}
        </span>
        <span className="h-px w-10 bg-white/15" />
        <span className="font-mono text-[11px] tracking-[0.32em] uppercase text-white/50">
            {label}
        </span>
    </div>
);

const Home: React.FC = () => {
    const heroRef = useRef<HTMLDivElement>(null);
    const reduce = useReducedMotion();
    const { scrollYProgress } = useScroll({
        target: heroRef,
        offset: ["start start", "end start"]
    });

    // Parallax — keep distance modest so it never "tears"
    const yHeroText = useTransform(scrollYProgress, [0, 1], ["0%", "32%"]);
    const opacityHero = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

    return (
        <div className="relative w-full bg-bg-primary overflow-hidden selection:bg-accent-2/30">
            {/* Interactive Canvas Background */}
            <NeuralBackground />

            {/* Static gradient blobs — soft, slow drift via CSS animation */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden mix-blend-screen opacity-40">
                <div className="absolute top-[-20%] left-[-10%] w-[55%] h-[55%] rounded-full bg-accent-1/20 blur-[160px] animate-float-slow" />
                <div className="absolute bottom-[-12%] right-[-12%] w-[44%] h-[44%] rounded-full bg-accent-4/10 blur-[160px] animate-float-slow" style={{ animationDelay: '-3.5s' }} />
                <div className="absolute top-[40%] left-[55%] w-[28%] h-[28%] rounded-full bg-accent-3/10 blur-[140px] animate-shimmer-slow" />
            </div>

            {/* Subliminal grid */}
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0wIDM5LjVMMDQwIDM5LjUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIvPjxwYXRoIGQ9Ik0zOS41IDB2NDAiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIvPjwvc3ZnPg==')] opacity-[0.12] z-0 pointer-events-none" />

            <main className="relative z-10">

                {/* ─── Hero ─── */}
                <section ref={heroRef} className="relative min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-6 pt-10 pb-24">
                    <motion.div
                        style={{ y: reduce ? 0 : yHeroText, opacity: opacityHero }}
                        className="max-w-5xl mx-auto text-center flex flex-col items-center will-change-[transform,opacity]"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.9, ease: GLIDE }}
                            className="mb-9 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2 backdrop-blur-md shadow-[0_0_20px_rgba(255,255,255,0.04)]"
                        >
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-4 opacity-70" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-4" />
                            </span>
                            <span className="font-mono text-[10.5px] font-medium tracking-[0.28em] text-white/85 uppercase">
                                Vortex Engine
                            </span>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 1.0, delay: 0.08, ease: GLIDE }}
                        >
                            <HeroHeadline />
                        </motion.div>

                        <motion.p
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 1.0, delay: 0.18, ease: GLIDE }}
                            className="mx-auto max-w-[640px] text-[clamp(1rem,0.6vw+0.92rem,1.2rem)] text-text-secondary leading-[1.65] mb-12 font-light tracking-[0.005em]"
                        >
                            The most advanced visual node platform for neural networks.
                            Build, configure, and train models in a gorgeous, highly-optimized environment.
                        </motion.p>

                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 1.0, delay: 0.28, ease: GLIDE }}
                            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
                        >
                            <Link
                                to="/dataset"
                                className="group relative inline-flex h-12 md:h-[52px] items-center justify-center gap-2.5 overflow-hidden rounded-full bg-white px-8 text-[14px] font-medium tracking-[-0.005em] text-black transition-all duration-500 ease-glide hover:scale-[1.025] active:scale-[0.98] shadow-[0_0_30px_rgba(255,255,255,0.18)] hover:shadow-[0_0_45px_rgba(255,255,255,0.28)]"
                            >
                                <span>Start Building</span>
                                <ArrowRight className="h-[15px] w-[15px] transition-transform duration-500 ease-glide group-hover:translate-x-1" strokeWidth={2} />
                            </Link>
                            <Link
                                to="/learn"
                                className="group inline-flex h-12 md:h-[52px] items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-7 text-[14px] font-medium text-white/85 backdrop-blur-md transition-all duration-500 ease-glide hover:bg-white/[0.07] hover:border-white/25 hover:text-white"
                            >
                                <span className="font-mono uppercase tracking-[0.18em] text-[11px]">Read the docs</span>
                            </Link>
                        </motion.div>
                    </motion.div>

                    <ScrollIndicator />
                </section>

                {/* ─── Bento ─── */}
                <section className="relative z-10 max-w-7xl mx-auto px-6 py-28 md:py-36 lg:px-8">
                    <FadeIn className="mb-16 md:mb-24 text-center max-w-3xl mx-auto">
                        <Eyebrow number="01" label="The Platform" />
                        <h2 className="text-[clamp(2rem,3.6vw+1rem,3.5rem)] font-semibold tracking-[-0.035em] text-white mb-6 leading-[1.04]">
                            Designed for{' '}
                            <em className="not-italic font-display italic font-normal tracking-[-0.018em] text-transparent bg-clip-text bg-gradient-to-r from-accent-1 via-accent-3 to-accent-4">
                                velocity.
                            </em>
                        </h2>
                        <p className="text-[1.05rem] md:text-[1.15rem] text-text-secondary font-light leading-[1.65] tracking-[0.003em]">
                            Every aspect of the platform is engineered to strip away boilerplate and let you
                            focus on what matters &mdash; the architecture itself.
                        </p>
                    </FadeIn>

                    <div className="grid grid-cols-1 md:grid-cols-6 gap-6 md:auto-rows-[26rem]">
                        <GlassCard
                            index="◌ 001"
                            title="Dataset Engine"
                            description="Streamline data ingestion. Automatically detect features, target columns, and handle complex preprocessing directly within a highly responsive visual workspace."
                            icon={Database}
                            to="/dataset"
                            delay={0.05}
                            className="md:col-span-4"
                        />
                        <GlassCard
                            index="◌ 002"
                            title="Visual Architecture"
                            description="Drag, drop, and connect neural layers. Visualize deep networks instantly."
                            icon={Layers}
                            to="/architect"
                            delay={0.12}
                            className="md:col-span-2 group"
                        />
                        <GlassCard
                            index="◌ 003"
                            title="Live Telemetry"
                            description="Watch the training loss converge in real-time."
                            icon={Activity}
                            to="/training"
                            delay={0.18}
                            className="md:col-span-2"
                        />
                        <GlassCard
                            index="◌ 004"
                            title="High Performance Workers"
                            description="Under the hood, dedicated Celery ML workers process epochs asynchronously. Your UI stays silky smooth at 60fps, no matter how deep the learning gets."
                            icon={Cpu}
                            to="/"
                            delay={0.24}
                            className="md:col-span-4"
                        />
                    </div>
                </section>

                {/* ─── Final CTA ─── */}
                <section className="relative z-10 max-w-5xl mx-auto px-6 py-28 md:py-36 text-center">
                    <FadeIn direction="up">
                        <div className="relative rounded-[3rem] border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-12 md:p-24 backdrop-blur-xl overflow-hidden">
                            {/* Top hairline */}
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-accent-3/70 to-transparent" />
                            {/* Soft inner glow */}
                            <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[110%] h-64 bg-accent-2/15 blur-[100px] rounded-full" />

                            <Eyebrow number="02" label="Get Started" />

                            <h2 className="text-[clamp(2.2rem,3.8vw+1rem,3.75rem)] font-semibold tracking-[-0.035em] text-white mb-6 leading-[1.04]">
                                Ready to{' '}
                                <em className="not-italic font-display italic font-normal tracking-[-0.018em] text-transparent bg-clip-text bg-gradient-to-r from-accent-1 via-accent-3 to-accent-4">
                                    train?
                                </em>
                            </h2>
                            <p className="text-[1.05rem] md:text-[1.15rem] text-text-secondary font-light leading-[1.65] mb-12 max-w-[44ch] mx-auto">
                                Create, manage, and scale your machine learning experiments seamlessly &mdash; right from the browser.
                            </p>

                            <Link
                                to="/signup"
                                className="group inline-flex h-14 items-center justify-center gap-3 rounded-full bg-gradient-to-r from-accent-1 via-accent-2 to-accent-3 px-9 text-[14.5px] font-medium tracking-[-0.005em] text-white transition-all duration-500 ease-glide hover:scale-[1.025] shadow-[0_0_45px_rgba(139,92,246,0.4)] hover:shadow-[0_0_65px_rgba(139,92,246,0.6)]"
                            >
                                <span>Create Free Account</span>
                                <span className="text-white/65 italic font-display">— the future awaits</span>
                                <ArrowRight className="h-[15px] w-[15px] transition-transform duration-500 ease-glide group-hover:translate-x-1" strokeWidth={2} />
                            </Link>
                        </div>
                    </FadeIn>
                </section>

            </main>
        </div>
    );
};

export default Home;
