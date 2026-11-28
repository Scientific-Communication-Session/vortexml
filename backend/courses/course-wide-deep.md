# Wide & Deep Networks

Originally developed by Google in 2016 for their Play Store Recommendation Engine, the Wide & Deep architecture elegantly solves a classic problem: how do we memorize specific sparse rules while still generalizing to unseen data?

## The Problem
*   **Linear Models (Wide)** are great at **memorization**. For example, they can strongly learn the specific rule: `IF user_searches="Fried Chicken" AND user_city="KFC" THEN predict=High_CTR`. However, they fail to generalize to unseen combinations.
*   **Deep Neural Networks (Deep)** are great at **generalization** by learning dense feature embeddings. However, they can sometimes overdraw generalized conclusions and ignore highly specific, perfectly correlated rule exceptions.

## The Solution: Combine Them
A Wide & Deep Network trains both architectures synchronously.

1.  **The Wide Part**: A simple linear layer connecting input features directly to the output node.
2.  **The Deep Part**: A stacked MLP.

Their outputs are simply summed before the final prediction.

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class WideDeepModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        
        # 1. WIDE PATH: Direct linear mapping (Memorization)
        self.wide = nn.Linear(input_dim, output_dim)

        # 2. DEEP PATH: Multi-Layer Perceptron (Generalization)
        deep_layers = []
        prev = input_dim
        for size in layer_sizes:
            deep_layers.append(nn.Linear(prev, size))
            deep_layers.append(nn.ReLU())
            prev = size
        deep_layers.append(nn.Linear(prev, output_dim))
        
        self.deep = nn.Sequential(*deep_layers)

    def forward(self, x):
        # Simply sum the memorized output and the generalized output
        return self.wide(x) + self.deep(x)
```
