import { formatTime } from '../../utils/helpers';
import type { JobView } from './types';

/** Compact duration: "8s", "2m 05s", "1h 12m". */
export function shortTime(seconds: number): string {
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
    return formatTime(seconds);
}

/** Percent complete of a run (0 while it is still queued). */
export function jobPercent(job: Pick<JobView, 'epoch' | 'total_epochs' | 'status'>): number {
    if (job.status === 'complete') return 100;
    if (!job.total_epochs) return 0;
    return Math.min(100, Math.round((job.epoch / job.total_epochs) * 100));
}

/** "14:02" in the viewer's locale, or "" if the timestamp is missing. */
export function clockTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "just now", "5 min ago", "2 h ago", "yesterday". */
export function timeAgo(iso: string | null | undefined): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return s < 172800 ? 'yesterday' : `${Math.round(s / 86400)} days ago`;
}

/** Where a queued run stands, in words. */
export function queueLine(job: Pick<JobView, 'ahead' | 'wait_seconds'>): string {
    if (job.ahead <= 0) return 'Next up — starting any moment';
    const ahead = job.ahead === 1 ? '1 run ahead of you' : `${job.ahead} runs ahead of you`;
    // The server only estimates the wait for the run at the front of the line.
    if (job.wait_seconds != null && job.wait_seconds > 0) {
        return `${ahead} · about ${shortTime(job.wait_seconds)} to go`;
    }
    return ahead;
}

export function etaLine(job: Pick<JobView, 'eta_seconds'>): string {
    if (job.eta_seconds == null) return 'estimating…';
    if (job.eta_seconds < 1) return 'finishing…';
    return `~${shortTime(job.eta_seconds)} left`;
}

/** Headline metric of a finished run. */
export function outcomeLine(job: Pick<JobView, 'final'>): string {
    const f = job.final;
    if (!f) return '';
    if (f.final_val_acc != null) return `${f.final_val_acc.toFixed(1)}% validation accuracy`;
    if (f.final_val_loss != null) return `validation loss ${f.final_val_loss.toFixed(4)}`;
    return '';
}
