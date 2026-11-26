import React, { useState } from 'react';
import { TriangleAlert, Trash2, X } from 'lucide-react';

// Deleting an account cannot be undone, so it asks for the password again and
// spells out exactly what goes.
const DeleteAccountModal: React.FC<{
    username: string;
    onClose: () => void;
    onDeleted: () => void;
}> = ({ username, onClose, onDeleted }) => {
    const [password, setPassword] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');

    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password || deleting) return;
        setDeleting(true);
        setError('');
        try {
            const res = await fetch('/api/auth/account', {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || `Could not delete the account (HTTP ${res.status}).`);
                return;
            }
            onDeleted();
        } catch (err) {
            setError('Could not reach the server: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(8,8,16,0.72)', backdropFilter: 'blur(6px)',
                display: 'grid', placeItems: 'center', padding: '1.5rem',
            }}
        >
            <form
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleDelete}
                className="glass-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-account-title"
                style={{ width: '100%', maxWidth: 520, padding: '1.6rem 1.7rem', position: 'relative' }}
            >
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="btn btn-secondary btn-sm"
                    style={{ position: 'absolute', top: '1rem', right: '1rem', padding: '0.3rem' }}
                >
                    <X size={15} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.6rem' }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center',
                        background: 'rgba(239,68,68,0.14)', color: '#f87171',
                    }}>
                        <TriangleAlert size={20} />
                    </div>
                    <h2 id="delete-account-title" style={{ fontSize: '1.2rem', margin: 0 }}>Delete your account?</h2>
                </div>

                <p className="text-muted" style={{ fontSize: '0.88rem', marginBottom: '0.7rem' }}>
                    This permanently deletes the account <strong style={{ color: '#fff' }}>{username}</strong> and
                    everything in it:
                </p>
                <ul className="text-muted" style={{ fontSize: '0.86rem', lineHeight: 1.6, margin: '0 0 0.9rem', paddingLeft: '1.2rem' }}>
                    <li>your saved projects and their trained model weights</li>
                    <li>your knowledge bases and the documents in them</li>
                    <li>your conversations</li>
                    <li>your linked devices, and any enquiries you sent us</li>
                    <li>any training run of yours that is running or queued right now</li>
                </ul>
                <p style={{ fontSize: '0.86rem', marginBottom: '1.1rem', color: '#fca5a5' }}>
                    It cannot be undone. Download your data first if you want to keep a copy.
                </p>

                <label htmlFor="delete-account-password" style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
                    Enter your password to confirm
                </label>
                <input
                    id="delete-account-password"
                    type="password"
                    value={password}
                    autoFocus
                    autoComplete="current-password"
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    style={{
                        width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10,
                        background: 'rgba(255,255,255,0.05)', color: 'inherit',
                        border: `1px solid ${error ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)'}`,
                        fontSize: '0.9rem', marginBottom: error ? '0.4rem' : '1.2rem',
                    }}
                />
                {error && (
                    <p role="alert" style={{ fontSize: '0.82rem', color: '#f87171', marginBottom: '1rem' }}>{error}</p>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Keep my account</button>
                    <button type="submit" className="btn btn-danger btn-sm" disabled={!password || deleting}>
                        <Trash2 size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                        {deleting ? 'Deleting…' : 'Delete everything'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default DeleteAccountModal;
