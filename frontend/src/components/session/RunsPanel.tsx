import React from 'react';
import { Building2, Hourglass, Server, Square, X } from 'lucide-react';
import ProgressRing from './ProgressRing';
import { etaLine, jobPercent, queueLine } from './format';
import type { JobView } from './types';
import './session.css';

/** One dot per run ahead of you, then your own marker. */
const QueueTrack: React.FC<{ ahead: number }> = ({ ahead }) => {
    const shown = Math.min(ahead, 8);
    return (
        <div className="vx-track" aria-hidden="true">
            {Array.from({ length: shown }).map((_, i) => (
                <React.Fragment key={i}>
                    <span className={`vx-track__node ${i === 0 ? 'vx-track__node--now' : ''}`} />
                    <span className="vx-track__link" />
                </React.Fragment>
            ))}
            {ahead > shown && <span className="vx-run__meta" style={{ fontSize: '0.7rem' }}>+{ahead - shown}&nbsp;</span>}
            <span className="vx-track__node vx-track__node--you">YOU</span>
        </div>
    );
};

interface RunsPanelProps {
    jobs: JobView[];
    focusedId: string | null;
    onFocus: (jobId: string) => void;
    onStop: (jobId: string) => void;
    onCancel: (jobId: string) => void;
}

/** The caller's running + queued runs, with their place in line. */
export const RunsPanel: React.FC<RunsPanelProps> = ({ jobs, focusedId, onFocus, onStop, onCancel }) => (
    <div className="vx-runs">
        {jobs.map((j) => {
            const device = j.device_name || (j.is_local ? 'Shared Mac mini' : `device #${j.device_id}`);
            const running = j.status === 'running';
            return (
                <div
                    key={j.job_id}
                    className={`vx-run ${j.job_id === focusedId ? 'vx-run--focused' : ''}`}
                    onClick={() => onFocus(j.job_id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus(j.job_id); }
                    }}
                    title="Show this run on the dashboard"
                >
                    {running
                        ? <ProgressRing value={jobPercent(j)} size={40} stroke={4} label pulse />
                        : <span className="vx-run__pos">#{j.position}</span>}

                    <div className="vx-run__main">
                        <div className="vx-run__title">
                            <strong>{j.project_name || 'Untitled run'}</strong>
                            <span className={`vx-chip ${running ? 'vx-chip--green' : 'vx-chip--amber'}`}>
                                {running ? 'Training' : 'Queued'}
                            </span>
                        </div>
                        <div className="vx-run__meta">
                            on {device}
                            {running
                                ? <> · epoch <b>{j.epoch}/{j.total_epochs}</b> · {etaLine(j)}</>
                                : <> · <Hourglass size={11} style={{ verticalAlign: '-1px' }} /> {queueLine(j)}</>}
                        </div>
                        {!running && j.ahead > 0 && <QueueTrack ahead={j.ahead} />}
                    </div>

                    <div className="vx-run__actions" onClick={(e) => e.stopPropagation()}>
                        {running ? (
                            <button className="btn btn-danger btn-sm" onClick={() => onStop(j.job_id)}>
                                <Square size={12} fill="currentColor" /> Stop
                            </button>
                        ) : (
                            <button className="btn btn-secondary btn-sm" onClick={() => onCancel(j.job_id)}>
                                <X size={13} /> Leave queue
                            </button>
                        )}
                    </div>
                </div>
            );
        })}
    </div>
);

interface TierStripProps {
    onEnroll: () => void;
    onSales: () => void;
}

/** The free-tier explainer with the two ways out of the queue. */
export const TierStrip: React.FC<TierStripProps> = ({ onEnroll, onSales }) => (
    <div className="vx-tier">
        <span>
            <strong>Free tier.</strong> The VortexML Mac mini is shared and trains one model at a time, first
            come first served. Runs keep going after you close the tab.
        </span>
        <span className="vx-tier__actions">
            <button type="button" className="vx-ghost-btn" onClick={onEnroll}>
                <Server size={14} /> Enroll your own server
            </button>
            <button type="button" className="vx-ghost-btn vx-ghost-btn--accent" onClick={onSales}>
                <Building2 size={14} /> Enterprise — no queue
            </button>
        </span>
    </div>
);
