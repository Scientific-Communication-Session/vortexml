import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { Activity, ArrowDown, ArrowRight, CloudCog, Database, GraduationCap, Layers, Pause, Play, Trophy } from 'lucide-react';
import VortexField from '../components/VortexField';
import TutorialClip from '../components/TutorialClip';
import ProgressRing from '../components/session/ProgressRing';
import './home.css';

// The full step-by-step guide closes the page; it is long, so it loads after
// the hero instead of with it.
const TutorialGuide = lazy(() => import('./Tutorial').then((m) => ({ default: m.TutorialGuide })));

// One curve for the whole page
const GLIDE = [0.22, 1, 0.36, 1] as const;

// Reveal on first view. Short travel, short duration: it orients, it doesn't perform.
const FadeIn: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({ children, delay = 0, className }) => {
    const reduce = useReducedMotion();
    return (
        <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10%' }}
            transition={{ duration: 0.5, delay, ease: GLIDE }}
            className={className}
        >
            {children}
        </motion.div>
    );
};

const SectionHead: React.FC<{ label: string; title: React.ReactNode; children: React.ReactNode }> = ({ label, title, children }) => (
    <FadeIn className="vx-section__head">
        <span className="vx-label">{label}</span>
        <h2 className="vx-h2">{title}</h2>
        <p className="vx-lead">{children}</p>
    </FadeIn>
);

// ─── Hero ────────────────────────────────────────────────────────────────────
const Hero: React.FC = () => {
    const reduce = useReducedMotion();
    // Each headline line rises out of its own mask, one after the other.
    const line = (i: number) => ({
        initial: reduce ? { opacity: 0 } : { y: '105%' },
        animate: reduce ? { opacity: 1 } : { y: '0%' },
        transition: { duration: 0.7, delay: 0.1 + i * 0.08, ease: GLIDE },
    });
    const rise = (delay: number) => ({
        initial: reduce ? { opacity: 0 } : { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay, ease: GLIDE },
    });

    return (
        <section className="vx-hero">
            <div className="vx-container vx-hero__grid">
                <div className="vx-hero__copy">
                    <motion.div {...rise(0)} className="vx-award vx-glass">
                        <span className="vx-award__icon"><Trophy size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                        <span className="vx-award__text">
                            <span className="vx-award__title">1st place — Scientific Communication Session 2026</span>
                            <span className="vx-award__sub">Politehnica University of Bucharest</span>
                        </span>
                    </motion.div>

                    <h1 className="vx-hero__title">
                        <span className="vx-hero__line vx-hero__line--strong"><motion.span {...line(0)}>Intelligence,</motion.span></span>
                        <span className="vx-hero__line vx-hero__line--light"><motion.span {...line(1)}>Simplified.</motion.span></span>
                    </h1>

                    <motion.p {...rise(0.3)} className="vx-hero__lead">
                        The most advanced visual node platform for neural networks.
                        Build, configure, and train models in a gorgeous, highly-optimized environment.
                    </motion.p>

                    <motion.div {...rise(0.38)} className="vx-hero__ctas">
                        <Link to="/dataset" className="vx-btn vx-btn--primary vx-btn--lg">
                            Start Building
                            <ArrowRight size={16} strokeWidth={2} className="vx-btn__arrow" aria-hidden="true" />
                        </Link>
                        <Link to="/demo" className="vx-btn vx-btn--ghost vx-btn--lg">
                            <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" style={{ marginLeft: 2 }} />
                            Watch a live demo
                        </Link>
                    </motion.div>

                    <motion.div {...rise(0.46)}>
                        <Link to="/tutorial" className="vx-tutorial-link">
                            <span className="vx-tutorial-link__tag">
                                <GraduationCap size={13} strokeWidth={2} aria-hidden="true" />
                                Tutorial
                            </span>
                            New here? Train your first model in ten minutes
                            <ArrowRight size={14} strokeWidth={2} className="vx-btn__arrow" aria-hidden="true" />
                        </Link>
                    </motion.div>
                </div>

                <motion.div
                    className="vx-hero__visual"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6, ease: GLIDE }}
                >
                    <VortexField className="vx-hero__vortex" label="The VortexML mark, two rings turning around a core, drawn in particles" />
                </motion.div>
            </div>
        </section>
    );
};

