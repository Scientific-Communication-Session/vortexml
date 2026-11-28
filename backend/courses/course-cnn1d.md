# 1D Convolutional Neural Networks (CNN-1D)

While 2D CNNs are famous for image processing, **1D CNNs** are incredibly effective for sequential data, time series, and even tabular data where local feature interactions exist.

## The Mathematics of Convolutions
Instead of a matrix multiplying every input across the entire layer (dense layer), a convolution uses a small, sliding **Kernel** (or filter).

Mathematically, a 1D convolution operation is defined as:
$$(f * g)[n] = \sum_{m=-M}^{M} f[m] \cdot g[n-m]$$
Where $f$ is our input vector, $g$ is our kernel vector, and $n$ is the current position.

### Why Convolutions?
1.  **Local Receptive Field:** Kernels only look at a tiny window of features at a time. This allows the network to learn "patterns" (e.g., a sudden spike in price).
2.  **Weight Sharing:** The same kernel slides over the whole sequence. This drastically reduces the number of parameters needed compared to an MLP.

## 💻 PyTorch Implementation inside Vortex ML

In tabular data, we treat the input feature vector as a sequence of length $N$ with $1$ channel.

```python
import torch.nn as nn

class CNN1DModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        
        conv_layers = []
        in_channels = 1 # Treat tabular data as a 1D sequence
        
        for out_channels in layer_sizes:
            # kernel_size=3 means the filter looks at 3 features at a time
            conv_layers.append(
                nn.Conv1d(in_channels, out_channels, kernel_size=3, padding=1)
            )
            conv_layers.append(nn.ReLU())
            in_channels = out_channels
            
        self.conv = nn.Sequential(*conv_layers)
        # Flatten the channels and features for the final prediction
        self.fc = nn.Linear(in_channels * input_dim, output_dim)

    def forward(self, x):
        # Reshape: (batch_size, channels, sequence_length) -> (batch, 1, features)
        x = x.unsqueeze(1)  
        x = self.conv(x)     
        x = x.view(x.size(0), -1) # Flatten
        return self.fc(x)
```
