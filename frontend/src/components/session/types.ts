// Shared types for background training sessions (context, Training page, Demo,
// navbar pill, resume prompt). They mirror the server's job views in app.py.

export type JobStatus = 'running' | 'queued' | 'complete' | 'stopped' | 'error';

export interface RunFinal {
    message?: string;
    weight_filename?: string;
    final_train_loss?: number;
    final_val_loss?: number;
    final_val_acc?: number | null;
    early_stopped?: boolean;
    stopped_epoch?: number;
    task_type?: string;
    device?: string;
}

/** Light description of one run — what `/api/training/active` returns. */
export interface JobView {
    job_id: string;
    device_id: number;
    device_name: string | null;
    is_local: boolean;
    project_name: string | null;
    status: JobStatus;
    /** 1-based place in the device's queue (0 once running). */
    position: number;
    /** Runs that must finish before this one starts (queue + the running one). */
    ahead: number;
    /** Honest wait estimate — only known for the run at the front of the line. */
    wait_seconds: number | null;
    epoch: number;
    total_epochs: number;
    eta_seconds: number | null;
    queued_at: string | null;
    started_at: string | null;
    finished_at?: string | null;
    demo_key: string | null;
    final?: RunFinal | null;
}

export interface EpochPoint {
    epoch: number;
    total_epochs: number;
    train_loss: number;
    val_loss: number;
    train_acc: number | null;
    val_acc: number | null;
    eta_seconds: number;
    epoch_time?: number;
    es_patience?: number;
    es_patience_counter?: number;
}

export interface RunInfo {
    arch_type: string;
    layer_sizes: number[];
    input_dim: number;
    output_dim: number;
    task_type: string;
    train_size: number;
    val_size: number;
    test_size: number;
    epochs: number;
    early_stopping?: { enabled?: boolean; patience?: number; min_delta?: number };
    device?: string;
}

export interface SysStat {
    cpu_percent: number | null;
    gpu_percent: number | null;
    ram_percent: number | null;
    cpu_temp: number | null;
    gpu_temp: number | null;
}

export interface RunConfig {
    arch_type?: string;
    layer_sizes?: number[];
    epochs?: number;
    lr?: number;
    batch_size?: number;
    optimizer?: string;
    activation?: string;
    project_name?: string;
    early_stopping?: { enabled?: boolean; patience?: number; min_delta?: number };
    [key: string]: unknown;
}

/** Everything the UI knows about one run: its status plus the replayable data. */
export interface RunView {
    job: JobView;
    config: RunConfig | null;
    info: RunInfo | null;
    history: EpochPoint[];
    stats: SysStat[];
    final: RunFinal | null;
    /** Error / stop message, when the run ended badly. */
    message: string | null;
    /** True once the server snapshot (full history) has been merged in. */
    hydrated: boolean;
}

export const isActive = (s: JobStatus) => s === 'running' || s === 'queued';
export const isTerminal = (s: JobStatus) => !isActive(s);
