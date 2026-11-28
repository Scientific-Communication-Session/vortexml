# Autoencoders (AE)

Autoencoders are an unsupervised learning technique where neural networks are trained to copy their input to their output. 

## The Bottleneck
If we simply made a wide network, it would trivially learn the identity function ($output = input$). Autoencoders force the data through an information **bottleneck**. 

The architecture consists of two parts:
1.  **Encoder**: Compresses the input $x$ into a latent-space representation $z$ (a lower-dimensional feature vector).
2.  **Decoder**: Reconstructs the input $x'$ from the latent space $z$.

By forcing the network to compress and reconstruct, it is forced to learn the most salient, underlying features of the training data.

### Use Cases in Tabular Data
*   **Dimensionality Reduction**: Like PCA, but non-linear and much more powerful.
*   **Anomaly Detection**: If an Autoencoder is trained entirely on "normal" data, it will accurately reconstruct normal rows. If you pass an anomalous/fraudulent row, the reconstruction error will be massively high, raising a flag.

## 💻 PyTorch Implementation inside Vortex ML

```python
import torch.nn as nn

class AutoencoderModel(nn.Module):
    def __init__(self, input_dim, output_dim, layer_sizes):
        super().__init__()
        
        # ENCODER: Compresses down to the latent space (bottleneck)
        enc_layers = []
        prev = input_dim
        for size in layer_sizes:
            enc_layers.append(nn.Linear(prev, size))
            enc_layers.append(nn.ReLU())
            prev = size
        self.encoder = nn.Sequential(*enc_layers)

        # DECODER: Reconstructs back to original input dimension
        dec_layers = []
        for size in reversed(layer_sizes[:-1]):
            dec_layers.append(nn.Linear(prev, size))
            dec_layers.append(nn.ReLU())
            prev = size
        dec_layers.append(nn.Linear(prev, input_dim))
        self.decoder = nn.Sequential(*dec_layers)

        # PREDICTION HEAD: Uses the compressed latent vector for the actual task
        latent_dim = layer_sizes[-1] if layer_sizes else input_dim
        self.head = nn.Linear(latent_dim, output_dim)

    def forward(self, x):
        # Predict target based on compressed latent representation
        encoded = self.encoder(x)
        return self.head(encoded)

    def reconstruct(self, x):
        # Utility method for Anomaly Detection (not used directly in standard forward)
        return self.decoder(self.encoder(x))
```
