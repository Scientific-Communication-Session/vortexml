import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Map, GraduationCap } from 'lucide-react';
import Courses from './Courses';
import Roadmap from './Roadmap';

type LearnTab = 'roadmap' | 'courses';

const GLIDE = [0.22, 1, 0.36, 1] as const;

const tabs: {
    id: LearnTab;
    label: string;
    accent: string;
    count: string;
    icon: React.ElementType;
}[] = [
    { id: 'roadmap', label: 'Roadmap', accent: 'Visual journey', count: '8 milestones', icon: Map },
    { id: 'courses', label: 'Courses', accent: 'Hands-on lessons', count: 'Curated', icon: GraduationCap },
];

const Learn: React.FC = () => {
    const [activeTab, setActiveTab] = useState<LearnTab>('roadmap');
    const activeMeta = tabs.find((t) => t.id === activeTab)!;

    return (
        <div className="learn-page relative">
            {/* ─── Editorial header ─── */}
            <motion.header
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.85, ease: GLIDE }}
                className="text-center max-w-3xl mx-auto pt-2 pb-10"
            >
                <p className="font-mono text-[10.5px] tracking-[0.32em] uppercase text-white/45 mb-5">
                    The Library — Knowledge Hub
                </p>
                <h1
                    className="text-white font-semibold tracking-[-0.04em] leading-[0.98] mb-5"
                    style={{ fontSize: 'clamp(2.4rem, 4.4vw + 0.5rem, 4rem)' }}
                >
                    Learn, build,{' '}
                    <em className="not-italic font-display italic font-normal tracking-[-0.02em] text-transparent bg-clip-text bg-gradient-to-r from-accent-1 via-accent-3 to-accent-4">
                        master.
                    </em>
                </h1>
                <p className="text-text-secondary text-[clamp(0.98rem,0.5vw+0.9rem,1.1rem)] font-light leading-[1.65] max-w-[58ch] mx-auto">
                    A complete machine learning journey — from the math beneath neurons to deploying models in production.
                </p>
            </motion.header>

            {/* ─── Refined segmented control ─── */}
            <div className="flex flex-col items-center gap-3 mb-12 md:mb-16">
                <div
                    role="tablist"
                    aria-label="Learning mode"
                    className="relative inline-flex items-center gap-1 p-1.5 rounded-full border border-white/[0.08] bg-[rgba(14,14,36,0.55)] backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_4px_24px_-8px_rgba(99,102,241,0.15)]"
                >
                    {tabs.map((tab) => {
                        const isActive = activeTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setActiveTab(tab.id)}
                                className="relative inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-medium tracking-[-0.005em] outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-colors duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                            >
                                {isActive && (
                                    <motion.span
                                        layoutId="learn-tab-pill"
                                        className="absolute inset-0 rounded-full bg-gradient-to-br from-white/[0.13] to-white/[0.05] border border-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_24px_-4px_rgba(139,92,246,0.35)]"
                                        transition={{
                                            type: 'spring',
                                            stiffness: 380,
                                            damping: 32,
                                            mass: 0.6,
                                        }}
                                    />
                                )}
                                <Icon
                                    className={`relative h-[14px] w-[14px] transition-colors duration-300 ${
                                        isActive ? 'text-white' : 'text-white/55'
                                    }`}
                                    strokeWidth={1.8}
                                />
                                <span
                                    className={`relative transition-colors duration-300 ${
                                        isActive ? 'text-white' : 'text-white/55 hover:text-white/85'
                                    }`}
                                >
                                    {tab.label}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Live caption that swaps with the tab */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeMeta.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.4, ease: GLIDE }}
                        className="flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.28em] text-white/40"
                    >
                        <span>{activeMeta.accent}</span>
                        <span className="w-1 h-1 rounded-full bg-white/25" />
                        <span>{activeMeta.count}</span>
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* ─── Content swap ─── */}
            <div className="relative">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.5, ease: GLIDE }}
                        className="will-change-[transform,opacity]"
                    >
                        {activeTab === 'roadmap' ? <Roadmap /> : <Courses />}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
};

export default Learn;
