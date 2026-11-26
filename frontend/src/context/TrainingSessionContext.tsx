import React, {
    createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import type { Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import {
    isActive, isTerminal,
    type EpochPoint, type JobView, type RunConfig, type RunFinal, type RunInfo, type RunView, type SysStat,
} from '../components/session/types';

/**
 * Background training sessions.
 *
 * A training run lives on the server, not in the tab that started it. This
 * provider is the browser's view of the caller's runs: it asks the server what
 * is running or queued (`/api/training/active`), attaches to each run to
 * replay everything that happened so far, and then follows the live socket
 * stream. It sits above the router's pages, so the run keeps streaming while
 * you move around the app — and a tab opened later, or a different browser
 * signed in to the same account, picks the run up exactly where it is.
 */

type AckScope = 'tab' | 'browser';
type Overlay = 'enterprise' | 'add-device' | null;

interface StartResult {
    status?: 'started' | 'queued';
    job_id?: string;
    position?: number;
    ahead?: number;
    job?: JobView;
    error?: string;
}

interface TrainingSessionValue {
    /** True once the first status check has come back. */
    ready: boolean;
    /** Running + queued runs, running first. */
    jobs: JobView[];
    /** The most recent finished run (kept by the server for a day). */
    lastRun: JobView | null;
    /** The run the dashboards should show (see `setFocus`). */
    focusRun: RunView | null;
    getRun: (jobId: string | null | undefined) => RunView | null;
    setFocus: (jobId: string | null) => void;
    /** Bumps whenever any run data changed — handy as an effect dependency. */
    version: number;

    start: (deviceId: number | null) => Promise<StartResult>;
    stop: (jobId: string) => Promise<void>;
    cancel: (jobId: string) => Promise<boolean>;
    refresh: () => Promise<void>;
    /** Pull a run's full history from the server (no-op if already loaded). */
    hydrate: (jobId: string) => Promise<void>;

    /** "The user has seen this run here" — drives the welcome-back prompt. */
    ack: (jobId: string, scope?: AckScope) => void;
    isAcked: (jobId: string) => boolean;

    overlay: Overlay;
    openEnterprise: () => void;
    openAddDevice: () => void;
    closeOverlay: () => void;
    /** Bumps when a device was linked, so device lists can reload. */
    deviceEpoch: number;
    notifyDeviceCreated: () => void;
}

const noop = () => { };
const TrainingSessionContext = createContext<TrainingSessionValue>({
    ready: false, jobs: [], lastRun: null, focusRun: null,
    getRun: () => null, setFocus: noop, version: 0,
    start: async () => ({ error: 'Training session is not available.' }),
    stop: async () => { }, cancel: async () => false, refresh: async () => { }, hydrate: async () => { },
    ack: noop, isAcked: () => false,
    overlay: null, openEnterprise: noop, openAddDevice: noop, closeOverlay: noop,
    deviceEpoch: 0, notifyDeviceCreated: noop,
});

// eslint-disable-next-line react-refresh/only-export-components
export const useTrainingSession = () => useContext(TrainingSessionContext);

// ── "seen" bookkeeping ──────────────────────────────────────────────────────
// Tab scope (sessionStorage): this tab already knows about the run, so don't
// greet the user with it. A new tab or another browser starts empty and asks.
// Browser scope (localStorage): a finished run's outcome was already shown here.
const ACK_KEY = 'vortex:runs-acked';

function readAcks(storage: Storage | undefined): string[] {
    try {
        const raw = storage?.getItem(ACK_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

// Storage can be unavailable (private mode, blocked cookies); this in-memory
// copy makes sure a dismissed prompt at least stays dismissed for the page's life.
const memoryAcks = new Set<string>();

function writeAck(storage: Storage | undefined, jobId: string) {
    memoryAcks.add(jobId);
    try {
        const list = readAcks(storage).filter((id) => id !== jobId);
        list.push(jobId);
        storage?.setItem(ACK_KEY, JSON.stringify(list.slice(-30)));
    } catch {
        /* storage unavailable — `memoryAcks` still covers this page load */
    }
}

const safeStorage = (kind: 'session' | 'local'): Storage | undefined => {
    try {
        return kind === 'session' ? window.sessionStorage : window.localStorage;
    } catch {
        return undefined;
    }
};

const blankJob = (job_id: string): JobView => ({
    job_id, device_id: 0, device_name: null, is_local: true, project_name: null,
    status: 'running', position: 0, ahead: 0, wait_seconds: null,
    epoch: 0, total_epochs: 0, eta_seconds: null,
    queued_at: null, started_at: null, demo_key: null,
});

interface StoredRun extends RunView {
    /** performance.now() when this tab first learned of the run. */
    createdAt: number;
    /** The end-of-run toast has been shown (or deliberately skipped). */
    announced: boolean;
    /** performance.now() of the last live socket event that said "running". */
    liveAt: number;
}

/**
 * Fold a job view fetched over HTTP into a run. HTTP answers and socket events
 * travel separately, so an answer can be older than what the socket already
 * said: never let it bring a finished run back, or turn a run the socket has
 * just seen start back into "queued".
 */
function mergeJob(run: StoredRun, incoming: JobView, askedAt: number) {
    if (isTerminal(run.job.status)) return;
    if (incoming.status === 'queued' && run.job.status === 'running' && run.liveAt > askedAt) return;
    run.job = {
        ...run.job,
        ...incoming,
        epoch: incoming.status === 'queued' ? incoming.epoch : Math.max(run.job.epoch, incoming.epoch),
    };
}

const MAX_STATS = 60;
const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 20000;

export const TrainingSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, isLoading: authLoading } = useAuth();
    const userId = user?.id ?? null;

    // Run data changes many times a second while training; it lives in refs and
    // the tree is re-rendered at most ~16×/s through `schedule`.
    const runsRef = useRef<Map<string, StoredRun>>(new Map());
    const lastRunRef = useRef<JobView | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const flushTimer = useRef<number | null>(null);
    const hydrating = useRef<Set<string>>(new Set());
    // Bumped on sign in / out so answers to the previous identity's requests
    // are dropped instead of leaking into the new one's view.
    const identity = useRef(0);
    const [version, bump] = useReducer((x: number) => x + 1, 0);
    const [ready, setReady] = useState(false);
    const [focusId, setFocusId] = useState<string | null>(null);
    const [overlay, setOverlay] = useState<Overlay>(null);
    const [deviceEpoch, setDeviceEpoch] = useState(0);

    const schedule = useCallback(() => {
        if (flushTimer.current != null) return;
        flushTimer.current = window.setTimeout(() => {
            flushTimer.current = null;
            bump();
        }, 60);
    }, []);

    const ack = useCallback((jobId: string, scope: AckScope = 'tab') => {
        writeAck(safeStorage(scope === 'tab' ? 'session' : 'local'), jobId);
        schedule();
    }, [schedule]);

    const isAcked = useCallback((jobId: string) => (
        memoryAcks.has(jobId)
        || readAcks(safeStorage('session')).includes(jobId)
        || readAcks(safeStorage('local')).includes(jobId)
    ), []);

    const ensureRun = useCallback((job: Partial<JobView> & { job_id: string }): StoredRun => {
        let run = runsRef.current.get(job.job_id);
        if (!run) {
            run = {
                job: { ...blankJob(job.job_id), ...job },
                config: null, info: null, history: [], stats: [],
                final: job.final ?? null, message: null, hydrated: false,
                createdAt: performance.now(), announced: false, liveAt: 0,
            };
            runsRef.current.set(job.job_id, run);
        }
        return run;
    }, []);

    /** Mark a run finished and tell the user — once, however we found out. */
    const conclude = useCallback((
        run: StoredRun, status: 'complete' | 'stopped' | 'error',
        final: RunFinal | null, message: string | null, live: boolean,
    ) => {
        run.job = { ...run.job, status, eta_seconds: null, final: final ?? run.job.final ?? null };
        if (final) run.final = final;
        if (message) run.message = message;
        if (run.announced) return;
        run.announced = true;
        const name = run.job.project_name || 'Your run';
        if (status === 'complete') {
            if (final?.early_stopped) {
                showToast(`${name}: early stopping at epoch ${final.stopped_epoch}`, 'warning');
            } else {
                showToast(`${name} finished training`, 'success');
            }
        } else if (status === 'error') {
            showToast(`Training error: ${message || 'the run failed'}`, 'error');
        } else if (live) {
            showToast('Training stopped.', 'warning');
        }
        // Seen live in this tab → no "finished while you were away" later.
        if (live) {
            writeAck(safeStorage('session'), run.job.job_id);
            writeAck(safeStorage('local'), run.job.job_id);
        }
    }, []);

    const hydrate = useCallback(async (jobId: string) => {
        const existing = runsRef.current.get(jobId);
        if (existing?.hydrated && isTerminal(existing.job.status)) return;
        if (hydrating.current.has(jobId)) return;
        hydrating.current.add(jobId);
        const who = identity.current;
        const askedAt = performance.now();
        let snap: {
            job?: JobView; config?: RunConfig; info?: RunInfo | null;
            history?: EpochPoint[]; stats?: SysStat[]; final?: RunFinal | null; error?: string;
        };
        try {
            snap = await apiPost(`/api/training/jobs/${jobId}/attach`, {
                socket_id: socketRef.current?.connected ? socketRef.current.id : undefined,
            });
        } catch {
            return;
        } finally {
            hydrating.current.delete(jobId);
        }
        if (who !== identity.current || !snap || snap.error || !snap.job) return;
        const run = ensureRun(snap.job);
        // The live stream may already have delivered epochs newer than the
        // snapshot — keep those, take everything older from the snapshot.
        const base = snap.history || [];
        const lastEpoch = base.length ? base[base.length - 1].epoch : 0;
        run.history = base.concat(run.history.filter((p) => p.epoch > lastEpoch));
        if (!run.stats.length && snap.stats) run.stats = snap.stats.slice(-MAX_STATS);
        run.info = run.info || snap.info || null;
        run.config = snap.config || run.config;
        if (isTerminal(snap.job.status)) {
            run.job = { ...run.job, ...snap.job };
            run.final = snap.final || run.final;
            run.announced = true;
        } else {
            mergeJob(run, snap.job, askedAt);
        }
        run.hydrated = true;
        schedule();
    }, [ensureRun, schedule]);

    const refresh = useCallback(async () => {
        const askedAt = performance.now();
        const who = identity.current;
        let data: { jobs?: JobView[]; last_run?: JobView | null };
        try {
            data = await apiGet('/api/training/active');
        } catch {
            return;
        }
        if (who !== identity.current) return;
        const runs = runsRef.current;
        const seen = new Set<string>();
        for (const job of data.jobs || []) {
            seen.add(job.job_id);
            const run = ensureRun(job);
            if (isTerminal(run.job.status)) continue;
            mergeJob(run, job, askedAt);
            if (!run.hydrated) void attachRef.current(job.job_id);
        }

        const last = data.last_run || null;
        lastRunRef.current = last;
        if (last) {
            const run = ensureRun(last);
            if (isActive(run.job.status) && !seen.has(last.job_id)) {
                // It ended while this tab wasn't listening (closed, asleep, offline).
                conclude(run, last.status as 'complete' | 'stopped' | 'error',
                    last.final ?? null, last.final?.message ?? null, false);
                run.hydrated = false;
                void hydrate(last.job_id);
            } else if (isTerminal(run.job.status)) {
                run.job = { ...run.job, ...last };
                run.final = run.final || last.final || null;
                run.announced = true;
            }
        }

        // Anything we still think is active but the server no longer lists was
        // cancelled or cleared elsewhere. (Runs this tab learned of after the
        // request went out are simply newer than the answer — leave them.)
        for (const [id, run] of runs) {
            if (isActive(run.job.status) && !seen.has(id) && run.createdAt < askedAt
                && last?.job_id !== id) {
                runs.delete(id);
            }
        }
        setReady(true);
        schedule();
    }, [conclude, ensureRun, hydrate, schedule]);

    // ── Socket ──────────────────────────────────────────────────────────────
    // Opened lazily: only once there is a run to follow, or one is about to be
    // started. Visitors who are just reading the site never hold a connection.
    const attachRef = useRef<(jobId: string) => Promise<void>>(async () => { });

    const bindSocket = useCallback((socket: Socket) => {
        const runOf = (data: { job_id?: string } | undefined) =>
            (data?.job_id ? ensureRun({ job_id: data.job_id }) : null);

        socket.on('connect', () => {
            // (Re)join every live run's room with the new socket id and pick
            // up whatever was missed while disconnected.
            for (const run of runsRef.current.values()) {
                if (isActive(run.job.status)) {
                    run.hydrated = false;
                    void hydrate(run.job.job_id);
                }
            }
        });

        socket.on('training_started', (data: { job_id: string; job?: JobView }) => {
            const run = runOf(data);
            if (!run || isTerminal(run.job.status)) return;
            run.job = { ...run.job, ...(data.job || {}), status: 'running', position: 0, ahead: 0 };
            run.liveAt = performance.now();
            run.history = [];
            run.stats = [];
            run.info = null;
            run.final = null;
            run.message = null;
            schedule();
        });

        socket.on('training_info', (data: RunInfo & { job_id: string }) => {
            const run = runOf(data);
            if (!run) return;
            run.info = data;
            if (isActive(run.job.status)) {
                run.job = { ...run.job, status: 'running' };
                run.liveAt = performance.now();
            }
            schedule();
        });

        socket.on('training_update', (data: EpochPoint & { job_id: string }) => {
            const run = runOf(data);
            if (!run || isTerminal(run.job.status)) return;
            const last = run.history[run.history.length - 1];
            if (last && data.epoch <= last.epoch) return; // already replayed
            run.history.push(data);
            run.liveAt = performance.now();
            run.job = {
                ...run.job, status: 'running', epoch: data.epoch,
                total_epochs: data.total_epochs, eta_seconds: data.eta_seconds,
            };
            schedule();
        });

        socket.on('system_stats', (data: SysStat & { job_id: string }) => {
            const run = runOf(data);
            if (!run) return;
            run.stats.push(data);
            if (run.stats.length > MAX_STATS) run.stats.splice(0, run.stats.length - MAX_STATS);
            schedule();
        });

        socket.on('training_complete', (data: RunFinal & { job_id: string; history?: unknown; model_path?: unknown }) => {
            const run = runOf(data);
            if (!run) return;
            const final = { ...data } as Record<string, unknown>;
            delete final.history;
            delete final.model_path;
            delete final.job_id;
            conclude(run, 'complete', final as RunFinal, null, true);
            schedule();
            void refresh();
        });

        socket.on('training_stopped', (data: { job_id: string; cancelled?: boolean }) => {
            const run = runOf(data);
            if (!run) return;
            if (data.cancelled) {
                runsRef.current.delete(run.job.job_id); // left the queue before starting
            } else {
                conclude(run, 'stopped', null, null, true);
            }
            schedule();
            void refresh();
        });

        socket.on('training_error', (data: { job_id: string; message?: string }) => {
            const run = runOf(data);
            if (!run) return;
            conclude(run, 'error', null, data.message || 'Training failed.', true);
            schedule();
            void refresh();
        });

        // A remote run lost its device — it waits in the queue and restarts
        // from scratch when the device is back.
        socket.on('training_requeued', (data: { job_id: string; message?: string; job?: JobView }) => {
            const run = runOf(data);
            if (!run) return;
            run.job = { ...run.job, ...(data.job || {}), status: 'queued' };
            run.liveAt = 0;
            showToast(data.message || 'Run requeued — it resumes when the device reconnects.', 'warning');
            schedule();
        });

        socket.on('queue_update', (data: { job_id: string; job: JobView }) => {
            const run = runOf(data);
            if (!run || !isActive(run.job.status)) return;
            run.job = { ...run.job, ...data.job };
            schedule();
        });
    }, [conclude, ensureRun, hydrate, refresh, schedule]);

    const ensureSocket = useCallback(async (): Promise<Socket | null> => {
        if (!socketRef.current) {
            // The socket client is loaded on demand too, so it stays out of the
            // bundle every visitor downloads.
            const who = identity.current;
            const { io } = await import('socket.io-client');
            if (who !== identity.current) return null; // signed in/out meanwhile
            if (!socketRef.current) {
                socketRef.current = io();
                bindSocket(socketRef.current);
            }
        }
        const s = socketRef.current;
        if (s.connected) return s;
        return new Promise((resolve) => {
            const done = () => { window.clearTimeout(timer); resolve(s); };
            // Don't hang a "Start" click forever on a flaky connection; without
            // a socket id the run still starts and the status poll picks it up.
            const timer = window.setTimeout(() => { s.off('connect', done); resolve(s); }, 4000);
            s.once('connect', done);
        });
    }, [bindSocket]);

    // Attaching needs the socket (to join the run's room) before the snapshot.
    useEffect(() => {
        attachRef.current = async (jobId: string) => {
            await ensureSocket();
            await hydrate(jobId);
        };
    }, [ensureSocket, hydrate]);

    // ── Identity changes (sign in / out) start from a clean slate ───────────
    useEffect(() => {
        if (authLoading) return;
        identity.current += 1;
        runsRef.current = new Map();
        lastRunRef.current = null;
        socketRef.current?.disconnect();
        socketRef.current = null;
        setReady(false);
        setFocusId(null);
        void refresh();
        return () => {
            socketRef.current?.disconnect();
            socketRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, authLoading]);

    // ── Keep the picture fresh ──────────────────────────────────────────────
    const hasActive = [...runsRef.current.values()].some((r) => isActive(r.job.status));
    useEffect(() => {
        if (authLoading) return;
        const tick = () => { if (!document.hidden) void refresh(); };
        const timer = window.setInterval(tick, hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
        document.addEventListener('visibilitychange', tick);
        window.addEventListener('focus', tick);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', tick);
            window.removeEventListener('focus', tick);
        };
    }, [hasActive, authLoading, refresh]);

    useEffect(() => () => {
        if (flushTimer.current != null) window.clearTimeout(flushTimer.current);
    }, []);

    // ── Actions ─────────────────────────────────────────────────────────────
    const start = useCallback(async (deviceId: number | null): Promise<StartResult> => {
        const socket = await ensureSocket();
        const askedAt = performance.now();
        const data: StartResult = await apiPost('/api/training/start', {
            device_id: deviceId,
            socket_id: socket?.connected ? socket.id : undefined,
        });
        if (data.error || !data.job_id) return data;
        const run = ensureRun(data.job || { job_id: data.job_id });
        if (data.job) mergeJob(run, data.job, askedAt);
        // Started here, so this tab doesn't need to be told about it later.
        writeAck(safeStorage('session'), data.job_id);
        setFocusId(data.job_id);
        schedule();
        void refresh();
        return data;
    }, [ensureRun, ensureSocket, refresh, schedule]);

    const stop = useCallback(async (jobId: string) => {
        try {
            const res = await apiPost('/api/training/stop', { job_id: jobId });
            if (res?.error) showToast(res.error, 'error');
        } catch (e) {
            showToast('Error: ' + (e instanceof Error ? e.message : String(e)), 'error');
        }
    }, []);

    const cancel = useCallback(async (jobId: string) => {
        try {
            const res = await fetch(`/api/training/queue/${jobId}`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || 'Could not cancel', 'error');
                void refresh();
                return false;
            }
            runsRef.current.delete(jobId);
            showToast('Queued run cancelled', 'success');
            schedule();
            void refresh();
            return true;
        } catch (e) {
            showToast('Cancel failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
            return false;
        }
    }, [refresh, schedule]);

    const value = useMemo<TrainingSessionValue>(() => {
        const runs = [...runsRef.current.values()];
        const jobs = runs
            .filter((r) => isActive(r.job.status))
            .map((r) => r.job)
            .sort((a, b) => (a.status === b.status
                ? a.position - b.position
                : a.status === 'running' ? -1 : 1));
        const lastRun = lastRunRef.current;

        // Default focus: what is training now, else what is waiting, else the
        // run that most recently ended.
        const pick = (id: string | null | undefined) => (id ? runsRef.current.get(id) ?? null : null);
        const focusRun = pick(focusId)
            ?? pick(jobs[0]?.job_id)
            ?? runs.filter((r) => isTerminal(r.job.status))
                .sort((a, b) => b.createdAt - a.createdAt)
                .find((r) => r.history.length > 0 || r.job.job_id === lastRun?.job_id)
            ?? null;

        return {
            ready, jobs, lastRun, focusRun,
            getRun: pick, setFocus: setFocusId, version,
            start, stop, cancel, refresh, hydrate,
            ack, isAcked,
            overlay,
            openEnterprise: () => setOverlay('enterprise'),
            openAddDevice: () => setOverlay('add-device'),
            closeOverlay: () => setOverlay(null),
            deviceEpoch,
            notifyDeviceCreated: () => setDeviceEpoch((n) => n + 1),
        };
        // `version` is the change signal for everything held in refs.
    }, [version, ready, focusId, overlay, deviceEpoch, start, stop, cancel, refresh, hydrate, ack, isAcked]);

    return (
        <TrainingSessionContext.Provider value={value}>
            {children}
        </TrainingSessionContext.Provider>
    );
};
