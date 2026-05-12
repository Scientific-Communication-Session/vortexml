import React from 'react';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
    return (
        <footer className="relative z-10 w-full border-t border-white/10 bg-[#04040a]">
            {/* Top hairline accent */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-px bg-gradient-to-r from-transparent via-accent-2/40 to-transparent" />

            <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-12 md:gap-8">
                    <div className="col-span-2 md:col-span-1">
                        <Link to="/" className="flex items-center gap-2 mb-5 no-underline group">
                            <span className="text-xl text-transparent bg-clip-text bg-gradient-to-br from-accent-1 to-accent-3 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-90">◎</span>
                            <span className="text-[17px] font-semibold text-text-primary tracking-[-0.02em]">
                                Vortex<span className="font-display italic font-normal tracking-[-0.01em] text-accent-2">ML</span>
                            </span>
                        </Link>
                        <p className="text-[14px] text-text-secondary leading-[1.6] max-w-xs font-light tracking-[0.002em]">
                            The future of machine learning development. Build, configure, and{' '}
                            <em className="font-display italic font-normal text-text-primary">train</em>{' '}
                            models without extreme complexity.
                        </p>
                    </div>

                    {[
                        {
                            title: 'Product',
                            links: [
                                { to: '/architect', label: 'Architect Builder' },
                                { to: '/dataset', label: 'Dataset Processing' },
                                { to: '/training', label: 'Live Training' },
                            ],
                        },
                        {
                            title: 'Resources',
                            links: [
                                { to: '/courses', label: 'ML Courses' },
                                { to: '#', label: 'Documentation' },
                                { to: '#', label: 'Community' },
                            ],
                        },
                        {
                            title: 'Company',
                            links: [
                                { to: '#', label: 'About Us' },
                                { to: '#', label: 'Blog' },
                                { to: '#', label: 'Contact' },
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
                        &copy; {new Date().getFullYear()} VORTEXML PLATFORM — ALL RIGHTS RESERVED
                    </p>
                    <div className="flex gap-6">
                        <a href="#" className="font-mono text-[11px] tracking-[0.08em] uppercase text-text-secondary hover:text-white transition-colors">Privacy</a>
                        <a href="#" className="font-mono text-[11px] tracking-[0.08em] uppercase text-text-secondary hover:text-white transition-colors">Terms</a>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