// ─── The product, tilting up into view as you scroll ────────────────────────
const ProductReveal: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const reduce = useReducedMotion();
    const inView = useInView(ref, { margin: '-10% 0px' });
    const [playing, setPlaying] = useState(!reduce);
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] });
    const rotateX = useTransform(scrollYProgress, [0, 1], [26, 0]);
    const scale = useTransform(scrollYProgress, [0, 1], [0.88, 1]);
    const y = useTransform(scrollYProgress, [0, 1], [48, 0]);
    const glow = useTransform(scrollYProgress, [0, 1], [0.2, 1]);

    useEffect(() => {
        const v = video.current;
        if (!v) return;
        if (playing && inView) v.play().catch(() => {});
        else v.pause();
    }, [playing, inView]);

    return (
        <section className="vx-reveal" aria-label="The training dashboard">
            <div className="vx-container" style={{ maxWidth: 'var(--container-wide)' }}>
                <div ref={ref} className="vx-reveal__stage">
                    <motion.div className="vx-reveal__glow" style={{ opacity: reduce ? 1 : glow }} />
                    <motion.figure
                        className="vx-frame vx-glass"
                        style={reduce ? undefined : { rotateX, scale, y }}
                    >
                        <div className="vx-frame__bar">
                            <span className="vx-frame__dots" aria-hidden="true"><i /><i /><i /></span>
                            <span className="vx-frame__url">vortexml / training</span>
                            <button
                                type="button"
                                className="vx-frame__toggle"
                                onClick={() => setPlaying((p) => !p)}
                                aria-label={playing ? 'Pause the recording' : 'Play the recording'}
                            >
                                {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                            </button>
                        </div>
                        <div className="vx-frame__screen">
                            <video
                                ref={video}
                                src="/tutorial/06-train.mp4"
                                poster="/tutorial/06-train.png"
                                aria-label="Starting a run on the Training page; the loss curve falls and accuracy rises."
                                width={1280}
                                height={800}
                                muted
                                loop
                                playsInline
                                preload="metadata"
                            />
                        </div>
                    </motion.figure>
                </div>
                <p className="vx-reveal__caption">Recorded from the running app — no mock-ups.</p>
            </div>
        </section>
    );
};

// ─── Walkthrough: the product in recorded clips ─────────────────────────────
const WALKTHROUGH = [
    {
        clip: '02-upload', url: 'vortexml / dataset',
        title: 'Upload your data',
        text: 'Drop in a CSV. You get a preview table and a summary of what is in it.',
        alt: 'Uploading a CSV on the Dataset page; the preview table appears.',
    },
    {
        clip: '03-columns', url: 'vortexml / dataset',
        title: 'Ask the tutor, pick the columns',
        text: 'Not sure what a feature or a target is? One click and the AI tutor explains, then you choose.',
        alt: 'Asking the AI tutor what features and a target are, then marking the columns.',
    },
    {
        clip: '04-autoconfig', url: 'vortexml / architect',
        title: 'Let the AI design the network',
        text: 'Describe your goal in plain words. The co-pilot proposes the whole model and fills the page in.',
        alt: 'Describing the goal to the AI co-pilot and applying its proposed configuration.',
    },
    {
        clip: '05-parameters', url: 'vortexml / architect',
        title: 'Tune the parameters with the tutor',
        text: 'Every setting has an ask-the-tutor button: what it does, and what value suits your data.',
        alt: 'Asking the AI tutor about the learning rate and about the values the co-pilot chose.',
    },
    {
        clip: '06-train', url: 'vortexml / training',
        title: 'Train it live',
        text: 'The loss falls and the accuracy climbs on screen, epoch by epoch.',
        alt: 'Starting a run on the Training page; the loss curve falls and accuracy rises.',
    },
    {
        clip: '07-explain', url: 'vortexml / training',
        title: 'Have the AI explain the results',
        text: 'One click turns the curves into a plain-language verdict: is it overfitting, is it ready, what next.',
        alt: 'Clicking Explain Results after training; the AI review of the run appears.',
    },
    {
        clip: '08-background', url: 'vortexml — opened in a second browser',
        title: 'Close the tab',
        text: 'The run carries on without you. Open the site in another browser and pick it up where it is.',
        alt: 'A second browser signs in while a run is training: the welcome-back prompt appears, then the dashboard with the full history.',
    },
    {
        clip: '09-predict', url: 'vortexml / predict',
        title: 'Ask it questions',
        text: 'Type in values the model has never seen and it answers.',
        alt: 'Entering two different students on the Predict page; the prediction changes from pass to fail.',
    },
];

