import React from 'react';
import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { useTrainingSession } from '../../context/TrainingSessionContext';
import ProgressRing from './ProgressRing';
import { etaLine, jobPercent } from './format';
import './session.css';

/**
 * Navbar indicator for a run in progress. Visible on every page while the
 * caller has something training or queued, so the run is never out of sight —
 * and one click from its dashboard.
 */
const SessionPill: React.FC = () => {
    const { jobs } = useTrainingSession();
    const job = jobs[0];
    if (!job) return null;
    const extra = jobs.length - 1;

    if (job.status === 'queued') {
        return (
            <Link to="/training" className="vx-pill vx-pill--queued" title={`${job.project_name || 'Your run'} is waiting in the queue`}>
                <Hourglass size={14} style={{ marginLeft: 4, color: '#fcd34d' }} />
                <span>Queued</span>
                <span className="vx-pill__meta">#{job.position}{extra > 0 ? ` · +${extra}` : ''}</span>
            </Link>
        );
    }

    const pct = jobPercent(job);
    return (
        <Link
            to="/training"
            className="vx-pill"
            title={`${job.project_name || 'Your run'} — epoch ${job.epoch}/${job.total_epochs}, ${etaLine(job)}`}
        >
            <ProgressRing value={pct} size={22} stroke={3} pulse />
            <span>Training</span>
            <span className="vx-pill__meta">{pct}%{extra > 0 ? ` · +${extra}` : ''}</span>
        </Link>
    );
};

export default SessionPill;
