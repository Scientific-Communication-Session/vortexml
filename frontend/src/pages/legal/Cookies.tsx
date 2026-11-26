import React from 'react';
import { Link } from 'react-router-dom';
import LegalPage, { Contact, type LegalSection } from './LegalPage';

const SECTIONS: LegalSection[] = [
    {
        id: 'cookie',
        title: 'The one cookie we set',
        body: (
            <>
                <div className="lg-table-wrap">
                    <table className="lg-table">
                        <thead>
                            <tr><th>Name</th><th>Purpose</th><th>Lifetime</th></tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><code>session</code></td>
                                <td>
                                    Keeps you signed in. For visitors without an account it holds a random
                                    identifier, so the dataset you uploaded and the model you are training
                                    stay yours as you move between pages.
                                </td>
                                <td>Until you close the browser or sign out</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    It is a strictly necessary cookie: the service cannot work without it, so the law does not
                    require us to ask for consent, and there is no cookie banner. It is signed, cannot be read by
                    scripts, and is only sent over HTTPS.
                </p>
            </>
        ),
    },
    {
        id: 'storage',
        title: 'What is stored in your browser',
        body: (
            <>
                <p>
                    Besides the cookie, the site keeps one small note in your browser’s own storage. It never
                    leaves your device.
                </p>
                <div className="lg-table-wrap">
                    <table className="lg-table">
                        <thead>
                            <tr><th>Key</th><th>Purpose</th></tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><code>vortex:runs-acked</code></td>
                                <td>
                                    Remembers which training runs you have already been told about, so the
                                    “welcome back” prompt is not shown twice. It holds run identifiers only.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </>
        ),
    },
    {
        id: 'third',
        title: 'Cookies from others',
        body: (
            <>
                <p>
                    The site is delivered through Cloudflare, which may set its own strictly necessary cookies
                    to tell visitors from automated attacks.
                </p>
                <p>
                    The typefaces are loaded from Fontshare and Google Fonts. They do not set cookies for this,
                    but they do see your IP address when your browser downloads the fonts.
                </p>
                <p>We use no analytics, advertising or social-media cookies.</p>
            </>
        ),
    },
    {
        id: 'control',
        title: 'Your choices',
        body: (
            <p>
                You can delete or block cookies in your browser’s settings. If you block the session cookie you
                can still read the site, but you cannot sign in, and uploads and training will not carry over
                from one page to the next. Questions: <Contact />. See also the{' '}
                <Link to="/privacy">Privacy Policy</Link>.
            </p>
        ),
    },
];

const Cookies: React.FC = () => (
    <LegalPage
        path="/cookies"
        eyebrow="Legal"
        title={<>Cookie <em>Policy</em></>}
        lead="VortexML sets a single cookie, and it is one the site cannot work without. Here is exactly what it does."
        summary={[
            'One essential cookie, to keep your session.',
            'No tracking, analytics or advertising cookies — which is why there is no cookie banner.',
        ]}
        sections={SECTIONS}
    />
);

export default Cookies;
