# LikeShare Image Obfuscator

ComfyUI custom nodes for image obfuscation and restoration using a deterministic Hilbert-curve pixel shuffle.

## Included Nodes

- `LikeShare Encrypt`: Obfuscates an input image.
- `LikeShare Decrypt`: Restores an image produced by the paired encrypt node.

## Features

- No runtime package installation
- No external service calls
- Batch image support
- Deterministic reversible transform

## Installation

Clone or copy this directory into `ComfyUI/custom_nodes/`, then restart ComfyUI.

## Notes

- The algorithm uses a fixed internal key to stay compatible with the intended LikeShare/Tomato-style obfuscation flow.
- This node only processes image tensors and does not modify files on disk.

## Publishing Checklist

Before publishing to the Comfy Registry, replace these placeholders in `pyproject.toml`:

- `YOUR_PUBLISHER_ID`

Then create your publisher/API key and publish with `comfy node publish`.
