from .image_obfuscator import LikeShareEncrypt, LikeShareDecrypt

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {
    "LikeShareEncrypt": LikeShareEncrypt,
    "LikeShareDecrypt": LikeShareDecrypt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LikeShareEncrypt": "LikeShare Encrypt",
    "LikeShareDecrypt": "LikeShare Decrypt",
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
