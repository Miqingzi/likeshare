import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { 
  FileLock2, Eye, EyeOff, Lock, Play, Music, Video, Image as ImageIcon,
  Download, RefreshCw, FileText, CheckCircle, ShieldAlert, Sparkles, 
  Clipboard, ClipboardCheck, ClipboardPaste, ZoomIn, ZoomOut, X, Info, Trash2, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp
} from "lucide-react";
import { decodeAndDecryptFromPNG, decryptPayload, decodeDuckMetadata, decodeAndDecryptDuckPNG, getMimeFromExt, unscrambleImage } from "../utils/crypto";
import { DecryptedFile } from "../types";
import ImageSequencePlayer from "./ImageSequencePlayer";

// Big Endian UInt32 Reader helper for real-time metadata scanning
function readUInt32BE(bin: Uint8Array, offset: number): number {
  return (
    (bin[offset] << 24) |
    (bin[offset + 1] << 16) |
    (bin[offset + 2] << 8) |
    bin[offset + 3]
  ) >>> 0;
}

interface DecryptorProps {
  shouldBlur: boolean;
  autoFullScreen: boolean;
  onFullScreenToggle?: (isOpen: boolean) => void;
}

export default function Decryptor({ shouldBlur, autoFullScreen, onFullScreenToggle }: DecryptorProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteError, setPasteError] = useState("");
  
  // Custom Settings preference states
  const [isBlurredFullScreen, setIsBlurredFullScreen] = useState(false);

  // Decryption state
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [stepMessage, setStepMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Queue of scanned files to be decrypted
  interface ScannedItem {
    id: string;
    file: File;
    hasPassword: boolean | null;
    metadata: { name: string; type: string; size: number; stegType?: string } | null;
  }
  const [scannedQueue, setScannedQueue] = useState<ScannedItem[]>([]);

  // Decrypted outputs
  interface DecryptedItem {
    id: string;
    sourceFileName: string;
    sourceFileSize: number;
    success: boolean;
    errorMsg?: string;
    result?: DecryptedFile;
    fileUrl?: string; // CreateObjectURL
  }
  const [decryptedResults, setDecryptedResults] = useState<DecryptedItem[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number>(0);
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [isMetadataExpanded, setIsMetadataExpanded] = useState(false);

  // Overlay preview state
  const [isFullScreenImage, setIsFullScreenImage] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(100); 
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (onFullScreenToggle) {
      onFullScreenToggle(isFullScreenImage);
    }
  }, [isFullScreenImage, onFullScreenToggle]);

  // Clean objects urls on unmount
  useEffect(() => {
    return () => {
      decryptedResults.forEach((r) => {
        if (r.fileUrl) {
          URL.revokeObjectURL(r.fileUrl);
        }
      });
    };
  }, [decryptedResults]);

  // Fast header pre-scanner
  const scanFileMetadata = async (selectedFile: File): Promise<{ hasPassword: boolean | null; metadata: { name: string; type: string; size: number; stegType?: string } | null }> => {
    try {
      const rawFileBuffer = await selectedFile.arrayBuffer();
      const rawBytes = new Uint8Array(rawFileBuffer);
      let isAppended = false;
      let packed: Uint8Array | null = null;
      let hasPasswordVal: boolean | null = null;
      let metaVal: { name: string; type: string; size: number; stegType?: string } | null = null;
      
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
                    metaVal = meta;
                    hasPasswordVal = meta.hasPassword !== false;
                  }
                }
              }
            }
          }
        }
      }

      if (!metaVal) {
        const imageURL = URL.createObjectURL(selectedFile);
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject();
            img.src = imageURL;
          });
          
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
            
            // 1. Try Duck Steganography Scanner
            const duck = decodeDuckMetadata(imgData, img.naturalWidth, img.naturalHeight);
            if (duck) {
              metaVal = {
                name: `duck_recovered.${duck.ext}`,
                type: getMimeFromExt(duck.ext),
                size: duck.dataLen,
                stegType: "duck" as any
              };
              hasPasswordVal = duck.hasPassword;
            } else {
              // 2. Fall back to Like混肴 Image Decoder
              const totalPixels = img.naturalWidth * img.naturalHeight;
              const pixelsToRead = Math.min(totalPixels, 12000);
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
                          metaVal = meta;
                          hasPasswordVal = meta.hasPassword !== false;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Silent catch
        } finally {
          URL.revokeObjectURL(imageURL);
        }
      }

      if (!metaVal) {
        if (selectedFile.type.startsWith("image/") || selectedFile.name.match(/\.(png|jpe?g|webp|bmp|gif)$/i)) {
          metaVal = {
            name: selectedFile.name,
            type: selectedFile.type || "image/png",
            size: selectedFile.size,
            stegType: "scramble"
          };
          hasPasswordVal = false;
        }
      }

      return {
        hasPassword: hasPasswordVal,
        metadata: metaVal
      };
    } catch {
      return {
        hasPassword: null,
        metadata: null
      };
    }
  };

  const addFilesToQueue = async (incomingList: File[]) => {
    setPasteError("");
    const newItems: ScannedItem[] = [];
    
    for (const f of incomingList) {
      const pre = await scanFileMetadata(f);
      newItems.push({
        id: `scanned-${Date.now()}-${Math.random()}`,
        file: f,
        hasPassword: pre.hasPassword,
        metadata: pre.metadata
      });
    }
    
    setScannedQueue((prev) => [...prev, ...newItems]);
  };

  // Global listener for Ctrl+V / Cmd+V
  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
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

      const incomingFiles: File[] = [];

      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const filesList = e.clipboardData.files;
        for (let i = 0; i < filesList.length; i++) {
          if (filesList[i].type.startsWith("image/")) {
            incomingFiles.push(filesList[i]);
          }
        }
      } else if (e.clipboardData && e.clipboardData.items) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image") !== -1) {
            const blob = items[i].getAsFile();
            if (blob) {
              const fileObj = new File([blob], `pasted_crypto_canvas_${Date.now()}_${i}.png`, { type: "image/png" });
              incomingFiles.push(fileObj);
            }
          }
        }
      }

      if (incomingFiles.length > 0) {
        e.preventDefault();
        await addFilesToQueue(incomingFiles);
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, [password]);

  // Formatter helpers
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Drag and drop handlers
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const dropped: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        dropped.push(e.dataTransfer.files[i]);
      }
      await addFilesToQueue(dropped);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected: File[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        selected.push(e.target.files[i]);
      }
      await addFilesToQueue(selected);
    }
  };

  // Ingest image file from clipboard via click
  const handlePasteFromClipboard = async () => {
    try {
      setPasteError("");
      if (!navigator.clipboard || !navigator.clipboard.read) {
        throw new Error("Clipboard read API is not available/supported in this iframe browser sandbox context.");
      }
      const clipboardItems = await navigator.clipboard.read();
      const loaded: File[] = [];
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const fileObj = new File([blob], `pasted_crypto_canvas_${Date.now()}.png`, { type: "image/png" });
            loaded.push(fileObj);
          }
        }
      }
      if (loaded.length > 0) {
        await addFilesToQueue(loaded);
      } else {
        setPasteError("剪切板中未检测到 PNG 加密画纸。请复制加密后的图像文件，或直接在页面上按键盘 Ctrl+V 快捷键进行粘贴。");
        setTimeout(() => setPasteError(""), 5000);
      }
    } catch (err: any) {
      console.error("Paste helper caught clipboard permission/error:", err);
      setPasteError("💡 浏览器原生剪贴板 API 读取受限。请您直接通过键盘快捷键【Ctrl+V】或【Cmd+V】在任意地方粘贴解析！已为您启用全局事件监听协助极速一键闪电处理。");
      setTimeout(() => setPasteError(""), 10000);
    }
  };

  // Decrypt queue item sequence
  const decryptQueueItem = async (scanned: ScannedItem, typedPassword?: string): Promise<Omit<DecryptedItem, "id">> => {
    const selectedFile = scanned.file;
    const effectivePassword = typedPassword !== undefined ? typedPassword : password;
    
    // Check if scanned is Block Scramble Image
    if (scanned.metadata && (scanned.metadata as any).stegType === "scramble") {
      const imageURL = URL.createObjectURL(selectedFile);
      const img = new Image();
      const loadedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("图片资源加载失败，这不是一份合法的图像文件。"));
        img.src = imageURL;
      });
      const result = await unscrambleImage(loadedImage, (msg, percent) => {
        setStepMessage(msg);
        setProgressPercent(percent);
      });
      URL.revokeObjectURL(imageURL);
      const decryptedBlobURL = URL.createObjectURL(result.blob);
      return {
        sourceFileName: selectedFile.name,
        sourceFileSize: selectedFile.size,
        success: true,
        result,
        fileUrl: decryptedBlobURL
      };
    }
    
    // Check if scanned is Duck Steganography
    if (scanned.metadata && (scanned.metadata as any).stegType === "duck") {
      const imageURL = URL.createObjectURL(selectedFile);
      const img = new Image();
      const loadedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("图片资源加载失败，这不是一份合法的图像文件。"));
        img.src = imageURL;
      });
      const result = await decodeAndDecryptDuckPNG(loadedImage, effectivePassword);
      URL.revokeObjectURL(imageURL);
      const decryptedBlobURL = URL.createObjectURL(result.blob);
      return {
        sourceFileName: selectedFile.name,
        sourceFileSize: selectedFile.size,
        success: true,
        result,
        fileUrl: decryptedBlobURL
      };
    }
    
    // Check trailer first
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
      if (packed.length >= 40) {
        const payloadSize = readUInt32BE(packed, 0);
        if (payloadSize > 0 && (payloadSize + 4) <= packed.length) {
          const payload = packed.subarray(4, 4 + payloadSize);
          const result = await decryptPayload(payload, effectivePassword, () => {});
          const decryptedBlobURL = URL.createObjectURL(result.blob);
          return {
            sourceFileName: selectedFile.name,
            sourceFileSize: selectedFile.size,
            success: true,
            result,
            fileUrl: decryptedBlobURL
          };
        }
      }
    }

    // Canvas matrix fallback decoding
    const imageURL = URL.createObjectURL(selectedFile);
    const img = new Image();
    
    const loadedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片资源加载失败，这不是一份合法的图像文件。"));
      img.src = imageURL;
    });

    const result = await decodeAndDecryptFromPNG(loadedImage, effectivePassword, () => {});
    URL.revokeObjectURL(imageURL);
    
    const decryptedBlobURL = URL.createObjectURL(result.blob);
    return {
      sourceFileName: selectedFile.name,
      sourceFileSize: selectedFile.size,
      success: true,
      result,
      fileUrl: decryptedBlobURL
    };
  };

  // Run Batch Decryption
  const handleBatchDecrypt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (scannedQueue.length === 0) return;

    try {
      setIsDecrypting(true);
      setErrorMsg(null);
      
      // Clean previous Object URLs
      decryptedResults.forEach((r) => {
        if (r.fileUrl) {
          URL.revokeObjectURL(r.fileUrl);
        }
      });
      setDecryptedResults([]);

      const outputs: DecryptedItem[] = [];
      const totalCount = scannedQueue.length;

      for (let i = 0; i < totalCount; i++) {
        const scanned = scannedQueue[i];
        const statusPrefix = `[${i + 1}/${totalCount}] "${scanned.file.name}"`;
        setStepMessage(`${statusPrefix}: 预检中...`);
        setProgressPercent(Math.round((i / totalCount) * 100));

        try {
          const finished = await decryptQueueItem(scanned, password);
          outputs.push({
            id: `dec-${Date.now()}-${i}`,
            ...finished
          });
        } catch (itemErr: any) {
          console.error(`Failed to decrypt queue item ${i}:`, itemErr);
          const errStr = itemErr?.message || "";
          let reason = "画纸存在损坏，或像素在社交传输中被二次有损降质";
          if (errStr.includes("decrypt") || errStr.includes("key") || errStr.includes("密码") || errStr.includes("校验")) {
            reason = "密钥或解密密码口令不正确";
          }
          outputs.push({
            id: `dec-${Date.now()}-${i}`,
            sourceFileName: scanned.file.name,
            sourceFileSize: scanned.file.size,
            success: false,
            errorMsg: reason
          });
        }
      }

      setDecryptedResults(outputs);
      setProgressPercent(100);
      setStepMessage("批量还原完成！");

      const firstSuccess = outputs.find(o => o.success && o.fileUrl);
      if (firstSuccess) {
        const firstSuccessIndex = outputs.indexOf(firstSuccess);
        setActivePreviewIndex(firstSuccessIndex);
        if (autoFullScreen) {
          setIsFullScreenImage(true);
        }
      } else {
        setActivePreviewIndex(0);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "批量处理过程发生意外中断");
    } finally {
      setIsDecrypting(false);
    }
  };

  // Trigger auto decryption if possible when scannedQueue changes or single file is dropped
  const queueLengthRef = useRef(0);
  const passwordRef = useRef(password);
  useEffect(() => { passwordRef.current = password; }, [password]);

  useEffect(() => {
    if (scannedQueue.length > 0 && scannedQueue.length > queueLengthRef.current) {
        const addedCount = scannedQueue.length - queueLengthRef.current;
        queueLengthRef.current = scannedQueue.length;
        
        const newlyAdded = scannedQueue.slice(-addedCount);
        const needsPassword = newlyAdded.some(i => i.hasPassword === true);
        
        if (!needsPassword || passwordRef.current) {
            handleBatchDecrypt();
        }
    } else if (scannedQueue.length === 0) {
        queueLengthRef.current = 0;
    }
  }, [scannedQueue, decryptedResults.length]);

  // Overlay navigational state
  const prevPreview = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (activePreviewIndex > 0) setActivePreviewIndex(activePreviewIndex - 1);
  };
  
  const nextPreview = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (activePreviewIndex < decryptedResults.length - 1) setActivePreviewIndex(activePreviewIndex + 1);
  };
  
  useEffect(() => {
    if (!isFullScreenImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prevPreview();
      if (e.key === "ArrowRight") nextPreview();
      if (e.key === "Escape") setIsFullScreenImage(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullScreenImage, activePreviewIndex, decryptedResults.length]);

  // Helper computations matching active tabs (切换预览!)
  const activeDecryptedItem = decryptedResults[activePreviewIndex];
  const decryptedResult = activeDecryptedItem?.success && activeDecryptedItem.result ? activeDecryptedItem.result : null;
  const fileUrl = activeDecryptedItem?.success && activeDecryptedItem.fileUrl ? activeDecryptedItem.fileUrl : null;

  // Handle direct copying of decrypted file data with high compatibility
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
        if (blob.type === "image/png" && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob })
          ]);
          setCopyStatus("success");
        } else if (navigator.clipboard.write) {
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
          }
        }
      } else if (type.startsWith("video/")) {
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
          if (navigator.clipboard.writeText) {
            const reader = new FileReader();
            reader.onloadend = async () => {
              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(reader.result as string);
                  setCopyStatus("success");
                }
              } catch {
                setCopyStatus("error");
              }
            };
            reader.readAsDataURL(blob);
          }
        }
      } else {
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
              }
            } catch {
              setCopyStatus("error");
            }
          };
          reader.readAsDataURL(blob);
        }
      }
      setTimeout(() => setCopyStatus("idle"), 2500);
    } catch (err) {
      console.error("Copy failed:", err);
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
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const removeScannedItem = (index: number) => {
    setScannedQueue((prev) => prev.filter((_, i) => i !== index));
  };

  const resetAll = () => {
    setPassword("");
    setScannedQueue([]);
    
    decryptedResults.forEach((r) => {
      if (r.fileUrl) {
        URL.revokeObjectURL(r.fileUrl);
      }
    });
    setDecryptedResults([]);
    setErrorMsg(null);
    setProgressPercent(0);
    setStepMessage("");
    setActivePreviewIndex(0);
  };

  // Match visual preview component
  const renderPreviewElement = () => {
    if (!decryptedResult || !fileUrl) return null;
    const type = decryptedResult.type;

    if (decryptedResult.isImageSequenceToVideo || type === "video/sequence" || (type === "application/zip" && decryptedResult.comfyNodeMode)) {
      return (
        <div className="flex flex-col gap-2 p-1 bg-[#0d0f12] rounded-xl relative w-full">
          <ImageSequencePlayer
            zipBlob={decryptedResult.blob}
            fps={decryptedResult.fps || 30}
            hasAudio={decryptedResult.audioAttached}
            audioName={decryptedResult.originalAudioName}
            shouldBlur={shouldBlur}
          />
        </div>
      );
    }

    if (type.startsWith("image/")) {
      return (
        <div className="flex flex-col items-center justify-center p-2 border border-slate-100 bg-white shadow-sm rounded-xl relative group">
          <div className="relative overflow-hidden rounded-lg w-full flex justify-center">
            <img 
              src={fileUrl} 
              alt="解密后图像预览" 
              className={`max-h-[290px] w-auto object-contain cursor-zoom-in group-hover:opacity-95 transition-all duration-200 ${
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
              className="absolute bottom-2 right-2 p-1.5 bg-black/70 hover:bg-black/85 rounded-lg text-white transition-all text-[11px] flex items-center gap-1 shadow-md cursor-pointer"
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
            className={`w-full max-h-[290px] h-auto rounded bg-black transition-all duration-200 ${
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
        <div className="flex flex-col gap-3.5 p-4 border border-slate-150 bg-indigo-50/20 rounded-xl">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-100 text-indigo-600 rounded-2xl animate-pulse">
              <Music className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-indigo-700">音频载荷就绪</span>
              <span className="text-[10px] text-slate-400">可在浏览器直接收听或单独导出</span>
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
        <div className="flex flex-col items-center justify-center py-7 px-4 border border-dashed border-slate-200 bg-slate-50/50 rounded-xl">
          <FileText className="w-10 h-10 text-slate-400 mb-2" />
          <span className="text-xs font-semibold text-slate-700">特殊常规二进制文件，暂无视图预览</span>
          <span className="text-[10px] text-slate-400 mt-1">此类型（{type}）推荐您直接下载点击使用</span>
        </div>
      );
    }
  };

  // Pre-scanned files info summaries
  const anyNeedPassword = scannedQueue.some((item) => item.hasPassword === true);
  const allNoPassword = scannedQueue.length > 0 && scannedQueue.every((item) => item.hasPassword === false);

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in" id="decryptor-module">
      {decryptedResults.length === 0 ? (
        <form onSubmit={handleBatchDecrypt} className="flex flex-col gap-5">
          {/* Main Upload Dropzone area with multi-file support */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs sm:text-sm font-semibold text-slate-700">步骤 1：支持大番茄、Like、鸭子的浏览查看</span>
              {scannedQueue.length > 0 && (
                <button
                  type="button"
                  onClick={() => setScannedQueue([])}
                  className="text-[11px] text-rose-500 hover:text-rose-600 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  清空列表 ({scannedQueue.length}份)
                </button>
              )}
            </div>

            <div
              id="decrypt-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border border-dashed rounded-2xl py-4 px-6 sm:py-6 sm:px-12 w-full flex flex-col items-center justify-center cursor-pointer transition-all duration-300 min-h-[280px] xs:min-h-[350px] sm:min-h-[420px] md:min-h-[480px] h-[30vh] sm:h-[40vh] md:h-[45vh] max-h-[600px] ${
                isDragOver
                  ? "border-pink-500 bg-pink-50/40 shadow-[0_0_20px_rgba(236,72,153,0.1)] scale-[0.99]"
                  : "border-slate-200 hover:border-pink-400 hover:bg-slate-5/40"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="image/png"
                multiple
              />
              <div className="p-2 bg-pink-50 text-pink-500 rounded-xl mb-1.5 transition-transform duration-300 hover:scale-105">
                <FileLock2 className="w-5.5 h-5.5 animate-pulse" />
              </div>
              <p className="text-xs sm:text-sm font-bold text-slate-900 text-center">拖拽加密 PNG 图像到这里，或点击浏览本地文件</p>
              <p className="text-[10px] sm:text-xs text-slate-400 mt-1 text-center max-w-lg leading-normal">
                提示：像素隐写还原仅支持未经社交平台二次有损压缩（如微信直接发图）污染破坏的原始无损 PNG 图像
              </p>
              
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePasteFromClipboard();
                }}
                className="mt-2.5 px-3.5 py-1.5 bg-pink-50/80 hover:bg-pink-100 text-pink-700 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm border border-pink-200/40"
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

          {/* Render Pre-scanned Queues dynamically */}
          {scannedQueue.length > 0 && (
            <div className="bg-slate-50/50 border border-slate-200/40 rounded-2xl p-4 flex flex-col gap-2.5 max-h-[220px] overflow-y-auto">
              <span className="text-[11px] uppercase font-bold text-slate-400 font-mono tracking-wider">预扫入拼装序列 ({scannedQueue.length}) :</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {scannedQueue.map((item, index) => (
                  <div 
                    key={item.id} 
                    className="flex items-center justify-between p-2.5 bg-white border border-slate-150 rounded-xl relative overflow-hidden group hover:border-pink-300 transition-all duration-200"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="flex-shrink-0 p-1 bg-slate-50 rounded-lg">
                        <ImageIcon className="w-8 h-8 text-pink-400" />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-800 truncate" title={item.file.name}>
                          {item.file.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>大小: {formatSize(item.file.size)}</span>
                          {item.metadata ? (
                            <span className="text-indigo-600 font-bold">
                              • 内含: {item.metadata.name} ({formatSize(item.metadata.size)})
                            </span>
                          ) : (
                            <span className="text-amber-600 font-semibold">• 格式：Canvas</span>
                          )}
                          {item.hasPassword === true && (
                            <span className="text-[9px] bg-amber-50 text-amber-700 px-1 py-0.2 rounded border border-amber-200 font-mono font-bold shrink-0">需密钥</span>
                          )}
                          {item.hasPassword === false && (
                            <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1 py-0.2 rounded border border-emerald-200 font-mono font-bold shrink-0">免密</span>
                          )}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeScannedItem(index)}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-rose-50 rounded-lg transition-all ml-1 flex-shrink-0"
                      title="从列表中取消此份"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Password Section tailored for the Queue constraints */}
          {scannedQueue.length > 0 && (
            <div className="flex flex-col gap-3.5 bg-slate-50/50 p-4 sm:p-5 rounded-2xl border border-slate-200/40">
              <div className="flex items-center justify-between">
                <label className="text-xs sm:text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <span>步骤 2：设定解密密钥</span>
                  {allNoPassword && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full animate-pulse">
                      扫载检测：所选皆免密资产
                    </span>
                  )}
                  {anyNeedPassword && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                      提示：存在加密资产，请匹配密码
                    </span>
                  )}
                </label>
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-4 h-4" />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isDecrypting || allNoPassword}
                  placeholder={
                    allNoPassword
                      ? "所有扫入画底均为免密码公共混淆密作，无须填写"
                      : "请输入对应的解析密码口令。如不匹配，将导致提取校验异常。"
                  }
                  className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-base md:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/10 focus:border-pink-500 text-slate-900 font-mono transition-shadow duration-200 disabled:opacity-50 disabled:bg-slate-50"
                  id="decrypt-password-input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={allNoPassword}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 disabled:opacity-30"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Global error board */}
          {errorMsg && (
            <div className="bg-rose-500/5 border border-rose-500/10 p-4 rounded-2xl flex items-start gap-3 animate-fade-in">
              <ShieldAlert className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="text-xs sm:text-sm font-bold text-slate-950 leading-none">批量解密异常中止</span>
                <span className="text-[11px] sm:text-xs text-rose-600 leading-relaxed">{errorMsg}</span>
              </div>
            </div>
          )}

          {/* Trigger Request button & Loader */}
          {scannedQueue.length > 0 && (
            <div className="flex flex-col gap-3">
              {isDecrypting && (
                <div className="flex flex-col gap-2.5 border border-pink-100 bg-pink-50/20 p-4 rounded-2xl animate-fade-in mb-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-pink-600 font-semibold flex items-center gap-1.5 max-w-[85%] truncate">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-pink-500 flex-shrink-0" />
                      <span>{stepMessage}</span>
                    </span>
                    <span className="text-pink-600 font-mono font-bold flex-shrink-0">{progressPercent}%</span>
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
                  className="w-full py-3.5 bg-gradient-to-r from-pink-600 to-pink-700 hover:from-pink-700 hover:to-pink-800 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-pink-100/60 cursor-pointer transition-all duration-200 active:scale-[0.98]"
                >
                  🚀 建立沙盒并批量还原隐写 ({scannedQueue.length} 份加密画纸)
                </button>
              )}
            </div>
          )}
        </form>
      ) : (
        /* METRICS AND DECRYPTED BATCH SWITCH PREVIEW (支持切换预览) */
        <div className="flex flex-col gap-4 animate-fade-in" id="decrypt-success-result">
          {/* Header Reset bar and Action Buttons */}
          <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-3 flex-wrap gap-2 mb-1">
            <div className="flex items-center gap-2">
              {activeDecryptedItem && activeDecryptedItem.success && decryptedResult && (
                <>
                  <button
                    onClick={handleDownload}
                    className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center shadow-sm transition-colors cursor-pointer"
                    title="下载还原资产 (Download)"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <button
                    onClick={handleCopyDecryptedData}
                    disabled={decryptedResult.type.startsWith("video/")}
                    className="p-2 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-350 text-slate-700 rounded-xl flex items-center justify-center transition-colors border border-slate-200 cursor-pointer"
                    title={
                      copyStatus === "success" 
                        ? "已成功复制到剪贴板" 
                        : copyStatus === "error" 
                        ? "复制失败，浏览器不支持" 
                        : "复制媒体数据 (Copy)"
                    }
                  >
                    {copyStatus === "success" ? (
                      <ClipboardCheck className="w-4 h-4 text-emerald-600 animate-bounce" />
                    ) : copyStatus === "error" ? (
                      <Clipboard className="w-4 h-4 text-rose-500" />
                    ) : (
                      <Clipboard className="w-4 h-4" />
                    )}
                  </button>
                </>
              )}
            </div>
            
            <button
              onClick={resetAll}
              className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>重新载入</span>
            </button>
          </div>

          <div className="flex flex-col gap-4 w-full">
            {/* Main details visual dynamic display (now fully dominant across width) */}
            <div className="w-full flex flex-col gap-2">
              <span className="text-[11px] font-bold text-slate-400 font-mono tracking-wider uppercase">还原数据解析渲染及属性分析 :</span>
              <div className="bg-slate-50/30 border border-slate-150 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-5 min-h-[470px]">
                
                {/* Active items detailed preview and error messages block */}
                <div className="flex-1">
                  {activeDecryptedItem ? (
                    activeDecryptedItem.success && decryptedResult ? (
                      <div className="w-full h-full">
                        {/* Visual Preview box */}
                        <div className="w-full bg-slate-50 p-4 border border-slate-200/50 rounded-xl flex flex-col justify-center">
                          {renderPreviewElement()}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-center py-10 w-full">
                        <span className="p-3 bg-rose-50 text-rose-500 rounded-2xl mb-3">
                          <ShieldAlert className="w-6 h-6 animate-pulse" />
                        </span>
                        <span className="text-sm font-bold text-slate-800">该加密文件解析失败</span>
                        <p className="text-xs text-slate-400 mt-1.5 max-w-sm leading-normal">
                          失败原因：{activeDecryptedItem.errorMsg || "此文件可能在传输途中、社交平台或微信中被有损重新压缩或重采样（直接损坏底层像素精细隐写深度），或您输入的密码校验口令不一致！"}
                        </p>
                        <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl max-w-sm text-[11px] text-amber-700 text-left font-sans leading-relaxed">
                          💡 <b>如何避免：</b>请在微信等平台传输时务必以<b>「发送原图」</b>或打包成常规文件包收发，社交平台对非原图的强制格式重构和元数据剥离会使得像素隐写数据永久丢失。
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 py-10">
                      <span>请从下方列表选择一份文件预览其解密恢复产物</span>
                    </div>
                  )}
                </div>

                {/* Collapsible Selector Panel at the Bottom */}
                <div className="border-t border-slate-200/60 pt-3 mt-1">
                  <button
                    type="button"
                    onClick={() => setIsQueueExpanded(!isQueueExpanded)}
                    className="w-full flex items-center justify-between py-1 px-3 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/40 rounded-xl transition-all text-slate-600 hover:text-slate-900 group cursor-pointer"
                  >
                    <div className="flex items-center gap-2 flex-wrap text-left">
                      <span className="text-[11px] font-bold font-mono tracking-wider uppercase text-slate-400 group-hover:text-slate-700">
                        选择还原文件预览详情 ({decryptedResults.length}) :
                      </span>
                      <span className="text-[10px] bg-pink-100 text-pink-700 font-mono px-1.5 py-0.5 rounded-md font-semibold shrink-0">
                        当前选中: #{activePreviewIndex + 1} ({activeDecryptedItem?.success ? "✅ 还原成功" : "❌ 校验未通过"})
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium shrink-0">
                      <span>{isQueueExpanded ? "收起" : "展开详情列表"}</span>
                      {isQueueExpanded ? <ChevronUp className="w-4 h-4 text-slate-500 animate-fade-in" /> : <ChevronDown className="w-4 h-4 text-slate-500 animate-fade-in" />}
                    </div>
                  </button>

                  {isQueueExpanded && (
                    <div className="mt-3 bg-slate-50/10 border border-slate-150 rounded-2xl p-3 flex gap-2 overflow-x-auto scrollbar-thin animate-fade-in min-h-[90px]">
                      {decryptedResults.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActivePreviewIndex(index);
                          }}
                          className={`flex items-center gap-2.5 p-2 text-left border rounded-xl transition-all cursor-pointer w-[200px] flex-shrink-0 relative ${
                            activePreviewIndex === index
                              ? "border-pink-500 bg-pink-50/40 shadow-sm"
                              : "border-slate-150 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="p-1 rounded-lg bg-slate-50 flex-shrink-0">
                            {item.success && item.result ? (
                              item.result.type.startsWith("image/") ? (
                                <ImageIcon className="w-4 h-4 text-rose-400" />
                              ) : item.result.type.startsWith("audio/") ? (
                                <Music className="w-4 h-4 text-emerald-400" />
                              ) : item.result.type.startsWith("video/") ? (
                                <Video className="w-4 h-4 text-sky-400" />
                              ) : (
                                <FileText className="w-4 h-4 text-amber-400" />
                              )
                            ) : (
                              <ShieldAlert className="w-4 h-4 text-red-400" />
                            )}
                          </div>
                          
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-[11px] font-bold text-slate-900 truncate pr-2" title={item.success && item.result ? item.result.name : item.sourceFileName}>
                              {item.success && item.result ? item.result.name : item.sourceFileName}
                            </span>
                            {item.success && item.result ? (
                              <span className="text-[9px] text-emerald-600 font-mono font-semibold mt-0.5">
                                ✅ {formatSize(item.result.size)}
                              </span>
                            ) : (
                              <span className="text-[9px] text-rose-500 font-medium mt-0.5 block truncate">
                                ❌ 校验失败
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bottom Status bar for 一键解剖完成 with collapsible details */}
                <div className="border-t border-dashed border-slate-200/80 pt-3.5 flex flex-col gap-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-xl font-bold flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>一键解剖完成 ({decryptedResults.filter(r => r.success).length} 份就绪 / 共 {decryptedResults.length} 份)</span>
                      </span>

                      {activeDecryptedItem && activeDecryptedItem.success && decryptedResult && (
                        <button
                          type="button"
                          onClick={() => setIsMetadataExpanded(!isMetadataExpanded)}
                          className="py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200/60 rounded-xl text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <span>{isMetadataExpanded ? "收起明细 (Collapse Details)" : "查看数据明细 (Show Details)"}</span>
                          {isMetadataExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">SANDBOX_STATUS // SAFE_VERIFIED</span>
                  </div>

                  {isMetadataExpanded && activeDecryptedItem && activeDecryptedItem.success && decryptedResult && (
                    <div className="bg-white border border-slate-200/60 rounded-xl font-mono text-[11px] text-slate-650 p-3.5 flex flex-col gap-2 shadow-sm animate-fade-in">
                      <span className="text-[10px] font-bold text-slate-400 block font-mono border-b border-slate-100 pb-1.5 uppercase">EXTRACTED // 数据明细</span>
                      <div className="flex items-start justify-between gap-3 border-b border-slate-200/30 pb-2">
                        <span className="text-slate-400 shrink-0">文件名</span>
                        <span className="font-semibold text-slate-800 break-all text-right select-all">{decryptedResult.name}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-b border-slate-200/30 pb-2">
                        <span className="text-slate-400 shrink-0">媒体类型</span>
                        <span className="font-semibold text-indigo-600 truncate max-w-[240px]" title={decryptedResult.type}>{decryptedResult.type}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400 shrink-0">解出物理量</span>
                        <span className="font-bold text-emerald-600">{formatSize(decryptedResult.size)}</span>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* High-Fidelity Full-Screen Zoom Overlay Modal */}
      {isFullScreenImage && fileUrl && decryptedResult && createPortal(
        <div 
          className="fixed inset-0 z-[99999] bg-slate-950/95 backdrop-blur-xl flex flex-col justify-between items-center p-2 sm:p-6 overflow-hidden animate-fade-in text-white"
          onClick={() => setIsFullScreenImage(false)}
        >
          {/* Header Bar containing Controls */}
          <div className="w-full max-w-5xl flex items-center justify-between gap-2 z-10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1.5 md:gap-2.5 min-w-0">
              <div className="flex items-center gap-1.5 py-1 px-2.5 bg-white/5 border border-white/10 rounded-xl text-[10px] text-slate-300 font-mono tracking-wider shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse shrink-0"></span>
                <span className="font-bold sm:inline hidden">INCOGNITO VIEWER // 弹窗式图片浏览器</span>
                <span className="font-bold inline sm:hidden">隐身预览</span>
              </div>

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

              {(decryptedResult.type.startsWith("image/") || decryptedResult.type.startsWith("video/")) && (
                <div className="flex items-center bg-white/10 rounded-xl p-0.5 px-1 sm:px-1.5 gap-0.5 sm:gap-1 text-white border border-white/5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const idx = [50, 75, 100, 125, 150, 175, 200, 250, 300].indexOf(zoomLevel);
                      if (idx > 0) setZoomLevel([50, 75, 100, 125, 150, 175, 200, 250, 300][idx - 1]);
                    }}
                    className="p-1 hover:bg-white/10 rounded text-slate-300 hover:text-white cursor-pointer transition-colors"
                  >
                    <ZoomOut className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomLevel(100)}
                    className="px-1 text-[9px] sm:text-xs font-mono hover:bg-white/10 rounded text-slate-200 hover:text-white py-0.5 cursor-pointer transition-colors"
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
                  >
                    <ZoomIn className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleDownload}
                className="py-1 px-2 sm:py-1.5 sm:px-4 bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md flex items-center justify-center gap-1 cursor-pointer transition-all duration-200"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">立即下载</span>
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

          {/* Central viewport with scaling */}
          <div 
            className="flex-grow w-full max-w-none flex items-center justify-center overflow-hidden min-h-0 relative z-0 px-2 sm:px-8 py-2 gap-2 mt-2 sm:mt-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Prev Button */}
            <button
              onClick={prevPreview}
              disabled={activePreviewIndex <= 0}
              className={`absolute left-1 sm:left-4 z-20 p-2 sm:p-3 rounded-full transition-all shrink-0 ${
                activePreviewIndex <= 0 ? "opacity-0 cursor-default pointer-events-none" : "bg-black/30 hover:bg-black/60 text-white cursor-pointer shadow-lg backdrop-blur-sm border border-white/5"
              }`}
            >
              <ChevronLeft className="w-5 h-5 sm:w-8 sm:h-8" />
            </button>

            <div 
              className="transition-transform duration-200 ease-out flex items-center justify-center h-full w-full max-w-full overflow-hidden relative z-10"
              style={{ transform: `scale(${zoomLevel / 100})` }}
            >
              {decryptedResult.isImageSequenceToVideo || decryptedResult.type === "video/sequence" ? (
                <div className="w-full max-w-xl bg-slate-950 p-4 border border-white/10 rounded-2xl">
                  <ImageSequencePlayer
                    zipBlob={decryptedResult.blob}
                    fps={decryptedResult.fps || 30}
                    hasAudio={decryptedResult.audioAttached}
                    audioName={decryptedResult.originalAudioName}
                    shouldBlur={isBlurredFullScreen}
                  />
                </div>
              ) : decryptedResult.type.startsWith("image/") ? (
                <img 
                  src={fileUrl} 
                  alt="全屏渲染预览" 
                  referrerPolicy="no-referrer"
                  className={`w-auto h-auto max-w-full max-h-full rounded-xl sm:rounded-2xl object-contain shadow-2xl border border-white/5 transition-all duration-300 ${
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
                  className={`w-auto h-auto max-w-full max-h-full rounded-xl sm:rounded-2xl object-contain shadow-2xl border border-white/5 transition-all duration-300 ${
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
                </div>
              )}
            </div>

            {/* Next Button */}
            <button
              onClick={nextPreview}
              disabled={activePreviewIndex >= decryptedResults.length - 1}
              className={`absolute right-1 sm:right-4 z-20 p-2 sm:p-3 rounded-full transition-all shrink-0 ${
                activePreviewIndex >= decryptedResults.length - 1 ? "opacity-0 cursor-default pointer-events-none" : "bg-black/30 hover:bg-black/60 text-white cursor-pointer shadow-lg backdrop-blur-sm border border-white/5"
              }`}
            >
              <ChevronRight className="w-5 h-5 sm:w-8 sm:h-8" />
            </button>
          </div>

          {/* Bottom Info Panel */}
          <div 
            className="w-full max-w-md bg-slate-900/90 border border-slate-800 p-3 sm:p-4 rounded-2xl flex flex-col gap-1.5 shadow-2xl backdrop-blur-xl z-10" 
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 text-left">
              <div className="min-w-0 flex-1">
                <span className="text-slate-400 text-[9px] font-mono tracking-wider uppercase block font-sans">
                  FILE_METADATA // 媒体详情
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
