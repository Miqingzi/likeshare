"""
Like分享 — "大番茄像素洗牌" 算法
==================================
完整移植自 Java TomatoScramble，算法步骤保持一致：
  1. 生成 2D Hilbert 曲线遍历顺序（gilbert2d）
  2. 用黄金比例共轭计算旋转偏移量
  3. 沿 Hilbert 曲线旋转像素列实现加密 / 解密

加密与解密使用相同的固定 key，用户无需也无法修改。
"""

import torch
import numpy as np

# ---- 固定参数（用户不可修改）----
FIXED_KEY = 1.0
GOLDEN_RATIO_CONJ = (np.sqrt(5.0) - 1.0) / 2.0  # ≈ 0.618


# ---------------------------------------------------------------------------
# 2D Hilbert 曲线遍历（等价于 Java generate2d / gilbert2d）
# ---------------------------------------------------------------------------

def _hilbert_positions(width, height):
    """生成 Hilbert 曲线遍历顺序，返回 (N,) int64 数组。"""
    total = width * height
    positions = np.zeros(total, dtype=np.int64)
    pos = [0]  # 用列表实现可变闭包

    def generate2d(x, y, ax, ay, bx, by):
        w = abs(ax + ay)
        h = abs(bx + by)
        dax = int(np.sign(ax))
        day = int(np.sign(ay))
        dbx = int(np.sign(bx))
        dby = int(np.sign(by))

        if h == 1:
            for _ in range(w):
                positions[pos[0]] = x + y * width
                pos[0] += 1
                x += dax
                y += day
            return

        if w == 1:
            for _ in range(h):
                positions[pos[0]] = x + y * width
                pos[0] += 1
                x += dbx
                y += dby
            return

        ax2 = ax // 2
        ay2 = ay // 2
        bx2 = bx // 2
        by2 = by // 2
        w2 = abs(ax2 + ay2)
        h2 = abs(bx2 + by2)

        if 2 * w > 3 * h:
            if (w2 & 1) == 1 and w > 2:
                ax2 += dax
                ay2 += day
            generate2d(x, y, ax2, ay2, bx, by)
            generate2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by)
        else:
            if (h2 & 1) == 1 and h > 2:
                bx2 += dbx
                by2 += dby
            generate2d(x, y, bx2, by2, ax2, ay2)
            generate2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2)
            generate2d(
                x + (ax - dax) + (bx2 - dbx),
                y + (ay - day) + (by2 - dby),
                -bx2, -by2,
                -(ax - ax2), -(ay - ay2),
            )

    if width >= height:
        generate2d(0, 0, width, 0, 0, height)
    else:
        generate2d(0, 0, 0, height, width, 0)

    return positions


# ---------------------------------------------------------------------------
# 加密 / 解密（与 Java TomatoScramble.process 步骤一致）
# ---------------------------------------------------------------------------

def _scramble_pixels(img_np):
    """
    加密 —— 等价于 Java ProcessType.ENCRYPT：
      1. 生成 Hilbert 遍历顺序 positions
      2. offset = round(GOLDEN_RATIO_CONJ * total * FIXED_KEY)
      3. loopPosition = total - offset
      4. 对 i <  loopPosition: newPixels[positions[i+offset]] = pixels[positions[i]]
         对 i >= loopPosition: newPixels[positions[i-loopPos]] = pixels[positions[i]]
    """
    h, w, c = img_np.shape
    total = h * w
    flat = img_np.reshape(total, c)

    positions = _hilbert_positions(w, h)

    offset = int(round(GOLDEN_RATIO_CONJ * total * FIXED_KEY))
    loop_pos = total - offset

    result = np.zeros_like(flat)

    # i < loopPosition
    i_lo = np.arange(loop_pos, dtype=np.int64)
    result[positions[i_lo + offset]] = flat[positions[i_lo]]

    # i >= loopPosition
    i_hi = np.arange(loop_pos, total, dtype=np.int64)
    result[positions[i_hi - loop_pos]] = flat[positions[i_hi]]

    return result.reshape(h, w, c)


def _unscramble_pixels(img_np):
    """
    解密 —— 等价于 Java ProcessType.DECRYPT：
      1. 生成 Hilbert 遍历顺序 positions
      2. offset (与加密相同)
      3. loopPosition = total - offset
      4. 对 i <  loopPosition: newPixels[positions[i]] = pixels[positions[i+offset]]
         对 i >= loopPosition: newPixels[positions[i]] = pixels[positions[i-loopPos]]
    """
    h, w, c = img_np.shape
    total = h * w
    flat = img_np.reshape(total, c)

    positions = _hilbert_positions(w, h)

    offset = int(round(GOLDEN_RATIO_CONJ * total * FIXED_KEY))
    loop_pos = total - offset

    result = np.zeros_like(flat)

    # i < loopPosition
    i_lo = np.arange(loop_pos, dtype=np.int64)
    result[positions[i_lo]] = flat[positions[i_lo + offset]]

    # i >= loopPosition
    i_hi = np.arange(loop_pos, total, dtype=np.int64)
    result[positions[i_hi]] = flat[positions[i_hi - loop_pos]]

    return result.reshape(h, w, c)


# ---------------------------------------------------------------------------
# Tensor <-> numpy
# ---------------------------------------------------------------------------

def _tensor_to_numpy(image):
    return (image.cpu().numpy() * 255).astype(np.uint8)


def _numpy_to_tensor(arr):
    return torch.from_numpy(arr.astype(np.float32) / 255.0)


# ---------------------------------------------------------------------------
# ComfyUI 节点（seed 为固定值，用户不可修改）
# ---------------------------------------------------------------------------

class LikeShareEncrypt:
    """Obfuscate an image with the LikeShare Hilbert pixel shuffle."""

    CATEGORY = "LikeShare"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "encrypt"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
            }
        }

    def encrypt(self, image):
        batch_size = image.shape[0]
        results = []
        for i in range(batch_size):
            img_np = _tensor_to_numpy(image[i])
            scrambled = _scramble_pixels(img_np)
            results.append(_numpy_to_tensor(scrambled))
        batch = torch.stack(results, dim=0)
        return (batch,)


class LikeShareDecrypt:
    """Restore an image produced by the LikeShare Hilbert pixel shuffle."""

    CATEGORY = "LikeShare"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "decrypt"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
            }
        }

    def decrypt(self, image):
        batch_size = image.shape[0]
        results = []
        for i in range(batch_size):
            img_np = _tensor_to_numpy(image[i])
            unscrambled = _unscramble_pixels(img_np)
            results.append(_numpy_to_tensor(unscrambled))
        batch = torch.stack(results, dim=0)
        return (batch,)
