import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowRight, Check, CircleCheck, Copy, Download, Eye, FileSpreadsheet, FlaskConical, Hand, Info,
    Lightbulb, MessageSquareQuote, Play, Sparkles, Upload, UserRound, Wand2,
} from 'lucide-react';
import { apiGet, apiPost, showToast } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import Clip from '../components/TutorialClip';
import '../components/session/session.css';
import './demo.css';
import './tutorial.css';

// Keep in sync with TEST_PROMPT in tools/tutorial-recorder/record.mjs.
const TEST_PROMPT = 'I want to predict whether a student will pass their final exam from their '
    + 'study habits. It is a yes/no answer and every row is a different student. '
    + 'I am a beginner, so keep it simple and quick to train.';

const DATASET_KEY = 'student_performance';

const COLUMNS: { name: string; meaning: string; target?: boolean }[] = [
    { name: 'hours_studied', meaning: 'Hours of study per day, 0 – 10' },
    { name: 'previous_score', meaning: 'Score on the last exam, 40 – 100' },
    { name: 'attendance_rate', meaning: 'Share of classes attended, 0.4 – 1.0' },
    { name: 'sleep_hours', meaning: 'Average sleep per night, 4 – 9' },
    { name: 'assignments_done', meaning: 'Assignments handed in, 0 – 20' },
    { name: 'passed', meaning: 'Did they pass? 1 = yes, 0 = no — what we predict', target: true },
];

const STEPS = [
    { id: 'kit', label: 'The kit' },
    { id: 'upload', label: 'Upload the data' },
    { id: 'columns', label: 'Choose what to predict' },
    { id: 'architect', label: 'Design the network' },
    { id: 'train', label: 'Train it' },
    { id: 'background', label: 'Close the tab' },
    { id: 'predict', label: 'Ask it questions' },
    { id: 'experiments', label: 'Change one thing' },
];

// Measured on this dataset with the tutorial's settings: five training runs per
// row, validation accuracy on the 64 held-back students (mean, min – max).
const EXPERIMENTS: {
    change: string; detail: string; mean: number; range: string; why: string; base?: boolean;
}[] = [
    {
        change: 'The tutorial settings', detail: '5 features · 32 → 16 · 30 epochs · lr 0.005',
        mean: 95.9, range: '93.8 – 96.9', base: true,
        why: 'Your reference point. Everything below changes exactly one thing.',
    },
    {
        change: 'Drop hours_studied and previous_score', detail: 'on the Dataset page',
        mean: 61.6, range: '60.9 – 62.5',
        why: 'The two strongest signals are gone. 54% of these students fail, so always answering “fail” already scores 54% — the model is barely beating a guess.',
    },
    {
        change: 'Learning rate 1.0', detail: 'instead of 0.005',
        mean: 58.1, range: '45.3 – 87.5',
        why: 'Each update overshoots. The loss jumps around instead of settling, and the result depends on luck — look at that range.',
    },
    {
        change: 'Learning rate 0.00001', detail: 'instead of 0.005',
        mean: 55.0, range: '45.3 – 65.6',
        why: 'Steps so small that 30 epochs are nowhere near enough. The loss curve is almost flat.',
    },
    {
        change: 'Only 3 epochs', detail: 'instead of 30',
        mean: 96.9, range: '96.9 – 96.9',
        why: 'Surprise: still excellent. This is an easy pattern, so the network finds it almost immediately. More training is not automatically better.',
    },
    {
        change: 'One hidden layer of 2 neurons', detail: 'instead of 32 → 16',
        mean: 98.4, range: '98.4 – 98.4',
        why: 'A tiny network is enough here — and a bigger one is not smarter. Match the model to the problem, not the other way round.',
    },
];

const Step: React.FC<{
    id: string; num: string; where: React.ReactNode; title: React.ReactNode; children: React.ReactNode;
}> = ({ id, num, where, title, children }) => (
    <section className="tt-step" id={id} data-step={id}>
        <div className="tt-step__head">
            <span className="tt-step__num">{num}</span>
            <div>
                <div className="tt-step__where">{where}</div>
                <h2>{title}</h2>
            </div>
        </div>
        {children}
    </section>
);

const Do: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="tt-card">
        <div className="tt-card__label"><Hand size={13} /> What to do</div>
        {children}
    </div>
);

const Changes: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="tt-card tt-card--changes">
        <div className="tt-card__label"><Eye size={13} /> What changes on screen</div>
        {children}
    </div>
);

