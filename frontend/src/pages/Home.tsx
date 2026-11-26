import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView, useScroll, useTransform, useReducedMotion } from 'framer-motion';
import { Database, Activity, ArrowRight, GraduationCap, Layers, CloudCog, Play, Trophy } from 'lucide-react';
import NeuralBackground from '../components/NeuralBackground';
import TutorialClip from '../components/TutorialClip';
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
            // Hidden on short screens, where the hero fills the viewport and the
            // indicator would sit on top of its last line.
            className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 opacity-60 [@media(max-height:980px)]:hidden"
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

// The tutorial's clips, in order. `seconds` is each GIF's length, so the
// walkthrough moves on exactly when the clip has played through once.
const WALKTHROUGH = [
    {
        clip: '01-upload', seconds: 11, url: 'vortexml / dataset',
        title: 'Upload your data',
        text: 'Drop in a CSV. You get a preview table and a summary of what is in it.',
        alt: 'Uploading a CSV on the Dataset page; the preview table appears.',
    },
    {
        clip: '02-columns', seconds: 18.6, url: 'vortexml / dataset',
        title: 'Choose what to predict',
        text: 'Tick the columns the model may look at, and the one it should learn to predict.',
        alt: 'Marking five columns as features and one as the target.',
    },
    {
        clip: '03-architect', seconds: 19.4, url: 'vortexml / architect',
        title: 'Design the network',
        text: 'Pick a model type, set its layers, and decide how long it trains.',
        alt: 'Selecting a Multi-Layer Perceptron and entering its layer sizes and hyperparameters.',
    },
    {
        clip: '04-train', seconds: 19.8, url: 'vortexml / training',
        title: 'Train it live',
        text: 'The loss falls and the accuracy climbs on screen, epoch by epoch.',
        alt: 'Starting a run on the Training page; the loss curve falls and accuracy rises.',
    },
    {
        clip: '05-background', seconds: 25.8, url: 'vortexml — opened in a second browser',
        title: 'Close the tab',
        text: 'The run carries on without you. Open the site in another browser and pick it up where it is.',
        alt: 'A second browser signs in while a run is training: the welcome-back prompt appears, then the dashboard with the full history.',
    },
    {
        clip: '06-predict', seconds: 28.1, url: 'vortexml / predict',
        title: 'Ask it questions',
        text: 'Type in values the model has never seen and it answers.',
        alt: 'Entering two different students on the Predict page; the prediction changes from pass to fail.',
    },
];

