import React from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../../site';
import LegalPage, { Contact, type LegalSection } from './LegalPage';

const SECTIONS: LegalSection[] = [
    {
        id: 'who',
        title: 'Who is responsible',
        body: (
            <p>
                VortexML is run by {SITE.operator}, based in {SITE.country}, who decides how and why the personal
                data described here is processed (the “controller” in the words of the EU General Data
                Protection Regulation, GDPR). To ask anything about your data, or to use any of the rights
                listed below, write to us <Contact via />.
            </p>
        ),
    },
    {
        id: 'collect',
        title: 'What we collect',
        body: (
            <>
                <div className="lg-table-wrap">
                    <table className="lg-table">
                        <thead>
                            <tr><th>What</th><th>Details</th><th>When</th></tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Account</strong></td>
                                <td>Email address, username, and your password stored only as a salted hash (we cannot read it). Your answers to the three sign-up questions are reduced to one setting: Novice or Expert.</td>
                                <td>When you sign up</td>
                            </tr>
                            <tr>
                                <td><strong>Your work</strong></td>
                                <td>Datasets and documents you upload, the column choices and model settings you make, trained model weights, training history, saved projects, knowledge bases and conversations.</td>
                                <td>When you use those features</td>
                            </tr>
                            <tr>
                                <td><strong>AI requests</strong></td>
                                <td>The questions you put to the AI features, and the context they need (see section 4).</td>
                                <td>When you use an AI feature</td>
                            </tr>
                            <tr>
                                <td><strong>Linked devices</strong></td>
                                <td>The nickname you give a device and the hardware details its agent reports (such as processor, memory and operating system).</td>
                                <td>If you link a device</td>
                            </tr>
                            <tr>
                                <td><strong>Enquiries</strong></td>
                                <td>Name, email address, company (optional), the topic and your message.</td>
                                <td>If you send the contact form</td>
                            </tr>
                            <tr>
                                <td><strong>Technical data</strong></td>
                                <td>Your IP address and basic request details, used to deliver the pages, to apply rate limits and to protect the service. A session cookie (see the <Link to="/cookies">Cookie Policy</Link>).</td>
                                <td>Whenever you visit</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    We do not use analytics or advertising trackers, we do not build profiles of visitors, and we
                    do not sell personal data.
                </p>
            </>
        ),
    },
    {
        id: 'why',
        title: 'Why we use it, and on what basis',
        body: (
            <ul>
                <li>
                    <strong>To provide the service you asked for</strong> — keep you signed in, train your models,
                    store your projects, answer your AI requests. Legal basis: performance of our agreement with
                    you (GDPR Art. 6(1)(b)).
                </li>
                <li>
                    <strong>To keep the service secure and fair</strong> — rate limits, the training queue,
                    preventing abuse. Legal basis: our legitimate interest in running a working, safe service
                    (Art. 6(1)(f)).
                </li>
                <li>
                    <strong>To answer enquiries</strong> you send through the contact form. Legal basis: steps
                    taken at your request before a possible agreement (Art. 6(1)(b)) and our legitimate interest
                    in replying (Art. 6(1)(f)).
                </li>
                <li>
                    <strong>To meet legal obligations</strong> if the law requires us to keep or disclose
                    something (Art. 6(1)(c)).
                </li>
            </ul>
        ),
    },
    {
        id: 'ai',
        title: 'What the AI features send, and to whom',
        body: (
            <>
                <p>
                    The AI features are powered by language models from Anthropic. When you use one, the
                    following is sent to Anthropic to produce the answer:
                </p>
                <ul>
                    <li><strong>AI tutor</strong> — your question and the earlier messages of that conversation.</li>
                    <li>
                        <strong>AI Auto-Configure</strong> — your description of the goal, and a summary of your
                        dataset: the file name, the number of rows and columns, each column’s name, type, value
                        range and average, the most common values of text columns, and which columns you
                        selected. The rows themselves are not sent.
                    </li>
                    <li><strong>Explain Results</strong> — the settings and the loss and accuracy history of that training run.</li>
                    <li><strong>Assistant</strong> — your question and the passages of your documents that best match it.</li>
                    <li><strong>Chat</strong> — the messages of the conversation and, if you ground it in a knowledge base, matching passages from it.</li>
                </ul>
                <p>
                    Column names, common values and document passages can themselves contain personal data, so
                    please do not use the AI features with material you would not want to leave this site.
                </p>
            </>
        ),
    },
    {
        id: 'sharing',
        title: 'Who else receives data',
        body: (
            <>
                <p>We share data only with the providers needed to run the service:</p>
                <div className="lg-table-wrap">
                    <table className="lg-table">
                        <thead>
                            <tr><th>Provider</th><th>Role</th><th>What it receives</th></tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Cloudflare</strong></td>
                                <td>Delivers the site and protects it from attacks</td>
                                <td>All traffic passes through it: your IP address and the requests you make</td>
                            </tr>
                            <tr>
                                <td><strong>Anthropic</strong></td>
                                <td>Language models behind the AI features</td>
                                <td>What section 4 lists, only when you use an AI feature</td>
                            </tr>
                            <tr>
                                <td><strong>Fontshare, Google Fonts</strong></td>
                                <td>Serve the typefaces the site uses</td>
                                <td>Your IP address, when your browser downloads the fonts</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    The application itself, its database and your files run on hardware operated by the project,
                    not on a public cloud. We may also disclose data if the law requires it.
                </p>
                <p>
                    Some of these providers process data outside the European Economic Area, including in the
                    United States. They do so under the safeguards they publish for international transfers,
                    such as the EU Standard Contractual Clauses.
                </p>
            </>
        ),
    },
    {
        id: 'retention',
        title: 'How long we keep it',
        body: (
            <ul>
                <li>
                    <strong>Without an account:</strong> your working data (the uploaded dataset, your choices,
                    the trained model) is deleted after about six hours of inactivity. The summary of a finished
                    run is kept for up to 24 hours so we can show it to you when you return.
                </li>
                <li>
                    <strong>With an account:</strong> your account and saved work are kept until you delete
                    them. Projects, knowledge bases, conversations and devices each have a delete button, and{' '}
                    <strong>Delete my account</strong> on your <Link to="/profile">Profile</Link> removes the
                    account and everything in it at once — immediately, including the files on our server.
                </li>
                <li><strong>Enquiries:</strong> kept for as long as needed to handle them, then deleted.</li>
                <li><strong>Technical data:</strong> rate-limit counters live in memory and are lost when the server restarts.</li>
            </ul>
        ),
    },
    {
        id: 'rights',
        title: 'Your rights',
        body: (
            <>
                <p>Under the GDPR you have the right to:</p>
                <ul>
                    <li>know whether we hold data about you, and receive a copy of it;</li>
                    <li>have inaccurate data corrected;</li>
                    <li>have your data deleted;</li>
                    <li>have its processing restricted, or object to processing based on our legitimate interests;</li>
                    <li>receive the data you gave us in a portable format.</li>
                </ul>
                <p>
                    Two of these you can do yourself, at any time, under <strong>Your Data</strong> on your{' '}
                    <Link to="/profile">Profile</Link>: <strong>Download my data</strong> gives you a copy of
                    everything in your account as one file, and <strong>Delete my account</strong> erases it.
                </p>
                <p>
                    For anything else, write to us <Contact via />. We answer within one month. You also
                    have the right to complain to a data protection authority; in Romania that is the National
                    Supervisory Authority for Personal Data Processing (ANSPDCP),{' '}
                    <a href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer">dataprotection.ro</a>.
                </p>
            </>
        ),
    },
    {
        id: 'security',
        title: 'Security',
        body: (
            <p>
                The site is served over HTTPS. Passwords are stored as salted hashes. The session cookie cannot
                be read by scripts and is sent only over secure connections. Each account’s data is visible only
                to that account. No system is perfectly secure, so please do not upload anything you could not
                afford to have exposed.
            </p>
        ),
    },
    {
        id: 'children',
        title: 'Children',
        body: (
            <p>
                VortexML is not directed at children under 16, and they should not create an account. If you
                believe a child has given us personal data, tell us and we will delete it.
            </p>
        ),
    },
    {
        id: 'changes',
        title: 'Changes to this policy',
        body: (
            <p>
                We will update this page when what we do with data changes. The date at the top shows the latest
                version, and significant changes will be announced on the site.
            </p>
        ),
    },
];

const Privacy: React.FC = () => (
    <LegalPage
        path="/privacy"
        eyebrow="Legal"
        title={<>Privacy <em>Policy</em></>}
        lead="What VortexML knows about you, why, who else sees it, how long it is kept, and what you can do about it."
        summary={[
            'We collect what the service needs: your account, the work you upload and create, and basic technical data.',
            'No analytics, no advertising, no selling of data.',
            'The AI features send your question and the context it needs to Anthropic. Dataset rows are not sent to the co-pilot.',
            'Without an account, your working data is deleted after about six hours of inactivity.',
            'You can download a copy of your data, or delete your account and everything in it, from your Profile at any time.',
        ]}
        sections={SECTIONS}
    />
);

export default Privacy;
