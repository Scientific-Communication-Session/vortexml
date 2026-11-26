import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowRight, Check, CircleCheck, Copy, Download, Eye, FileSpreadsheet, FlaskConical, Hand, Info,
    Lightbulb, MessageSquareQuote, Play, Sparkles, Upload, UserRound,
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
    { id: 'account', label: 'Create your account' },
    { id: 'upload', label: 'Upload the data' },
    { id: 'columns', label: 'Choose what to predict' },
    { id: 'architect', label: 'Let the AI design it' },
    { id: 'parameters', label: 'Tune the parameters' },
    { id: 'train', label: 'Train it' },
    { id: 'explain', label: 'Have the AI explain it' },
    { id: 'background', label: 'Close the tab' },
    { id: 'predict', label: 'Ask it questions' },
    { id: 'assistant', label: 'Ask your documents' },
    { id: 'chat', label: 'Chat with a model' },
    { id: 'leaderboard', label: 'Compare your runs' },
    { id: 'learn', label: 'Learn the theory' },
    { id: 'device', label: 'Use your own machine' },
    { id: 'experiments', label: 'Change one thing' },
];

// Measured on this dataset against one fixed reference model: five training runs per
// row, validation accuracy on the 64 held-back students (mean, min – max).
const EXPERIMENTS: {
    change: string; detail: string; mean: number; range: string; why: string; base?: boolean;
}[] = [
    {
        change: 'The reference settings', detail: '5 features · 32 → 16 · 30 epochs · lr 0.005',
        mean: 95.9, range: '93.8 – 96.9', base: true,
        why: 'Close to what the co-pilot proposes for this table. Everything below changes exactly one thing.',
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

// The guide itself: the kit, the steps and the rail that tracks them. The
// Tutorial page shows it under its own header; the home page ends with it.
export const TutorialGuide: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [active, setActive] = useState('kit');
    const [copied, setCopied] = useState(false);
    const [loadingSample, setLoadingSample] = useState(false);
    // null = unknown (signed out, or still checking)
    const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
    // Are the AI features switched on for this server? (They need an API key.)
    useEffect(() => {
        if (!user) { setAiAvailable(null); return; }
        apiGet('/api/auto-config/status')
            .then((d) => setAiAvailable(Boolean(d.available)))
            .catch(() => setAiAvailable(null));
    }, [user]);

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
                                    <div className="tt-kit__sub">for the AI co-pilot in step 4</div>
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
                                <span>Use your own words if you like. The co-pilot reads the description together with your dataset, so it already knows the columns.</span>
                            </div>
                        </div>
                    </div>

                </Step>

                {/* ── 01 · Account ── */}
                <Step id="account" num="01" where={<>Page · <Link to="/signup">Sign Up</Link></>} title={<>Create your <em>account</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Click <b>Sign Up</b> in the top bar and fill in an email, a username and a password.</li>
                                <li>Three short questions follow. Pick the <b>first answer</b> to each — the beginner ones.</li>
                                <li>Click <b>Complete Registration</b>.</li>
                            </ol>
                            <div className="tt-note">
                                <Sparkles size={15} />
                                <span>Those answers matter: two or more beginner answers give you a <strong>Novice</strong> account, and Novice accounts get the <strong>AI tutor</strong> used in steps 3 and 5. You can switch modes later on your Profile.</span>
                            </div>
                        </Do>
                        <Changes>
                            <ul>
                                <li>You land back on the home page, signed in: your username and a <b>🌿 Novice</b> badge appear in the top bar.</li>
                                <li>A round purple <b>chat button</b> appears in the bottom-right corner of every page — that is the tutor.</li>
                                <li>Small <b>✨ icons</b> appear next to settings all over the app. Each one asks the tutor about that setting.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="01-account" url="vortexml / signup" alt="Filling in the sign-up form, answering the three survey questions as a beginner, and landing on the home page with a Novice badge." />
                    <div className="tt-account">
                        {user ? (
                            <>
                                <CircleCheck size={18} style={{ color: 'var(--color-success)' }} />
                                <span>
                                    Signed in as <strong>{user.username}</strong> — the model you train will be saved to your account.
                                    {!user.is_beginner && <> You are in <strong>Expert</strong> mode, which hides the AI tutor: switch to Novice on your <Link to="/profile" className="vx-link">Profile</Link> to follow steps 3 and 5.</>}
                                </span>
                            </>
                        ) : (
                            <>
                                <UserRound size={18} style={{ color: 'var(--color-accent-text)' }} />
                                <span>
                                    <strong>It is free, and the rest of the tutorial needs it:</strong> the AI tutor, the
                                    co-pilot, saved models and the Predict page all work only when you are signed in.
                                </span>
                                <Link to="/signup" className="vx-ghost-btn vx-ghost-btn--accent">Create an account</Link>
                            </>
                        )}
                    </div>
                </Step>

                {/* ── 02 · Upload ── */}
                <Step id="upload" num="02" where={<>Page · <Link to="/dataset">Dataset</Link></>} title={<>Upload the <em>data</em></>}>
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
                    <Clip name="02-upload" url="vortexml / dataset" alt="Uploading student_performance.csv on the Dataset page; the preview table appears." />
                </Step>

                {/* ── 03 · Columns, with the tutor ── */}
                <Step id="columns" num="03" where={<>Page · <Link to="/dataset">Dataset</Link></>} title={<>Choose what to <em>predict</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Scroll to <b>Select Columns</b> and click the <b>✨ icon</b> next to the title. The tutor opens and explains what a feature and a target are.</li>
                                <li>Close the tutor, then click <b>Feature</b> on the five study-habit columns — the clues the model may use.</li>
                                <li>Click <b>Target</b> on <code>passed</code> — the answer it must learn to give.</li>
                                <li>Click <b>Continue to Architecture Builder</b>.</li>
                            </ol>
                        </Do>
                        <Changes>
                            <ul>
                                <li>The tutor panel slides up in the corner with your question already asked, then its answer.</li>
                                <li>Each feature you pick lights up; the target is marked in a different colour.</li>
                                <li>A column can be a feature or the target, never both — picking one clears the other.</li>
                                <li>The <b>Continue</b> button fades in once there is at least one feature and a target.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="03-columns" url="vortexml / dataset" alt="Asking the AI tutor what features and a target are, then marking five columns as features and 'passed' as the target." />
                    <div className="tt-note">
                        <Info size={15} />
                        <span>The tutor explains and advises; it does not see your data or click for you. You can also type your own question into it at any time.</span>
                    </div>
                </Step>

                {/* ── 04 · The co-pilot designs the network ── */}
                <Step id="architect" num="04" where={<>Page · <Link to="/architect">Architect</Link></>} title={<>Let the AI <em>design the network</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Click <b>🪄 AI Auto-Configure</b> at the top of the Architect page.</li>
                                <li>Paste the <a href="#kit" className="vx-link">test prompt</a> and press Enter. The co-pilot may ask one or two short questions — answer in your own words, or skip them.</li>
                                <li>Click <b>Generate Configuration</b> and read the proposal and its reasoning.</li>
                                <li>Click <b>Apply to Architect</b>.</li>
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
                                <li>A <b>Proposed configuration</b> card lists the architecture, layers, epochs and learning rate — and why it chose them.</li>
                                <li>After <b>Apply</b>, the page fills itself in: the architecture is selected and every field is set for you.</li>
                                <li>The <b>Architecture Preview</b> draws the result: 5 inputs → the hidden layers → 2 outputs (pass / fail).</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="04-autoconfig" url="vortexml / architect" alt="Describing the goal to the AI co-pilot, generating a configuration and applying it to the Architect page." />
                    <div className="tt-note">
                        {aiAvailable === false
                            ? <><Info size={15} /><span><strong>The AI co-pilot is not switched on for this server</strong> (it needs an API key from the administrator). Pick <strong>Multi-Layer Perceptron</strong> yourself and keep the default settings — that trains well on this dataset too.</span></>
                            : aiAvailable === true
                                ? <><Sparkles size={15} /><span><strong>The AI co-pilot is available on this server.</strong> For a small table like this one it keeps the suggestion modest — a small Multi-Layer Perceptron for a few dozen epochs, usually with early stopping. Your exact numbers can differ from the clip's.</span></>
                                : <><Info size={15} /><span>The AI co-pilot needs you to be <Link to="/signin" className="vx-link">signed in</Link>, which is why step 1 comes first.</span></>}
                    </div>
                </Step>

                {/* ── 05 · Parameters, with the tutor ── */}
                <Step id="parameters" num="05" where={<>Page · <Link to="/architect">Architect</Link></>} title={<>Tune the parameters <em>with the tutor</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Under <b>Hyperparameters</b>, click the <b>✨ icon</b> next to <b>Learning Rate</b>. The tutor explains what it does and what value suits a first run.</li>
                                <li>Ask a follow-up about <i>your</i> model. Tell it your numbers — it cannot see the page.</li>
                                <li>Change a value if the tutor convinces you; otherwise keep the co-pilot's.</li>
                                <li>Type <b>Exam-Predictor</b> as the <b>Project Name</b>.</li>
                            </ol>
                            <div className="tt-prompt" style={{ marginTop: '0.9rem' }}>
                                My table has 800 rows and 5 features. The co-pilot set learning rate 0.001 and 40 epochs — should I change either?
                            </div>
                        </Do>
                        <Changes>
                            <ul>
                                <li>Every setting has two icons: <b>?</b> opens a short written explanation, <b>✨</b> asks the tutor.</li>
                                <li>The tutor answers in plain language, with a concrete value to start from.</li>
                                <li>Its answer to the follow-up refers to your rows, features and epochs, because you told it.</li>
                                <li>The same ✨ icons sit next to <b>Epochs</b>, <b>Batch Size</b>, <b>Optimizer</b>, <b>Activation</b>, the layer sizes and each architecture card.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="05-parameters" url="vortexml / architect" alt="Asking the AI tutor about the learning rate, then about the values the co-pilot chose, and naming the project." />
                </Step>

                {/* ── 06 · Train ── */}
                <Step id="train" num="06" where={<>Page · <Link to="/training">Training</Link></>} title={<>Train <em>it</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Click <b>Start Training ⚡</b> at the bottom of the Architect page.</li>
                                <li>Under <b>Compute Device</b>, keep the <b>VortexML M4 Mac Mini</b> selected.</li>
                                <li>Click <b>▶ Start Training</b> in the Training Log panel and watch. On this dataset it takes a second or two.</li>
                            </ol>
                            <div className="tt-note">
                                <Info size={15} />
                                <span>If the button says <strong>Join the queue</strong>, someone else is training. The Mac mini is the free, shared machine and runs one model at a time — yours starts by itself when it is free.</span>
                            </div>
                        </Do>
                        <Changes>
                            <ul>
                                <li><b>Epoch</b> counts up and the progress bar fills.</li>
                                <li><b>Train loss</b> — how wrong the model is — falls from around 0.6 to below 0.1.</li>
                                <li><b>Val accuracy</b> — the share of held-back students it gets right — climbs to roughly 95%.</li>
                                <li>With early stopping on, the run may end before the last epoch: training stops once the validation loss stops improving.</li>
                                <li>The log ends with a green <b>✅</b> line giving the final loss, and new buttons appear: <b>Save Weights</b> and <b>✨ Explain Results</b>.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="06-train" url="vortexml / training" alt="Starting the run on the Training page; the loss curve falls and accuracy rises until training completes." />
                </Step>

                {/* ── 07 · Explain Results ── */}
                <Step id="explain" num="07" where={<>Page · <Link to="/training">Training</Link></>} title={<>Have the AI <em>explain the results</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>When the run has finished, click <b>✨ Explain Results</b> in the Training Log panel.</li>
                                <li>Read the verdict. It is written for someone who has never read a loss curve.</li>
                                <li>Close it and compare what it says with the charts above.</li>
                            </ol>
                        </Do>
                        <Changes>
                            <ul>
                                <li>A panel opens with <b>Reviewing your training run…</b>, then the review.</li>
                                <li>It covers how training went, whether the model is <b>overfitting</b>, whether it is <b>ready to use</b>, and what to try next.</li>
                                <li>The numbers it quotes are yours — the AI is given this run's loss and accuracy history.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="07-explain" url="vortexml / training" alt="Clicking Explain Results after training; the AI's plain-language review of the run appears." />
                    <div className="tt-note">
                        <Lightbulb size={15} />
                        <span>The same button sits on every saved project on your <Link to="/profile" className="vx-link">Profile</Link>, so you can ask about an older run too.</span>
                    </div>
                </Step>

                {/* ── 08 · Background sessions ── */}
                <Step id="background" num="08" where="Any page · any browser" title={<>Close the tab — it <em>keeps training</em></>}>
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
                        name="08-background"
                        url="vortexml — opened in a second browser"
                        alt="A second browser signs in while a run is training: the welcome-back prompt appears, then the dashboard with the full history."
                        caption={<>
                            Recorded with a deliberately long run (6,000 epochs) so there was something to come back to.
                            Notice the validation loss creeping up while the training loss keeps falling — that is
                            overfitting, and exactly why a few dozen epochs was the better choice.
                        </>}
                    />
                    <div className="tt-note">
                        <Lightbulb size={15} />
                        <span>
                            The prompt also offers two ways out of the queue: <strong>enroll your own server</strong> (link a machine
                            you own; it only runs your jobs — see step 14) or <strong>talk to sales</strong> about Enterprise — tailored
                            configurations, high priority with no queue, and several models training at once.
                        </span>
                    </div>
                </Step>

                {/* ── 09 · Predict ── */}
                <Step id="predict" num="09" where={<>Page · <Link to="/predict">Predict</Link></>} title={<>Ask it <em>questions</em></>}>
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
                    <Clip name="09-predict" url="vortexml / predict" alt="Entering two different students on the Predict page; the prediction changes from pass to fail." />
                </Step>

                {/* ── 10 · Assistant ── */}
                <Step id="assistant" num="10" where={<>Page · <Link to="/assistant">Assistant</Link></>} title={<>Ask your <em>documents</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Open <b>Assistant</b>, type a name under <b>Knowledge bases</b> and click <b>Create</b>.</li>
                                <li>Click <b>Add documents</b> and pick one or more files — text, Markdown, PDF, Word, Excel, PowerPoint, HTML, CSV or JSON.</li>
                                <li>Type a question about them under <b>Ask</b> and press Enter.</li>
                            </ol>
                        </Do>
                        <Changes>
                            <ul>
                                <li>Each file shows up as a <b>📄</b> tag once it has been read and indexed.</li>
                                <li>The answer is written from your documents only, with numbered references like <b>[1]</b>.</li>
                                <li>A <b>Sources</b> list under it shows the exact passages each reference points to.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="10-assistant" url="vortexml / assistant" alt="Creating a knowledge base, adding a document and asking a question; the answer appears with its sources." />
                </Step>

                {/* ── 11 · Chat ── */}
                <Step id="chat" num="11" where={<>Page · <Link to="/chat">Chat</Link></>} title={<>Chat with <em>a model</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Open <b>Chat</b>, type a question and press Enter.</li>
                                <li>Tick <b>💭 Reasoning</b> to see how it thinks before it answers.</li>
                                <li>Pick one of your knowledge bases in the documents menu to ground the conversation in your files.</li>
                            </ol>
                        </Do>
                        <Changes>
                            <ul>
                                <li>The answer is written out word by word; the red button stops it mid-sentence.</li>
                                <li><b>Regenerate</b> appears under the reply for a second opinion.</li>
                                <li>Every conversation is saved in the list on the left, where you can rename or delete it.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="11-chat" url="vortexml / chat" alt="Asking the chat model why a model scores well on training data and badly on validation data; the answer streams in." />
                </Step>

                {/* ── 12 · Leaderboard ── */}
                <Step id="leaderboard" num="12" where={<>Page · <Link to="/leaderboard">Leaderboard</Link></>} title={<>Compare <em>your runs</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Train the same data a second and third time with one setting changed (step 15 has ideas).</li>
                                <li>Open <b>Leaderboard</b> and tick the runs you want to compare — up to six.</li>
                                <li>Sort <b>By accuracy</b> or <b>By val loss</b>.</li>
                            </ol>
                        </Do>
                        <Changes>
                            <ul>
                                <li>Every finished run you made while signed in is listed, best first, with a trophy on the winner.</li>
                                <li>The two charts overlay the ticked runs: <b>Validation Loss</b> and <b>Validation Accuracy</b>, epoch by epoch.</li>
                                <li>A run that never settles — like the one with a learning rate of 1.0 in the clip — is obvious at a glance.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="12-leaderboard" url="vortexml / leaderboard" alt="Ticking three runs on the Leaderboard; their validation loss and accuracy curves are drawn on the same charts." />
                </Step>

                {/* ── 13 · Learn ── */}
                <Step id="learn" num="13" where={<>Page · <Link to="/learn">Learn</Link></>} title={<>Learn the <em>theory</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Open <b>Learn</b>. The <b>Roadmap</b> lays out eight milestones, from the mathematics to deployment.</li>
                                <li>Click any topic for a short explanation; the arrows unfold its sub-topics.</li>
                                <li>Switch to <b>Courses</b> for full written lessons on each kind of network.</li>
                            </ol>
                        </Do>
                        <Changes>
                            <ul>
                                <li>Topics slide in along the central line as you scroll.</li>
                                <li>A topic opens in a small card you can close with Esc.</li>
                                <li>A course opens as an article with formulas — start with <b>Introduction to Neural Networks</b>.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip name="13-learn" url="vortexml / learn" alt="Scrolling the learning roadmap, opening a topic, then opening the Introduction to Neural Networks course." />
                </Step>

                {/* ── 14 · Your own device ── */}
                <Step id="device" num="14" where={<>Page · <Link to="/profile">Profile</Link></>} title={<>Train on <em>your own machine</em></>}>
                    <div className="tt-step__body">
                        <Do>
                            <ol>
                                <li>Open <b>Profile</b> and click <b>Link a device</b>.</li>
                                <li>Give the machine a nickname and click <b>Create &amp; Download Agent</b>.</li>
                                <li>On that machine, unzip the bundle and run the command shown: <code>chmod +x run.sh &amp;&amp; ./run.sh</code></li>
                                <li>Leave it running, then pick the device under <b>Compute Device</b> on the Training page.</li>
                            </ol>
                        </Do>
                        <Changes>
                            <ul>
                                <li>The device is listed under <b>Your Devices</b> straight away, marked <b>Offline</b>.</li>
                                <li>Once the agent on that machine connects, it turns <b>Available</b> and shows the machine's specs.</li>
                                <li>Runs on your own device skip the shared queue, and only you can use it.</li>
                            </ul>
                        </Changes>
                    </div>
                    <Clip
                        name="14-device"
                        url="vortexml / profile"
                        alt="Linking a device from the Profile page: naming it, downloading the agent, and seeing it listed as offline."
                        caption="Recorded without a second machine, so the device stays Offline here. It turns Available once the agent runs on it."
                    />
                </Step>

                {/* ── 15 · Experiments ── */}
                <Step id="experiments" num="15" where="Go further" title={<>Change one thing, <em>see what happens</em></>}>
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
                                                    ? 'linear-gradient(90deg, var(--color-success), var(--color-success))'
                                                    : 'linear-gradient(90deg, var(--color-warning), var(--color-warning))',
                                            }} />
                                        </span>
                                        <b style={{ color: e.mean >= 90 ? 'var(--color-success)' : 'var(--color-warning)' }}>{e.mean.toFixed(1)}%</b>
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
    );
};

const Tutorial: React.FC = () => (
    <div className="dm-page">
        <header className="dm-hero">
            <div className="vx-eyebrow" style={{ justifyContent: 'center' }}>
                <span className="vx-dot vx-dot--violet vx-dot--still" /> Tutorial
            </div>
            <h1>Your first model, <em>step by step.</em></h1>
            <p>
                In about ten minutes you will teach a neural network to predict whether a student passes an
                exam — and let the AI tutor and co-pilot do the hard parts. Every step shows exactly what to
                click and what you should see change.
            </p>
            <div className="dm-hero__facts">
                <span className="vx-chip vx-chip--violet">≈ 10 minutes</span>
                <span className="vx-chip vx-chip--cyan">AI-guided, no ML experience needed</span>
                <span className="vx-chip vx-chip--green">Recorded from the real app</span>
            </div>
            <div className="dm-hero__actions">
                <a href="#account" className="dm-cta">Start the tutorial <ArrowRight size={16} /></a>
                <Link to="/demo" className="dm-cta dm-cta--quiet">Just watch a live demo</Link>
            </div>
        </header>
        <TutorialGuide />
    </div>
);

export default Tutorial;
