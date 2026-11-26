import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { useTrainingSession } from '../context/TrainingSessionContext';
import Logo from './Logo';
import './footer.css';

type FooterLink = { to: string; label: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
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
];

const Footer: React.FC = () => {
    const { openEnterprise } = useTrainingSession();
    return (
        <footer className="vx-footer">
            <div className="vx-footer__inner">
                <div className="vx-footer__grid">
                    <div className="vx-footer__brand">
                        <Link to="/" className="vx-footer__logo">
                            <Logo size={24} className="vx-nav__logo" />
                            <span>Vortex<span className="vx-nav__brand-ml">ML</span></span>
                        </Link>
                        <p className="vx-footer__about">
                            The future of machine learning development. Build, configure, and train
                            models without extreme complexity.
                        </p>
                        <p className="vx-footer__award">
                            <Trophy size={14} strokeWidth={1.8} aria-hidden="true" />
                            <span>
                                1st place, Scientific Communication Session 2026 —
                                Politehnica University of Bucharest
                            </span>
                        </p>
                    </div>

                    {COLUMNS.map((col) => (
                        <div key={col.title}>
                            <h3 className="vx-footer__heading">{col.title}</h3>
                            <ul className="vx-footer__list">
                                {col.links.map((l) => (
                                    <li key={l.label}>
                                        {l.to === 'sales' ? (
                                            <button type="button" onClick={openEnterprise} className="vx-footer__link">
                                                {l.label}
                                            </button>
                                        ) : (
                                            <Link to={l.to} className="vx-footer__link">{l.label}</Link>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="vx-footer__base">
                    <p>&copy; {new Date().getFullYear()} VortexML — All rights reserved</p>
                    <div className="vx-footer__legal">
                        <Link to="/privacy" className="vx-footer__link">Privacy</Link>
                        <Link to="/terms" className="vx-footer__link">Terms</Link>
                        <Link to="/cookies" className="vx-footer__link">Cookies</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
