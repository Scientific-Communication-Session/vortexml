# Transformers and Attention Mechanisms

Introduced in the seminal 2017 paper *"Attention Is All You Need"*, Transformers completely usurped RNNs and LSTMs, leading directly to the creation of GPT, BERT, and the modern generative AI era.

## The Problem with RNNs
RNNs compress entire sequences into a single fixed-size bottleneck vector (the hidden state). They also process data sequentially, which makes them incredibly slow to train on GPUs since computation cannot be parallelized.

## The Solution: Self-Attention
Transformers throw out recurrence entirely. Instead, they look at the *entire* sequence at once and compute an **Attention Score**.
For every word (or feature), Self-Attention asks: *How important is every other feature in the sequence for understanding this specific feature?*

### The Math: Scaled Dot-Product Attention
Inputs are multiplied by learned weight matrices to create three vectors for each feature:
*   **Query ($Q$)**: What am I looking for?
*   **Key ($K$)**: What do I represent?
*   **Value ($V$)**: If I am what you're looking for, here is my information.

$$Attention(Q, K, V) = softmax\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$
Where $d_k$ is the dimension of the keys, scaling the dot product down so gradients don't vanish inside the softmax function.

## 💻 PyTorch Implementation inside Vortex ML

While famous for NLP, Attention performs brilliantly on tabular data by dynamically weighting the importance of different columns for each specific row.

```python
import torch.nn as nn

class TransformerModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        d_model = layer_sizes[0] if layer_sizes else 64
        
        # Multi-Head Attention requires d_model to be divisible by n_heads
        n_heads = max(1, d_model // 16)
        d_model = n_heads * (d_model // n_heads) 
        num_layers = len(layer_sizes) if layer_sizes else 1

        # Project flat tabular features into the embedding dimension
        self.input_proj = nn.Linear(input_dim, d_model)
        
        # PyTorch provides optimized Transformer logic
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, 
            nhead=n_heads, 
            dim_feedforward=d_model * 4,
            dropout=0.1, 
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.head = nn.Linear(d_model, output_dim)

    def forward(self, x):
        # Add a dummy sequence dimension: (batch, 1, d_model)
        x = self.input_proj(x).unsqueeze(1)  
        
        # Self-Attention is computed here
        x = self.transformer(x)
        
        # Extract the sequence and predict
        return self.head(x[:, 0, :])
```