const Walkthrough: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);
    const inView = useInView(ref, { margin: '-20% 0px' });
    const reduce = useReducedMotion();
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(!reduce);
    // Length of the clip on screen, once the browser knows it.
    const [seconds, setSeconds] = useState<number | null>(null);
    const step = WALKTHROUGH[index];

    const show = (i: number) => {
        setSeconds(null);
        setIndex(i);
    };

    return (
        <div ref={ref} className="vx-walk">
            <ol className="vx-walk__steps">
                {WALKTHROUGH.map((s, i) => {
                    const active = i === index;
                    return (
                        <li key={s.clip}>
                            <button
                                type="button"
                                onClick={() => show(i)}
                                aria-current={active ? 'step' : undefined}
                                className="vx-walk__step"
                            >
                                <span className="vx-walk__row">
                                    <span className="vx-walk__num">{String(i + 1).padStart(2, '0')}</span>
                                    <span className="vx-walk__title">{s.title}</span>
                                </span>
                                {active && <span className="vx-walk__text">{s.text}</span>}
                                {/* Fills over the length of the clip; the clip ending moves on to the next step. */}
                                {active && seconds !== null && (
                                    <span className="vx-walk__progress">
                                        <span
                                            key={s.clip}
                                            style={{
                                                animation: `walkthrough-fill ${seconds}s linear forwards`,
                                                animationPlayState: playing && inView ? 'running' : 'paused',
                                            }}
                                        />
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ol>

            <div style={{ minWidth: 0 }}>
                <TutorialClip
                    name={step.clip}
                    url={step.url}
                    alt={step.alt}
                    playing={playing}
                    onToggle={() => setPlaying((p) => !p)}
                    onDuration={setSeconds}
                    onEnded={() => show((index + 1) % WALKTHROUGH.length)}
                    caption={<>Step {index + 1} of {WALKTHROUGH.length} · recorded from the running app, no mock-ups.</>}
                />
            </div>
        </div>
    );
};

// ─── Card visuals: small pieces of the real product ─────────────────────────
// Rows 1, 3 and 7 of sample-data/student_performance.csv (three of its five
// feature columns, and the target)
const STUDENTS = {
    cols: ['hours_studied', 'previous_score', 'sleep_hours', 'passed'],
    rows: [
        ['6.39', '41', '5.2', '0'],
        ['2.19', '72', '6.8', '0'],
        ['5.36', '99', '6.8', '1'],
    ],
};

const DatasetVisual: React.FC = () => (
    <div className="vx-mini vx-mini-scroll">
        <table className="vx-mini-table">
            <thead>
                <tr>
                    {STUDENTS.cols.map((c, i) => {
                        const target = i === STUDENTS.cols.length - 1;
                        return (
                            <th key={c} className={target ? 'is-target' : undefined}>
                                {c}
                                <span className="vx-mini-role">{target ? 'Target' : 'Feature'}</span>
                            </th>
                        );
                    })}
                </tr>
            </thead>
            <tbody>
                {STUDENTS.rows.map((r, ri) => (
                    <tr key={ri}>
                        {r.map((v, i) => <td key={i} className={i === r.length - 1 ? 'is-target' : undefined}>{v}</td>)}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// 5 inputs → 8 → 8 → 2 outputs, the shape the tutorial's network takes
const ArchitectureVisual: React.FC = () => {
    const reduce = useReducedMotion();
    const layers = [5, 8, 8, 2];
    const W = 280, H = 150, padX = 24, padY = 14;
    const nodes = layers.map((n, li) => Array.from({ length: n }, (_, ni) => ({
        x: padX + (li * (W - 2 * padX)) / (layers.length - 1),
        y: padY + ((ni + 0.5) * (H - 2 * padY)) / n,
    })));
    const edges: [number, number, number, number][] = [];
    for (let l = 0; l < nodes.length - 1; l++) {
        for (const a of nodes[l]) for (const b of nodes[l + 1]) edges.push([a.x, a.y, b.x, b.y]);
    }
    const path = [nodes[0][2], nodes[1][3], nodes[2][5], nodes[3][1]];
    return (
        <div className="vx-mini">
            <svg className="vx-net" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label="A network with 5 inputs, two hidden layers of 8, and 2 outputs">
                {edges.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />)}
                {!reduce && path.slice(0, -1).map((a, i) => (
                    <motion.line
                        key={`p${i}`}
                        className="vx-net__pulse"
                        x1={a.x} y1={a.y} x2={path[i + 1].x} y2={path[i + 1].y}
                        initial={{ strokeDashoffset: 6 }}
                        animate={{ strokeDashoffset: -200 }}
                        transition={{ duration: 2.4, delay: i * 0.5, repeat: Infinity, repeatDelay: 1.2, ease: 'linear' }}
                    />
                ))}
                {nodes.map((layer, li) => layer.map((n, ni) => (
                    <circle key={`${li}-${ni}`} cx={n.x} cy={n.y} r={li === 3 ? 5 : 4} className={li === 3 ? 'is-out' : undefined} />
                )))}
                <text x={padX} y={H + 10} textAnchor="middle">Input</text>
                <text x={W - padX} y={H + 10} textAnchor="middle">Output</text>
            </svg>
        </div>
    );
};

const TelemetryVisual: React.FC = () => {
    const reduce = useReducedMotion();
    const loss = 'M8,8 C40,44 70,66 110,76 S200,86 272,88';
    return (
        <div className="vx-mini vx-chart">
            <div className="vx-chart__stats">
                <div><div className="vx-chart__v">24/40</div><div className="vx-chart__l">Epoch</div></div>
                <div><div className="vx-chart__v">0.0761</div><div className="vx-chart__l">Train loss</div></div>
                <div><div className="vx-chart__v is-accent">96.9%</div><div className="vx-chart__l">Val accuracy</div></div>
            </div>
            <svg viewBox="0 0 280 96" role="img" aria-label="Loss falling and accuracy rising over the epochs">
                <line className="grid" x1="0" x2="280" y1="8" y2="8" />
                <line className="grid" x1="0" x2="280" y1="48" y2="48" />
                <line className="grid" x1="0" x2="280" y1="88" y2="88" />
                <path className="acc" d="M8,80 C40,40 80,22 130,16 S220,12 272,11" />
                <path className="area" d={`${loss} L272,96 L8,96 Z`} />
                <motion.path
                    className="loss"
                    d={loss}
                    initial={reduce ? false : { pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.2, ease: GLIDE }}
                />
                <circle className="dot" cx="272" cy="88" r="3.5" />
            </svg>
        </div>
    );
};

const SessionsVisual: React.FC = () => (
    <div className="vx-mini vx-runs">
        <div className="vx-run is-live">
            <ProgressRing value={62} size={28} stroke={3} pulse />
            <div className="vx-run__main">
                <div className="vx-run__name">Exam-Predictor</div>
                <div className="vx-run__where">Your own server · Training</div>
                <div className="vx-run__bar"><span style={{ width: '62%' }} /></div>
            </div>
            <span className="vx-run__meta">62%</span>
        </div>
        <div className="vx-run">
            <ProgressRing value={0} size={28} stroke={3} />
            <div className="vx-run__main">
                <div className="vx-run__name">Iris-Species</div>
                <div className="vx-run__where">Shared Mac mini · Queued</div>
            </div>
            <span className="vx-run__meta">#2</span>
        </div>
    </div>
);

const FeatureCard: React.FC<{
    title: string;
    description: string;
    icon: React.ElementType;
    to: string;
    wide?: boolean;
    delay?: number;
    visual: React.ReactNode;
}> = ({ title, description, icon: Icon, to, wide, delay = 0, visual }) => (
    <FadeIn delay={delay} className={`vx-card ${wide ? 'vx-card--wide' : 'vx-card--narrow'}`}>
        <div className="vx-card__body">
            <span className="vx-card__icon"><Icon size={20} strokeWidth={1.75} aria-hidden="true" /></span>
            <h3 className="vx-card__title">{title}</h3>
            <p className="vx-card__text">{description}</p>
            <Link to={to} className="vx-card__link">
                Explore <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
            </Link>
        </div>
        <div className="vx-card__visual">{visual}</div>
    </FadeIn>
);

// ─── Page ───────────────────────────────────────────────────────────────────
const Home: React.FC = () => (
    <div className="vx-home">
        <div className="vx-home__light" aria-hidden="true" />

        <Hero />
        <ProductReveal />

        {/* ─── How it works ─── */}
        <section id="how-it-works" className="vx-section">
            <div className="vx-container">
                <SectionHead label="How it works" title="From a spreadsheet to a working model.">
                    Eight steps, with the AI tutor and co-pilot doing the hard parts. Pick one, or let them play through.
                </SectionHead>
                <FadeIn delay={0.05}>
                    <Walkthrough />
                </FadeIn>
                <FadeIn className="vx-walk__after">
                    <a href="#tutorial" className="vx-btn vx-btn--ghost">
                        <GraduationCap size={16} strokeWidth={1.9} aria-hidden="true" />
                        Do it yourself, step by step
                        <ArrowDown size={15} strokeWidth={2} className="vx-btn__down" aria-hidden="true" />
                    </a>
                    <span>It comes with a practice dataset and the exact prompt to give the AI.</span>
                </FadeIn>
            </div>
        </section>

        {/* ─── The platform ─── */}
        <section className="vx-section">
            <div className="vx-container">
                <SectionHead label="The Platform" title="Designed for velocity.">
                    Every aspect of the platform is engineered to strip away boilerplate and let you
                    focus on what matters &mdash; the architecture itself.
                </SectionHead>
                <div className="vx-bento">
                    <FeatureCard
                        wide
                        title="Dataset Engine"
                        description="Streamline data ingestion. Automatically detect features, target columns, and handle complex preprocessing directly within a highly responsive visual workspace."
                        icon={Database}
                        to="/dataset"
                        visual={<DatasetVisual />}
                    />
                    <FeatureCard
                        title="Visual Architecture"
                        description="Drag, drop, and connect neural layers. Visualize deep networks instantly."
                        icon={Layers}
                        to="/architect"
                        delay={0.06}
                        visual={<ArchitectureVisual />}
                    />
                    <FeatureCard
                        title="Live Telemetry"
                        description="Watch the training loss converge in real-time."
                        icon={Activity}
                        to="/training"
                        delay={0.03}
                        visual={<TelemetryVisual />}
                    />
                    <FeatureCard
                        wide
                        title="Background Sessions"
                        description="Training runs on the server, not in your tab. Close the browser, come back from any device, and pick the run up exactly where it is — queued on the shared Mac mini, or instantly on a server you enroll yourself."
                        icon={CloudCog}
                        to="/training"
                        delay={0.09}
                        visual={<SessionsVisual />}
                    />
                </div>
            </div>
        </section>

        {/* ─── Tutorial ─── */}
        <section id="tutorial" className="vx-section" style={{ scrollMarginTop: 'var(--space-16)' }}>
            <div className="vx-container" style={{ maxWidth: 'var(--container-wide)' }}>
                <SectionHead label="Tutorial" title="Your first model, step by step.">
                    In about ten minutes you will teach a neural network to predict whether a student passes
                    an exam, with the AI tutor and co-pilot doing the hard parts. Every step shows exactly
                    what to click and what you should see change.
                </SectionHead>
                <Suspense fallback={<div className="vx-lead" style={{ margin: '0 auto', padding: 'var(--space-24) 0', textAlign: 'center' }}>Loading the tutorial…</div>}>
                    <TutorialGuide />
                </Suspense>
            </div>
        </section>

        {/* ─── Get started ─── */}
        <section className="vx-final">
            <div className="vx-container" style={{ maxWidth: '64rem' }}>
                <FadeIn className="vx-final__panel vx-glass">
                    <span className="vx-label">Get Started</span>
                    <h2 className="vx-h2">Ready to train?</h2>
                    <p className="vx-lead">
                        Create, manage, and scale your machine learning experiments seamlessly &mdash; right from the browser.
                    </p>
                    <Link to="/signup" className="vx-btn vx-btn--primary vx-btn--lg">
                        Create Free Account
                        <span className="vx-final__after">— the future awaits</span>
                        <ArrowRight size={16} strokeWidth={2} className="vx-btn__arrow" aria-hidden="true" />
                    </Link>
                </FadeIn>
            </div>
        </section>
    </div>
);

export default Home;
