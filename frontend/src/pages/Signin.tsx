import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Mail, Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import './auth.css';

const GLIDE = [0.22, 1, 0.36, 1] as const;

const Signin: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { checkAuth } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const res = await fetch('/api/auth/signin', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (res.ok) {
                await checkAuth();
                navigate('/');
            } else {
                setError(data.error || 'Authentication failed');
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full overflow-hidden bg-bg-primary">
            <div className="vx-auth__light" aria-hidden="true" />

            <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-24">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.95, ease: GLIDE }}
                    className="w-full max-w-md"
                >
                    {/* Brand row */}
                    <div className="mb-10 flex items-center justify-center gap-2">
                        <Logo size={24} className="shrink-0" />
                        <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">
                            Vortex<span className="vx-nav__brand-ml">ML</span>
                        </span>
                    </div>

                    {/* Header */}
                    <div className="text-center mb-10">
                        <p className="vx-label mb-4">
                            Step 01 / Sign In
                        </p>
                        <h2
                            className="text-white font-semibold tracking-[-0.035em] leading-[1.04] mb-3"
                            style={{ fontSize: 'clamp(2rem, 3.4vw + 0.5rem, 2.85rem)' }}
                        >
                            Welcome{' '}
                            <em className="not-italic font-normal text-text-secondary">
                                back.
                            </em>
                        </h2>
                        <p className="text-text-secondary font-light leading-[1.6] text-[15px]">
                            Continue training where you left off.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                role="alert"
                                className="info-banner info-banner--danger"
                            >
                                {error}
                            </motion.div>
                        )}

                        <Field
                            label="Email"
                            icon={Mail}
                            type="email"
                            placeholder="neural@vortex.ai"
                            value={email}
                            onChange={setEmail}
                            autoComplete="email"
                            required
                        />
                        <Field
                            label="Password"
                            icon={Lock}
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={setPassword}
                            autoComplete="current-password"
                            required
                            minLength={6}
                        />

                        <PrimaryButton loading={loading}>
                            {loading ? 'Signing in…' : 'Sign in'}
                        </PrimaryButton>

                        <p className="text-center text-[13px] text-text-secondary mt-3">
                            New to VortexML?{' '}
                            <Link
                                to="/signup"
                                className="text-white/90 hover:text-white transition-colors no-underline border-b border-white/30 hover:border-white pb-px"
                            >
                                Create an account
                            </Link>
                        </p>
                    </form>
                </motion.div>
            </div>
        </div>
    );
};

const Field: React.FC<{
    label: string;
    icon: React.ElementType;
    type: string;
    placeholder?: string;
    value: string;
    onChange: (v: string) => void;
    autoComplete?: string;
    required?: boolean;
    minLength?: number;
}> = ({ label, icon: Icon, type, placeholder, value, onChange, autoComplete, required, minLength }) => {
    return (
        <label className="au-field">
            <span className="au-field__label">
                {label}
            </span>
            <div className="relative">
                <Icon className="au-field__icon" strokeWidth={1.8} />
                <input
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    autoComplete={autoComplete}
                    required={required}
                    minLength={minLength}
                    className="au-field__input"
                />
            </div>
        </label>
    );
};

const PrimaryButton: React.FC<{ children: React.ReactNode; loading?: boolean }> = ({ children, loading }) => {
    return (
        <button
            type="submit"
            disabled={loading}
            className="vx-btn vx-btn--primary vx-btn--lg vx-auth__submit"
        >
            <span>{children}</span>
            {loading ? (
                <Loader2 size={16} className="vx-spin" strokeWidth={2.2} aria-hidden="true" />
            ) : (
                <ArrowRight size={16} className="vx-btn__arrow" strokeWidth={2.2} aria-hidden="true" />
            )}
        </button>
    );
};

export default Signin;
