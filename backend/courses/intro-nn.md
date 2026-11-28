# Introduction to Neural Networks

Neural networks are computing systems inspired by the biological neural networks that constitute animal brains. They are the backbone of modern Deep Learning, powering everything from voice assistants to autonomous vehicles.

## 🏛️ A Brief History

The history of neural networks spans several decades, marked by periods of intense hype followed by "AI winters":

*   **1943: The McCulloch-Pitts Neuron.** Warren McCulloch and Walter Pitts created a computational model for neural networks based on mathematics and algorithms.
*   **1958: The Perceptron.** Frank Rosenblatt created the Perceptron, an algorithm for pattern recognition based on a two-layer learning computer network. It generated massive hype but was later shown by Minsky and Papert (1969) to be incapable of solving non-linear problems like XOR.
*   **1986: Backpropagation.** Geoffrey Hinton, David Rumelhart, and Ronald Williams popularized the backpropagation algorithm, allowing multi-layer networks to be trained efficiently.
*   **2012: The Deep Learning Boom.** Alex Krizhevsky and his team won the ImageNet competition using a deep convolutional neural network (AlexNet) trained on GPUs, crushing traditional machine learning methods and sparking the current AI revolution.

## 🧮 The Mathematics: Forward and Backward Propagation

### 1. Forward Propagation (The Prediction)

A single neuron takes inputs $x_i$, multiplies them by weights $w_i$, sums them up, adds a bias $b$, and passes the result through an activation function $\sigma$ (like ReLU or Sigmoid).

Mathematically, for a single layer:
$$Z = WX + b$$
$$A = \sigma(Z)$$

Where $W$ is the weight matrix, $X$ is the input vector, $b$ is the bias vector, and $A$ is the activation output.

### 2. Loss Function (The Error)

We need to measure how wrong our prediction was. A common choice for regression is Mean Squared Error (MSE):
$$Loss = \frac{1}{n} \sum (y_{true} - y_{pred})^2$$

### 3. Backpropagation (The Learning)

To minimize the loss, we need to know how to adjust the weights. We use calculus (the Chain Rule) to find the gradient of the loss with respect to each weight.

$$\frac{\partial Loss}{\partial W} = \frac{\partial Loss}{\partial A} \cdot \frac{\partial A}{\partial Z} \cdot \frac{\partial Z}{\partial W}$$

We then update the weights using an optimizer (like Gradient Descent or Adam) and a learning rate $\eta$:
$$W_{new} = W_{old} - \eta \cdot \frac{\partial Loss}{\partial W}$$

## 💻 Code Example (PyTorch)

Here is how you define a simple Neural Network layer in PyTorch:

```python
import torch
import torch.nn as nn

class SimpleNeuron(nn.Module):
    def __init__(self, input_features):
        super().__init__()
        # nn.Linear automatically initializes Weights (W) and bias (b)
        self.linear = nn.Linear(in_features=input_features, out_features=1)
        # Activation function
        self.relu = nn.ReLU()
        
    def forward(self, x):
        # Z = WX + b
        z = self.linear(x)
        # A = sigma(Z)
        a = self.relu(z)
        return a

# Create input tensor
x = torch.randn(1, 5) # 1 sample, 5 features
model = SimpleNeuron(5)
output = model(x)
print(output)
```

## 🌐 Architectures available in Vortex ML
Proceed to our specialized courses for a deep dive into the architectures we support:
*   Multi-Layer Perceptron (MLP) & Deep Neural Networks (DNN)
*   1D Convolutional Neural Networks (CNN-1D)
*   Recurrent Neural Networks (RNN, LSTM, GRU)
*   Autoencoders (AE)
*   Residual Networks (ResNet)
*   Transformers
*   Wide & Deep Networks
