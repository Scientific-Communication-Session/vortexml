import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    Activity, ArrowUpRight, Building2, CircleAlert, CircleCheck, Hourglass, Info, ListPlus, Server, X,
} from 'lucide-react';
import ProgressRing from './ProgressRing';
import { clockTime, etaLine, jobPercent, outcomeLine, queueLine, timeAgo } from './format';
import type { JobView } from './types';
import './session.css';

/**
 * - `resume`: the caller came back (new tab, another browser) while a run is
 *   training or queued.
 * - `finished`: the run ended while they were away.
 * - `busy`: they pressed Start on the shared device while they already have a
 *   run there.
 */
export type PromptMode = 'resume' | 'finished' | 'busy';

interface Props {
    mode: PromptMode;
    job: JobView;
    onClose: () => void;
    /** Go to the run's dashboard. */
    onView: () => void;
    onEnroll: () => void;
    onSales: () => void;
    /** `busy` only: queue the new run behind the current one anyway. */
    onQueue?: () => void;
}

const Choice: React.FC<{
    icon: React.ReactNode;
    title: string;
    text: string;
    tag?: React.ReactNode;
    primary?: boolean;
    autoFocus?: boolean;
    onClick: () => void;
}> = ({ icon, title, text, tag, primary, autoFocus, onClick }) => (
    <button
        type="button"
        className={`vx-choice ${primary ? 'vx-choice--primary' : ''}`}
        onClick={onClick}
        autoFocus={autoFocus}
    >
        <span className="vx-choice__icon">{icon}</span>
        <span className="vx-choice__title">{title} <ArrowUpRight size={15} /></span>
        <span className="vx-choice__text">{text}</span>
        {tag && <span className="vx-choice__tag">{tag}</span>}
    </button>
);

