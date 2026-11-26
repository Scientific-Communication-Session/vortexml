import React from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../../site';
import LegalPage, { Contact, type LegalSection } from './LegalPage';

const SECTIONS: LegalSection[] = [
    {
        id: 'service',
        title: 'What VortexML is',
        body: (
            <>
                <p>
                    VortexML is a website for building, training and using neural networks on tabular data, with
                    AI features that explain and assist. It is run by {SITE.operator} (“we”, “us”). These terms
                    are the agreement between you and us for using {SITE.url.replace('https://', '')} and
                    everything on it (“the service”).
                </p>
                <p>
                    The service is free and is offered for learning and experimentation. By using it you accept
                    these terms. If you do not accept them, please do not use the service.
                </p>
            </>
        ),
    },
    {
        id: 'accounts',
        title: 'Accounts',
        body: (
            <>
                <p>
                    Much of the service works without an account. Saved models, predictions, the AI features and
                    following a training run from another browser need one.
                </p>
                <ul>
                    <li>Give an email address you can be reached at, and keep your password to yourself.</li>
                    <li>You are responsible for what happens under your account. Tell us if you think someone else has used it.</li>
                    <li>You must be at least 16 years old to create an account.</li>
                    <li>One person, one account. Do not create accounts by automated means.</li>
                </ul>
            </>
        ),
    },
    {
        id: 'use',
        title: 'Acceptable use',
        body: (
            <>
                <p>The training server is shared by everyone. Please use it for what it is for. You agree not to:</p>
                <ul>
                    <li>upload data you have no right to use, or data whose processing would break the law;</li>
                    <li>
                        upload sensitive personal data about other people — for example health, financial or
                        identity records of real, identifiable individuals — or any personal data you have no legal
                        basis to process;
                    </li>
                    <li>use the service to build models intended to discriminate against, deceive, surveil or harm people;</li>
                    <li>probe, attack or overload the service, get around its rate limits or queue, or access other people’s data;</li>
                    <li>use the compute for anything other than training and running models here (for example cryptocurrency mining);</li>
                    <li>resell the service or present it as your own.</li>
                </ul>
                <p>
                    Automated access to the public pages is welcome within reason; see{' '}
                    <a href="/robots.txt">robots.txt</a> and <a href="/llms.txt">llms.txt</a>.
                </p>
            </>
        ),
    },
    {
        id: 'content',
        title: 'Your data and your models',
        body: (
            <>
                <p>
                    The datasets and documents you upload, the models you train and the conversations you have
                    remain yours. You give us permission to store and process them only as far as needed to run
                    the service for you: to train, to predict, to answer your questions, and to show you your
                    results.
                </p>
                <p>
                    You are responsible for having the right to upload what you upload. We may remove content, or
                    suspend an account, that breaks these terms or the law.
                </p>
                <p>
                    Work done without an account is temporary and is deleted after a period of inactivity. Work
                    saved to an account is kept until you delete it or ask us to. Keep your own copy of anything
                    that matters: this is a free service and we do not promise to keep your data forever.
                </p>
            </>
        ),
    },
    {
        id: 'ai',
        title: 'AI features',
        body: (
            <>
                <p>
                    The tutor, the co-pilot, Explain Results, the Assistant and Chat are powered by language
                    models from a third-party provider (Anthropic). What you type into them, and the material
                    needed to answer — such as a summary of your dataset’s columns, your training metrics, or
                    passages from your documents — is sent to that provider to produce the answer. The{' '}
                    <Link to="/privacy">Privacy Policy</Link> describes this in detail.
                </p>
                <ul>
                    <li>AI output can be wrong, incomplete or out of date. Check it before relying on it.</li>
                    <li>It is not professional advice of any kind.</li>
                    <li>Do not enter confidential information or other people’s personal data into the AI features.</li>
                    <li>The AI features may be limited, changed or switched off at any time.</li>
                </ul>
            </>
        ),
    },
    {
        id: 'models',
        title: 'What trained models are good for',
        body: (
            <>
                <p>
                    A model trained here is an educational result. Its accuracy on the data it was tested with
                    says little about how it behaves elsewhere. Do not use a model trained on VortexML to make
                    decisions about people’s health, safety, finances, employment, education or legal position.
                </p>
                <p>
                    Some sample datasets come from medical research (breast cancer diagnosis, diabetes
                    progression). They are included to teach machine learning. Nothing on this site is medical
                    advice, and no model here is a diagnostic tool.
                </p>
            </>
        ),
    },
    {
        id: 'devices',
        title: 'Your own devices',
        body: (
            <p>
                You can link a machine you own and train on it. That involves downloading a small agent program
                and running it on that machine. You run it at your own risk and are responsible for the machine,
                its security and its electricity. Unlink the device on your Profile page to stop it accepting
                work.
            </p>
        ),
    },
    {
        id: 'availability',
        title: 'Availability, the queue and Enterprise',
        body: (
            <>
                <p>
                    The shared server trains one model at a time; other runs wait in a queue. We do not
                    guarantee that the service will be available, fast, or free of interruptions, and a run in
                    progress can be lost if the server restarts. We may change, limit or discontinue any part of
                    the service.
                </p>
                <p>
                    Enterprise arrangements — dedicated capacity, no queue, several models at once — are agreed
                    separately and in writing. Sending the contact form is an enquiry, not an order.
                </p>
            </>
        ),
    },
    {
        id: 'ip',
        title: 'Our content',
        body: (
            <p>
                The VortexML name and logo, the design of the site, the tutorial, the recordings and the course
                texts belong to us or to their authors. You may link to them and quote them with attribution.
                The sample datasets remain the work of the researchers credited next to each one.
            </p>
        ),
    },
    {
        id: 'ending',
        title: 'Ending your use',
        body: (
            <p>
                You can stop using the service at any time. <strong>Delete my account</strong> on your{' '}
                <Link to="/profile">Profile</Link> removes the account and everything in it straight away; you
                can also ask us to do it <Contact via />. We may suspend or close an account that breaks these terms, puts the service or
                other people at risk, or has been inactive for a long time. Where we reasonably can, we will warn
                you first.
            </p>
        ),
    },
    {
        id: 'liability',
        title: 'Warranties and liability',
        body: (
            <>
                <p>
                    The service is provided “as is”, free of charge, without warranties of any kind, as far as
                    the law allows. In particular we do not promise that it will be uninterrupted or error-free,
                    that results will be accurate, or that your data will never be lost.
                </p>
                <p>
                    As far as the law allows, we are not liable for indirect or consequential loss, loss of data,
                    or loss of profit arising from your use of the service.
                </p>
                <p>
                    Nothing in these terms limits liability that cannot be limited by law, or takes away rights
                    you have as a consumer under the law of the country where you live.
                </p>
            </>
        ),
    },
    {
        id: 'changes',
        title: 'Changes to these terms',
        body: (
            <p>
                We may update these terms as the service changes. The date at the top shows the latest version.
                If a change is significant, we will say so on the site. Continuing to use the service after a
                change means you accept the updated terms.
            </p>
        ),
    },
    {
        id: 'law',
        title: 'Governing law and contact',
        body: (
            <>
                <p>
                    These terms are governed by the law of {SITE.country}. If you are a consumer in the European
                    Union, you also keep the protection of the mandatory rules of the country where you live, and
                    you may bring a dispute before the courts there.
                </p>
                <p>
                    Questions about these terms: <Contact />.
                </p>
            </>
        ),
    },
];

const Terms: React.FC = () => (
    <LegalPage
        path="/terms"
        eyebrow="Legal"
        title={<>Terms of <em>Service</em></>}
        lead="The rules for using VortexML, written to be read. They cover what the service is, what you may do with it, and what you can expect from us."
        summary={[
            'VortexML is free and meant for learning. It comes with no guarantees.',
            'Your data and your models stay yours. We only process them to run the service for you.',
            'Do not upload other people’s sensitive personal data, and do not abuse the shared server.',
            'AI answers can be wrong; trained models are not for decisions about real people.',
        ]}
        sections={SECTIONS}
    />
);

export default Terms;
