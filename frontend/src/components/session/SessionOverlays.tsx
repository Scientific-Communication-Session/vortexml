import React, { Suspense, lazy, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTrainingSession } from '../../context/TrainingSessionContext';
import { showToast } from '../../utils/helpers';
import type { PromptMode } from './ResumePrompt';
import type { JobView } from './types';

// These only appear for some visitors, some of the time — keep them out of the
// bundle everyone downloads.
const AddDeviceModal = lazy(() => import('../devices/AddDeviceModal'));
const EnterpriseModal = lazy(() => import('./EnterpriseModal'));
const ResumePrompt = lazy(() => import('./ResumePrompt'));

// Don't interrupt someone who is in the middle of signing in.
const QUIET_ROUTES = ['/signin', '/signup', '/survey'];
// A finished run is only worth a welcome-back for a day (the server forgets it then too).
const FINISHED_WINDOW_MS = 24 * 3600 * 1000;

/**
 * App-wide overlays for background sessions, mounted once in the Layout:
 *
 *  - the welcome-back prompt, shown when this tab discovers a run it didn't
 *    start (a reopened tab, or another browser signed in to the same account),
 *    or one that finished in the meantime;
 *  - the enterprise / talk-to-sales modal;
 *  - the "link your own device" modal.
 */
const SessionOverlays: React.FC = () => {
    const session = useTrainingSession();
    const { user } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();

    const {
        ready, jobs, lastRun, isAcked, ack, getRun,
        overlay, openEnterprise, openAddDevice, closeOverlay, notifyDeviceCreated,
    } = session;

    // Which run, if any, should this tab be told about?
    let prompt: { mode: PromptMode; job: JobView } | null = null;
    if (ready && !overlay && !QUIET_ROUTES.includes(pathname)) {
        const unseen = jobs.find((j) => !isAcked(j.job_id));
        if (unseen) {
            prompt = { mode: 'resume', job: unseen };
        } else if (
            jobs.length === 0 && lastRun && !isAcked(lastRun.job_id)
            && (lastRun.status === 'complete' || lastRun.status === 'error')
            && lastRun.finished_at
            && Date.now() - new Date(lastRun.finished_at).getTime() < FINISHED_WINDOW_MS
        ) {
            prompt = { mode: 'finished', job: lastRun };
        }
    }
    // Prefer the live copy of the run so the ring and ETA tick inside the prompt.
    const promptJob = prompt ? (getRun(prompt.job.job_id)?.job ?? prompt.job) : null;

    const dismiss = useCallback(() => {
        if (!prompt) return;
        // A live run only needs acknowledging in this tab; a finished one has
        // been "seen" for this whole browser.
        ack(prompt.job.job_id, prompt.mode === 'finished' ? 'browser' : 'tab');
        if (prompt.mode === 'finished') ack(prompt.job.job_id, 'tab');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prompt?.job.job_id, prompt?.mode, ack]);

    const enroll = useCallback(() => {
        dismiss();
        if (!user) {
            closeOverlay();
            showToast('Sign in to link your own server to your account.', 'info');
            navigate('/signin');
            return;
        }
        openAddDevice();
    }, [dismiss, user, closeOverlay, navigate, openAddDevice]);

    return (
        <Suspense fallback={null}>
            {prompt && promptJob && (
                <ResumePrompt
                    mode={prompt.mode}
                    job={promptJob}
                    onClose={dismiss}
                    onView={() => {
                        session.setFocus(prompt!.job.job_id);
                        dismiss();
                        navigate('/training');
                    }}
                    onEnroll={enroll}
                    onSales={() => { dismiss(); openEnterprise(); }}
                />
            )}

            {overlay === 'enterprise' && (
                <EnterpriseModal onClose={closeOverlay} onEnroll={enroll} />
            )}

            {overlay === 'add-device' && (
                <AddDeviceModal onClose={closeOverlay} onCreated={notifyDeviceCreated} />
            )}
        </Suspense>
    );
};

export default SessionOverlays;
