import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { useTrainingSession } from '../context/TrainingSessionContext';
import Logo from './Logo';

const Footer: React.FC = () => {
    const { openEnterprise } = useTrainingSession();
    return (
        <footer className="relative z-10 w-full border-t border-white/10 bg-[#04040a]">
            {/* Top hairline accent */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-px bg-gradient-to-r from-transparent via-accent-2/40 to-transparent" />

            <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-12 md:gap-8">
                    <div className="col-span-2 md:col-span-1">
                        <Link to="/" className="flex items-center gap-2 mb-5 no-underline group">
                            <Logo size={24} className="shrink-0 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-180" />
                            <span className="text-[17px] font-semibold text-text-primary tracking-[-0.02em]">
                                Vortex<span className="font-display italic font-normal tracking-[-0.01em] text-accent-2">ML</span>
                            </span>
                        </Link>
                        <p className="text-[14px] text-text-secondary leading-[1.6] max-w-xs font-light tracking-[0.002em]">
                            The future of machine learning development. Build, configure, and{' '}
                            <em className="font-display italic font-normal text-text-primary">train</em>{' '}
                            models without extreme complexity.
                        </p>
                        <p className="mt-5 flex items-start gap-2 text-[12.5px] leading-[1.5] text-amber-200/80 max-w-xs">
                            <Trophy className="mt-[2px] h-[14px] w-[14px] shrink-0" strokeWidth={1.8} />
                            <span>
                                1st place, Scientific Communication Session 2026 —
                                Politehnica University of Bucharest
                            </span>
                        </p>
                    </div>

                    {[
                        {
                            title: 'Product',
                            links: [
                                { to: '/demo', label: 'Live Demo' },
                                { to: '/architect', label: 'Architect Builder' },
                                { to: '/dataset', label: 'Dataset Processing' },
                                { to: '/training', label: 'Live Training' },
                            ],
                        },
                        {
                            title: 'Resources',
                            links: [
                                { to: '/tutorial', label: 'Tutorial' },
                                { to: '/learn', label: 'Learning Roadmap' },
                                { to: '/courses', label: 'ML Courses' },
                            ],
                        },
                        {
                            title: 'Company',
                            links: [
                                { to: '/about', label: 'About' },
                                { to: 'sales', label: 'Contact' },
                                { to: '/terms', label: 'Terms of Service' },
                                { to: '/privacy', label: 'Privacy Policy' },
                            ],
                        },
                    ].map((col) => (
                        <div key={col.title}>
                            <h3 className="text-[11px] font-mono font-medium text-text-primary mb-5 tracking-[0.22em] uppercase">
                                {col.title}
                            </h3>
                            <ul className="space-y-3 list-none p-0">
                                {col.links.map((l) =>
                                    l.to.startsWith('/') ? (
                                        <li key={l.label}>
                                            <Link
                                                to={l.to}
                                                className="text-[13.5px] text-text-secondary hover:text-white transition-colors duration-300 no-underline tracking-[-0.003em]"
                                            >
                                                {l.label}
                                            </Link>
                                        </li>
                                    ) : l.to === 'sales' ? (
                                        <li key={l.label}>
                                            <button
                                                type="button"
                                                onClick={openEnterprise}
                                                className="p-0 border-0 bg-transparent cursor-pointer font-[inherit] text-[13.5px] text-text-secondary hover:text-white transition-colors duration-300 tracking-[-0.003em]"
                                            >
                                                {l.label}
                                            </button>
                                        </li>
                                    ) : (
                                        <li key={l.label}>
                                            <a
                                                href={l.to}
                                                className="text-[13.5px] text-text-secondary hover:text-white transition-colors duration-300 no-underline tracking-[-0.003em]"
                                            >
                                                {l.label}
                                            </a>
                                        </li>
                                    )
                                )}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="font-mono text-[11px] tracking-[0.06em] text-text-muted">
                        &copy; {new Date().getFullYear()} VORTEXML — ALL RIGHTS RESERVED
                    </p>
                    <div className="flex gap-6">
                        <Link to="/privacy" className="font-mono text-[11px] tracking-[0.08em] uppercase text-text-secondary hover:text-white transition-colors no-underline">Privacy</Link>
                        <Link to="/terms" className="font-mono text-[11px] tracking-[0.08em] uppercase text-text-secondary hover:text-white transition-colors no-underline">Terms</Link>
                        <Link to="/cookies" className="font-mono text-[11px] tracking-[0.08em] uppercase text-text-secondary hover:text-white transition-colors no-underline">Cookies</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
