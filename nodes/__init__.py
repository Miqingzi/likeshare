"""
Like Transition - Image Encryption/Decryption Nodes for ComfyUI
A lightweight local multimedia asset encryption/decryption tool
"""

from .encrypt_image import EncryptImageNode, NODE_CLASS_MAPPINGS as ENCRYPT_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS as ENCRYPT_DISPLAY
from .decrypt_image import DecryptImageNode, NODE_CLASS_MAPPINGS as DECRYPT_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS as DECRYPT_DISPLAY

# Combine node mappings
NODE_CLASS_MAPPINGS = {
    **ENCRYPT_MAPPINGS,
    **DECRYPT_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **ENCRYPT_DISPLAY,
    **DECRYPT_DISPLAY,
}

__all__ = [
    "EncryptImageNode",
    "DecryptImageNode",
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
]
