import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Mail, Lock, User, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const GLIDE = [0.22, 1, 0.36, 1] as const;

const Signup: React.FC = () => {
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { checkAuth } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        setLoading(true);
        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, username, password }),
            });
            const data = await res.json();
            if (res.ok) {
                await checkAuth();
                navigate('/survey');
            } else {
                setError(data.error || 'Registration failed');
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full overflow-hidden bg-bg-primary">
            {/* Ambient blobs */}
            <div className="pointer-events-none absolute inset-0 mix-blend-screen opacity-60">
                <div className="absolute -top-32 right-[-10%] w-[640px] h-[640px] rounded-full bg-accent-3/14 blur-[140px]" />
                <div className="absolute bottom-[-15%] left-[-5%] w-[520px] h-[520px] rounded-full bg-accent-1/15 blur-[140px]" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-accent-4/8 blur-[160px]" />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMzkuNUw0MCAzOS41IiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMikiLz48cGF0aCBkPSJNMzkuNSAwdjQwIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wMikiLz48L3N2Zz4=')] opacity-[0.18]" />

            <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-24">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.95, ease: GLIDE }}
                    className="w-full max-w-md"
                >
                    {/* Brand row */}
                    <div className="mb-10 flex items-center justify-center gap-2">
                        <span className="text-[22px] leading-none text-transparent bg-clip-text bg-gradient-to-br from-accent-1 to-accent-3">◎</span>
                        <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">
                            Vortex<span className="font-display italic font-normal text-accent-2 ml-0.5">ML</span>
                        </span>
                    </div>

                    {/* Header */}
                    <div className="text-center mb-10">
                        <p className="font-mono text-[10.5px] tracking-[0.32em] uppercase text-white/45 mb-4">
                            Step 00 / Sign Up
                        </p>
                        <h2
                            className="text-white font-semibold tracking-[-0.035em] leading-[1.04] mb-3"
                            style={{ fontSize: 'clamp(2rem, 3.4vw + 0.5rem, 2.85rem)' }}
                        >
                            Join the{' '}
                            <em className="not-italic font-display italic font-normal tracking-[-0.01em] text-transparent bg-clip-text bg-gradient-to-r from-accent-1 via-accent-3 to-accent-4">
                                Vortex.
                            </em>
                        </h2>
                        <p className="text-text-secondary font-light leading-[1.6] text-[15px]">
                            Create an account to start training models.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3 text-[13px] text-red-300 font-medium"
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
                            label="Username"
                            icon={User}
                            type="text"
                            placeholder="VortexCoder99"
                            value={username}
                            onChange={setUsername}
                            autoComplete="username"
                            required
                        />
                        <Field
                            label="Password"
                            icon={Lock}
                            type="password"
                            placeholder="6+ characters"
                            value={password}
                            onChange={setPassword}
                            autoComplete="new-password"
                            required
                            minLength={6}
                        />
                        <Field
                            label="Confirm"
                            icon={Lock}
                            type="password"
                            placeholder="Repeat password"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            autoComplete="new-password"
                            required
                        />

                        <PrimaryButton loading={loading}>
                            {loading ? 'Creating account…' : 'Create account'}
                        </PrimaryButton>

                        <p className="text-center text-[13px] text-white/45 mt-3 font-light">
                            Already have an account?{' '}
                            <Link
                                to="/signin"
                                className="text-white/90 hover:text-white transition-colors no-underline border-b border-white/30 hover:border-white pb-px"
                            >
                                Sign in
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
        <label className="group flex flex-col gap-2">
            <span className="font-mono text-[10.5px] tracking-[0.22em] uppercase text-white/55">
                {label}
            </span>
            <div className="relative">
                <Icon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-[15px] w-[15px] text-white/35 group-focus-within:text-white/85 transition-colors duration-300" strokeWidth={1.8} />
                <input
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    autoComplete={autoComplete}
                    required={required}
                    minLength={minLength}
                    className="w-full h-[54px] pl-[44px] pr-4 rounded-2xl bg-white/[0.04] border border-white/10 text-white text-[15px] tracking-[-0.005em] placeholder:text-white/25 outline-none focus:border-white/35 focus:bg-white/[0.06] transition-[border-color,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
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
            className="group relative mt-3 inline-flex h-[54px] items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-accent-1 via-accent-2 to-accent-3 px-7 text-[14.5px] font-medium tracking-[-0.005em] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_8px_28px_-4px_rgba(139,92,246,0.5)] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1)_inset,0_10px_36px_-4px_rgba(139,92,246,0.65)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.012] active:scale-[0.985] disabled:opacity-70 disabled:cursor-wait disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
        >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:translate-x-full transition-transform duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)]" />
            <span className="relative">{children}</span>
            {loading ? (
                <Loader2 className="relative h-[16px] w-[16px] animate-spin" strokeWidth={2.2} />
            ) : (
                <ArrowRight className="relative h-[16px] w-[16px] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-1" strokeWidth={2.2} />
            )}
        </button>
    );
};

export default Signup;
