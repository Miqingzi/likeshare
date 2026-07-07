"""
ComfyUI Image Decryption Node
Decrypts images encrypted with AES-256-GCM password-based encryption
"""

import json
import struct
import numpy as np
from PIL import Image
import io


class DecryptImageNode:
    """
    Decrypts an image that was encrypted using the EncryptImage node.
    
    Reverses the encryption protocol to retrieve the original image data.
    """
    
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "encrypted_image": ("IMAGE",),
                "password": ("STRING", {"default": ""}),
            },
        }
    
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("decrypted_image", "metadata_json")
    FUNCTION = "decrypt"
    CATEGORY = "image/encryption"
    
    def decrypt(self, encrypted_image, password: str):
        """
        Decrypt image encrypted with AES-256-GCM.
        
        Args:
            encrypted_image: ComfyUI IMAGE tensor containing encrypted data
            password: Decryption password
            
        Returns:
            Tuple of (decrypted_image_tensor, metadata_json_string)
        """
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            from cryptography.hazmat.backends import default_backend
        except ImportError:
            raise RuntimeError("cryptography library is required. Install with: pip install cryptography")
        
        # Convert encrypted image tensor to bytes
        encrypted_bytes = self._tensor_to_bytes(encrypted_image)
        
        # Read payload length
        payload_len = struct.unpack('>I', encrypted_bytes[:4])[0]
        payload = encrypted_bytes[4:4+payload_len]
        
        # Parse payload structure
        magic_header = payload[:8]
        if magic_header != b"CSPNG100":
            raise ValueError(f"Invalid magic header: {magic_header}")
        
        salt = payload[8:24]
        iv = payload[24:36]
        metadata_len = struct.unpack('>I', payload[36:40])[0]
        metadata_json_bytes = payload[40:40+metadata_len]
        ciphertext = payload[40+metadata_len:]
        
        # Derive key from password
        kdf = PBKDF2(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
            backend=default_backend()
        )
        key = kdf.derive(password.encode())
        
        # Decrypt data using AES-GCM
        cipher = AESGCM(key)
        try:
            plaintext = cipher.decrypt(iv, ciphertext, None)
        except Exception as e:
            raise ValueError(f"Decryption failed: {str(e)}. Wrong password?")
        
        # Parse metadata
        metadata = json.loads(metadata_json_bytes.decode('utf-8'))
        
        # Convert bytes back to image
        try:
            decrypted_pil = Image.open(io.BytesIO(plaintext))
        except Exception as e:
            raise ValueError(f"Failed to parse decrypted image: {str(e)}")
        
        # Convert to tensor
        decrypted_tensor = self._pil_to_tensor(decrypted_pil)
        
        metadata_output = json.dumps({
            "original_filename": metadata.get("name", "unknown"),
            "original_mime_type": metadata.get("type", "image/png"),
            "original_size": metadata.get("size", 0),
            "decryption_status": "success",
            "encryption_method": "AES-256-GCM",
            "key_derivation": "PBKDF2-SHA256-100k"
        })
        
        return (decrypted_tensor, metadata_output)
    
    @staticmethod
    def _tensor_to_bytes(image_tensor):
        """Convert ComfyUI IMAGE tensor to bytes"""
        if isinstance(image_tensor, np.ndarray):
            # IMAGE is (batch, height, width, channels) with values in [0, 1]
            img = image_tensor[0] if image_tensor.ndim == 4 else image_tensor
            # Convert from [0, 1] to [0, 255]
            img = (img * 255).astype(np.uint8)
            
            # Extract RGB channels (ignore alpha if present)
            if img.shape[-1] >= 3:
                rgb = img[:, :, :3]
            else:
                rgb = img
            
            # Flatten to bytes: width*height*3 bytes
            bytes_data = rgb.flatten().tobytes()
            return bytes_data
        
        raise TypeError("Expected numpy array")
    
    @staticmethod
    def _pil_to_tensor(pil_image):
        """Convert PIL Image to ComfyUI IMAGE tensor"""
        img_array = np.array(pil_image)
        
        # Ensure it's RGB or RGBA
        if img_array.ndim == 2:
            img_array = np.stack([img_array] * 3, axis=-1)
        elif img_array.shape[-1] == 4:
            img_array = img_array[:, :, :3]
        
        # Convert to [0, 1] range
        img_array = img_array.astype(np.float32) / 255.0
        
        # Add batch dimension
        img_tensor = np.expand_dims(img_array, axis=0)
        return img_tensor


NODE_CLASS_MAPPINGS = {
    "DecryptImage": DecryptImageNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DecryptImage": "Decrypt Image",
}
