// Shared types for the compute-device feature (Training picker + Profile).

export interface DeviceSpecs {
    platform?: string;
    hostname?: string;
    chip?: string;
    ram_gb?: number | null;
    cpu_cores?: number;
    gpu_cores?: number | null;
    accelerator?: 'mps' | 'cuda' | 'cpu' | string;
    accelerator_label?: string;
}

export interface DeviceJob {
    project_name?: string;
    epoch: number;
    total_epochs: number;
    eta_seconds?: number | null;
    started_at?: string;
}

export type DeviceStatus = 'available' | 'busy' | 'offline';

export interface Device {
    id: number;
    nickname: string;
    is_shared: boolean;
    owned: boolean;
    specs: DeviceSpecs | null;
    last_seen: string | null;
    created_at: string;
    // Live runtime fields computed by the server.
    online: boolean;
    status: DeviceStatus;
    job: DeviceJob | null;
}