const ResumePrompt: React.FC<Props> = ({ mode, job, onClose, onView, onEnroll, onSales, onQueue }) => {
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

    const name = job.project_name || 'Your model';
    const device = job.device_name || (job.is_local ? 'the shared Mac mini' : 'your device');
    const shared = job.is_local;
    const queued = job.status === 'queued';
    const failed = job.status === 'error';
    const pct = jobPercent(job);
    const since = clockTime(job.started_at);

    // ── Header copy per situation ──
    let eyebrow: React.ReactNode;
    let title: React.ReactNode;
    let lede: React.ReactNode;
    if (mode === 'finished') {
        eyebrow = failed
            ? <><span className="vx-dot vx-dot--red vx-dot--still" /> Background session · ended</>
            : <><span className="vx-dot vx-dot--still" /> Background session · finished</>;
        title = failed
            ? <>Your training <em>stopped early.</em></>
            : <>Your training finished <em>while you were away.</em></>;
        lede = failed
            ? <><strong>{name}</strong> ran into a problem on {device} {timeAgo(job.finished_at)}. Nothing was lost on your side — open the dashboard to see how far it got.</>
            : <><strong>{name}</strong> completed on {device} {timeAgo(job.finished_at)}{outcomeLine(job) ? <> with <strong>{outcomeLine(job)}</strong></> : null}. The model is saved and ready to use.</>;
    } else if (mode === 'busy') {
        eyebrow = <><span className={`vx-dot ${queued ? 'vx-dot--amber' : ''}`} /> Free tier · one run at a time</>;
        title = <>You already have a training <em>{queued ? 'in the queue.' : 'running.'}</em></>;
        lede = <>
            <strong>{name}</strong> is {queued ? 'waiting for' : 'training on'} the {device}. The Mac mini is
            our free, shared machine — it trains one model at a time, so a second run has to wait its turn.
        </>;
    } else {
        eyebrow = queued
            ? <><span className="vx-dot vx-dot--amber" /> Background session · queued</>
            : <><span className="vx-dot" /> Background session · live</>;
        title = queued
            ? <>Welcome back — your training is <em>in the queue.</em></>
            : <>Welcome back — your training is <em>still running.</em></>;
        lede = queued
            ? <><strong>{name}</strong> is waiting for the {device}. It keeps its place in line whether this tab is open or not, and starts on its own when its turn comes.</>
            : <><strong>{name}</strong> has been training on the {device}{since ? <> since <strong>{since}</strong></> : null}. Closing the browser didn't stop it — runs live on the server.</>;
    }

    const viewChoice = mode === 'finished' ? (
        <Choice
            primary autoFocus
            icon={failed ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
            title={failed ? 'See what happened' : 'See the results'}
            text={failed
                ? 'Open the dashboard for the error and the epochs that did complete.'
                : 'The full loss and accuracy curves, the training log and your saved weights.'}
            tag={<span className="vx-chip vx-chip--cyan">Dashboard</span>}
            onClick={onView}
        />
    ) : (
        <Choice
            primary autoFocus
            icon={<Activity size={18} />}
            title="See the progress"
            text={queued
                ? 'Watch your place in the queue, then the live curves the moment it starts.'
                : 'Live loss and accuracy curves, the epoch log and hardware telemetry.'}
            tag={<span className="vx-chip vx-chip--cyan">{queued ? 'Queue + dashboard' : 'Live dashboard'}</span>}
            onClick={onView}
        />
    );

    return createPortal(
        <div className="vx-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="vx-prompt-title">
            <div className="vx-modal" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="vx-close" onClick={onClose} aria-label="Close">
                    <X size={17} />
                </button>

                <div className="vx-eyebrow">{eyebrow}</div>
                <h2 className="vx-title" id="vx-prompt-title">{title}</h2>
                <p className="vx-lede">{lede}</p>

                {/* The run itself — live */}
                <div className="vx-runcard">
                    {job.status === 'running' && <ProgressRing value={pct} size={58} stroke={5} label pulse />}
                    {queued && (
                        <span className="vx-run__pos" style={{ width: 58, height: 58, fontSize: '1.05rem', borderRadius: 16 }}>
                            #{job.position}
                        </span>
                    )}
                    {job.status === 'complete' && <ProgressRing value={100} size={58} stroke={5} label color="#22c55e" />}
                    {(failed || job.status === 'stopped') && (
                        <span className="vx-run__pos" style={{ width: 58, height: 58, borderRadius: 16, color: '#fca5a5', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
                            <CircleAlert size={22} />
                        </span>
                    )}
                    <div className="vx-runcard__body">
                        <div className="vx-runcard__name">
                            <strong>{name}</strong>
                            <span className="vx-runcard__stat">
                                {job.status === 'running' && <>Epoch {job.epoch}/{job.total_epochs} · {etaLine(job)}</>}
                                {queued && <><Hourglass size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{queueLine(job)}</>}
                                {job.status === 'complete' && outcomeLine(job)}
                                {failed && `stopped at epoch ${job.epoch}/${job.total_epochs}`}
                            </span>
                        </div>
                        <div className="vx-runcard__sub">
                            <span>{device}</span>
                            <span className={`vx-chip ${shared ? 'vx-chip--cyan' : 'vx-chip--violet'}`}>
                                {shared ? 'Free tier · shared' : 'Your own server'}
                            </span>
                        </div>
                        <div className={`vx-bar ${queued ? 'vx-bar--waiting' : ''}`}>
                            <span style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                </div>

                <div className="vx-choices-label">What would you like to do?</div>
                <div className={`vx-choices ${onQueue ? 'vx-choices--four' : ''}`}>
                    {viewChoice}
                    {onQueue && (
                        <Choice
                            icon={<ListPlus size={18} />}
                            title="Queue it anyway"
                            text="Add the new run behind this one. It starts by itself as soon as the Mac mini is free."
                            tag={<span className="vx-chip vx-chip--amber">Free · waits its turn</span>}
                            onClick={onQueue}
                        />
                    )}
                    <Choice
                        icon={<Server size={18} />}
                        title="Enroll your own server"
                        text="Link a machine you own to your account. It only runs your jobs — no queue, and it can train alongside the Mac mini."
                        tag={<span className="vx-chip vx-chip--violet">Free · your hardware</span>}
                        onClick={onEnroll}
                    />
                    <Choice
                        icon={<Building2 size={18} />}
                        title="Talk to sales"
                        text="Enterprise gets tailored configurations, high priority with no queue, and several models training at once."
                        tag={<span className="vx-chip vx-chip--green">Enterprise</span>}
                        onClick={onSales}
                    />
                </div>

                <div className="vx-footnote">
                    <Info size={15} />
                    <span>
                        The <strong>VortexML Mac mini is the free tier</strong>: one shared machine, one training at a
                        time, first come first served. <strong>Enterprise</strong> is built around you — personalised
                        solutions with configurations tailored to your workloads, high priority with no queue, and
                        the ability to train multiple models at once to compare different outcomes.
                    </span>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default ResumePrompt;