const Tutorial: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [active, setActive] = useState('kit');
    const [copied, setCopied] = useState(false);
    const [loadingSample, setLoadingSample] = useState(false);
    const [archTab, setArchTab] = useState<'hand' | 'ai'>('hand');
    // null = unknown (signed out, or still checking)
    const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
    const [aiClip, setAiClip] = useState(false);

    // Is the AI co-pilot switched on for this server? (It needs an API key.)
    useEffect(() => {
        if (!user) { setAiAvailable(null); return; }
        apiGet('/api/auto-config/status')
            .then((d) => setAiAvailable(Boolean(d.available)))
            .catch(() => setAiAvailable(null));
    }, [user]);

    // The co-pilot clip exists only if it has been recorded on a server with
    // the co-pilot enabled (see tools/tutorial-recorder).
    useEffect(() => {
        const probe = new Image();
        probe.onload = () => setAiClip(true);
        probe.src = '/tutorial/03-autoconfig.png';
    }, []);

    // Highlight the step being read in the side rail.
    useEffect(() => {
        const sections = [...document.querySelectorAll<HTMLElement>('[data-step]')];
        if (!sections.length || !('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            const visible = entries.filter((e) => e.isIntersecting)
                .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
            if (visible[0]) setActive((visible[0].target as HTMLElement).dataset.step || 'kit');
        }, { rootMargin: '-25% 0px -60% 0px' });
        sections.forEach((s) => io.observe(s));
        return () => io.disconnect();
    }, []);

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(TEST_PROMPT);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            showToast('Copy failed — select the text and copy it manually.', 'warning');
        }
    };

    // Skip the download/upload round trip: put the test dataset straight into
    // the Dataset page, exactly as if it had been uploaded.
    const loadForMe = async () => {
        if (loadingSample) return;
        setLoadingSample(true);
        try {
            const res = await apiPost('/api/demo/load', { key: DATASET_KEY, configure: false });
            if (res.error) {
                showToast(res.error, 'error');
                return;
            }
            showToast('Test dataset loaded — continue with step 2.', 'success');
            navigate('/dataset');
        } catch (e) {
            showToast('Could not load the dataset: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setLoadingSample(false);
        }
    };

    const downloadUrl = `/api/demo/datasets/${DATASET_KEY}/download`;

    return (
        <div className="dm-page">
            <header className="dm-hero">
                <div className="vx-eyebrow" style={{ justifyContent: 'center' }}>
                    <span className="vx-dot vx-dot--violet vx-dot--still" /> Tutorial
                </div>
                <h1>Your first model, <em>step by step.</em></h1>
                <p>
                    In about five minutes you will teach a neural network to predict whether a student passes an
                    exam — from uploading the data to asking the finished model questions. Every step shows exactly
                    what to click and what you should see change.
                </p>
                <div className="dm-hero__facts">
                    <span className="vx-chip vx-chip--violet">≈ 5 minutes</span>
                    <span className="vx-chip vx-chip--cyan">No ML experience needed</span>
                    <span className="vx-chip vx-chip--green">Recorded from the real app</span>
                </div>
                <div className="dm-hero__actions">
                    <a href="#upload" className="dm-cta">Start the tutorial <ArrowRight size={16} /></a>
                    <Link to="/demo" className="dm-cta dm-cta--quiet">Just watch a live demo</Link>
                </div>
            </header>

            <div className="tt-layout">
                <nav className="tt-rail" aria-label="Tutorial steps">
                    <div className="tt-rail__label">On this page</div>
                    {STEPS.map((s, i) => (
                        <a key={s.id} href={`#${s.id}`} className={active === s.id ? 'is-active' : ''}>
                            <span>{String(i).padStart(2, '0')}</span>{s.label}
                        </a>
                    ))}
                </nav>

                <div>
                    {/* ── 00 · The kit ── */}
                    <Step id="kit" num="00" where="Before you start" title={<>Your <em>kit</em></>}>
                        <div className="tt-kit">
                            <div className="glass-panel">
                                <div className="tt-kit__head">
                                    <span className="tt-kit__icon"><FileSpreadsheet size={19} /></span>
                                    <div>
                                        <h3>The test dataset</h3>
                                        <div className="tt-kit__sub">student_performance.csv · 800 rows · 6 columns</div>
                                    </div>
                                </div>
                                <p>
                                    800 students, one per row. Five columns describe how they study; the last says
                                    whether they passed. It is practice data, generated for teaching — small, clean,
                                    and with a real pattern for the model to find.
                                </p>
                                <table className="tt-cols">
                                    <tbody>
                                        {COLUMNS.map((c) => (
                                            <tr key={c.name} className={c.target ? 'is-target' : ''}>
                                                <td>{c.name}</td>
                                                <td>{c.meaning}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="tt-actions">
                                    <a className="vx-ghost-btn vx-ghost-btn--accent" href={downloadUrl}>
                                        <Download size={14} /> Download the CSV
                                    </a>
                                    <button type="button" className="vx-ghost-btn" onClick={loadForMe} disabled={loadingSample}>
                                        <Upload size={14} /> {loadingSample ? 'Loading…' : 'Or load it for me'}
                                    </button>
                                </div>
                            </div>

                            <div className="glass-panel">
                                <div className="tt-kit__head">
                                    <span className="tt-kit__icon"><MessageSquareQuote size={19} /></span>
                                    <div>
                                        <h3>The test prompt</h3>
                                        <div className="tt-kit__sub">for the AI co-pilot in step 3</div>
                                    </div>
                                </div>
                                <p>
                                    VortexML can choose the network for you if you describe your goal in plain words.
                                    This is the description we will use:
                                </p>
                                <div className="tt-prompt">{TEST_PROMPT}</div>
                                <div className="tt-actions">
                                    <button type="button" className="vx-ghost-btn vx-ghost-btn--accent" onClick={copyPrompt}>
                                        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy the prompt'}
                                    </button>
                                </div>
                                <div className="tt-note">
                                    <Info size={15} />
                                    <span>No co-pilot on your server? Step 3 also gives the exact settings to enter by hand — the result is the same.</span>
                                </div>
                            </div>
                        </div>

                        <div className="tt-account">
                            {user ? (
                                <>
                                    <CircleCheck size={18} style={{ color: '#4ade80' }} />
                                    <span>Signed in as <strong>{user.username}</strong> — the model you train will be saved to your account.</span>
                                </>
                            ) : (
                                <>
                                    <UserRound size={18} style={{ color: '#a78bfa' }} />
                                    <span>
                                        <strong>Create a free account first.</strong> You can train without one, but saving the
                                        model, the AI co-pilot and the Predict page (step 6) all need you to be signed in.
                                    </span>
                                    <Link to="/signup" className="vx-ghost-btn vx-ghost-btn--accent">Create an account</Link>
                                </>
                            )}
                        </div>
                    </Step>

                    {/* ── 01 · Upload ── */}
                    <Step id="upload" num="01" where={<>Page · <Link to="/dataset">Dataset</Link></>} title={<>Upload the <em>data</em></>}>
                        <div className="tt-step__body">
                            <Do>
                                <ol>
                                    <li>Open <b>Dataset</b> in the top bar.</li>
                                    <li>Drag <code>student_performance.csv</code> onto the upload area, or click it and pick the file.</li>
                                    <li>No file? Click the <b>Student performance</b> chip under the upload area — it loads the same data.</li>
                                </ol>
                            </Do>
                            <Changes>
                                <ul>
                                    <li>The progress steps at the top jump to <b>3 · Select Columns</b>.</li>
                                    <li>A green badge shows the file name, with a summary: <b>800</b> rows, <b>6</b> columns, all numeric.</li>
                                    <li>A <b>Data Preview</b> table shows the first ten students — check it looks like your data.</li>
                                </ul>
                            </Changes>
                        </div>
                        <Clip name="01-upload" url="vortexml / dataset" alt="Uploading student_performance.csv on the Dataset page; the preview table appears." />
                    </Step>

                    {/* ── 02 · Columns ── */}
                    <Step id="columns" num="02" where={<>Page · <Link to="/dataset">Dataset</Link></>} title={<>Choose what to <em>predict</em></>}>
                        <div className="tt-step__body">
                            <Do>
                                <ol>
                                    <li>Scroll to <b>Select Columns</b>.</li>
                                    <li>Click <b>Feature</b> on the five study-habit columns — these are the clues the model may use.</li>
                                    <li>Click <b>Target</b> on <code>passed</code> — this is the answer it must learn to give.</li>
                                    <li>Click <b>Continue to Architecture Builder</b>.</li>
                                </ol>
                            </Do>
                            <Changes>
                                <ul>
                                    <li>Each feature you pick lights up; the target is marked in a different colour.</li>
                                    <li>A column can be a feature or the target, never both — picking one clears the other.</li>
                                    <li>The <b>Continue</b> button fades in once there is at least one feature and a target.</li>
                                </ul>
                            </Changes>
                        </div>
                        <Clip name="02-columns" url="vortexml / dataset" alt="Marking five columns as features and 'passed' as the target, then continuing to the Architect." />
                    </Step>

                    {/* ── 03 · Architect ── */}
                    <Step id="architect" num="03" where={<>Page · <Link to="/architect">Architect</Link></>} title={<>Design the <em>network</em></>}>
                        <div className="tt-tabs" role="tablist" aria-label="How to configure the model">
                            <button type="button" role="tab" aria-selected={archTab === 'hand'}
                                className={archTab === 'hand' ? 'is-active' : ''} onClick={() => setArchTab('hand')}>
                                <Hand size={14} /> By hand
                            </button>
                            <button type="button" role="tab" aria-selected={archTab === 'ai'}
                                className={archTab === 'ai' ? 'is-active' : ''} onClick={() => setArchTab('ai')}>
                                <Wand2 size={14} /> With the AI co-pilot
                            </button>
                        </div>

                        {archTab === 'hand' ? (
                            <>
                                <div className="tt-step__body">
                                    <Do>
                                        <ol>
                                            <li>Under <b>Select Architecture</b>, click <b>Multi-Layer Perceptron</b> — the simplest kind of network, and the right one for a table of independent rows.</li>
                                            <li>Set the two hidden layers and the hyperparameters to the values below.</li>
                                            <li>Give the project a name, then click <b>Start Training ⚡</b>.</li>
                                        </ol>
                                        <div className="tt-values">
                                            <div className="tt-value"><span>Layer 1</span><b>32 neurons</b></div>
                                            <div className="tt-value"><span>Layer 2</span><b>16 neurons</b></div>
                                            <div className="tt-value"><span>Epochs</span><b>30</b></div>
                                            <div className="tt-value"><span>Learning rate</span><b>0.005</b></div>
                                            <div className="tt-value"><span>Batch size</span><b>32</b></div>
                                            <div className="tt-value"><span>Project name</span><b>Exam-Predictor</b></div>
                                        </div>
                                    </Do>
                                    <Changes>
                                        <ul>
                                            <li>The chosen card is outlined, and two new panels appear: <b>Configure Layers</b> and <b>Hyperparameters</b>.</li>
                                            <li>The <b>Architecture Preview</b> redraws as you type: 5 inputs → 32 → 16 → 2 outputs (pass / fail).</li>
                                            <li><b>Start Training ⚡</b> saves the design and takes you to the Training page.</li>
                                        </ul>
                                    </Changes>
                                </div>
                                <Clip name="03-architect" url="vortexml / architect" alt="Selecting the Multi-Layer Perceptron and entering the layer sizes and hyperparameters." />
                            </>
                        ) : (
                            <>
                                <div className="tt-step__body">
                                    <Do>
                                        <ol>
                                            <li>Click <b>🪄 AI Auto-Configure</b> at the top of the Architect page.</li>
                                            <li>Paste the <a href="#kit" className="vx-link">test prompt</a> and press Enter. The co-pilot may ask one or two short questions — answer in your own words.</li>
                                            <li>Click <b>Generate Configuration</b>, read the proposal and its reasoning.</li>
                                            <li>Click <b>Apply to Architect</b>, then <b>Start Training ⚡</b>.</li>
                                        </ol>
                                        <div className="tt-actions" style={{ marginTop: '0.9rem' }}>
                                            <button type="button" className="vx-ghost-btn vx-ghost-btn--accent" onClick={copyPrompt}>
                                                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy the test prompt'}
                                            </button>
                                        </div>
                                    </Do>
                                    <Changes>
                                        <ul>
                                            <li>A chat panel opens in the corner of the page; your message and the co-pilot's reply appear in it.</li>
                                            <li>A <b>Proposed configuration</b> card lists the architecture, layers, epochs, learning rate — and why.</li>
                                            <li>After <b>Apply</b>, the page fills itself in: the architecture is selected and every field is set for you.</li>
                                        </ul>
                                    </Changes>
                                </div>
                                {aiClip && (
                                    <Clip name="03-autoconfig" url="vortexml / architect" alt="Describing the goal to the AI co-pilot and applying its proposed configuration." />
                                )}
                                <div className="tt-note">
                                    {aiAvailable === false
                                        ? <><Info size={15} /><span><strong>The AI co-pilot is not switched on for this server</strong> (it needs an API key from the administrator). Use the <button className="vx-link" onClick={() => setArchTab('hand')}>by-hand settings</button> instead — they give the same model.</span></>
                                        : aiAvailable === true
                                            ? <><Sparkles size={15} /><span><strong>The AI co-pilot is available on this server.</strong> For a small table like this one its safety rules keep the suggestion modest — a small Multi-Layer Perceptron for a few dozen epochs. The exact numbers can differ from the by-hand ones; either trains well.</span></>
                                            : <><Info size={15} /><span>The AI co-pilot needs you to be <Link to="/signin" className="vx-link">signed in</Link>, and must be switched on by the server's administrator. If its button is greyed out, use the <button className="vx-link" onClick={() => setArchTab('hand')}>by-hand settings</button>.</span></>}
                                </div>
                            </>
                        )}
                    </Step>

                    {/* ── 04 · Train ── */}
                    <Step id="train" num="04" where={<>Page · <Link to="/training">Training</Link></>} title={<>Train <em>it</em></>}>
                        <div className="tt-step__body">
                            <Do>
                                <ol>
                                    <li>Under <b>Compute Device</b>, keep the <b>VortexML M4 Mac Mini</b> selected.</li>
                                    <li>Click <b>▶ Start Training</b> in the Training Log panel.</li>
                                    <li>Watch. On this dataset it takes about a second.</li>
                                </ol>
                                <div className="tt-note">
                                    <Info size={15} />
                                    <span>If the button says <strong>Join the queue</strong>, someone else is training. The Mac mini is the free, shared machine and runs one model at a time — yours starts by itself when it is free.</span>
                                </div>
                            </Do>
                            <Changes>
                                <ul>
                                    <li><b>Epoch</b> counts up to 30/30 and the progress bar fills.</li>
                                    <li><b>Train loss</b> — how wrong the model is — falls from around 0.6 to below 0.1.</li>
                                    <li><b>Val accuracy</b> — the share of held-back students it gets right — climbs to roughly 95%.</li>
                                    <li>The log ends with a green <b>Training complete!</b> and new buttons: <b>Save Weights</b> and <b>Explain Results</b>.</li>
                                </ul>
                            </Changes>
                        </div>
                        <Clip name="04-train" url="vortexml / training" alt="Starting the run on the Training page; the loss curve falls and accuracy rises until training completes." />
                    </Step>

                    {/* ── 05 · Background sessions ── */}
                    <Step id="background" num="05" where="Any page · any browser" title={<>Close the tab — it <em>keeps training</em></>}>
                        <div className="tt-step__body">
                            <Do>
                                <ol>
                                    <li>Start a longer run (more data, or more epochs).</li>
                                    <li>Close the tab. Really — the run lives on the server, not in your browser.</li>
                                    <li>Come back later, from this browser or another one, and sign in.</li>
                                </ol>
                                <div className="tt-note">
                                    <Info size={15} />
                                    <span>Following a run from a <strong>different</strong> browser needs an account, since that is how the server knows it is you. Without one, the run is tied to the browser you started it in.</span>
                                </div>
                            </Do>
                            <Changes>
                                <ul>
                                    <li>While a run is active, a <b>Training n%</b> pill sits in the top bar on every page — click it to jump to the dashboard.</li>
                                    <li>When you return, a <b>Welcome back</b> prompt shows the run's live progress and asks what you want to do.</li>
                                    <li><b>See the progress</b> reopens the dashboard with every epoch you missed already drawn.</li>
                                    <li>If the run finished meanwhile, the prompt tells you how it went instead.</li>
                                </ul>
                            </Changes>
                        </div>
                        <Clip
                            name="05-background"
                            url="vortexml — opened in a second browser"
                            alt="A second browser signs in while a run is training: the welcome-back prompt appears, then the dashboard with the full history."
                            caption={<>
                                Recorded with a deliberately long run (6,000 epochs) so there was something to come back to.
                                Notice the validation loss creeping up while the training loss keeps falling — that is
                                overfitting, and exactly why 30 epochs was the better choice.
                            </>}
                        />
                        <div className="tt-note">
                            <Lightbulb size={15} />
                            <span>
                                The prompt also offers two ways out of the queue: <strong>enroll your own server</strong> (link a machine
                                you own; it only runs your jobs) or <strong>talk to sales</strong> about Enterprise — tailored
                                configurations, high priority with no queue, and several models training at once.
                            </span>
                        </div>
                    </Step>

                    {/* ── 06 · Predict ── */}
                    <Step id="predict" num="06" where={<>Page · <Link to="/predict">Predict</Link></>} title={<>Ask it <em>questions</em></>}>
                        <div className="tt-step__body">
                            <Do>
                                <ol>
                                    <li>Open <b>Predict</b> and choose <b>Exam-Predictor</b> under <i>Choose a model</i>.</li>
                                    <li>Describe a hard-working student and click <b>Predict scenario</b>.</li>
                                    <li>Now lower three values to describe a struggling one, and predict again.</li>
                                </ol>
                                <div className="tt-values">
                                    <div className="tt-value"><span>hours_studied</span><b>8 → 1</b></div>
                                    <div className="tt-value"><span>previous_score</span><b>82 → 45</b></div>
                                    <div className="tt-value"><span>attendance_rate</span><b>0.95 → 0.5</b></div>
                                    <div className="tt-value"><span>sleep_hours</span><b>7.5</b></div>
                                    <div className="tt-value"><span>assignments_done</span><b>18</b></div>
                                </div>
                            </Do>
                            <Changes>
                                <ul>
                                    <li>A <b>Prediction</b> panel appears with the answer and how confident the model is.</li>
                                    <li>The first student should come out as <b>1</b> (passed); the second flips to <b>0</b> (failed).</li>
                                    <li>The bars show the confidence in each answer — try values in between and watch them shift.</li>
                                </ul>
                            </Changes>
                        </div>
                        <Clip name="06-predict" url="vortexml / predict" alt="Entering two different students on the Predict page; the prediction changes from pass to fail." />
                    </Step>

                    {/* ── 07 · Experiments ── */}
                    <Step id="experiments" num="07" where="Go further" title={<>Change one thing, <em>see what happens</em></>}>
                        <p className="dm-section__note" style={{ maxWidth: '70ch', marginBottom: '1.1rem' }}>
                            The fastest way to understand a setting is to break it. We ran each of these five times on
                            the tutorial dataset and measured the validation accuracy — the bar shows the average, the
                            small numbers the lowest and highest run. The thin line marks 54%, what you would score by
                            always answering “fail”.
                        </p>
                        <div className="tt-exp">
                            {EXPERIMENTS.map((e) => (
                                <div key={e.change} className={`tt-exp__row ${e.base ? 'tt-exp__row--base' : ''}`}>
                                    <div className="tt-exp__change">
                                        {e.change}
                                        <small>{e.detail}</small>
                                    </div>
                                    <div>
                                        <div className="tt-exp__meter">
                                            <span className="tt-exp__bar">
                                                <i style={{
                                                    width: `${e.mean}%`,
                                                    background: e.mean >= 90
                                                        ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                                                        : 'linear-gradient(90deg, #f59e0b, #f97316)',
                                                }} />
                                            </span>
                                            <b style={{ color: e.mean >= 90 ? '#4ade80' : '#fbbf24' }}>{e.mean.toFixed(1)}%</b>
                                        </div>
                                        <small className="tt-kit__sub">runs ranged {e.range}%</small>
                                    </div>
                                    <div className="tt-exp__why">{e.why}</div>
                                </div>
                            ))}
                        </div>
                        <div className="tt-note">
                            <FlaskConical size={15} />
                            <span>
                                Your numbers will differ a little: training starts from random weights, and the validation
                                set here is only 64 students, so each one is worth 1.6 points. To repeat an experiment,
                                reload the dataset, change the one setting, and train again — every run is saved to your
                                account, and the <Link to="/leaderboard" className="vx-link">Leaderboard</Link> lines them up.
                            </span>
                        </div>

                        <div className="dm-next" style={{ marginTop: '2rem' }}>
                            <Link to="/dataset">
                                <span className="dm-next__title"><Upload size={17} /> Use your own data <ArrowRight size={15} /></span>
                                <p>The same six steps work for any table: a CSV, Excel, JSON or Parquet file with one column you want to predict.</p>
                            </Link>
                            <Link to="/demo">
                                <span className="dm-next__title"><Play size={17} /> Try the real datasets <ArrowRight size={15} /></span>
                                <p>Iris flowers, breast-cancer diagnosis and diabetes progression — trained live in one click on the Demo page.</p>
                            </Link>
                            <Link to="/learn">
                                <span className="dm-next__title"><Lightbulb size={17} /> Understand the ideas <ArrowRight size={15} /></span>
                                <p>What a neuron is, why loss falls, what overfitting means — the Learn section explains the concepts behind each button.</p>
                            </Link>
                        </div>
                    </Step>
                </div>
            </div>
        </div>
    );
};

export default Tutorial;
