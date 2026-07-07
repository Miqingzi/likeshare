"""
Like Transition - ComfyUI Encryption Node
Image encryption and decryption using AES-256-GCM with password-based key derivation
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

__version__ = "1.0.0"
__author__ = "Miqingzi"
__description__ = "A lightweight local multimedia asset encryption/decryption tool for ComfyUI"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
]
