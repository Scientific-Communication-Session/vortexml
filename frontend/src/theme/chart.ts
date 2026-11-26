import Chart from 'chart.js/auto';
import type { ChartDataset, ScaleOptions } from 'chart.js';

// ── Chart theme (Violet Night) ──────────────────────────────────────────────
// Categorical series colours, in this fixed order. Validated with the dataviz
// checker against the card surface #13131a: every adjacent pair clears the
// colour-blind (ΔE ≥ 8) and normal-vision (ΔE ≥ 15) floors, and the first three
// clear them on all pairs. Assign in order, never cycle: a ninth series folds
// into "Other". Colour follows the entity (CPU is always slot 1), never rank.
export const SERIES = [
    '#8c86fc', // 1 violet (the brand accent)
    '#e76624', // 2 orange
    '#00a888', // 3 aqua
    '#d28e05', // 4 yellow
    '#e24d8b', // 5 magenta
    '#0aac23', // 6 green
    '#338ced', // 7 blue
    '#eb6263', // 8 red
] as const;

// Text and structure inks, from tokens.css. Text never wears a series colour.
export const INK = {
    fg: '#f5f5f8',
    fg2: '#afb0be',
    fg3: '#848593',
    grid: 'rgba(232, 232, 245, 0.06)',
    surface: '#13131a',
} as const;

const FONT = '"Cabinet Grotesk", ui-sans-serif, system-ui, sans-serif';

/** A hex colour at a given opacity, for area fills under a line. */
export const tint = (hex: string, alpha: number) =>
    hex + Math.round(alpha * 255).toString(16).padStart(2, '0');

// Global defaults: recessive grid and axes, legend as small round keys, a
// glass tooltip. Set once, the first time any page imports this module.
Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 12;
Chart.defaults.color = INK.fg2;
Chart.defaults.borderColor = INK.grid;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.plugins.legend.labels.boxHeight = 8;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.legend.labels.color = INK.fg2;
Chart.defaults.plugins.legend.align = 'start';
Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: 'rgba(27, 27, 35, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    titleColor: INK.fg,
    bodyColor: INK.fg2,
    padding: 10,
    cornerRadius: 10,
    boxPadding: 4,
    usePointStyle: true,
});

/** One line series in categorical slot `slot` (0-based). */
export const lineSeries = (label: string, slot: number, extra: Partial<ChartDataset<'line'>> = {}): ChartDataset<'line'> => ({
    label,
    data: [],
    borderColor: SERIES[slot],
    backgroundColor: tint(SERIES[slot], 0.1),
    borderWidth: 2,
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: INK.surface,
    pointHoverBackgroundColor: SERIES[slot],
    ...extra,
});

/** A quiet axis: no border line, faint grid, small ticks, optional title. */
export const axis = (title?: string, extra: Record<string, unknown> = {}): ScaleOptions<'linear'> => ({
    border: { display: false },
    grid: { color: INK.grid },
    ticks: { color: INK.fg3, font: { size: 11 }, padding: 6 },
    ...(title ? { title: { display: true, text: title, color: INK.fg3, font: { size: 11 } } } : {}),
    ...extra,
}) as ScaleOptions<'linear'>;

export default Chart;
