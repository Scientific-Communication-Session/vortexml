# Recurrent Architectures (RNN, LSTM, GRU)

Feedforward networks (like MLPs) have no memory. They process each input independently. Recurrent Neural Networks (RNNs) address this by maintaining a hidden state $h_t$ that carries information across time steps.

## Vanilla RNN
An RNN processes sequences step-by-step. At time $t$, it combines the current input $x_t$ with the previous hidden state $h_{t-1}$:

$$h_t = \tanh(W_{hh}h_{t-1} + W_{xh}x_t + b)$$

**The Flaw**: Vanilla RNNs suffer terribly from the **Vanishing Gradient Problem**. Over long sequences, the gradients multiplied during backpropagation shrink to zero, making the network "forget" early inputs.

## Long Short-Term Memory (LSTM)
LSTMs solve the vanishing gradient problem by introducing a **Cell State** ($C_t$) and three "Gates" that regulate information flow:
1.  **Forget Gate**: Decides what information to throw away from the cell state.
2.  **Input Gate**: Decides which new values to update in the cell state.
3.  **Output Gate**: Decides what the next hidden state should be based on the cell state.

Because the cell state acts like a highway strictly controlled by gates, gradients flow easily without vanishing.

## Gated Recurrent Unit (GRU)
GRUs are a newer variation on LSTMs. They combine the forget and input gates into a single "Update Gate" and merge the cell state and hidden state. They perform similarly to LSTMs but are computationally cheaper because they have fewer parameters.

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class LSTMModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        hidden_size = layer_sizes[0] if layer_sizes else 64
        num_layers = len(layer_sizes) if layer_sizes else 1
        
        # PyTorch provides optimized LSTM implementations
        self.lstm = nn.LSTM(
            input_size=input_dim, 
            hidden_size=hidden_size,
            num_layers=num_layers, 
            batch_first=True
        )
        self.fc = nn.Linear(hidden_size, output_dim)

    def forward(self, x):
        # We treat tabular data as a sequence of length 1: (batch, seq_len=1, features)
        x = x.unsqueeze(1)
        
        # LSTM returns: output, (hidden_state, cell_state)
        # We only care about the output from the final sequence step: [:, -1, :]
        out, (h_n, c_n) = self.lstm(x)
        return self.fc(out[:, -1, :])
```
