import React, { useState } from 'react';
import { X, Download, Laptop, Terminal, CircleCheck, Copy, Check } from 'lucide-react';
import { apiPost, showToast } from '../../utils/helpers';
import type { Device } from './types';

const RUN_COMMAND = 'chmod +x run.sh && ./run.sh';

interface AddDeviceModalProps {
    onClose: () => void;
    /** Called after a device row is created so the parent can refresh its list. */
    onCreated: () => void;
}

const AddDeviceModal: React.FC<AddDeviceModalProps> = ({ onClose, onCreated }) => {
    const [nickname, setNickname] = useState('');
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState<Device | null>(null);
    const [copied, setCopied] = useState(false);

    const triggerDownload = (id: number) => {
        window.location.href = `/api/devices/${id}/agent.zip`;
    };

    const copyCommand = async () => {
        try {
            await navigator.clipboard.writeText(RUN_COMMAND);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            showToast('Copy failed — select the command and copy it manually.', 'warning');
        }
    };

    const handleCreate = async () => {
        setCreating(true);
        try {
            const data = await apiPost('/api/devices', { nickname: nickname.trim() || 'My Device' });
            if (data.error || !data.device) {
                showToast(data.error || 'Could not link device', 'error');
                return;
            }
            setCreated(data.device);
            onCreated();
            triggerDownload(data.device.id);
            showToast('Device linked — downloading agent…', 'success');
        } catch (e) {
            showToast('Failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
        } finally {
            setCreating(false);
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
            <div
                onClick={(e) => e.stopPropagation()}
                className="glass-panel"
                style={{ width: '100%', maxWidth: 540, padding: '1.6rem 1.7rem', position: 'relative' }}
            >
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="btn btn-secondary btn-sm"
                    style={{ position: 'absolute', top: '1rem', right: '1rem', padding: '0.3rem' }}
                >
                    <X size={15} />
                </button>

                {!created ? (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.4rem' }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center',
                                background: 'rgba(139,92,246,0.14)', color: '#8b5cf6',
                            }}>
                                <Laptop size={20} />
                            </div>
                            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Link your own device</h2>
                        </div>
                        <p className="text-muted" style={{ fontSize: '0.87rem', marginBottom: '1.1rem' }}>
                            Run training on a machine you own — a home Mac, a server, a spare laptop.
                            You'll get a small agent bundle to run on that machine. It pairs only with
                            your account, and you can drive it from any browser, even one with no ML power.
                        </p>

                        <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
                            Device nickname
                        </label>
                        <input
                            type="text"
                            value={nickname}
                            autoFocus
                            maxLength={80}
                            placeholder="e.g. Home Mac Mini"
                            onChange={(e) => setNickname(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                            style={{
                                width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10,
                                background: 'rgba(255,255,255,0.05)', color: 'inherit',
                                border: '1px solid rgba(255,255,255,0.12)', fontSize: '0.9rem',
                                marginBottom: '1.2rem',
                            }}
                        />

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                            <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating}>
                                <Download size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                                {creating ? 'Linking…' : 'Create & Download Agent'}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.5rem' }}>
                            <CircleCheck size={22} style={{ color: '#22c55e' }} />
                            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>"{created.nickname}" is linked</h2>
                        </div>
                        <p className="text-muted" style={{ fontSize: '0.87rem', marginBottom: '1rem' }}>
                            The agent bundle is downloading. Set it running on that machine:
                        </p>

                        <ol style={{ fontSize: '0.86rem', lineHeight: 1.7, paddingLeft: '1.1rem', margin: '0 0 1rem' }}>
                            <li>Unzip the bundle somewhere permanent.</li>
                            <li>Open a terminal in that folder and run:
                                <div style={{
                                    fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                                    background: 'rgba(0,0,0,0.4)', borderRadius: 8,
                                    padding: '0.4rem 0.4rem 0.4rem 0.7rem', margin: '0.4rem 0',
                                    display: 'flex', alignItems: 'center', gap: '0.45rem',
                                }}>
                                    <Terminal size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflowX: 'auto', whiteSpace: 'nowrap' }}>{RUN_COMMAND}</span>
                                    <button
                                        type="button"
                                        onClick={copyCommand}
                                        title="Copy command to clipboard"
                                        className="btn btn-secondary btn-sm"
                                        style={{
                                            padding: '0.3rem 0.55rem', flexShrink: 0,
                                            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                        }}
                                    >
                                        {copied ? <Check size={13} /> : <Copy size={13} />}
                                        {copied ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </li>
                            <li>Leave that window open. When it prints
                                <em> "waiting for training jobs"</em>, the device turns
                                <strong style={{ color: '#22c55e' }}> Available</strong> here.</li>
                        </ol>
                        <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '1.1rem' }}>
                            The bundle holds a pairing token for your account — keep it private.
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => triggerDownload(created.id)}>
                                <Download size={14} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                                Download again
                            </button>
                            <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default AddDeviceModal;
