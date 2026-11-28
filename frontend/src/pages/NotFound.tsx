import React from 'react';
import { Link } from 'react-router-dom';

// Any address the app has no page for. The server answers it with a 404 status.
const NotFound: React.FC = () => (
    <div className="page-header" style={{ textAlign: 'center', paddingTop: '12vh' }}>
        <h1>Page not found</h1>
        <p>There is nothing at this address. It may have moved, or the link may be mistyped.</p>
        <p style={{ marginTop: '1.5rem' }}>
            <Link to="/" className="btn btn-primary">Back to the home page</Link>
        </p>
    </div>
);

export default NotFound;
