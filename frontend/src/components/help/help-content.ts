// Centralised help-topic registry. Keep entries terse and beginner-friendly.

export type HelpTopic =
    // Hyperparameters
    | 'epochs'
    | 'learning_rate'
    | 'batch_size'
    | 'optimizer'
    | 'activation'
    | 'layers'
    | 'project_name'
    | 'early_stopping'
    | 'patience'
    | 'min_delta'
    // Architectures
    | 'arch_mlp'
    | 'arch_dnn'
    | 'arch_cnn1d'
    | 'arch_rnn'
    | 'arch_lstm'
    | 'arch_gru'
    | 'arch_autoencoder'
    | 'arch_resnet'
    | 'arch_transformer'
    | 'arch_wide_deep'
    // Dataset
    | 'features_target'
    // Training metrics
    | 'metric_epoch'
    | 'metric_train_loss'
    | 'metric_val'
    | 'metric_eta';

interface HelpEntry {
    title: string;
    body: string;
}

export const HELP_TOPICS: Record<HelpTopic, HelpEntry> = {
    // ── Hyperparameters ────────────────────────────────────────
    epochs: {
        title: 'Epochs',
        body:
            'An epoch is one full pass through the training data. More epochs let the model see the data more times. ' +
            'Start with 20–30 for small datasets. Too few → undertrained; too many → overfitting (memorising instead of learning).',
    },
    learning_rate: {
        title: 'Learning Rate',
        body:
            'How big a step the optimiser takes when updating weights. Too high → training is unstable. Too low → training is slow. ' +
            '0.001 with Adam is a safe default that works on most tabular problems.',
    },
    batch_size: {
        title: 'Batch Size',
        body:
            'How many samples the model looks at before updating its weights. Common values: 16, 32, 64. ' +
            'Smaller batches = noisier updates but use less memory. 32 is a good starting point.',
    },
    optimizer: {
        title: 'Optimizer',
        body:
            'The algorithm that adjusts the weights based on the loss. ' +
            'Adam — works almost everywhere out of the box. ' +
            'AdamW — Adam with better weight decay; slightly better in modern setups. ' +
            'SGD — classic, sometimes generalises better but needs more tuning. ' +
            'RMSprop — good for recurrent networks.',
    },
    activation: {
        title: 'Activation Function',
        body:
            'Adds non-linearity so the network can learn complex patterns. ' +
            'ReLU is the standard, fast choice. GELU is common in Transformers. ' +
            'Sigmoid / Tanh are old-school and rarely the right pick today.',
    },
    layers: {
        title: 'Layer Sizes',
        body:
            'Each number = how many neurons in that hidden layer. The network goes ' +
            'input → layer 1 → layer 2 → … → output. ' +
            'More / wider layers = more capacity (and more risk of overfitting). ' +
            'For most tabular problems, 2–3 layers of 32–128 neurons each is plenty.',
    },
    project_name: {
        title: 'Project Name',
        body:
            'A label for this experiment. It is baked into the saved weights filename and shown on your profile, so you can find this run again later.',
    },
    early_stopping: {
        title: 'Early Stopping',
        body:
            'Automatically halt training when the model stops improving on the validation set. ' +
            'Saves time and prevents overfitting. You set how many epochs of no improvement to tolerate (patience) and ' +
            'how much improvement counts as progress (min delta).',
    },
    patience: {
        title: 'Patience',
        body:
            'Number of epochs to wait while validation loss is not improving before stopping. ' +
            'Larger = more tolerant. 5–10 is typical.',
    },
    min_delta: {
        title: 'Min Delta',
        body:
            'The smallest amount of improvement that counts as progress. Smaller values are stricter. ' +
            '0.0001 is a sensible default for most tasks.',
    },

    // ── Architectures ──────────────────────────────────────────
    arch_mlp: {
        title: 'Multi-Layer Perceptron (MLP)',
        body:
            'The default neural network. Use it as your first try on any tabular problem. ' +
            'Stack 2–3 hidden layers and start training.',
    },
    arch_dnn: {
        title: 'Deep Neural Network (DNN)',
        body:
            'An MLP with BatchNorm and Dropout to stabilise training and reduce overfitting. ' +
            'Useful when you have lots of data and want to go deeper than a plain MLP.',
    },
    arch_cnn1d: {
        title: '1D Convolutional Network',
        body:
            'Best for data with local patterns: sensor readings, audio, sequences, or tabular data where neighbouring columns are related.',
    },
    arch_rnn: {
        title: 'Recurrent Neural Network (RNN)',
        body:
            'For step-by-step sequential data. Often replaced by LSTM/GRU since vanilla RNNs forget long sequences.',
    },
    arch_lstm: {
        title: 'Long Short-Term Memory (LSTM)',
        body:
            'Great for time-series and other sequential data. Remembers information over long sequences via gating mechanisms.',
    },
    arch_gru: {
        title: 'Gated Recurrent Unit (GRU)',
        body:
            'A simpler, faster LSTM. Works just as well in most cases. Good for sequences when you want speed.',
    },
    arch_autoencoder: {
        title: 'Autoencoder',
        body:
            'Compresses then reconstructs data. Best for anomaly detection or learning compact feature representations rather than direct prediction.',
    },
    arch_resnet: {
        title: 'Residual Network (ResNet)',
        body:
            'Uses skip connections to train very deep networks without losing gradient. ' +
            'Pick it if MLP/DNN saturate and you want more depth.',
    },
    arch_transformer: {
        title: 'Transformer',
        body:
            'Attention-based — looks at all features at once. Powerful but data-hungry. ' +
            'Use when other architectures plateau and you have a lot of data.',
    },
    arch_wide_deep: {
        title: 'Wide & Deep Network',
        body:
            'Combines memorisation (wide linear path) with generalisation (deep MLP path). ' +
            'Designed by Google for recommendation systems but works well on any tabular task.',
    },

    // ── Dataset ───────────────────────────────────────────────
    features_target: {
        title: 'Features and Target',
        body:
            '“Features” are the inputs your model uses to make a prediction (e.g. hours studied, attendance rate). ' +
            'The “target” is the value you want the model to predict (e.g. passed / failed). ' +
            'Pick all the columns you think are useful inputs as features, and pick exactly one column as the target.',
    },

    // ── Training metrics ──────────────────────────────────────
    metric_epoch: {
        title: 'Epoch',
        body: 'Current epoch number, out of the total you set. Each epoch = one full pass through the training data.',
    },
    metric_train_loss: {
        title: 'Train Loss',
        body:
            'How wrong the model was on the training data this epoch. Lower is better and it should generally decrease over time. ' +
            'If it stays flat, the model is not learning; if it drops to ~0 while val loss climbs, you are overfitting.',
    },
    metric_val: {
        title: 'Validation Metric',
        body:
            'Performance on data the model has never seen during training. ' +
            'For classification this is accuracy (higher is better); for regression it is loss (lower is better). ' +
            'This is the honest signal of whether the model is learning real patterns.',
    },
    metric_eta: {
        title: 'ETA',
        body: 'Estimated time until training finishes, computed from the average duration of the epochs run so far.',
    },
};

export const ARCH_HELP_TOPIC: Record<string, HelpTopic> = {
    mlp: 'arch_mlp',
    dnn: 'arch_dnn',
    cnn1d: 'arch_cnn1d',
    rnn: 'arch_rnn',
    lstm: 'arch_lstm',
    gru: 'arch_gru',
    autoencoder: 'arch_autoencoder',
    resnet: 'arch_resnet',
    transformer: 'arch_transformer',
    wide_deep: 'arch_wide_deep',
};
