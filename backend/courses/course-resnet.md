# Residual Networks (ResNet)

As deep learning progressed, researchers realized that adding more layers didn't always improve performance. Often, **ultradeep networks performed worse** than shallow ones due to the vanishing gradient problem.

In 2015, Kaiming He introduced ResNets, altering the fundamental architecture of neural networks and winning every major AI competition that year.

## The Skip Connection

The core idea of a ResNet is the **Residual Block**. Instead of layers learning the desired underlying mapping directly, they are forced to learn a **residual** (the difference) from the identity mapping.

This is achieved via "Skip Connections" or "Shortcut Connections", where the input to a block is added the block's output:
$$y = F(x) + x$$

Where $F(x)$ represents the stacked non-linear layers.

**Why is this brilliant?**
1.  If the optimal mapping is closer to an identity mapping, it is easier for the network to push the non-linear weights to zero ($F(x) = 0$).
2.  **Gradient Superhighways:** During backpropagation, the gradients can flow completely unimpeded along the skip connection ($+x$). This explicitly solves the vanishing gradient problem, allowing networks with *thousands* of layers to easily train.

## 💻 PyTorch Implementation inside Vortex ML

While famous for CNNs on images, this paradigm is equally powerful for dense MLPs on tabular data.

```python
import torch.nn as nn

class ResidualBlock(nn.Module):
    def __init__(self, dim, dropout=0.1):
        super().__init__()
        # F(x) path
        self.block = nn.Sequential(
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(dim, dim),
            nn.BatchNorm1d(dim),
        )
        self.act = nn.ReLU()

    def forward(self, x):
        # y = F(x) + x
        return self.act(self.block(x) + x)

class ResNetModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        hidden = layer_sizes[0] if layer_sizes else 64
        
        # Project inputs to the hidden dimension size
        self.input_proj = nn.Linear(input_dim, hidden)
        
        # Stack Residual blocks based on layer configurations
        self.blocks = nn.Sequential(
            *[ResidualBlock(hidden) for _ in layer_sizes]
        )
        self.head = nn.Linear(hidden, output_dim)

    def forward(self, x):
        x = self.input_proj(x)
        x = self.blocks(x)
        return self.head(x)
```
