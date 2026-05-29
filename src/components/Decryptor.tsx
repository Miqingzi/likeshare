import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { 
  FileLock2, Eye, EyeOff, Lock, Play, Music, Video, Image as ImageIcon,
  Download, RefreshCw, FileText, CheckCircle, ShieldAlert, Sparkles, 
  Clipboard, ClipboardCheck, ClipboardPaste, ZoomIn, ZoomOut, X, Settings
} from "lucide-react";
import { decodeAndDecryptFromPNG, decryptPayload } from "../utils/crypto";
import { DecryptedFile } from "../types";

// Big Endian UInt32 Reader helper for real-time metadata scanning
function readUInt32BE(bin: Uint8Array, offset: number): number {
  return (
    (bin[offset] << 24) |
    (bin[offset + 1] << 16) |
    (bin[offset + 2] << 8) |
    bin[offset + 3]
  );
}

interface DecryptorProps {
  shouldBlur: boolean;
  onFullScreenToggle?: (isOpen: boolean) => void;
}

export default function Decryptor({ shouldBlur, onFullScreenToggle }: DecryptorProps) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  
  // Custom Settings preference states - managed in parent now
  const [isBlurredFullScreen, setIsBlurredFullScreen] = useState(false);
  
  // Real-time metadata scanning states
  const [detectedHasPassword, setDetectedHasPassword] = useState<boolean | null>(null);
  const [scannedMetadata, setScannedMetadata] = useState<{ name: string; type: string; size: number } | null>(null);

  // Decryption state
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [stepMessage, setStepMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Decrypted output
  const [decryptedResult, setDecryptedResult] = useState<DecryptedFile | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  // Overlay preview state
  const [isFullScreenImage, setIsFullScreenImage] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(100); // Scale percentage: 50%, 75%, 100%, 125%, 150%, 200%
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");
  const [pasteError, setPasteError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (onFullScreenToggle) {
      onFullScreenToggle(isFullScreenImage);
    }
  }, [isFullScreenImage, onFullScreenToggle]);

  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      // If user is pasting into other textual input fields inside the app, and it doesn't contain a file, don't hijack it
      const target = e.target as HTMLElement;
      const isTextInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA") && target.id !== "decrypt-password-input";
      
      let containsFile = false;
      if (e.clipboardData) {
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
          containsFile = true;
        } else if (e.clipboardData.items) {
          for (let i = 0; i < e.clipboardData.items.length; i++) {
            if (e.clipboardData.items[i].kind === "file") {
              containsFile = true;
              break;
            }
          }
        }
      }

      if (isTextInput && !containsFile) {
        return;
      }

      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const files = e.clipboardData.files;
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith("image/")) {
            e.preventDefault();
            const pastedFile = files[i];
            setFile(pastedFile);
            await triggerAutoDecryption(pastedFile, "");
            return;
          }
        }
      }

      if (e.clipboardData && e.clipboardData.items) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image") !== -1) {
            const blob = items[i].getAsFile();
            if (blob) {
              e.preventDefault();
              const fileObj = new File([blob], `pasted_crypto_canvas_${Date.now()}.png`, { type: "image/png" });
              setFile(fileObj);
              await triggerAutoDecryption(fileObj, "");
              return;
            }
          }
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [shouldBlur, password]);

  // Formatter helpers
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Trigger and automate the decryption process instantly on file intake
  const triggerAutoDecryption = async (selectedFile: File, overridePassword?: string) => {
    try {
      setIsDecrypting(true);
      setErrorMsg(null);
      setDecryptedResult(null);
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
        setFileUrl(null);
      }

      onProgress("正在载入二进制画纸并进行预检...", 5);
      
      // Fast Path: Check if the file is steganographed with appended data (under the "CSPFOOT1" format)
      const rawFileBuffer = await selectedFile.arrayBuffer();
      const rawBytes = new Uint8Array(rawFileBuffer);
      let isAppended = false;
      let packed: Uint8Array | null = null;
      
      if (rawBytes.length >= 12) {
        const last8 = rawBytes.subarray(rawBytes.length - 8);
        const decoder = new TextDecoder();
        const marker = decoder.decode(last8);
        if (marker === "CSPFOOT1") {
          const packedLen = readUInt32BE(rawBytes, rawBytes.length - 12);
          if (packedLen > 0 && packedLen <= rawBytes.length - 12) {
            const packedStart = rawBytes.length - 12 - packedLen;
            packed = rawBytes.subarray(packedStart, packedStart + packedLen);
            isAppended = true;
          }
        }
      }

      if (isAppended && packed) {
        onProgress("检测到画纸附加隐写载荷，提取中...", 15);
        if (packed.length >= 40) {
          const payloadSize = readUInt32BE(packed, 0);
          if (payloadSize > 0 && (payloadSize + 4) <= packed.length) {
            const payload = packed.subarray(4, 4 + payloadSize);
            const decoder = new TextDecoder();
            if (payload.length >= 8) {
              const magic = decoder.decode(payload.subarray(0, 8));
              if (magic === "CSPNG100") {
                const metadataLength = readUInt32BE(payload, 36);
                if (metadataLength > 0 && (40 + metadataLength) <= payload.length) {
                  const metadataBytes = payload.subarray(40, 40 + metadataLength);
                  const metadataText = decoder.decode(metadataBytes);
                  const meta = JSON.parse(metadataText);
                  if (meta && meta.name) {
                    setScannedMetadata(meta);
                    const parsedHasPassword = meta.hasPassword !== false;
                    setDetectedHasPassword(parsedHasPassword);
                    
                    const effectivePassword = overridePassword !== undefined ? overridePassword : password;
                    if (parsedHasPassword && !effectivePassword) {
                      onProgress("此文件已被加密保护，需要密码口令", 100);
                      setIsDecrypting(false);
                      return;
                    }

                    onProgress("执行还原与验证...", 60);
                    // Use the exported decryptPayload directly on the extracted payload bytes
                    const result = await decryptPayload(payload, effectivePassword, (msg, percent) => {
                      setStepMessage(msg);
                      setProgressPercent(percent);
                    });

                    // Save output
                    const decryptedBlobURL = URL.createObjectURL(result.blob);
                    setDecryptedResult(result);
                    setFileUrl(decryptedBlobURL);

                    // Auto open full-screen overlay for decrypted element
                    setIsFullScreenImage(true);
                    setIsBlurredFullScreen(shouldBlur);
                    setIsDecrypting(false);
                    return;
                  }
                }
              }
            }
          }
        }
      }

      onProgress("未检测到附加隐写字尾，正在通过 Canvas 像素矩阵解析器读取...", 10);
      const imageURL = URL.createObjectURL(selectedFile);
      const img = new Image();
      
      const loadedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("图片资源加载失败，这不是一份合法的图像文件。"));
        img.src = imageURL;
      });

      const width = loadedImage.naturalWidth;
      const height = loadedImage.naturalHeight;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      
      let finalHasPasswordValue = false;
      if (ctx) {
        ctx.drawImage(loadedImage, 0, 0);
        
        // Scan a safe upper limit of pixels to parse metadata correctly
        const totalPixels = width * height;
        const pixelsToRead = Math.min(totalPixels, 12000);
        const imgData = ctx.getImageData(0, 0, width, height).data;
        const packedData = new Uint8Array(pixelsToRead * 3);
        
        for (let i = 0; i < pixelsToRead; i++) {
          const pixelIdx = i * 4;
          const packedIdx = i * 3;
          packedData[packedIdx] = imgData[pixelIdx];
          packedData[packedIdx + 1] = imgData[pixelIdx + 1];
          packedData[packedIdx + 2] = imgData[pixelIdx + 2];
        }

        if (packedData.length >= 40) {
          const payloadSize = readUInt32BE(packedData, 0);
          if (payloadSize > 0 && (payloadSize + 4) <= packedData.length) {
            const payload = packedData.subarray(4, 4 + payloadSize);
            const decoder = new TextDecoder();
            if (payload.length >= 8) {
              const magic = decoder.decode(payload.subarray(0, 8));
              if (magic === "CSPNG100") {
                const metadataLength = readUInt32BE(payload, 36);
                if (metadataLength > 0 && (40 + metadataLength) <= payload.length) {
                  const metadataBytes = payload.subarray(40, 40 + metadataLength);
                  const metadataText = decoder.decode(metadataBytes);
                  const meta = JSON.parse(metadataText);
                  if (meta && meta.name) {
                    setScannedMetadata(meta);
                    const parsedHasPassword = meta.hasPassword !== false;
                    setDetectedHasPassword(parsedHasPassword);
                    finalHasPasswordValue = parsedHasPassword;
                  }
                }
              }
            }
          }
        }
      }

      // If the file requires a password, and no password is given yet
      const effectivePassword = overridePassword !== undefined ? overridePassword : password;
      if (finalHasPasswordValue && !effectivePassword) {
        onProgress("此文件已被加密保护，需要密码口令", 100);
        URL.revokeObjectURL(imageURL);
        setIsDecrypting(false);
        return;
      }

      // Proceed with decryption using the effective password (defaults to empty/no-password)
      const result = await decodeAndDecryptFromPNG(loadedImage, effectivePassword, (msg, percent) => {
        setStepMessage(msg);
        setProgressPercent(percent);
      });

      // Revoke the source imageURL
      URL.revokeObjectURL(imageURL);

      // Save output
      const decryptedBlobURL = URL.createObjectURL(result.blob);
      setDecryptedResult(result);
      setFileUrl(decryptedBlobURL);

      // Auto open full-screen overlay for decrypted element
      setIsFullScreenImage(true);
      setIsBlurredFullScreen(shouldBlur);

    } catch (err) {
      const errorString = (err as Error).message || "";
      if (errorString.includes("decrypt") || errorString.includes("key") || errorString.includes("密码") || errorString.includes("校验")) {
        setErrorMsg("此文件是加密保护资产。请输入匹配的解构密钥口令，然后点击下方还原按钮。");
      } else {
        setErrorMsg(errorString || "加解密失败，请检查该图纸是否完整且未被画质破坏。");
      }
    } finally {
      setIsDecrypting(false);
    }
  };

  // Drag handles
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selected = e.dataTransfer.files[0];
      setFile(selected);
      await triggerAutoDecryption(selected, "");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      await triggerAutoDecryption(selected, "");
    }
  };

  // Ingest image file from clipboard and instantly trigger auto-decryption
  const handlePasteFromClipboard = async () => {
    try {
      setPasteError("");
      if (!navigator.clipboard || !navigator.clipboard.read) {
        throw new Error("Clipboard read API is not available/supported in this iframe browser sandbox context.");
      }
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const fileObj = new File([blob], `pasted_crypto_canvas_${Date.now()}.png`, { type: "image/png" });
            setFile(fileObj);
            await triggerAutoDecryption(fileObj, "");
            return;
          }
        }
      }
      setPasteError("剪切板中未检测到 PNG 加密画纸。请复制加密后的图像文件，或直接在页面上按键盘 Ctrl+V 快捷键进行粘贴。");
      setTimeout(() => setPasteError(""), 5000);
    } catch (err: any) {
      console.error("Paste helper caught clipboard permission/execution error in decryptor:", err);
      // Encourage key binding paste as a highly compatible, browser-approved native method that is never blocked
      setPasteError("💡 浏览器原生剪贴板 API 读取受限。请您直接通过键盘快捷键【Ctrl+V】或【Cmd+V】在任意地方粘贴解析！已为您启用全局事件监听协助极速一键闪电处理。");
      setTimeout(() => setPasteError(""), 10000);
    }
  };

  // Run Decryption (Manual form submit button with customized password)
  const handleDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    await triggerAutoDecryption(file, password);
  };

  // Helper inside loop status
  const onProgress = (msg: string, percent: number) => {
    setStepMessage(msg);
    setProgressPercent(percent);
  };

  // Handle direct copying of decrypted file to clipboard (Optimized to copy image/video directly with Base64 fallback)
  const handleCopyDecryptedData = async () => {
    if (!decryptedResult || !fileUrl) return;
    try {
      setCopyStatus("idle");
      const type = decryptedResult.type;
      
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }

      const res = await fetch(fileUrl);
      const blob = await res.blob();

      if (type.startsWith("image/")) {
        // If it is PNG image, copy directly
        if (blob.type === "image/png" && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          setCopyStatus("success");
        } else if (navigator.clipboard.write) {
          // If it is another image format (JPEG, SVG, WebP, GIF), convert to PNG via Canvas to fit strict clipboard standards
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Image failed to load"));
            img.src = fileUrl;
          });
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
            if (pngBlob) {
              await navigator.clipboard.write([
                new ClipboardItem({ "image/png": pngBlob })
              ]);
              setCopyStatus("success");
            } else {
              throw new Error("Canvas output empty");
            }
          } else {
            throw new Error("Canvas context construction failed");
          }
        } else {
          throw new Error("Clipboard writing not supported by browser");
        }
      } else if (type.startsWith("video/")) {
        // Try to write video blob directly into Clipboard API first
        try {
          if (navigator.clipboard.write) {
            await navigator.clipboard.write([
              new ClipboardItem({ [blob.type]: blob })
            ]);
            setCopyStatus("success");
          } else {
            throw new Error("Clipboard write unsupported");
          }
        } catch {
          // Fallback: Copy as Base64 DataURL (high compatibility representation of the media)
          if (navigator.clipboard.writeText) {
            const reader = new FileReader();
            reader.onloadend = async () => {
              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(reader.result as string);
                  setCopyStatus("success");
                } else {
                  setCopyStatus("error");
                }
              } catch {
                setCopyStatus("error");
              }
            };
            reader.readAsDataURL(blob);
          } else {
            setCopyStatus("error");
          }
        }
      } else {
        // Text or fallback files
        if ((type.startsWith("text/") || type.includes("json") || type.includes("javascript")) && navigator.clipboard.writeText) {
          const txt = await res.text();
          await navigator.clipboard.writeText(txt);
          setCopyStatus("success");
        } else if (navigator.clipboard.writeText) {
          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(reader.result as string);
                setCopyStatus("success");
              } else {
                setCopyStatus("error");
              }
            } catch {
              setCopyStatus("error");
            }
          };
          reader.readAsDataURL(blob);
        } else {
          setCopyStatus("error");
        }
      }
      setTimeout(() => setCopyStatus("idle"), 2500);
    } catch (err) {
      console.error("Copying decrypted output failed:", err);
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 4000);
    }
  };

  // Trigger download
  const handleDownload = () => {
    if (!decryptedResult || !fileUrl) return;
    const link = document.createElement("a");
    link.download = decryptedResult.name;
    link.href = fileUrl;
    link.click();
  };

  const resetAll = () => {
    setFile(null);
    setPassword("");
    setDetectedHasPassword(null);
    setScannedMetadata(null);
    setDecryptedResult(null);
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
      setFileUrl(null);
    }
    setErrorMsg(null);
    setProgressPercent(0);
    setStepMessage("");
  };

  // Match visual preview component
  const renderPreviewElement = () => {
    if (!decryptedResult || !fileUrl) return null;
    const type = decryptedResult.type;

    if (type.startsWith("image/")) {
      return (
        <div className="flex flex-col items-center justify-center p-3 border border-slate-100 bg-white shadow-sm rounded-xl relative group">
          <div className="relative overflow-hidden rounded-lg">
            <img 
              src={fileUrl} 
              alt="解密后图像预览" 
              className={`max-h-[250px] w-auto object-contain cursor-zoom-in group-hover:opacity-95 transition-all duration-200 ${
                shouldBlur ? "blur-md" : "filter-none"
              }`}
              onClick={() => {
                setIsFullScreenImage(true);
                setIsBlurredFullScreen(shouldBlur);
              }}
            />
            <button
              onClick={() => {
                setIsFullScreenImage(true);
                setIsBlurredFullScreen(shouldBlur);
              }}
              type="button"
              className="absolute bottom-2 right-2 p-1.5 bg-black/70 hover:bg-black/85 rounded-lg text-white transition-all text-xs flex items-center gap-1 shadow-md cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              全屏查看
            </button>
          </div>
        </div>
      );
    } else if (type.startsWith("video/")) {
      return (
        <div className="flex flex-col gap-2 p-1 border border-slate-950 bg-[#0d0f12] rounded-xl relative">
          <video 
            key={fileUrl}
            controls 
            playsInline
            preload="auto"
            className={`w-full max-h-[260px] h-auto rounded bg-black transition-all duration-200 ${
              shouldBlur ? "blur-md" : "filter-none"
            }`}
          >
            <source src={fileUrl} type={type} />
            您的浏览器不支持 HTML5 视频播放。
          </video>
        </div>
      );
    } else if (type.startsWith("audio/")) {
      return (
        <div className="flex flex-col gap-4 p-5 border border-slate-150 bg-indigo-50/20 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-2xl animate-pulse">
              <Music className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-indigo-700">音频资产就绪</span>
              <span className="text-[10px] text-slate-400">支持在浏览器直接收听或导出至本机</span>
            </div>
          </div>
          <audio 
            src={fileUrl} 
            controls 
            className="w-full"
          />
        </div>
      );
    } else {
      return (
        <div className="flex flex-col items-center justify-center py-8 px-4 border border-dashed border-slate-200 bg-slate-50/50 rounded-xl">
          <FileText className="w-12 h-12 text-slate-400 mb-2" />
          <span className="text-sm font-semibold text-slate-700">常规二进制文件预览限制</span>
          <span className="text-xs text-slate-400 mt-1">该类型（{type}）推荐您直接下载点击使用</span>
        </div>
      );
    }
  };

  return (
    <div className="w-full flex flex-col gap-6" id="decryptor-module">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2 relative">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 sm:hidden">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-pink-500"></span>
          </span>
          <div className="p-2 rounded-xl bg-pink-50 text-pink-600 hidden sm:block">
            <FileLock2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-950 font-display leading-tight">解码：上传加密 PNG 进行还原</h2>
          </div>
        </div>
      </div>

      {!decryptedResult ? (
        <form onSubmit={handleDecrypt} className="flex flex-col gap-6">
          {/* Selective Panel */}
          <div className="flex flex-col gap-2">
            <span className="text-xs sm:text-sm font-semibold text-slate-700">提供 “Like混淆” 制作的无损加密 PNG</span>
            {!file ? (
              <div className="flex flex-col gap-2 w-full">
                <div
                  id="decrypt-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border border-dashed rounded-2xl p-6 sm:p-12 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                    isDragOver
                      ? "border-pink-500 bg-pink-50/40 shadow-[0_0_20px_rgba(236,72,153,0.1)] scale-[0.99]"
                      : "border-slate-200 hover:border-pink-400 hover:bg-slate-50/40"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/png"
                  />
                  <div className="p-3 bg-pink-50 text-pink-500 rounded-2xl mb-3 transition-transform duration-300 hover:scale-105">
                    <FileLock2 className="w-6 h-6 animate-pulse" />
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-slate-900 text-center">拖拽加密 PNG 图像到这里，或点击浏览选择</p>
                  <p className="text-[10px] sm:text-xs text-slate-400 mt-2 text-center max-w-md leading-normal">
                    提示：像素解码仅支持未经插值与微信/压缩画质污染破坏的原始 24/32-bit PNG 图像
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePasteFromClipboard();
                    }}
                    className="mt-4 px-4 py-2 bg-pink-50/80 hover:bg-pink-100 text-pink-700 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm border border-pink-200/40"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    读取剪贴板快捷导入
                  </button>
                </div>
                {pasteError && (
                  <span className="text-[11px] text-rose-500 font-semibold text-center block animate-fade-in animate-pulse">
                    ⚠️ {pasteError}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between p-3.5 border border-slate-200/60 bg-slate-50/60 backdrop-blur-md rounded-2xl relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-pink-500"></div>
                <div className="flex items-center gap-3 pl-1 min-w-0 flex-1">
                  <div className="flex-shrink-0">
                    <ImageIcon className="w-10 h-10 text-pink-400" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 truncate pr-4" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{formatSize(file.size)}</span>
                      <span>•</span>
                      <span>{file.type || "PNG 密文画图"}</span>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={isDecrypting}
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-rose-50 transition-colors mr-1 cursor-pointer disabled:opacity-40 flex-shrink-0"
                  id="cancel-decrypt-file"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Intelligent Password Label & Input */}
          {file && (
            <div className="flex flex-col gap-3 bg-slate-50/50 p-4 sm:p-5 rounded-2xl border border-slate-200/40">
              <div className="flex items-center justify-between">
                <label className="text-xs sm:text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  <span>输入解密密码</span>
                  {detectedHasPassword === false && (
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold animate-pulse">
                      扫码检测：免密码资产
                    </span>
                  )}
                  {detectedHasPassword === true && (
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                      需要强制密码
                    </span>
                  )}
                </label>
                {scannedMetadata && (
                  <span className="text-[10px] text-indigo-600 font-mono italic truncate max-w-[150px] sm:max-w-[250px]">
                    包内原始文件：{scannedMetadata.name} ({formatSize(scannedMetadata.size)})
                  </span>
                )}
              </div>
              
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isDecrypting || detectedHasPassword === false}
                  required={detectedHasPassword === true}
                  placeholder={
                    detectedHasPassword === false
                      ? "此文件为免密码混淆资产，无需输入，可直接点击本地还原"
                      : "请输入匹配的解构密钥口令"
                  }
                  className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-base md:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/10 focus:border-pink-500 text-slate-900 font-mono transition-shadow duration-200 disabled:opacity-50 disabled:bg-slate-50"
                  id="decrypt-password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={detectedHasPassword === false}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 disabled:opacity-30"
                  id="toggle-decrypt-pwd-btn"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Error Board */}
          {errorMsg && (
            <div className="bg-rose-500/5 border border-rose-500/10 p-4 rounded-2xl flex items-start gap-3 animate-fade-in">
              <ShieldAlert className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="text-xs sm:text-sm font-bold text-slate-950 leading-none">解密提取失败</span>
                <span className="text-[11px] sm:text-xs text-rose-600 leading-relaxed">{errorMsg}</span>
              </div>
            </div>
          )}

          {/* Trigger Request */}
          {file && (
            <div className="flex flex-col gap-3">
              {isDecrypting && (
                <div className="flex flex-col gap-2.5 border border-pink-100 bg-pink-50/20 p-4 rounded-2xl animate-fade-in">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-pink-600 font-semibold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-pink-500" />
                      {stepMessage}
                    </span>
                    <span className="text-pink-600 font-mono font-bold">{progressPercent}%</span>
                  </div>
                  <div className="h-2 w-full bg-pink-150/40 rounded-full overflow-hidden relative">
                    <div 
                      className="h-full bg-gradient-to-r from-pink-500 to-pink-600 transition-all duration-150 rounded-full"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {!isDecrypting && (
                <button
                  type="submit"
                  className="w-full py-3.5 bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-pink-100/60 cursor-pointer transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
                  id="start-decrypt-btn"
                >
                  本地还原并提取文件 (Decrypt)
                </button>
              )}
            </div>
          )}
        </form>
      ) : (
        /* SUCCESS RESULTS VIEW WITH TOP COMPACT ACTIONS BAR */
        <div className="flex flex-col gap-4 animate-fade-in" id="decrypt-success-result">
          {/* Alert Success Banner */}
          <div className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl flex items-center gap-2.5">
            <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <div className="flex flex-row items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-slate-950 font-display leading-none">原媒体载荷已顺利提取！</span>
              <span className="text-[10px] text-slate-500 leading-none">本地混淆还原/AES-GCM 验证通过。</span>
            </div>
          </div>

          {/* Top Actions Pill Bar - Icon Ony for Saving Screen Real-estate on Mobile and Desktop */}
          <div className="flex items-center gap-2.5 justify-start border-b border-dashed border-slate-100 pb-2.5" id="decrypt-top-actions">
            <button
              onClick={handleDownload}
              className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-100 flex items-center justify-center cursor-pointer transition-colors"
              id="top-download-btn-dec"
              title="下载文件 (Download)"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handleCopyDecryptedData}
              type="button"
              disabled={decryptedResult.type.startsWith("video/")}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 disabled:hover:bg-slate-100 text-slate-700 rounded-xl flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 transition-colors"
              title={
                decryptedResult.type.startsWith("video/") 
                  ? "视频暂不支持直接复制数据 (Video Copying Disabled)" 
                  : decryptedResult.type.startsWith("image/") 
                    ? "复制已解密图片 (Copy Image)" 
                    : "复制解密数据 (Copy Data)"
              }
            >
              {copyStatus === "success" ? (
                <ClipboardCheck className="w-4 h-4 text-emerald-500 animate-fade-in" />
              ) : copyStatus === "error" ? (
                <Clipboard className="w-4 h-4 text-rose-500 animate-fade-in" />
              ) : (
                <Clipboard className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={resetAll}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl flex items-center justify-center cursor-pointer transition-colors"
              id="top-reset-btn-dec"
              title="继续解码下一个 (Reset)"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* Visual Media Showcase */}
            <div className="flex-1 w-full bg-slate-50 p-4 border border-slate-200/50 rounded-2xl">
              <span className="text-[10px] sm:text-xs font-bold text-slate-400 block mb-3 font-mono">MEDIA_RENDER_OUTPUT // 媒体在线渲染</span>
              {renderPreviewElement()}
            </div>

            {/* Metadata Restored Lists */}
            <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-slate-400 block font-mono tracking-wider">METADATA_EXTRACTED // 恢复数据明细</span>
              <div className="p-3 bg-slate-50/70 border border-slate-200/40 rounded-xl font-mono text-[11px] text-slate-600 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200/30 pb-2">
                  <span className="text-slate-400 shrink-0">文件名</span>
                  <span className="font-semibold text-slate-800 break-all text-right select-all">{decryptedResult.name}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-slate-200/30 pb-2">
                  <span className="text-slate-400 shrink-0">恢复类型</span>
                  <span className="font-semibold text-indigo-600 truncate max-w-[160px]" title={decryptedResult.type}>{decryptedResult.type}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400 shrink-0">解析大小</span>
                  <span className="font-bold text-emerald-600">{formatSize(decryptedResult.size)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* High-Fidelity Full-Screen Zoom Overlay Modal */}
      {isFullScreenImage && fileUrl && decryptedResult && createPortal(
        <div 
          className="fixed inset-0 z-[99999] bg-slate-950/80 backdrop-blur-xl flex flex-col justify-between items-center p-4 sm:p-6 overflow-hidden animate-fade-in text-white"
          onClick={() => setIsFullScreenImage(false)}
        >
          {/* Header Bar containing Controls (Blur switch, Download, Zoom, Close) */}
          <div className="w-full max-w-5xl flex items-center justify-between gap-2 z-10 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1.5 md:gap-2.5 min-w-0">
              {/* Incognito indicator badge */}
              <div className="flex items-center gap-1.5 py-1 px-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] text-slate-300 font-mono tracking-wider shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse shrink-0"></span>
                <span className="font-bold sm:inline hidden">INCOGNITO VIEWER // 弹窗式图片浏览器</span>
                <span className="font-bold inline sm:hidden">隐身预览</span>
              </div>

              {/* Blur toggle button */}
              {(decryptedResult.type.startsWith("image/") || decryptedResult.type.startsWith("video/")) && (
                <button
                  type="button"
                  onClick={() => setIsBlurredFullScreen(!isBlurredFullScreen)}
                  className={`flex items-center justify-center gap-1 py-1 px-2 sm:px-3 rounded-xl text-[11px] sm:text-xs font-bold transition-all duration-200 cursor-pointer shadow-md shrink-0 ${
                    isBlurredFullScreen 
                      ? "bg-amber-500 hover:bg-amber-600 text-white" 
                      : "bg-white/10 hover:bg-white/20 text-slate-200"
                  }`}
                  title={isBlurredFullScreen ? "取消模糊" : "开启模糊"}
                >
                  {isBlurredFullScreen ? (
                    <>
                      <Eye className="w-3.5 h-3.5 text-white" />
                      <span className="hidden md:inline">查看明文</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-amber-300" />
                      <span className="hidden md:inline">遮罩模糊</span>
                    </>
                  )}
                </button>
              )}

              {/* Zoom scale controller (only for images & videos) */}
              {(decryptedResult.type.startsWith("image/") || decryptedResult.type.startsWith("video/")) && (
                <div className="flex items-center bg-white/10 rounded-xl p-0.5 px-1 sm:px-1.5 gap-0.5 sm:gap-1 text-white border border-white/5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const idx = [50, 75, 100, 125, 150, 175, 200, 250, 300].indexOf(zoomLevel);
                      if (idx > 0) setZoomLevel([50, 75, 100, 125, 150, 175, 200, 250, 300][idx - 1]);
                    }}
                    className="p-1 hover:bg-white/10 rounded text-slate-300 hover:text-white cursor-pointer transition-colors"
                    title="缩小"
                  >
                    <ZoomOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomLevel(100)}
                    className="px-1 text-[9px] sm:text-xs font-mono hover:bg-white/10 rounded text-slate-200 hover:text-white py-0.5 cursor-pointer transition-colors"
                    title="重置100%"
                  >
                    {zoomLevel}%
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const levels = [50, 75, 100, 125, 150, 175, 200, 250, 300];
                      const idx = levels.indexOf(zoomLevel);
                      if (idx !== -1 && idx < levels.length - 1) setZoomLevel(levels[idx + 1]);
                    }}
                    className="p-1 hover:bg-white/10 rounded text-slate-300 hover:text-white cursor-pointer transition-colors"
                    title="放大"
                  >
                    <ZoomIn className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Download / Save button based on client operating system */}
              <button
                type="button"
                onClick={handleDownload}
                className="py-1 px-2 sm:py-1.5 sm:px-4 bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md flex items-center justify-center gap-1 cursor-pointer transition-all duration-200 hover:scale-[1.01] shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">立即下载</span>
                <span className="inline xs:hidden">下载</span>
              </button>

              <button 
                type="button"
                className="p-1.5 sm:p-2 bg-white/10 hover:bg-white/20 hover:text-pink-400 text-white rounded-xl transition-all flex items-center gap-1.5 shadow-lg cursor-pointer text-xs font-bold shrink-0"
                onClick={() => setIsFullScreenImage(false)}
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">关闭</span>
              </button>
            </div>
          </div>

          {/* Central Media Container with flex-1 dynamic viewport scaling */}
          <div 
            className="flex-grow w-full max-w-5xl flex items-center justify-center overflow-auto min-h-0 relative z-0 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div 
              className="transition-transform duration-200 ease-out flex items-center justify-center max-h-full max-w-full"
              style={{ transform: `scale(${zoomLevel / 100})` }}
            >
              {decryptedResult.type.startsWith("image/") ? (
                <img 
                  src={fileUrl} 
                  alt="全屏渲染预览" 
                  referrerPolicy="no-referrer"
                  className={`max-h-[72vh] sm:max-h-[78vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/10 transition-all duration-300 ${
                    isBlurredFullScreen ? "blur-2xl scale-[1.01]" : "filter-none"
                  }`}
                />
              ) : decryptedResult.type.startsWith("video/") ? (
                <video 
                  key={fileUrl}
                  autoPlay
                  controls
                  playsInline
                  preload="auto"
                  loop
                  className={`max-h-[72vh] sm:max-h-[78vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/10 transition-all duration-300 ${
                    isBlurredFullScreen ? "blur-2xl scale-[1.01]" : "filter-none"
                  }`}
                >
                  <source src={fileUrl} type={decryptedResult.type} />
                  您的浏览器不支持 HTML5 视频播放。
                </video>
              ) : decryptedResult.type.startsWith("audio/") ? (
                <div className="flex flex-col items-center gap-4 bg-slate-900/90 border border-slate-800 p-8 rounded-3xl text-white max-w-sm w-full shadow-2xl">
                  <Music className="w-12 h-12 text-pink-400 animate-bounce" />
                  <span className="text-sm font-semibold break-all text-center">{decryptedResult.name}</span>
                  <audio src={fileUrl} controls className="w-full mt-2" />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 bg-slate-900/90 border border-slate-800 p-8 rounded-3xl text-white max-w-sm w-full shadow-2xl text-center">
                  <FileText className="w-12 h-12 text-indigo-400" />
                  <span className="text-sm font-semibold break-all">{decryptedResult.name}</span>
                  <span className="text-xs text-slate-400">二进制常规文件不支持直接视图预览，已提供常规保存下载</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Info Panel */}
          <div 
            className="w-full max-w-md bg-slate-900/90 border border-slate-800 p-3 sm:p-4 rounded-2xl flex flex-col gap-1.5 shadow-2xl backdrop-blur-xl z-10" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Swapped Image / File Info Displayed Here */}
            <div className="flex items-start justify-between gap-3 text-left">
              <div className="min-w-0 flex-1">
                <span className="text-slate-400 text-[9px] font-mono tracking-wider uppercase block">
                  FILE_METADATA // 媒体文件详情
                </span>
                <span className="text-white text-xs sm:text-sm font-bold truncate block mt-0.5" title={decryptedResult.name}>
                  {decryptedResult.name}
                </span>
              </div>
              <div className="shrink-0 text-right font-mono text-[10px] text-slate-350 flex flex-col items-end">
                <span className="font-bold text-indigo-400">{decryptedResult.type}</span>
                <span>{formatSize(decryptedResult.size)}</span>
              </div>
            </div>

            {/* Visual indicators or labels & description details */}
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono border-t border-slate-800/50 pt-1.5">
              <span className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isBlurredFullScreen ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`}></span>
                <span>遮罩: {isBlurredFullScreen ? "遮盖" : "原图"}</span>
              </span>
              {typeof navigator !== "undefined" && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? (
                <span className="text-pink-400/80">长按可呼出系统保存</span>
              ) : (
                <span className="text-slate-600">CLIENT_DECRYPTED</span>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
