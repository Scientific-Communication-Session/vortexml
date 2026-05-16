import React from 'react';
import { Server, Laptop, Cpu, Sparkles, Check } from 'lucide-react';
import { formatTime } from '../../utils/helpers';
import type { Device } from './types';

interface DeviceCardProps {
    device: Device;
    selected: boolean;
    onSelect: (id: number) => void;
}

/** Every device card (and the Add-device tile) is exactly this tall. */
export const DEVICE_CARD_HEIGHT = 212;

const STATUS_META: Record<Device['status'], { label: string; color: string; bg: string }> = {
    available: { label: 'Available', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    busy: { label: 'Training', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    offline: { label: 'Offline', color: '#8b8ba7', bg: 'rgba(139,139,167,0.10)' },
};

const SpecStat: React.FC<{ value: React.ReactNode; label: string }> = ({ value, label }) => (
    <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontWeight: 700 }}>
            {value}
        </div>
        <div className="text-muted" style={{ fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {label}
        </div>
    </div>
);

const ELLIPSIS: React.CSSProperties = {
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

const DeviceCard: React.FC<DeviceCardProps> = ({ device, selected, onSelect }) => {
    const specs = device.specs || {};
    const status = STATUS_META[device.status];
    const selectable = device.status === 'available';

    return (
        <div
            role="button"
            tabIndex={selectable ? 0 : -1}
            aria-pressed={selected}
            aria-disabled={!selectable}
            onClick={() => selectable && onSelect(device.id)}
            onKeyDown={(e) => {
                if (selectable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelect(device.id);
                }
            }}
            className="glass-panel"
            style={{
                height: DEVICE_CARD_HEIGHT,
                padding: '1.05rem 1.15rem',
                cursor: selectable ? 'pointer' : 'not-allowed',
                opacity: device.status === 'offline' ? 0.6 : 1,
                border: selected
                    ? '1px solid rgba(139,92,246,0.85)'
                    : '1px solid rgba(255,255,255,0.10)',
                boxShadow: selected ? '0 0 22px -4px rgba(139,92,246,0.45)' : undefined,
                transition: 'border-color 0.2s, box-shadow 0.2s, opacity 0.2s',
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {/* Header — icon + (name / status / chip) stacked */}
            <div style={{ display: 'flex', gap: '0.7rem' }}>
                <div style={{
                    flexShrink: 0,
                    width: 38, height: 38, borderRadius: 10,
                    display: 'grid', placeItems: 'center',
                    background: device.is_shared ? 'rgba(6,182,212,0.14)' : 'rgba(139,92,246,0.14)',
                    color: device.is_shared ? '#06b6d4' : '#8b5cf6',
                }}>
                    {device.is_shared ? <Server size={19} /> : <Laptop size={19} />}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: '0.96rem', display: 'block', ...ELLIPSIS }}>
                        {device.nickname}
                    </strong>
                    {/* Status pill — on its own line, under the name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0.3rem 0' }}>
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.32rem',
                            fontSize: '0.68rem', fontWeight: 700,
                            padding: '0.2rem 0.5rem', borderRadius: 999,
                            color: status.color, background: status.bg,
                        }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.color }} />
                            {status.label}
                        </span>
                        {device.is_shared && (
                            <span className="text-muted" style={{ fontSize: '0.66rem' }}>· shared</span>
                        )}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.73rem', ...ELLIPSIS }}>
                        {specs.chip || 'Unknown chip'}{specs.platform ? ` · ${specs.platform}` : ''}
                    </div>
                </div>
            </div>

            {/* Spec grid — sits at a consistent position on every card */}
            <div style={{
                display: 'flex', gap: '0.5rem',
                marginTop: '0.85rem', padding: '0.6rem 0',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
                <SpecStat value={specs.ram_gb != null ? `${specs.ram_gb}` : '—'} label="GB RAM" />
                <SpecStat value={specs.cpu_cores ?? '—'} label="CPU cores" />
                <SpecStat value={specs.gpu_cores ?? '—'} label="GPU cores" />
            </div>

            {/* Footer — pinned to the bottom */}
            <div style={{
                marginTop: 'auto', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: '0.5rem',
            }}>
                <span className="text-muted" style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    fontSize: '0.74rem', minWidth: 0, ...ELLIPSIS,
                }}>
                    {specs.accelerator === 'cpu'
                        ? <Cpu size={13} style={{ flexShrink: 0 }} />
                        : <Sparkles size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />}
                    {specs.accelerator_label || 'CPU only'}
                </span>

                {device.status === 'busy' && device.job ? (
                    <span style={{ fontSize: '0.72rem', color: status.color, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        {device.job.epoch}/{device.job.total_epochs}
                        {device.job.eta_seconds != null && ` · ${formatTime(device.job.eta_seconds)}`}
                    </span>
                ) : selected ? (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        fontSize: '0.74rem', fontWeight: 700, color: '#8b5cf6', flexShrink: 0,
                    }}>
                        <Check size={13} /> Selected
                    </span>
                ) : null}
            </div>
        </div>
    );
};

export default DeviceCard;
