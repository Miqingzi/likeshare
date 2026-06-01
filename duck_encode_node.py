import hashlib
import io
import os
import os
import struct
from typing import Tuple, List, Any
try:
    from moviepy.editor import ImageSequenceClip, AudioFileClip, concatenate_audioclips
except ImportError:
    try:
        from moviepy import ImageSequenceClip, AudioFileClip, concatenate_audioclips
    except ImportError:
        print("❌ MoviePy import failed. Please install moviepy: pip install moviepy")
        ImageSequenceClip = None
        AudioFileClip = None
        concatenate_audioclips = None
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import torch
import tempfile
try:
    import folder_paths  # type: ignore
except Exception:  # pragma: no cover
    folder_paths = None

try:
    from .duck_payload_exporter import export_duck_payload, _bytes_to_binary_image, _required_canvas_size, _build_file_header
except ImportError:
    from duck_payload_exporter import export_duck_payload, _bytes_to_binary_image, _required_canvas_size, _build_file_header


# 分类名称要求
CATEGORY = "SSTool"
LSB_BITS_PER_CHANNEL = 2
DUCK_CHANNELS = 3
WATERMARK_SKIP_W_RATIO = 0.40
WATERMARK_SKIP_H_RATIO = 0.08




def _tensor_to_pil(image: torch.Tensor) -> Image.Image:
    """将 ComfyUI 的 IMAGE Tensor 转为 PIL.Image。"""
    if image.dim() == 4:
        image = image[0]
    image = image.detach().cpu().numpy()
    image = np.clip(image * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(image)


def _pil_to_tensor(image: Image.Image) -> torch.Tensor:
    """将 PIL.Image 转为 ComfyUI 需要的 IMAGE Tensor。"""
    arr = np.array(image).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None, ...]




# ===================== 核心：复用VideoHelperSuite的音频解析逻辑 =====================
def export_lazy_audio_to_file(audio_obj) -> str:

    path_attr = getattr(audio_obj, "file", None)
    if isinstance(path_attr, str) and os.path.exists(path_attr):
        return path_attr


    temp_audio_path = tempfile.mkstemp(suffix=".wav")
    # mkstemp返回(fd, path)，我们需要path，并关闭fd
    os.close(temp_audio_path[0])
    temp_audio_path = temp_audio_path[1]

    try:

        if isinstance(audio_obj, torch.Tensor):
            import soundfile as sf
            audio_np = audio_obj.detach().cpu().numpy()
            if audio_np.ndim == 1:
                audio_np = audio_np[:, None]
            if audio_np.ndim == 2 and audio_np.shape[0] < audio_np.shape[1]:
                audio_np = audio_np.T
            sf.write(temp_audio_path, audio_np, samplerate=44100)
            print(f"✅ 导出音频张量为WAV：{temp_audio_path}")
            print(f"✅ Export audio tensor to WAV: {temp_audio_path}")
            return temp_audio_path

        elif isinstance(audio_obj, np.ndarray):
            import soundfile as sf
            arr = audio_obj
            if arr.ndim == 1:
                arr = arr[:, None]
            if arr.ndim == 2 and arr.shape[0] < arr.shape[1]:
                arr = arr.T
            sf.write(temp_audio_path, arr, samplerate=44100)
            print(f"✅ 导出numpy音频为WAV：{temp_audio_path}")
            print(f"✅ Export numpy audio to WAV: {temp_audio_path}")
            return temp_audio_path

        elif isinstance(audio_obj, dict):
            import soundfile as sf
            # 优先检查 waveform (ComfyUI 标准格式)
            data = audio_obj.get("waveform")
            if data is None:
                data = audio_obj.get("samples") or audio_obj.get("audio")
            
            sr = audio_obj.get("sample_rate") or audio_obj.get("samplerate") or 44100
            
            if data is not None:
                # 处理 Tensor 转 numpy
                if hasattr(data, "cpu"):
                    arr = data.detach().cpu().numpy()
                else:
                    arr = np.array(data)
                
                # 处理维度 (Batch, Channels, Samples)
                if arr.ndim == 3:
                    arr = arr.squeeze(0)  # 移除 batch 维度 (1, C, N) -> (C, N)
                
                if arr.ndim == 1:
                    arr = arr[:, None]
                # (Channels, Samples) -> (Samples, Channels) for soundfile
                if arr.ndim == 2 and arr.shape[0] < arr.shape[1]:
                    arr = arr.T
                
                sf.write(temp_audio_path, arr, samplerate=int(sr))
                print(f"✅ 导出dict音频为WAV：{temp_audio_path}")
                print(f"✅ Export dict audio to WAV: {temp_audio_path}")
                return temp_audio_path

        elif isinstance(audio_obj, (tuple, list)) and len(audio_obj) >= 1:
            import soundfile as sf
            arr = np.array(audio_obj[0])
            sr = audio_obj[1] if len(audio_obj) > 1 else 44100
            if arr.ndim == 1:
                arr = arr[:, None]
            if arr.ndim == 2 and arr.shape[0] < arr.shape[1]:
                arr = arr.T
            sf.write(temp_audio_path, arr, samplerate=int(sr))
            print(f"✅ 导出tuple/list音频为WAV：{temp_audio_path}")
            print(f"✅ Export tuple/list audio to WAV: {temp_audio_path}")
            return temp_audio_path

        elif isinstance(audio_obj, str):
            if os.path.exists(audio_obj):
                import shutil
                shutil.copy2(audio_obj, temp_audio_path)
                print(f"✅ 复制音频文件到临时路径：{temp_audio_path}")
                print(f"✅ Copy audio file to temp path: {temp_audio_path}")
                return temp_audio_path
            raise FileNotFoundError(f"音频路径不存在：{audio_obj}")

        raise TypeError(f"不支持的音频类型：{type(audio_obj)}")

    except Exception as e:
        print(f"❌ Export audio failed: {str(e)}")
        print(f"❌ 导出音频失败：{str(e)}")
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
        return None

