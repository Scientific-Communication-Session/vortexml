import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { SITE } from '../../site';
import LegalPage, { Contact, type LegalSection } from './LegalPage';

const SECTIONS: LegalSection[] = [
    {
        id: 'what',
        title: 'What it is',
        body: (
            <>
                <p>
                    VortexML is a place to build, train and use neural networks without writing code. You upload
                    a table, choose the column you want predicted, design the network — or let an AI co-pilot
                    design it — and watch it learn, epoch by epoch. Then you ask the finished model questions.
                </p>
                <p>
                    It was made for people meeting machine learning for the first time. Every setting has a
                    written explanation and an AI tutor one click away, and the <Link to="/tutorial">tutorial</Link>{' '}
                    takes you from an empty page to a working model in about ten minutes.
                </p>
            </>
        ),
    },
    {
        id: 'how',
        title: 'How it works',
        body: (
            <>
                <p>
                    Training happens on the server, not in your browser, so a run carries on when you close the
                    tab and is waiting for you when you come back. The shared server is a single Mac mini: the
                    free tier. It trains one model at a time, and other runs wait their turn in a queue.
                </p>
                <p>
                    If you have a machine of your own, you can link it to your account and train on it instead;
                    it only ever runs your jobs. For teams that need dedicated capacity, no queue and several
                    models training at once, there is an Enterprise option — <Contact>get in touch</Contact>.
                </p>
                <p>
                    Under the surface it is PyTorch for the models, a Python server that orchestrates training
                    and streams progress, and a React interface. The AI tutor, co-pilot and assistant use
                    Anthropic’s Claude models.
                </p>
            </>
        ),
    },
    {
        id: 'who',
        title: 'Who makes it',
        body: (
            <p>
                VortexML is built and run by {SITE.operator} in {SITE.country}. It began as a student research
                project and was presented at the Scientific Communication Session 2026 of Politehnica University
                of Bucharest, where it won first place.
            </p>
        ),
    },
    {
        id: 'contact',
        title: 'Get in touch',
        body: (
            <>
                <p>
                    Questions, feedback, a bug to report, or interest in Enterprise: write to us{' '}
                    <Contact via />. We read everything.
                </p>
                <p>
                    For how we handle data, see the <Link to="/privacy">Privacy Policy</Link>; for the rules of
                    the service, the <Link to="/terms">Terms of Service</Link>.
                </p>
            </>
        ),
    },
];

const About: React.FC = () => (
    <LegalPage
        path="/about"
        eyebrow="About"
        title={<>Machine learning, <em>made approachable.</em></>}
        lead="VortexML lets anyone train a neural network on their own data — in a browser, with an AI tutor explaining every step."
        updated={false}
        sections={SECTIONS}
    >
        <div className="lg-award">
            <Trophy size={26} strokeWidth={1.7} />
            <div>
                <strong>1st place — Scientific Communication Session 2026</strong>
                <small>Politehnica University of Bucharest</small>
            </div>
        </div>
        <div className="lg-facts">
            <div className="lg-fact"><b>10</b><span>neural network architectures, from a simple MLP to a Transformer</span></div>
            <div className="lg-fact"><b>5</b><span>AI features: tutor, co-pilot, result explanations, document assistant and chat</span></div>
            <div className="lg-fact"><b>0</b><span>lines of code to write, and nothing to install</span></div>
        </div>
    </LegalPage>
);

export default About;
