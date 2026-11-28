# Multi-Layer Perceptrons (MLP) and Deep Neural Networks (DNN)

## The Multi-Layer Perceptron (MLP)
An MLP is the quintessential deep learning architecture. It consists of multiple layers of nodes in a directed graph, with each layer fully connected to the next one. 

### Why do we need hidden layers?
A single-layer perceptron can only learn linearly separable patterns. By adding hidden layers with non-linear activation functions (like ReLU), an MLP becomes a **Universal Function Approximator**—capable of approximating any continuous function, allowing it to solve complex, non-linear problems XOR.

## Deep Neural Networks (DNN)
A DNN is essentially an MLP with many hidden layers. However, simply stacking layers leads to problems like vanishing gradients and overfitting. 

In modern DNNs, we introduce specific layers to stabilize training:
1.  **Batch Normalization (`nn.BatchNorm1d`)**: Normalizes the activations of the previous layer at each batch, stabilizing the learning process and significantly accelerating training.
2.  **Dropout (`nn.Dropout`)**: Randomly zeroes some of the elements of the input tensor with probability $p$ during training. This prevents complex co-adaptations on training data (preventing overfitting).

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class DNNModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes, dropout=0.3):
        super().__init__()
        layers = []
        prev = input_dim
        
        for size in layer_sizes:
            layers.append(nn.Linear(prev, size))
            layers.append(nn.BatchNorm1d(size))  # Stabilize training
            layers.append(nn.ReLU())             # Non-linearity
            layers.append(nn.Dropout(dropout))   # Prevent overfitting
            prev = size
            
        layers.append(nn.Linear(prev, output_dim))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)
```