class DuckHideNode:
    """生成鸭子图并将真实图片/视频数据隐藏其中，可选密码保护。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "password": ("STRING", {"default": "", "multiline": False}),
                "title": ("STRING", {"default": "", "multiline": False}),
                "fps": ("INT", {"default": 16, "min": 1, "max": 60, "step": 1, "tooltip": "fps必须为整数，int类型"}),
                "compress": ([2, 6, 8], {"default": 2, "tooltip": "选择压缩方式，8为最小体积"}),
                "combine_video": ("BOOLEAN", {"default": True, "tooltip": "如果为false则不会合成视频，强制输出组图"}),
                
            },
            "optional": {
                "images": ("IMAGE",),
                "audio": ("AUDIO",),
                "text_input": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("duck_image",)
    FUNCTION = "hide"
    CATEGORY = CATEGORY

    def _convert_comfy_image_to_cv2(self, comfy_image):
        img = np.rint(comfy_image.detach().cpu().numpy() * 255.0).astype(np.uint8)
        if img.ndim == 4:
            img = img.squeeze(0)
        if img.shape[-1] == 4:
            img = img[..., :3]
        return img

    def _parse_comfy_audio(self, audio: Any) -> str:
        """
        统一解析音频：复用保存音频节点的export逻辑
        """
        if audio is None or audio == "":
            return None
        
        # 核心：调用导出函数，将任意音频对象转为临时文件路径
        audio_path = export_lazy_audio_to_file(audio)
        return audio_path

    def _images_to_video(self, images: List[Image.Image], fps: float, audio: Any) -> np.ndarray:
        # """将多张图片合成视频"""
        frame_list = []
        for img in images:
            rgb_img = self._convert_comfy_image_to_cv2(img)
            frame_list.append(rgb_img)

        clip = ImageSequenceClip(frame_list, fps=fps)
        audio_clip = None
        
        # 1. 尝试加载音频
        if audio is not None and audio != "":
            try:
                print("检测到音频输入，尝试嵌入视频中")
                print("Audio detected, attempting to embed into video")
                audio_path = self._parse_comfy_audio(audio)
                print("audio_path:", audio_path)
                
                if audio_path is not None:
                    try:
                        loaded_audio = AudioFileClip(audio_path)
                        # 检查音频有效性
                        if loaded_audio.duration <= 0.05:
                            print(f"⚠️ Audio duration too short ({loaded_audio.duration}s), ignoring audio.")
                            loaded_audio.close()
                            audio_clip = None
                        else:
                            audio_clip = loaded_audio
                    except Exception as e:
                         print(f"⚠️ Failed to load AudioFileClip: {e}, ignoring audio.")
                         audio_clip = None

                    if audio_clip:
                        # 音频处理逻辑 (循环/截断)
                        if audio_clip.duration > clip.duration:
                            if hasattr(audio_clip, 'subclip'):
                                audio_clip = audio_clip.subclip(0, clip.duration)
                            else:
                                audio_clip = audio_clip.subclipped(0, clip.duration)
                        else:
                            repeats = int(clip.duration // audio_clip.duration)
                            remainder = clip.duration - repeats * audio_clip.duration
                            parts = []
                            if repeats <= 0:
                                if hasattr(audio_clip, 'subclip'):
                                     parts.append(audio_clip.subclip(0, min(audio_clip.duration, clip.duration)))
                                else:
                                     parts.append(audio_clip.subclipped(0, min(audio_clip.duration, clip.duration)))
                            else:
                                for _ in range(repeats):
                                    parts.append(audio_clip)
                                if remainder > 0:
                                    if hasattr(audio_clip, 'subclip'):
                                        parts.append(audio_clip.subclip(0, remainder))
                                    else:
                                        parts.append(audio_clip.subclipped(0, remainder))
                            audio_clip = concatenate_audioclips(parts)
                        
                        # 设置音频到视频剪辑
                        if hasattr(clip, 'set_audio'):
                             clip = clip.set_audio(audio_clip)
                        else:
                             clip = clip.with_audio(audio_clip)
            except Exception as e:
                print(f"⚠️ Audio processing error: {e}, continue without audio.")
                if audio_clip:
                    audio_clip.close()
                audio_clip = None
                # 移除已设置的音频
                if hasattr(clip, 'set_audio'):
                     clip = clip.set_audio(None)
                else:
                     clip = clip.with_audio(None)

        # 2. 尝试写入视频文件 (带重试机制)
        temp_video_path = None
        try:
            def write_video(use_audio=True):
                # 必须 delete=False 否则 win 下无法读取
                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
                    t_path = tf.name
                
                # 如果不使用音频，强制移除
                current_clip = clip
                if not use_audio:
                    if hasattr(current_clip, 'set_audio'):
                        current_clip = current_clip.set_audio(None)
                    else:
                        current_clip = current_clip.with_audio(None)

                current_clip.write_videofile(
                    t_path,
                    codec="libx264",
                    audio_codec="aac" if use_audio and current_clip.audio else None,
                    fps=fps,
                    ffmpeg_params=[
                        "-pix_fmt","yuv420p",
                        "-crf","16",
                        "-preset","medium",
                        "-profile:v","high",
                        "-movflags","+faststart"
                    ]
                )
                return t_path

            try:
                # 第一次尝试：如果 audio_clip 存在，则尝试带音频写入
                temp_video_path = write_video(use_audio=(audio_clip is not None))
            except (IndexError, OSError, Exception) as e:
                if audio_clip is not None:
                    print(f"❌ Video encoding with audio failed: {e}")
                    print("🔄 Retrying without audio...")
                    # 清理第一次失败的临时文件 (如果有)
                    if temp_video_path and os.path.exists(temp_video_path):
                        try:
                            os.unlink(temp_video_path)
                        except:
                            pass
                    # 重试不带音频
                    temp_video_path = write_video(use_audio=False)
                else:
                    # 如果本来就没音频还失败了，那就真失败了
                    raise e

            # 读取最终成功的临时文件
            with open(temp_video_path, "rb") as f:
                video_bytes = f.read()

        finally:
            # 强制释放资源
            clip.close()
            if audio_clip:
                audio_clip.close()
            
            # 删除临时文件
            if temp_video_path and os.path.exists(temp_video_path):
                try:
                    os.unlink(temp_video_path)
                except:
                    pass

        return video_bytes

    def hide(self, fps: float, password: str, title: str, compress: int, combine_video: bool, images=None, audio=None, Notes: str = "", text_input: str = ""):
        return self._hide(fps, password, title, compress, combine_video, images, audio, Notes, text_input=text_input)

    def _hide(self, fps: float, password: str, title: str, compress: int, combine_video: bool, images=None, audio=None, Notes: str = "", video_path="", text_input: str = ""):
        # 优先处理文本输入
        if text_input and text_input.strip():
            raw_bytes = text_input.encode("utf-8")
            ext = "txt"
            
            out_path, duck_img = export_duck_payload(
                raw_bytes=raw_bytes,
                password=password,
                ext=ext,
                compress=compress,
                title=title,
                output_dir=(folder_paths.get_output_directory() if folder_paths else os.getcwd()),
                output_name="duck_payload_txt.png",
            )
            duck_tensor = _pil_to_tensor(duck_img)
            return (duck_tensor,)

        # image 
        if images is None and not video_path:
            raise ValueError("Images, video_path or text_input required. 需要提供 images, video_path 或 text_input 。")

        if isinstance(images, (torch.Tensor, np.ndarray)):
            # 获取维度：3维=单帧，4维=多帧序列
            dims = len(images.shape)
            if dims == 4:
                # Load Video输出的4维帧序列 (N, H, W, C)
                frame_count = images.shape[0]
                # 拆分4维张量为单帧列表
                frame_list = [images[i] for i in range(frame_count)]
            elif dims == 3:
                # 单张图片 (H, W, C)
                frame_count = 1
                frame_list = [images]
            else:
                raise ValueError(f"Unsupported input dims: {dims} (only 3/4D). 不支持的输入维度：{dims}（仅支持3/4维）")
        elif isinstance(images, list):
            # 手动传入的图片列表
            frame_count = len(images)
            frame_list = images
        else:
            # 未知类型，按单帧处理
            frame_count = 1
            frame_list = [images]


        if video_path:
            # 直接使用视频文件
            with open(video_path, "rb") as f:
                vid_bytes = f.read()
                # 转为二进制图片，再走图片逻辑
                bin_img = _bytes_to_binary_image(vid_bytes, width=512)
                with io.BytesIO() as buf:
                    bin_img.save(buf, format="PNG")
                    raw_bytes = buf.getvalue()
                orig_ext = os.path.splitext(video_path)[1].lower().lstrip('.')
                ext = f"{orig_ext}.binpng"

        elif not combine_video and frame_count > 1:
            print("Output as image list (输出为图片列表)")
            duck_results = []
            
            # 预处理：生成所有 raw_bytes 并计算最大所需尺寸，确保所有输出图片尺寸一致且数据结构完整
            raw_bytes_list = []
            max_required_size = 0
            lsb_bits = 8 if compress >= 8 else (6 if compress >= 6 else 2)
            
            for i, frame_tensor in enumerate(frame_list):
                pil = _tensor_to_pil(frame_tensor)
                with io.BytesIO() as buf:
                    pil.save(buf, format="PNG")
                    raw_bytes = buf.getvalue()
                raw_bytes_list.append(raw_bytes)
                
                # 计算所需尺寸
                ext = "png"
                file_header = _build_file_header(raw_bytes, password, ext=ext)
                req_size = _required_canvas_size((len(file_header) + 4) * 8, lsb_bits)
                if req_size > max_required_size:
                    max_required_size = req_size
            
            print(f"Unified canvas size for image list: {max_required_size}x{max_required_size}")
            
            # 内存优化：预分配最终 Tensor，避免 torch.cat 带来的内存峰值 (List + Tensor 双倍占用)
            # 形状: (frame_count, H, W, C)
            result_tensor = torch.zeros((frame_count, max_required_size, max_required_size, 3), dtype=torch.float32)
            
            for i, raw_bytes in enumerate(raw_bytes_list):
                ext = "png"
                out_name = f"duck_payload_seq_{i:05d}.png" 
                
                out_path, duck_img = export_duck_payload(
                    raw_bytes=raw_bytes,
                    password=password,
                    ext=ext,
                    compress=compress,
                    title=f"{title} ({i+1}/{frame_count})",
                    output_dir=(folder_paths.get_output_directory() if folder_paths else os.getcwd()),
                    output_name=out_name,
                    fixed_size=max_required_size, # 强制使用统一尺寸
                )
                
                # 直接写入预分配的 Tensor
                # _pil_to_tensor 返回 (1, H, W, C)，我们需要 [0] 取出 (H, W, C)
                result_tensor[i] = _pil_to_tensor(duck_img)[0]
            
            # 清理 raw_bytes_list 以释放内存 (虽然 Python 会自动回收，但显式清理是个好习惯)
            del raw_bytes_list

            return (result_tensor,)

        elif frame_count > 1:
            print("检测到视频输入，合成视频中")
            print("Detected video input, composing video")
            print("图片张数：",frame_count)
            print("Number of images:", frame_count)
            #合成视频
            vid_bytes = self._images_to_video(frame_list, fps,audio)

            # 转为二进制图片，再走图片逻辑
            bin_img = _bytes_to_binary_image(vid_bytes, width=512)
            with io.BytesIO() as buf:
                bin_img.save(buf, format="PNG")
                raw_bytes = buf.getvalue()
            orig_ext = "mp4"
            ext = f"{orig_ext}.binpng"
        else:
            pil = _tensor_to_pil(frame_list[0])
            with io.BytesIO() as buf:
                pil.save(buf, format="PNG")
                raw_bytes = buf.getvalue()
            ext = "png"

        out_path, duck_img = export_duck_payload(
            raw_bytes=raw_bytes,
            password=password,
            ext=ext,
            compress=compress,
            title=title,
            output_dir=(folder_paths.get_output_directory() if folder_paths else os.getcwd()),
            output_name="duck_payload.png",
        )

        duck_tensor = _pil_to_tensor(duck_img)
        return (duck_tensor,)


NODE_CLASS_MAPPINGS = {"DuckHideNode": DuckHideNode}
NODE_DISPLAY_NAME_MAPPINGS = {"DuckHideNode": "鸭鸭图 SuperSecureMediaProtection媒体内容保护 编码V1.2"}

