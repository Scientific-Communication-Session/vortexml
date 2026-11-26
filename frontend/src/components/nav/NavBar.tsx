import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
    Activity, ChevronDown, Database, FileSearch, GraduationCap, Layers, Map, Menu,
    MessagesSquare, Target, Trophy, X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import SessionPill from '../session/SessionPill';
import Logo from '../Logo';
import './nav.css';

// Grouped navigation. Every page from the old flat bar is here, at most one
// click deeper. Descriptions are the page titles from pageMeta.ts.
type Item = { to: string; label: string; hint: string; icon: React.ElementType };
type Group = { id: string; label: string; items: Item[] };

const DEMO = { to: '/demo', label: 'Demo' };

const GROUPS: Group[] = [
    {
        id: 'build',
        label: 'Build',
        items: [
            { to: '/dataset', label: 'Dataset', hint: 'Upload and choose what to predict', icon: Database },
            { to: '/architect', label: 'Architect', hint: 'Design the network', icon: Layers },
            { to: '/training', label: 'Training', hint: 'Live loss and accuracy', icon: Activity },
            { to: '/predict', label: 'Predict', hint: 'Ask your trained model', icon: Target },
        ],
    },
    {
        id: 'ai',
        label: 'AI',
        items: [
            { to: '/assistant', label: 'Assistant', hint: 'Ask your documents', icon: FileSearch },
            { to: '/chat', label: 'Chat', hint: 'Talk to a language model', icon: MessagesSquare },
        ],
    },
    {
        id: 'learn',
        label: 'Learn',
        items: [
            { to: '/tutorial', label: 'Tutorial', hint: 'Your first model in ten minutes', icon: GraduationCap },
            { to: '/learn', label: 'Learn', hint: 'A machine learning roadmap', icon: Map },
            { to: '/leaderboard', label: 'Leaderboard', hint: 'Compare your training runs', icon: Trophy },
        ],
    },
];

const isUnder = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

