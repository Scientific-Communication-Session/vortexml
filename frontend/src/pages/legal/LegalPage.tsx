import React from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../../site';
import { useTrainingSession } from '../../context/TrainingSessionContext';
import './legal.css';

export interface LegalSection {
    id: string;
    title: string;
    body: React.ReactNode;
}

/** How to reach us: the address when there is one, the contact form otherwise. */
export const Contact: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { openEnterprise } = useTrainingSession();
    if (SITE.contactEmail) {
        return <a href={`mailto:${SITE.contactEmail}`}>{children ?? SITE.contactEmail}</a>;
    }
    return (
        <button type="button" className="lg-link" onClick={openEnterprise}>
            {children ?? 'the contact form'}
        </button>
    );
};

const OTHERS = [
    { to: '/terms', label: 'Terms of Service' },
    { to: '/privacy', label: 'Privacy Policy' },
    { to: '/cookies', label: 'Cookie Policy' },
    { to: '/about', label: 'About' },
];

// The shared shell of the long-form pages: a heading, a short plain-language
// summary, a contents rail and numbered sections.
const LegalPage: React.FC<{
    eyebrow: string;
    title: React.ReactNode;
    lead: React.ReactNode;
    updated?: boolean;
    summary?: React.ReactNode[];
    sections: LegalSection[];
    path: string;
    children?: React.ReactNode;
}> = ({ eyebrow, title, lead, updated = true, summary, sections, path, children }) => (
    <article className="lg-page">
        <header className="lg-head">
            <div className="lg-eyebrow">{eyebrow}</div>
            <h1>{title}</h1>
            <p className="lg-lead">{lead}</p>
            {updated && <p className="lg-updated">Last updated: {SITE.legalUpdated}</p>}
        </header>

        <div className="lg-layout">
            <nav className="lg-toc" aria-label="On this page">
                <div className="lg-toc__label">On this page</div>
                {sections.map((s, i) => (
                    <a key={s.id} href={`#${s.id}`}>{updated ? `${i + 1}. ` : ''}{s.title}</a>
                ))}
            </nav>

            <div className="lg-body">
                {children}
                {summary && (
                    <aside className="lg-summary" aria-label="Summary">
                        <h2>In short</h2>
                        <ul>{summary.map((item, i) => <li key={i}>{item}</li>)}</ul>
                    </aside>
                )}
                {sections.map((s, i) => (
                    <section key={s.id} id={s.id} className="lg-section">
                        <h2>{updated ? `${i + 1}. ` : ''}{s.title}</h2>
                        {s.body}
                    </section>
                ))}
                <div className="lg-others">
                    {OTHERS.filter((o) => o.to !== path).map((o) => <Link key={o.to} to={o.to}>{o.label}</Link>)}
                </div>
            </div>
        </div>
    </article>
);

export default LegalPage;
