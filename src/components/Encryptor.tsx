import React, { useState, useRef, useEffect } from "react";
import { 
  Upload, FileText, Lock, Eye, EyeOff, Music, Video, Image as ImageIcon,
  Download, RefreshCw, CheckCircle, Shield, Sparkles, Clipboard, ClipboardCheck, 
  ClipboardPaste, Trash2, FolderArchive, FileCheck, Info, Film, Sliders, Volume2, Settings
} from "lucide-react";
import { encryptAndEncodeToPNG, scrambleImage } from "../utils/crypto";
import JSZip from "jszip";

export default function Encryptor() {
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteError, setPasteError] = useState("");

  const [stegMode, setStegMode] = useState<"like" | "scramble">("like");
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

  // Encryption states
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [stepMessage, setStepMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);

  // Batch output states
  interface EncryptedItem {
    id: string;
    originalName: string;
    originalSize: number;
    mimeType: string;
    dataUrl: string;
    width: number;
    height: number;
    payloadSize: number;
    success: boolean;
    errorMsg?: string;
  }
  const [encryptedResults, setEncryptedResults] = useState<EncryptedItem[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global listener for Ctrl+V
  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isTextInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      
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

      const inputFiles: File[] = [];

      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const clipboardFiles = e.clipboardData.files;
        for (let i = 0; i < clipboardFiles.length; i++) {
          const f = clipboardFiles[i];
          inputFiles.push(f);
        }
      } else if (e.clipboardData && e.clipboardData.items) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === "file") {
            const blob = item.getAsFile();
            if (blob) {
              let ext = item.type.split("/")[1] || "bin";
              if (ext.includes("+") || ext.length > 5) ext = "bin";
              const fileObj = new File([blob], `pasted_file_${Date.now()}_${i}.${ext}`, { type: item.type });
              inputFiles.push(fileObj);
            }
          }
        }
      }

      if (inputFiles.length > 0) {
        e.preventDefault();
        setFiles((prev) => [...prev, ...inputFiles]);
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, []);

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Determine file icon
  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith("image/")) {
      return <ImageIcon className="w-8 h-8 text-rose-400" id="file-icon-image" />;
    } else if (fileType.startsWith("audio/")) {
      return <Music className="w-8 h-8 text-emerald-400" id="file-icon-audio" />;
    } else if (fileType.startsWith("video/")) {
      return <Video className="w-8 h-8 text-sky-400" id="file-icon-video" />;
    } else {
      return <FileText className="w-8 h-8 text-amber-400" id="file-icon-generic" />;
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        droppedFiles.push(e.dataTransfer.files[i]);
      }
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles: File[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        selectedFiles.push(e.target.files[i]);
      }
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  };

  // Paste from clipboard helper by clicking button
  const handlePasteFromClipboard = async () => {
    try {
      setPasteError("");
      if (!navigator.clipboard || !navigator.clipboard.read) {
        throw new Error("Clipboard read API is not available/supported in this iframe browser sandbox context.");
      }
      const clipboardItems = await navigator.clipboard.read();
      const pastedFilesList: File[] = [];
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/") || type.startsWith("text/")) {
            const blob = await item.getType(type);
            let ext = type.split("/")[1] || "bin";
            if (ext.includes("+") || ext.length > 5) ext = "bin";
            const fileObj = new File([blob], `clipboard_file_${Date.now()}.${ext}`, { type });
            pastedFilesList.push(fileObj);
          }
        }
      }
      if (pastedFilesList.length > 0) {
        setFiles((prev) => [...prev, ...pastedFilesList]);
      } else {
        setPasteError("剪切板中未找到合适的文件。请复制任意文件或直接在页面上按键盘 Ctrl+V 快捷键进行粘贴。");
        setTimeout(() => setPasteError(""), 5000);
      }
    } catch (err: any) {
      console.error("Paste helper caught clipboard permission/execution error:", err);
      setPasteError("💡 浏览器原生剪贴板 API 读取受限。请您直接通过键盘快捷键【Ctrl+V】或【Cmd+V】在任意地方粘贴解析！已为您启用全局事件监听协助极速一键闪电处理。");
      setTimeout(() => setPasteError(""), 10000);
    }
  };

  // Password strength calculation
  const getPasswordStrength = () => {
    if (!password) return { label: "请输入密码", score: 0, color: "bg-zinc-800" };
    let score = 0;
    if (password.length >= 6) score++;
    if (/[a-zA-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[[^a-zA-Z0-9]/.test(password)) score++;
    
    if (score === 1) return { label: "低强度 (不建议)", score: 25, color: "bg-red-500" };
    if (score === 2) return { label: "中等强度", score: 50, color: "bg-amber-500" };
    if (score === 3) return { label: "高强度安全", score: 75, color: "bg-emerald-500" };
    return { label: "极度安全 (加固)", score: 100, color: "bg-teal-400" };
  };

  const strength = getPasswordStrength();

  // Execute batch encryption
  const handleBatchEncrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;

    try {
      setIsEncrypting(true);
      setEncryptedResults([]);
      
      const newResults: EncryptedItem[] = [];
      const totalFiles = files.length;
      
      for (let i = 0; i < totalFiles; i++) {
        const targetFile = files[i];
        const filePrefix = `[${i + 1}/${totalFiles}] "${targetFile.name}"`;
        
        try {
          let result;
          if (stegMode === "scramble") {
            if (!targetFile.type.startsWith("image/") && !targetFile.name.match(/\.(png|jpe?g|webp|bmp|gif)$/i)) {
              throw new Error("大番茄混淆图仅支持图片格式文件(如 PNG / JPG / BMP)！");
            }
            result = await scrambleImage(targetFile, (msg, percent) => {
              setStepMessage(`${filePrefix}: ${msg}`);
              const combinedPercent = Math.round((i / totalFiles) * 100 + (percent / totalFiles));
              setProgressPercent(combinedPercent);
            });
          } else {
            result = await encryptAndEncodeToPNG(targetFile, password, (msg, percent) => {
              setStepMessage(`${filePrefix}: ${msg}`);
              const combinedPercent = Math.round((i / totalFiles) * 100 + (percent / totalFiles));
              setProgressPercent(combinedPercent);
            });
          }
          
          newResults.push({
            id: `enc-${Date.now()}-${i}`,
            originalName: targetFile.name,
            originalSize: targetFile.size,
            mimeType: stegMode === "scramble" ? "image/scramble" : targetFile.type,
            dataUrl: result.dataUrl,
            width: result.width,
            height: result.height,
            payloadSize: result.payloadSize,
            success: true
          });
        } catch (fileErrObj: any) {
          console.error(`Failed to encrypt index ${i}:`, fileErrObj);
          newResults.push({
            id: `enc-${Date.now()}-${i}`,
            originalName: targetFile.name,
            originalSize: targetFile.size,
            mimeType: targetFile.type,
            dataUrl: "",
            width: 0,
            height: 0,
            payloadSize: 0,
            success: false,
            errorMsg: fileErrObj?.message || "底层 Canvas 映射或内存容量超载失效"
          });
        }
      }
      
      setEncryptedResults(newResults);
      setActivePreviewIndex(0);
      setProgressPercent(100);
      setStepMessage(`批量无损加密已全部处理完成！`);
    } catch (err: any) {
      alert("批量加密任务运行出现错误: " + (err as Error).message);
    } finally {
      setIsEncrypting(false);
    }
  };

  const handleCopyImageToClipboard = async (item: EncryptedItem) => {
    if (!item.success || !item.dataUrl) return;
    try {
      setCopyStatus("idle");
      const r = await fetch(item.dataUrl);
      const blob = await r.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);
      setCopyStatus("success");
      setTimeout(() => setCopyStatus("idle"), 2500);
    } catch (err) {
      console.error("Unable to copy image to clipboard:", err);
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 3500);
    }
  };

  // Download individual item
  const handleDownloadItem = async (item: EncryptedItem) => {
    if (!item.success || !item.dataUrl) return;
    try {
      const response = await fetch(item.dataUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const link = document.createElement("a");
      const nameWithoutExt = item.originalName.substring(0, item.originalName.lastIndexOf(".")) || item.originalName;
      link.download = `${nameWithoutExt}_secure.png`;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
    } catch (err) {
      console.warn("Blob conversion download failed, downloading base64 directly:", err);
      const link = document.createElement("a");
      const nameWithoutExt = item.originalName.substring(0, item.originalName.lastIndexOf(".")) || item.originalName;
      link.download = `${nameWithoutExt}_secure.png`;
      link.href = item.dataUrl;
      link.click();
    }
  };

  // Export all successfully encrypted items as a single ZIP package (一键批量导出)
  const handleExportAllZip = async () => {
    const successItems = encryptedResults.filter((r) => r.success);
    if (successItems.length === 0) return;
    
    setStepMessage("正在打包压缩文件中，请稍后...");
    setIsEncrypting(true);
    setProgressPercent(40);

    try {
      const zip = new JSZip();
      
      for (let i = 0; i < successItems.length; i++) {
        const item = successItems[i];
        const base64Content = item.dataUrl.split(",")[1];
        const originalNameWithoutExt = item.originalName.substring(0, item.originalName.lastIndexOf(".")) || item.originalName;
        const filename = `${originalNameWithoutExt}_secure.png`;
        
        zip.file(filename, base64Content, { base64: true });
        setProgressPercent(40 + Math.round((i / successItems.length) * 50));
      }
      
      const contentBlob = await zip.generateAsync({ type: "blob" });
      const blobUrl = URL.createObjectURL(contentBlob);
      
      const link = document.createElement("a");
      link.download = `like_confused_encrypted_pkg_${Date.now()}.zip`;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (zipErr) {
      console.error("ZIP creation failed:", zipErr);
      alert("批量打包输出 ZIP 失败，请使用单张下载功能。");
    } finally {
      setIsEncrypting(false);
      setProgressPercent(100);
      setStepMessage("");
    }
  };

  const handleExportAllPNG = async () => {
    const successItems = encryptedResults.filter((r) => r.success);
    if (successItems.length === 0) return;
    
    for (let i = 0; i < successItems.length; i++) {
        const item = successItems[i];
        try {
          const response = await fetch(item.dataUrl);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          
          const link = document.createElement("a");
          const nameWithoutExt = item.originalName.substring(0, item.originalName.lastIndexOf(".")) || item.originalName;
          link.download = `${nameWithoutExt}_secure.png`;
          link.href = blobUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
        } catch (err) {
          const link = document.createElement("a");
          const nameWithoutExt = item.originalName.substring(0, item.originalName.lastIndexOf(".")) || item.originalName;
          link.download = `${nameWithoutExt}_secure.png`;
          link.href = item.dataUrl;
          link.click();
        }
        await new Promise(r => setTimeout(r, 150));
    }
  };

  const removeFileAt = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const resetAll = () => {
    setFiles([]);
    setPassword("");
    setEncryptedResults([]);
    setProgressPercent(0);
    setStepMessage("");
    setActivePreviewIndex(0);
  };

  const activeEncryptedItem = encryptedResults[activePreviewIndex];

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in" id="encryptor-module">
      {/* Module Banner Title */}
      <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
        <span className="relative flex h-3 w-3 sm:hidden">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
        </span>
        <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 hidden sm:block">
          <Shield className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base sm:text-lg font-bold text-slate-950 font-display leading-tight">批量加密：媒体载荷离线像素隐写安全箱</h2>
          <p className="text-[11px] text-slate-400 mt-0.5 sm:block hidden">支持单文件或多文件合并批处理，全本地沙盒运算保护密文，杜绝任何云端上载泄露风险</p>
        </div>
      </div>

      {encryptedResults.length === 0 ? (
        <form onSubmit={handleBatchEncrypt} className="flex flex-col gap-5">
          {/* Main Upload Dropzone area with multi-file support */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs sm:text-sm font-semibold text-slate-700">步骤 1：导入需要附带隐写的文件 (批处理模式)</span>
              {files.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="text-[11px] text-rose-500 hover:text-rose-600 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  清空列表 ({files.length}个文件)
                </button>
              )}
            </div>

            <div
              id="dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border border-dashed rounded-2xl p-5 sm:p-10 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 min-h-[280px] xs:min-h-[350px] sm:min-h-[420px] md:min-h-[480px] h-[30vh] sm:h-[40vh] md:h-[45vh] max-h-[600px] ${
                isDragOver
                  ? "border-indigo-500 bg-indigo-50/40 shadow-[0_0_20px_rgba(99,102,241,0.1)] scale-[0.99]"
                  : "border-slate-200 hover:border-indigo-400 hover:bg-slate-5/40"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="image/*,audio/*,video/*,text/*,application/*"
                multiple
              />
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl mb-2.5 transition-transform duration-300 hover:scale-105">
                <Upload className="w-6 h-6 animate-pulse" />
              </div>
              <p className="text-xs sm:text-sm font-bold text-slate-900 text-center">拖动单个/多个文件到这里，或点击浏览本地文件</p>
              <p className="text-[10px] sm:text-xs text-slate-400 mt-1.5 text-center max-w-lg leading-normal">
                支持各类画图(JPG/PNG/GIF)、音频(MP3/WAV/AAC)、录像(MP4/MKV)和本地包文，可在单幅离线画纸完成高达 10-150MB 无损混淆
              </p>
              
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePasteFromClipboard();
                }}
                className="mt-3.5 px-3.5 py-1.5 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm border border-indigo-200/40"
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

          {/* Render File List visually when files are ready */}
          {files.length > 0 && (
            <div className="bg-slate-50/50 border border-slate-200/40 rounded-2xl p-4 flex flex-col gap-2.5 max-h-[220px] overflow-y-auto">
              <span className="text-[11px] uppercase font-bold text-slate-400 font-mono tracking-wider">已导入待混淆队列 ({files.length}) :</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {files.map((f, index) => (
                  <div 
                    key={`${f.name}-${index}`} 
                    className="flex items-center justify-between p-2.5 bg-white border border-slate-150 rounded-xl relative overflow-hidden group hover:border-indigo-300 transition-all duration-200"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="flex-shrink-0 p-1 bg-slate-50 rounded-lg">
                        {getFileIcon(f.type)}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-800 truncate" title={f.name}>
                          {f.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {formatSize(f.size)} • {f.type || "二进制或文本媒介"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFileAt(index)}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-rose-50 rounded-lg transition-all ml-1 flex-shrink-0"
                      title="移除此资产"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Password Setup Configuration */}
          {files.length > 0 && (
            <div className={`flex flex-col gap-3.5 bg-slate-50/50 p-4 sm:p-5 rounded-2xl border border-slate-200/40 transition-opacity ${stegMode === "scramble" ? "opacity-50" : ""}`}>
              <div className="flex flex-col gap-2">
                <label className="text-xs sm:text-sm font-semibold text-slate-800 flex items-center justify-between">
                  <span>步骤 2：设定解密口令 (批处理公用)</span>
                  <span className="text-[10px] sm:text-xs font-normal text-slate-400">
                    {stegMode === "scramble" ? "大番茄混淆图不支持密码加密" : "留空则为通用免密。所有文件将应用此统一密钥"}
                  </span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isEncrypting || stegMode === "scramble"}
                    placeholder={stegMode === "scramble" ? "大番茄混淆图无需密码" : "[可选密码] 输入相同的解密密码，保障机密完整隔离"}
                    className={`w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 text-slate-900 font-mono transition-shadow duration-200 ${stegMode === "scramble" ? "bg-slate-100 text-slate-400" : "bg-white"}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={stegMode === "scramble"}
                    className={`absolute right-3.5 top-1/2 -translate-y-1/2 cursor-pointer p-0.5 ${stegMode === "scramble" ? "text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password Strength display */}
              {password && (
                <div className="flex flex-col gap-1.5 animate-fade-in">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-medium font-sans">密码抗爆破强度评估:</span>
                    <span className={`font-bold font-mono ${
                      strength.score <= 25 ? "text-red-500" :
                      strength.score <= 50 ? "text-amber-500" :
                      strength.score <= 75 ? "text-emerald-500" : "text-teal-500"
                    }`}>
                      {strength.label}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-200/70 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${strength.color}`}
                      style={{ width: `${strength.score}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Output Steganography Option Selector (Step 3) */}
          {files.length > 0 && (
            <div className="flex flex-col gap-4 bg-indigo-50/10 p-4 sm:p-5 rounded-2xl border border-indigo-100/60 shadow-sm animate-fade-in" id="comfy-node-widget">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-indigo-950 border-b border-indigo-100/40 pb-2">
                <Settings className="w-4 h-4 text-indigo-500" />
                <span>步骤 3：选择封装输出物理材质 / 隐写图方向</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-1">
                {/* Option 1: Like Confused PNG */}
                <div
                  onClick={() => setStegMode("like")}
                  className={`flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 select-none ${
                    stegMode === "like"
                      ? "bg-indigo-500/5 border-indigo-500 shadow-sm animate-fade-in"
                      : "bg-white/80 border-slate-200/80 hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-xs sm:text-sm ${stegMode === "like" ? "text-indigo-600" : "text-slate-800"}`}>
                      🌸 Like混淆 (Standard LSB)
                    </span>
                    <input
                      type="radio"
                      name="stegMode"
                      checked={stegMode === "like"}
                      onChange={() => setStegMode("like")}
                      className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                    />
                  </div>
                  <p className="text-[10px] sm:text-xs text-slate-500 leading-relaxed font-sans">
                    标准 CSPNG100 结构混淆，将加密流混合于《戴珍珠耳环的少女》底纸，格式与主流解密端保持一贯契合。
                  </p>
                </div>

                {/* Option 3: Tomato Block Scramble (For Images Only) */}
                <div
                  onClick={() => setStegMode("scramble")}
                  className={`flex flex-col gap-2 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 select-none ${
                    stegMode === "scramble"
                      ? "bg-amber-500/5 border-amber-500 shadow-sm animate-fade-in"
                      : "bg-white/80 border-slate-200/80 hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`font-bold text-xs sm:text-sm ${stegMode === "scramble" ? "text-amber-600" : "text-slate-800"}`}>
                      🧩 大番茄混淆图
                    </span>
                    <input
                      type="radio"
                      name="stegMode"
                      checked={stegMode === "scramble"}
                      onChange={() => setStegMode("scramble")}
                      className="w-3.5 h-3.5 accent-amber-600 cursor-pointer"
                    />
                  </div>
                  <p className="text-[10px] sm:text-xs text-slate-500 leading-relaxed font-sans">
                    (仅限图片) 大番茄像素洗牌 (TomatoScramble) 视觉混淆算法。基于 Hilbert曲线+黄金比例。受轻微有损压缩影响小。完美满足安全图传需求。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Submit Triggers */}
          {files.length > 0 && (
            <div className="flex flex-col gap-3">
              {isEncrypting && (
                <div className="flex flex-col gap-2.5 border border-indigo-100 bg-indigo-50/20 p-4 rounded-2xl animate-fade-in mb-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-indigo-600 font-semibold flex items-center gap-1.5 max-w-[85%] truncate">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-indigo-500 flex-shrink-0" />
                      <span>{stepMessage}</span>
                    </span>
                    <span className="text-indigo-600 font-mono font-bold flex-shrink-0">{progressPercent}%</span>
                  </div>
                  <div className="h-2 w-full bg-indigo-150/40 rounded-full overflow-hidden relative">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-150 rounded-full"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}

              {!isEncrypting && (
                <button
                  type="submit"
                  className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-indigo-100/60 cursor-pointer transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-1.5"
                >
                  <Shield className="w-4 h-4" />
                  <span>开始批量无损加密 ({files.length} 个本地文件)</span>
                </button>
              )}
            </div>
          )}
        </form>
      ) : (
        /* METRICS AND BATCH RESULT PREVIEWER */
        <div className="flex flex-col gap-4 animate-fade-in" id="encrypt-result-node">
          {/* Output Control bar */}
          <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-3 flex-wrap gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-xl font-bold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>一键加密完成 ({encryptedResults.filter(r => r.success).length} / {encryptedResults.length})</span>
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportAllPNG}
                title="受浏览器安全策略限制，若导数量大可能被拦截"
                disabled={isEncrypting || encryptedResults.filter(r => r.success).length === 0}
                className="py-1.5 px-3 bg-white hover:bg-slate-50 disabled:opacity-50 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 shadow-sm cursor-pointer flex items-center gap-1.5 transition-colors hidden sm:flex"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>直接导出纯图</span>
              </button>
              <button
                onClick={handleExportAllZip}
                disabled={isEncrypting || encryptedResults.filter(r => r.success).length === 0}
                className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors"
              >
                <FolderArchive className="w-3.5 h-3.5" />
                <span>打ZIP包(推荐)</span>
              </button>
              <button
                onClick={resetAll}
                disabled={isEncrypting}
                className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>继续加密</span>
              </button>
            </div>
          </div>

          {/* Loader state in result screen if ZIP packaging is running */}
          {isEncrypting && (
            <div className="w-full bg-indigo-50/30 border border-indigo-100 p-3.5 rounded-2xl text-xs text-indigo-700 font-semibold animate-pulse flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 animate-spin text-indigo-500" />
                {stepMessage}
              </span>
              <span>{progressPercent}%</span>
            </div>
          )}

          {/* Grid setup mimicking "Switchable Preview" (切换预览) */}
          <div className="flex flex-col lg:flex-row gap-5 items-stretch">
            {/* Left Queue selection lists */}
            <div className="w-full lg:w-[350px] flex flex-col gap-2 flex-shrink-0">
              <span className="text-[11px] font-bold text-slate-400 font-mono tracking-wider">切换进行独立查看或单张保存 ({encryptedResults.length}):</span>
              <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto max-h-[360px] pb-2 lg:pb-0 scrollbar-thin">
                {encryptedResults.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActivePreviewIndex(idx)}
                    className={`flex items-center gap-3 p-3 text-left border rounded-xl transition-all flex-shrink-0 lg:flex-shrink w-[240px] lg:w-full cursor-pointer relative ${
                      activePreviewIndex === idx
                        ? "border-indigo-500 bg-indigo-50/40 shadow-sm"
                        : "border-slate-150 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <div className="p-1 rounded-lg bg-slate-50 flex-shrink-0">
                      {getFileIcon(item.mimeType)}
                    </div>
                    
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-bold text-slate-900 truncate pr-5" title={item.originalName}>
                        {item.originalName}
                      </span>
                      {item.success ? (
                        <span className="text-[10px] text-slate-400 mt-0.5 font-mono">
                          密图尺寸: {item.width} × {item.height}
                        </span>
                      ) : (
                        <span className="text-[10px] text-rose-500 mt-0.5 font-medium">
                          ❌ 加密失败: 超载或异常
                        </span>
                      )}
                    </div>
                    {item.success && (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all" onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadItem(item);
                      }} title="立即保存此份">
                        <Download className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right main dynamic display */}
            <div className="flex-1 bg-slate-50/30 border border-slate-150 rounded-2xl p-4 sm:p-5 flex flex-col justify-between self-stretch min-h-[380px]">
              {activeEncryptedItem && activeEncryptedItem.success ? (
                <div className="flex flex-col md:flex-row gap-5 items-stretch h-full">
                  {/* Image render node */}
                  <div className="flex-1 flex flex-col justify-center items-center p-4 bg-[#090b0d] border border-slate-900/60 rounded-xl relative overflow-hidden min-h-[220px]">
                    <div className="absolute top-2.5 left-2.5 text-[8px] text-slate-500 font-mono flex items-center gap-1 select-none">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>已混淆像素安全纸层</span>
                    </div>

                    <div className="absolute bottom-2.5 right-2.5 text-[8px] text-indigo-400 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                      {activeEncryptedItem.mimeType === "image/scramble" ? "HILBERT-1D" : "AES-255-GCM"}
                    </div>

                    <img
                      src={activeEncryptedItem.dataUrl}
                      alt="加密生成图"
                      referrerPolicy="no-referrer"
                      className="max-h-[190px] w-auto object-contain cursor-pointer select-text pointer-events-auto"
                      style={{ imageRendering: "pixelated" }}
                    />

                    <p className="text-[10px] text-slate-500 mt-3 font-mono">
                      画底分辨率: <span className="text-slate-300 font-bold">{activeEncryptedItem.width} × {activeEncryptedItem.height}</span> 像素
                    </p>
                  </div>

                  {/* Info details and guides */}
                  <div className="w-full md:w-[240px] flex flex-col justify-between flex-shrink-0 gap-3 text-xs">
                    <div className="flex flex-col gap-2.5">
                      <div className="bg-indigo-50/50 p-2.5 border border-indigo-100 rounded-lg">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide block">源文件名</span>
                        <span className="font-bold text-slate-800 truncate block mt-0.5" title={activeEncryptedItem.originalName}>
                          {activeEncryptedItem.originalName}
                        </span>
                      </div>

                      <div className="bg-indigo-50/50 p-2.5 border border-indigo-100 rounded-lg">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide block">
                          {activeEncryptedItem.mimeType === "image/scramble" ? "元素分辨率 / 块数" : "原始大小 / 载荷量"}
                        </span>
                        <span className="font-bold text-slate-800 block mt-0.5">
                          {activeEncryptedItem.mimeType === "image/scramble" 
                            ? `${activeEncryptedItem.width}x${activeEncryptedItem.height}  (${activeEncryptedItem.payloadSize} 块)`
                            : `${formatSize(activeEncryptedItem.originalSize)} / ${formatSize(activeEncryptedItem.payloadSize)}`
                          }
                        </span>
                      </div>

                      <div className="bg-indigo-50/50 p-2.5 border border-indigo-100 rounded-lg">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wide block">最终格式质地</span>
                        <span className="font-bold text-emerald-600 block mt-0.5">
                          {activeEncryptedItem.mimeType === "image/scramble" 
                            ? "无损置乱安全 PNG (无压缩)" 
                            : "24-Bit 无损像素 PNG"
                          }
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => handleDownloadItem(activeEncryptedItem)}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg flex items-center justify-center gap-1 shadow-sm transition-all text-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        下载此张无损画纸
                      </button>

                      {activeEncryptedItem.mimeType === "image/scramble" && (
                        <button
                          type="button"
                          onClick={() => handleCopyImageToClipboard(activeEncryptedItem)}
                          className={`w-full py-2 font-bold rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-all text-xs cursor-pointer ${
                            copyStatus === "success" ? "bg-emerald-600 text-white hover:bg-emerald-700" :
                            copyStatus === "error" ? "bg-red-600 text-white" : "bg-amber-500 hover:bg-amber-600 text-slate-950"
                          }`}
                        >
                          {copyStatus === "success" ? (
                            <>
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              <span>已成功复制到剪贴板！</span>
                            </>
                          ) : copyStatus === "error" ? (
                            <>
                              <Info className="w-3.5 h-3.5" />
                              <span>复制失败 (长按图片或右键复制)</span>
                            </>
                          ) : (
                            <>
                              <Clipboard className="w-3.5 h-3.5" />
                              <span>一键复制加密图片 (推荐)</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Info on mobile long press and disable manual clip */}
                      <p className="text-[10px] text-slate-400 bg-slate-50 border border-slate-100 p-2.5 rounded-lg leading-relaxed font-sans">
                        {activeEncryptedItem.mimeType === "image/scramble" ? (
                          <span>💡 <b>置乱优势：</b>分块置乱属于纯物理空间位置排序转换，完全不损坏图像颜色通道质地。因此<b>强烈推荐您使用上述一键复制功能</b>，直接到微信、QQ 聊天框中极速粘贴分享发送进行交流解密！</span>
                        ) : (
                          <span>💡 <b>提示：</b>操作系统剪贴板原生复制时将对像素矩阵进行<b>有损降位压缩</b>，因此常规隐写禁用一键复制。请使用单纸下载或直接一键打包 ZIP。移动端可通过<b>「长按左侧画纸」</b>保存！</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ) : activeEncryptedItem ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-10">
                  <span className="p-3 bg-rose-50 text-rose-500 rounded-2xl mb-3">
                    <Info className="w-6 h-6 animate-pulse" />
                  </span>
                  <span className="text-sm font-bold text-slate-800">该文件发生错误，混淆未通过</span>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm leading-normal">
                    异常原因：{activeEncryptedItem.errorMsg || "此媒体由于格式异常、内存溢出或像素超限，无法顺利嵌入隐写质地。"}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
                  <span>请从左侧列表选择一份文件预览其还原像素密图</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