// ─── One dropdown ────────────────────────────────────────────────────────────
// A disclosure: a button that shows a list of links. Opens on click, on hover
// with a mouse, and from the keyboard (Enter, Space, ArrowDown). The panel
// grows out of its trigger.
const NavMenu: React.FC<{
    group: Group;
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
}> = ({ group, open, onOpen, onClose }) => {
    const { pathname } = useLocation();
    const reduce = useReducedMotion();
    const panelId = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<number | undefined>(undefined);
    const active = group.items.some((i) => isUnder(pathname, i.to));

    const links = () => Array.from(panel.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);

    const focusLink = (index: number) => {
        const all = links();
        if (all.length) all[(index + all.length) % all.length].focus();
    };

    const hoverOpen = (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        window.clearTimeout(closeTimer.current);
        onOpen();
    };
    const hoverClose = (e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        closeTimer.current = window.setTimeout(onClose, 140);
    };
    useEffect(() => () => window.clearTimeout(closeTimer.current), []);

    const onTriggerKey = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            onOpen();
            requestAnimationFrame(() => focusLink(0));
        }
    };

    const onPanelKey = (e: React.KeyboardEvent) => {
        const all = links();
        const i = all.indexOf(document.activeElement as HTMLAnchorElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); focusLink(i + 1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); focusLink(i - 1); }
        if (e.key === 'Home') { e.preventDefault(); focusLink(0); }
        if (e.key === 'End') { e.preventDefault(); focusLink(all.length - 1); }
        if (e.key === 'Escape') { e.preventDefault(); onClose(); trigger.current?.focus(); }
    };

    return (
        <div className="vx-nav__menu" onPointerEnter={hoverOpen} onPointerLeave={hoverClose}>
            <button
                ref={trigger}
                type="button"
                className={`vx-nav__link vx-nav__trigger${active ? ' is-active' : ''}`}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => (open ? onClose() : onOpen())}
                onKeyDown={onTriggerKey}
            >
                {group.label}
                <ChevronDown className="vx-nav__chevron" size={14} strokeWidth={2} aria-hidden="true" />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        ref={panel}
                        id={panelId}
                        className="vx-nav__panel"
                        onKeyDown={onPanelKey}
                        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -2 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <ul>
                            {group.items.map(({ to, label, hint, icon: Icon }) => (
                                <li key={to}>
                                    <NavLink
                                        to={to}
                                        className={({ isActive }) => `vx-nav__item${isActive ? ' is-active' : ''}`}
                                        onClick={onClose}
                                    >
                                        <span className="vx-nav__item-icon"><Icon size={16} strokeWidth={1.75} aria-hidden="true" /></span>
                                        <span className="vx-nav__item-text">
                                            <span className="vx-nav__item-label">{label}</span>
                                            <span className="vx-nav__item-hint">{hint}</span>
                                        </span>
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ─── The bar ────────────────────────────────────────────────────────────────
const NavBar: React.FC = () => {
    const { user, setUser } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const reduce = useReducedMotion();
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [sheet, setSheet] = useState(false);
    const bar = useRef<HTMLElement>(null);
    const sheetId = useId();

    const closeAll = useCallback(() => { setOpenMenu(null); setSheet(false); }, []);

    // Close on navigation (adjusted during render, not in an effect).
    const [lastPath, setLastPath] = useState(pathname);
    if (pathname !== lastPath) {
        setLastPath(pathname);
        setOpenMenu(null);
        setSheet(false);
    }

    // Close on a click outside the bar, or Escape anywhere.
    useEffect(() => {
        if (!openMenu && !sheet) return;
        const onDown = (e: PointerEvent) => {
            if (bar.current && !bar.current.contains(e.target as Node)) closeAll();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [openMenu, sheet, closeAll]);

    const handleLogout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            setUser(null);
            navigate('/');
        } catch (error) {
            console.error('Failed to logout:', error);
        }
    };

    const account = user ? (
        <>
            <span className="vx-nav__user">
                {user.username}
                <span className="vx-nav__level">{user.is_beginner ? 'Novice' : 'Expert'}</span>
            </span>
            <NavLink to="/profile" title="Open your profile" className={({ isActive }) => `vx-btn vx-btn--ghost vx-btn--sm${isActive ? ' is-active' : ''}`}>
                Profile
            </NavLink>
            <button type="button" onClick={handleLogout} className="vx-btn vx-btn--ghost vx-btn--sm">
                Logout
            </button>
        </>
    ) : (
        <>
            <NavLink to="/signin" className="vx-btn vx-btn--quiet vx-btn--sm">Sign In</NavLink>
            <NavLink to="/signup" className="vx-btn vx-btn--primary vx-btn--sm">Sign Up</NavLink>
        </>
    );

    return (
        <nav ref={bar} aria-label="Primary" className="vx-nav">
            <div className="vx-nav__bar">
                <NavLink to="/" aria-label="VortexML, home" className="vx-nav__brand">
                    <Logo size={22} className="vx-nav__logo" />
                    <span>Vortex<span className="vx-nav__brand-ml">ML</span></span>
                </NavLink>

                <div className="vx-nav__center">
                    <NavLink to={DEMO.to} className={({ isActive }) => `vx-nav__link${isActive ? ' is-active' : ''}`}>
                        {DEMO.label}
                    </NavLink>
                    {GROUPS.map((g) => (
                        <NavMenu
                            key={g.id}
                            group={g}
                            open={openMenu === g.id}
                            onOpen={() => setOpenMenu(g.id)}
                            onClose={() => setOpenMenu((cur) => (cur === g.id ? null : cur))}
                        />
                    ))}
                </div>

                <div className="vx-nav__end">
                    <SessionPill />
                    <div className="vx-nav__account">{account}</div>
                    <button
                        type="button"
                        className="vx-nav__burger"
                        aria-expanded={sheet}
                        aria-controls={sheetId}
                        aria-label={sheet ? 'Close menu' : 'Open menu'}
                        onClick={() => setSheet((s) => !s)}
                    >
                        {sheet ? <X size={20} strokeWidth={1.75} /> : <Menu size={20} strokeWidth={1.75} />}
                    </button>
                </div>
            </div>

            {/* Phones and tablets: the same groups in one sheet */}
            <AnimatePresence>
                {sheet && (
                    <motion.div
                        id={sheetId}
                        className="vx-nav__sheet"
                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <NavLink to={DEMO.to} className={({ isActive }) => `vx-nav__sheet-link${isActive ? ' is-active' : ''}`}>
                            {DEMO.label}
                        </NavLink>
                        {GROUPS.map((g) => (
                            <div key={g.id} className="vx-nav__sheet-group">
                                <p className="vx-nav__sheet-label">{g.label}</p>
                                <ul>
                                    {g.items.map(({ to, label, icon: Icon }) => (
                                        <li key={to}>
                                            <NavLink to={to} className={({ isActive }) => `vx-nav__sheet-link${isActive ? ' is-active' : ''}`}>
                                                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                                                {label}
                                            </NavLink>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        <div className="vx-nav__sheet-account">{account}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </nav>
    );
};

export default NavBar;
