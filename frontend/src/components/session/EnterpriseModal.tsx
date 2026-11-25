import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Check, CircleCheck, Loader2, Send, Server, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './session.css';

interface Props {
    onClose: () => void;
    /** Jump to the "link your own device" flow instead. */
    onEnroll: () => void;
}

const INTERESTS = [
    { value: 'priority', label: 'High priority — no queue' },
    { value: 'parallel', label: 'Training several models at once' },
    { value: 'tailored', label: 'A configuration tailored to our workloads' },
    { value: 'other', label: 'Something else' },
];

const Plan: React.FC<{
    icon: React.ReactNode;
    name: string;
    chip: React.ReactNode;
    points: string[];
    featured?: boolean;
    action?: React.ReactNode;
}> = ({ icon, name, chip, points, featured, action }) => (
    <div className={`vx-plan ${featured ? 'vx-plan--featured' : ''}`}>
        <div className="vx-plan__head">
            <span className="vx-plan__name">{icon} {name}</span>
            {chip}
        </div>
        <ul>
            {points.map((p) => (
                <li key={p}><Check size={13} strokeWidth={2.4} /> <span>{p}</span></li>
            ))}
        </ul>
        {action}
    </div>
);

/** Plans at a glance + the "talk to sales" form (stored via /api/sales/contact). */
const EnterpriseModal: React.FC<Props> = ({ onClose, onEnroll }) => {
    const { user } = useAuth();
    const [name, setName] = useState(user?.username || '');
    const [email, setEmail] = useState(user?.email || '');
    const [company, setCompany] = useState('');
    const [interest, setInterest] = useState(INTERESTS[0].value);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = overflow;
        };
    }, [onClose]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (sending) return;
        setSending(true);
        setError(null);
        try {
            const res = await fetch('/api/sales/contact', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, company, interest, message }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || `Could not send your message (HTTP ${res.status}).`);
            } else {
                setSent(true);
            }
        } catch {
            setError('Could not reach the server — check your connection and try again.');
        } finally {
            setSending(false);
        }
    };

    return createPortal(
        <div className="vx-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="vx-ent-title">
            <div className="vx-modal vx-modal--wide" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="vx-close" onClick={onClose} aria-label="Close">
                    <X size={17} />
                </button>

                <div className="vx-eyebrow"><span className="vx-dot vx-dot--violet vx-dot--still" /> VortexML Enterprise</div>
                <h2 className="vx-title" id="vx-ent-title">Skip the queue. Train <em>in parallel.</em></h2>
                <p className="vx-lede">
                    The shared Mac mini is free for everyone, which is exactly why it has a queue. When training is
                    part of your work rather than an experiment, we build the setup around you.
                </p>

                <div className="vx-ent">
                    <div className="vx-plans">
                        <Plan
                            icon={<Users size={16} />}
                            name="Free tier"
                            chip={<span className="vx-chip vx-chip--cyan">Shared Mac mini</span>}
                            points={[
                                'Train on the shared VortexML M4 Mac mini',
                                'One run at a time — first come, first served',
                                'Runs keep going in the background after you close the tab',
                            ]}
                        />
                        <Plan
                            icon={<Server size={16} />}
                            name="Your own server"
                            chip={<span className="vx-chip vx-chip--violet">Free · your hardware</span>}
                            points={[
                                'Link a Mac or Linux machine you own to your account',
                                'It only runs your jobs, so there is nobody to queue behind',
                            ]}
                            action={(
                                <button type="button" className="vx-link" style={{ marginTop: '0.55rem', fontSize: '0.83rem' }} onClick={onEnroll}>
                                    Enroll a server now →
                                </button>
                            )}
                        />
                        <Plan
                            featured
                            icon={<Building2 size={16} />}
                            name="Enterprise"
                            chip={<span className="vx-chip vx-chip--green">Talk to us</span>}
                            points={[
                                'Personalised solutions with configurations tailored to your workloads',
                                'High priority — your runs never wait in a queue',
                                'Train multiple models at once and compare the outcomes side by side',
                            ]}
                        />
                    </div>

                    {sent ? (
                        <div className="vx-sent">
                            <span className="vx-sent__icon"><CircleCheck size={28} /></span>
                            <h3>Message received</h3>
                            <p>Thanks, {name.split(' ')[0] || 'there'}. Our team will get back to you at <strong style={{ color: '#fff' }}>{email}</strong>.</p>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} style={{ marginTop: '0.4rem' }}>
                                Close
                            </button>
                        </div>
                    ) : (
                        <form className="vx-form" onSubmit={submit} noValidate>
                            <div className="vx-form__row">
                                <div className="vx-field">
                                    <label htmlFor="vx-ent-name">Your name</label>
                                    <input id="vx-ent-name" value={name} onChange={(e) => setName(e.target.value)}
                                        autoComplete="name" maxLength={120} required />
                                </div>
                                <div className="vx-field">
                                    <label htmlFor="vx-ent-email">Work email</label>
                                    <input id="vx-ent-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="email" maxLength={200} required />
                                </div>
                            </div>
                            <div className="vx-form__row">
                                <div className="vx-field">
                                    <label htmlFor="vx-ent-company">Company <span style={{ opacity: 0.6 }}>(optional)</span></label>
                                    <input id="vx-ent-company" value={company} onChange={(e) => setCompany(e.target.value)}
                                        autoComplete="organization" maxLength={160} />
                                </div>
                                <div className="vx-field">
                                    <label htmlFor="vx-ent-interest">What matters most</label>
                                    <select id="vx-ent-interest" value={interest} onChange={(e) => setInterest(e.target.value)}>
                                        {INTERESTS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="vx-field">
                                <label htmlFor="vx-ent-message">What are you training?</label>
                                <textarea id="vx-ent-message" value={message} onChange={(e) => setMessage(e.target.value)}
                                    maxLength={4000} required
                                    placeholder="Dataset sizes, how many models you'd like to run side by side, any hardware or deadline constraints…" />
                            </div>
                            {error && <div className="vx-form__error" role="alert">{error}</div>}
                            <button type="submit" className="btn btn-primary" disabled={sending}>
                                {sending ? <Loader2 size={15} className="chat-msg__spinner" /> : <Send size={15} />}
                                {sending ? 'Sending…' : 'Contact sales'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default EnterpriseModal;
