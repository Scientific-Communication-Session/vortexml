import type React from 'react';
import { Columns3, Focus, History, Layers, Network, Repeat, RotateCw, ScanLine, Shrink, Waypoints } from 'lucide-react';

// One outline icon per architecture key. The API still sends an emoji per
// architecture; the UI ignores it and draws from one icon set instead.
export const ARCH_ICON: Record<string, React.ElementType> = {
    mlp: Network,
    dnn: Layers,
    cnn1d: ScanLine,
    rnn: Repeat,
    lstm: History,
    gru: RotateCw,
    autoencoder: Shrink,
    resnet: Waypoints,
    transformer: Focus,
    wide_deep: Columns3,
};
