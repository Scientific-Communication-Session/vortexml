import React from 'react';
import { Server, Laptop, Cpu, MemoryStick, Sparkles, Check } from 'lucide-react';
import { formatTime } from '../../utils/helpers';
import type { Device } from './types';

interface DeviceCardProps {
    device: Device;
    selected: boolean;
    onSelect: (id: number) => void;
}

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
        <div className="text-muted" style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {label}
        </div>
    </div>
);

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
                padding: '1.1rem 1.2rem',
                cursor: selectable ? 'pointer' : 'not-allowed',
                opacity: device.status === 'offline' ? 0.55 : 1,
                border: selected
                    ? '1px solid rgba(139,92,246,0.85)'
                    : '1px solid rgba(255,255,255,0.10)',
                boxShadow: selected ? '0 0 22px -4px rgba(139,92,246,0.45)' : undefined,
                transition: 'border-color 0.2s, box-shadow 0.2s, opacity 0.2s',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
            }}
        >
            {/* Header: icon + name + status pill */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.7rem' }}>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.97rem' }}>{device.nickname}</strong>
                        {device.is_shared && <span className="bento-tag bento-tag-sm">Shared</span>}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.76rem', marginTop: '0.15rem' }}>
                        {specs.chip || 'Unknown chip'}{specs.platform ? ` · ${specs.platform}` : ''}
                    </div>
                </div>
                <span style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', gap: '0.32rem',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '0.22rem 0.55rem', borderRadius: 999,
                    color: status.color, background: status.bg,
                }}>
                    <span style={{
                        width: 6, height: 6, borderRadius: '50%', background: status.color,
                    }} />
                    {status.label}
                </span>
            </div>

            {/* Spec grid */}
            <div style={{
                display: 'flex', gap: '0.5rem',
                padding: '0.6rem 0',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
                <SpecStat value={specs.ram_gb != null ? `${specs.ram_gb}` : '—'} label="GB RAM" />
                <SpecStat value={specs.cpu_cores ?? '—'} label="CPU cores" />
                <SpecStat value={specs.gpu_cores ?? '—'} label="GPU cores" />
            </div>

            {/* Footer: accelerator + live job / selected state */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span className="text-muted" style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem',
                }}>
                    {specs.accelerator === 'cpu'
                        ? <Cpu size={13} />
                        : <Sparkles size={13} style={{ color: '#8b5cf6' }} />}
                    {specs.accelerator_label || 'CPU only'}
                </span>

                {device.status === 'busy' && device.job ? (
                    <span style={{ fontSize: '0.74rem', color: status.color, fontFamily: 'var(--font-mono)' }}>
                        epoch {device.job.epoch}/{device.job.total_epochs}
                        {device.job.eta_seconds != null && ` · ETA ${formatTime(device.job.eta_seconds)}`}
                    </span>
                ) : selected ? (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        fontSize: '0.74rem', fontWeight: 700, color: '#8b5cf6',
                    }}>
                        <Check size={13} /> Selected
                    </span>
                ) : (
                    <MemoryStick size={13} className="text-muted" style={{ opacity: 0.4 }} />
                )}
            </div>
        </div>
    );
};

export default DeviceCard;