// The whole product in six recorded clips, playing one after another.
const Walkthrough: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);
    const inView = useInView(ref, { margin: '-20% 0px' });
    const reduce = useReducedMotion();
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(!reduce);
    const step = WALKTHROUGH[index];
    const running = playing && inView;

    // Fetch the next clip while this one plays, so the hand-over is seamless.
    useEffect(() => {
        if (!running) return;
        const next = WALKTHROUGH[(index + 1) % WALKTHROUGH.length];
        new Image().src = `/tutorial/${next.clip}.gif`;
    }, [index, running]);

    return (
        <div ref={ref} className="grid gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-10 items-start">
            <ol className="order-2 lg:order-1 flex flex-col gap-1.5 list-none p-0 m-0">
                {WALKTHROUGH.map((s, i) => {
                    const active = i === index;
                    return (
                        <li key={s.clip}>
                            <button
                                type="button"
                                onClick={() => setIndex(i)}
                                aria-current={active ? 'step' : undefined}
                                className={cn(
                                    'relative block w-full cursor-pointer overflow-hidden rounded-2xl border border-solid px-5 py-3.5 text-left font-sans',
                                    'transition-[background-color,border-color] duration-500 ease-glide',
                                    active
                                        ? 'border-accent-2/35 bg-white/[0.06]'
                                        : 'border-transparent bg-transparent hover:bg-white/[0.035]',
                                )}
                            >
                                <span className="flex items-baseline gap-3.5">
                                    <span className={cn(
                                        'font-mono text-[11px] tracking-[0.18em] transition-colors duration-500',
                                        active ? 'text-accent-3' : 'text-white/35',
                                    )}>
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                    <span className={cn(
                                        'text-[15.5px] font-medium tracking-[-0.01em] transition-colors duration-500',
                                        active ? 'text-white' : 'text-white/60',
                                    )}>
                                        {s.title}
                                    </span>
                                </span>
                                {active && (
                                    <span className="mt-1.5 block pl-[1.95rem] text-[13.5px] font-light leading-relaxed text-text-secondary">
                                        {s.text}
                                    </span>
                                )}
                                {/* Fills over the length of the clip, then hands over to the next step. */}
                                {active && running && (
                                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.06]">
                                        <span
                                            key={s.clip}
                                            className="block h-full origin-left bg-gradient-to-r from-accent-1 via-accent-3 to-accent-4"
                                            style={{ animation: `walkthrough-fill ${s.seconds}s linear forwards` }}
                                            onAnimationEnd={() => setIndex((n) => (n + 1) % WALKTHROUGH.length)}
                                        />
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ol>

            <div className="order-1 lg:order-2 min-w-0">
                <TutorialClip
                    name={step.clip}
                    url={step.url}
                    alt={step.alt}
                    playing={playing}
                    onToggle={() => setPlaying((p) => !p)}
                    caption={<>Step {index + 1} of {WALKTHROUGH.length} · recorded from the running app, no mock-ups.</>}
                />
            </div>
        </div>
    );
};

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
                <section ref={heroRef} className="relative min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-6 pt-28 pb-28">
                    <motion.div
                        style={{ y: reduce ? 0 : yHeroText, opacity: opacityHero }}
                        className="max-w-5xl mx-auto text-center flex flex-col items-center will-change-[transform,opacity]"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.9, ease: GLIDE }}
                            className="mb-4 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2 backdrop-blur-md shadow-[0_0_20px_rgba(255,255,255,0.04)]"
                        >
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-4 opacity-70" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-4" />
                            </span>
                            <span className="font-mono text-[10.5px] font-medium tracking-[0.28em] text-white/85 uppercase">
                                Vortex Engine
                            </span>
                        </motion.div>

                        {/* Award */}
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.9, delay: 0.05, ease: GLIDE }}
                            className="mb-9 inline-flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-gradient-to-r from-amber-400/[0.12] via-amber-300/[0.05] to-transparent px-4 py-2.5 text-left backdrop-blur-md shadow-[0_0_34px_-10px_rgba(251,191,36,0.55)]"
                        >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-amber-300/30 bg-amber-400/15 text-amber-300">
                                <Trophy className="h-[18px] w-[18px]" strokeWidth={1.8} />
                            </span>
                            <span className="flex flex-col leading-tight">
                                <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-amber-100">
                                    1st place — Scientific Communication Session 2026
                                </span>
                                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/60">
                                    Politehnica University of Bucharest
                                </span>
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
                                to="/demo"
                                className="group inline-flex h-12 md:h-[52px] items-center justify-center gap-2.5 rounded-full border border-white/15 bg-white/[0.03] px-7 text-[14px] font-medium text-white/85 backdrop-blur-md transition-all duration-500 ease-glide hover:bg-white/[0.07] hover:border-white/25 hover:text-white"
                            >
                                <Play className="h-[13px] w-[13px]" fill="currentColor" strokeWidth={0} />
                                <span className="font-mono uppercase tracking-[0.18em] text-[11px]">Watch a live demo</span>
                            </Link>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 1.0, delay: 0.42, ease: GLIDE }}
                            className="mt-7"
                        >
                            <Link
                                to="/tutorial"
                                className="group inline-flex items-center gap-3 rounded-full border border-accent-3/30 bg-accent-2/[0.1] py-2 pl-2 pr-5 text-[13.5px] text-white/85 backdrop-blur-md transition-all duration-500 ease-glide hover:border-accent-3/60 hover:bg-accent-2/[0.18] hover:text-white no-underline shadow-[0_0_30px_-12px_rgba(139,92,246,0.8)]"
                            >
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-accent-1 to-accent-2 px-3 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-white">
                                    <GraduationCap className="h-[13px] w-[13px]" strokeWidth={2} />
                                    Tutorial
                                </span>
                                New here? Train your first model in five minutes
                                <ArrowRight className="h-[13px] w-[13px] transition-transform duration-500 ease-glide group-hover:translate-x-1" strokeWidth={2} />
                            </Link>
                        </motion.div>
                    </motion.div>

                    <ScrollIndicator />
                </section>

                {/* ─── How it works ─── */}
                <section id="how-it-works" className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-10 md:pt-28 lg:px-8">
                    <FadeIn className="mb-12 md:mb-16 text-center max-w-3xl mx-auto">
                        <Eyebrow number="01" label="How it works" />
                        <h2 className="text-[clamp(2rem,3.6vw+1rem,3.5rem)] font-semibold tracking-[-0.035em] text-white mb-6 leading-[1.04]">
                            From a spreadsheet to a{' '}
                            <em className="not-italic font-display italic font-normal tracking-[-0.018em] whitespace-nowrap text-transparent bg-clip-text bg-gradient-to-r from-accent-1 via-accent-3 to-accent-4">
                                working model.
                            </em>
                        </h2>
                        <p className="text-[1.05rem] md:text-[1.15rem] text-text-secondary font-light leading-[1.65] tracking-[0.003em]">
                            Six steps, shown exactly as they happen in the app. Pick one, or let them play through.
                        </p>
                    </FadeIn>

                    <FadeIn delay={0.08}>
                        <Walkthrough />
                    </FadeIn>

                    <FadeIn delay={0.12} className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            to="/tutorial"
                            className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-full bg-white px-7 text-[14px] font-medium tracking-[-0.005em] text-black transition-all duration-500 ease-glide hover:scale-[1.025] active:scale-[0.98] shadow-[0_0_30px_rgba(255,255,255,0.14)] no-underline hover:no-underline"
                        >
                            <GraduationCap className="h-[16px] w-[16px]" strokeWidth={1.9} />
                            <span>Follow the full tutorial</span>
                            <ArrowRight className="h-[15px] w-[15px] transition-transform duration-500 ease-glide group-hover:translate-x-1" strokeWidth={2} />
                        </Link>
                        <span className="text-[13.5px] font-light text-text-secondary">
                            It comes with a practice dataset and the exact settings to type in.
                        </span>
                    </FadeIn>
                </section>

                {/* ─── Bento ─── */}
                <section className="relative z-10 max-w-7xl mx-auto px-6 py-28 md:py-36 lg:px-8">
                    <FadeIn className="mb-16 md:mb-24 text-center max-w-3xl mx-auto">
                        <Eyebrow number="02" label="The Platform" />
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
                            title="Background Sessions"
                            description="Training runs on the server, not in your tab. Close the browser, come back from any device, and pick the run up exactly where it is — queued on the shared Mac mini, or instantly on a server you enroll yourself."
                            icon={CloudCog}
                            to="/training"
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

                            <Eyebrow number="03" label="Get Started" />

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
