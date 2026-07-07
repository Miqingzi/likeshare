# Like Transition - ComfyUI Encryption Node

A lightweight local multimedia asset encryption/decryption tool for ComfyUI. All encryption/decryption logic runs locally in the backend, with 100% rejection of data leakage.

## Features

- **AES-256-GCM Encryption**: Military-grade encryption with authentication
- **Password-Based Key Derivation**: PBKDF2-SHA256 with 100,000 iterations
- **Pixel-Level Encoding**: Encrypted data encoded directly into PNG pixels
- **Zero External Dependencies**: All processing done locally
- **Metadata Preservation**: Maintains original file information
- **Batch Processing Ready**: Handle multiple images efficiently

## Installation

1. Clone this repository into your ComfyUI `custom_nodes` directory:
   ```bash
   cd ComfyUI/custom_nodes
   git clone https://github.com/Miqingzi/Like-transition.git
   ```

2. Install Python dependencies:
   ```bash
   pip install -r Like-transition/requirements.txt
   ```

3. Restart ComfyUI

## Quick Start

### Encrypt an Image

1. Add "Encrypt Image" node to your workflow
2. Connect an image to the node
3. Set a strong password
4. Optionally specify the filename and MIME type
5. The encrypted image will be output as PNG

### Decrypt an Image

1. Add "Decrypt Image" node to your workflow
2. Connect the encrypted PNG image to the node
3. Enter the same password used for encryption
4. The original image will be restored

## Nodes

### Encrypt Image
Encrypts an image using AES-256-GCM encryption.

**Inputs:**
- `image` (IMAGE): The image to encrypt
- `password` (STRING): Encryption password
- `filename` (STRING): Original filename for metadata
- `mime_type` (STRING, optional): MIME type of original image

**Outputs:**
- `encrypted_image` (IMAGE): PNG image containing encrypted data
- `metadata_json` (STRING): Encryption metadata

### Decrypt Image
Decrypts an image encrypted with the Encrypt Image node.

**Inputs:**
- `encrypted_image` (IMAGE): The encrypted PNG image
- `password` (STRING): Decryption password

**Outputs:**
- `decrypted_image` (IMAGE): The original decrypted image
- `metadata_json` (STRING): Decryption metadata

## Encryption Protocol

```
┌─────────────────────────────────────────────────────────┐
│ Length Prefix (4 bytes)                                │
├─────────────────────────────────────────────────────────┤
│ Magic Header: "CSPNG100"                               │
│ Salt (16 bytes)                                        │
│ IV (12 bytes)                                          │
│ Metadata Length (4 bytes)                              │
│ Metadata (JSON)                                        │
│ Ciphertext (AES-GCM-256)                               │
└─────────────────────────────────────────────────────────┘
```

Each 3 bytes → RGB pixel (A=255)

## Security

- **Algorithm**: AES-256-GCM
- **Key Derivation**: PBKDF2-SHA256 (100,000 iterations)
- **Authentication**: GCM authentication tag
- **Randomization**: Random salt and IV per encryption
- **Local Processing**: No external data transmission

## Requirements

- Python 3.8+
- ComfyUI
- cryptography >= 41.0.0
- pillow >= 10.0.0
- numpy >= 1.24.0

## License

Apache License 2.0

## Author

Miqingzi
