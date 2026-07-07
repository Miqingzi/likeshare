"""
ComfyUI Image Encryption Node
Encrypts images to PNG using AES-256-GCM with password-based key derivation
"""

import hashlib
import json
import struct
from typing import Any
import numpy as np
from PIL import Image
import io


class EncryptImageNode:
    """
    Encrypts an image file and encodes it into a PNG using pixel-level encryption.
    
    The encryption protocol:
    - Magic Header: "CSPNG100" (8 bytes)
    - Salt: 16 bytes (for PBKDF2 key derivation)
    - IV: 12 bytes (for AES-GCM)
    - Metadata Length: 4 bytes (Big-Endian UInt32)
    - Metadata: JSON string containing filename, MIME type, original size
    - Ciphertext: AES-GCM-256 encrypted image data
    
    Each 3 bytes of encrypted data maps to R, G, B channels of a pixel (A=255).
    """
    
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "password": ("STRING", {"default": ""}),
                "filename": ("STRING", {"default": "image.png"}),
            },
            "optional": {
                "mime_type": ("STRING", {"default": "image/png"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("encrypted_image", "metadata_json")
    FUNCTION = "encrypt"
    CATEGORY = "image/encryption"
    
    def encrypt(self, image, password: str, filename: str, mime_type: str = "image/png"):
        """
        Encrypt image using AES-256-GCM with password-based key derivation.
        
        Args:
            image: ComfyUI IMAGE tensor (batch, height, width, channels)
            password: Encryption password
            filename: Original filename for metadata
            mime_type: MIME type of the original image
            
        Returns:
            Tuple of (encrypted_image_tensor, metadata_json_string)
        """
        try:
            import cryptography
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
            from cryptography.hazmat.primitives.ciphers.aead import AEAD, AESGCM
            from cryptography.hazmat.backends import default_backend
        except ImportError:
            raise RuntimeError("cryptography library is required. Install with: pip install cryptography")
        
        # Convert image tensor to bytes
        image_pil = self._tensor_to_pil(image)
        image_bytes = self._pil_to_bytes(image_pil, mime_type)
        
        # Generate random salt and IV
        import os
        salt = os.urandom(16)
        iv = os.urandom(12)
        
        # Derive key from password
        kdf = PBKDF2(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode())
        
        # Create metadata
        metadata = {
            "name": filename,
            "type": mime_type,
            "size": len(image_bytes),
        }
        metadata_json = json.dumps(metadata).encode('utf-8')
        metadata_len = struct.pack('>I', len(metadata_json))
        
        # Encrypt data using AES-GCM
        cipher = AESGCM(key)
        ciphertext = cipher.encrypt(iv, image_bytes, None)
        
        # Construct payload
        magic_header = b"CSPNG100"
        payload = magic_header + salt + iv + metadata_len + metadata_json + ciphertext
        
        # Add length prefix
        payload_len = struct.pack('>I', len(payload))
        full_data = payload_len + payload
        
        # Encode to PNG pixels (3 bytes per pixel: R, G, B)
        pixels_needed = (len(full_data) + 2) // 3  # Round up
        width = max(1, int(np.sqrt(pixels_needed)))
        height = (pixels_needed + width - 1) // width
        
        # Pad data to match pixel count
        padded_data = full_data + b'\x00' * (width * height * 3 - len(full_data))
        
        # Create image from bytes
        pixel_data = np.frombuffer(padded_data[:width * height * 3], dtype=np.uint8)
        pixel_data = pixel_data.reshape((height, width, 3))
        
        # Add alpha channel (fully opaque)
        alpha = np.full((height, width, 1), 255, dtype=np.uint8)
        rgba_data = np.concatenate([pixel_data, alpha], axis=2)
        
        # Convert to PIL and then to tensor
        encrypted_pil = Image.fromarray(rgba_data, 'RGBA')
        encrypted_tensor = self._pil_to_tensor(encrypted_pil)
        
        metadata_output = json.dumps({
            "original_filename": filename,
            "original_mime_type": mime_type,
            "original_size": len(image_bytes),
            "encrypted_width": width,
            "encrypted_height": height,
            "encryption_method": "AES-256-GCM",
            "key_derivation": "PBKDF2-SHA256-100k"
        })
        
        return (encrypted_tensor, metadata_output)
    
    @staticmethod
    def _tensor_to_pil(image_tensor):
        """Convert ComfyUI IMAGE tensor to PIL Image"""
        # IMAGE is (batch, height, width, channels) with values in [0, 1]
        if isinstance(image_tensor, np.ndarray):
            img = image_tensor[0] if image_tensor.ndim == 4 else image_tensor
            # Convert from [0, 1] to [0, 255]
            img = (img * 255).astype(np.uint8)
            # Handle channels
            if img.shape[-1] == 4:
                return Image.fromarray(img, 'RGBA')
            elif img.shape[-1] == 3:
                return Image.fromarray(img, 'RGB')
            else:
                return Image.fromarray(img, 'L')
        return image_tensor
    
    @staticmethod
    def _pil_to_bytes(pil_image, mime_type):
        """Convert PIL Image to bytes with specified format"""
        buffer = io.BytesIO()
        if mime_type == "image/jpeg":
            pil_image.convert('RGB').save(buffer, format='JPEG', quality=95)
        elif mime_type == "image/webp":
            pil_image.save(buffer, format='WEBP', quality=95)
        else:  # Default to PNG
            pil_image.save(buffer, format='PNG')
        return buffer.getvalue()
    
    @staticmethod
    def _pil_to_tensor(pil_image):
        """Convert PIL Image to ComfyUI IMAGE tensor"""
        img_array = np.array(pil_image)
        # Ensure it's RGB or RGBA
        if img_array.ndim == 2:
            img_array = np.stack([img_array] * 3, axis=-1)
        # Convert to [0, 1] range
        img_array = img_array.astype(np.float32) / 255.0
        # Add batch dimension
        img_tensor = np.expand_dims(img_array, axis=0)
        return img_tensor


NODE_CLASS_MAPPINGS = {
    "EncryptImage": EncryptImageNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "EncryptImage": "Encrypt Image",
}
