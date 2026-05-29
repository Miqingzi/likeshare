import React, { useState, useRef } from "react";
import { 
  Upload, FileText, Lock, Eye, EyeOff, Music, Video, Image as ImageIcon,
  Download, RefreshCw, CheckCircle, Shield, Sparkles, Clipboard, ClipboardCheck, ClipboardPaste
} from "lucide-react";
import { encryptAndEncodeToPNG } from "../utils/crypto";

const girlPearlEarringAssetUrl = new URL("../assets/images/girl_pearl_earring_1780013307983.png", import.meta.url).href;

export default function Encryptor() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  
  // Clipboard states
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error" >("idle");
  const [pasteError, setPasteError] = useState("");

  // Encryption state
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [stepMessage, setStepMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  
  // Output state
  const [encryptedResult, setEncryptedResult] = useState<{
    dataUrl: string;
    width: number;
    height: number;
    payloadSize: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // File size formatter
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
      return <ImageIcon className="w-16 h-16 text-rose-400" id="file-icon-image" />;
    } else if (fileType.startsWith("audio/")) {
      return <Music className="w-16 h-16 text-emerald-400" id="file-icon-audio" />;
    } else if (fileType.startsWith("video/")) {
      return <Video className="w-16 h-16 text-sky-400" id="file-icon-video" />;
    } else {
      return <FileText className="w-16 h-16 text-amber-400" id="file-icon-generic" />;
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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  // Paste from clipboard helper
  const handlePasteFromClipboard = async () => {
    try {
      setPasteError("");
      if (!navigator.clipboard || !navigator.clipboard.read) {
        throw new Error("Clipboard read API is not available/supported in this iframe browser sandbox context.");
      }
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/") || type.startsWith("text/")) {
            const blob = await item.getType(type);
            let ext = type.split("/")[1] || "bin";
            if (ext.includes("+") || ext.length > 5) ext = "bin";
            const fileObj = new File([blob], `clipboard_file_${Date.now()}.${ext}`, { type });
            setFile(fileObj);
            return;
          }
        }
      }
      setPasteError("剪切板中未找到合适的文件。请复制任意文件或截图，再点击进行快捷导入。");
      setTimeout(() => setPasteError(""), 3500);
    } catch (err: any) {
      console.error("Paste helper caught clipboard permission/execution error:", err);
      const isPolicyBlocked = err?.message?.includes("permissions policy") || err?.name === "SecurityError" || (typeof window !== "undefined" && window.self !== window.top);
      if (isPolicyBlocked) {
        setPasteError("安全限制：剪贴板读取已被浏览器沙盒隔离，建议点击新窗口打开体验，或直接拖拽文件导入。");
      } else {
        setPasteError("读取剪切板出错：请检查是否授权相关权限或直接拖放文件。");
      }
      setTimeout(() => setPasteError(""), 5000);
    }
  };

  // Copy to clipboard helper
  const handleCopyToClipboard = async () => {
    if (!encryptedResult?.dataUrl) return;
    try {
      setCopyStatus("idle");
      if (!navigator.clipboard || !navigator.clipboard.write) {
        throw new Error("Clipboard write API is not available in this sandbox context.");
      }
      const res = await fetch(encryptedResult.dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob
        })
      ]);
      setCopyStatus("success");
      setTimeout(() => setCopyStatus("idle"), 2500);
    } catch (err: any) {
      console.warn("Clipboard Image Writing failed, falling back to writing DataURL text:", err);
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          throw new Error("writeText API is not available.");
        }
        await navigator.clipboard.writeText(encryptedResult.dataUrl);
        setCopyStatus("success");
        setTimeout(() => setCopyStatus("idle"), 2500);
      } catch (e: any) {
        console.error("Fallback text copy also blocked by browser policy:", e);
        setCopyStatus("error");
        setTimeout(() => setCopyStatus("idle"), 4000);
      }
    }
  };

  // Password strength calculation
  const getPasswordStrength = () => {
    if (!password) return { label: "请输入密码", score: 0, color: "bg-zinc-800" };
    let score = 0;
    if (password.length >= 6) score++;
    if (/[a-zA-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    
    if (score === 1) return { label: "低强度 (不建议)", score: 25, color: "bg-red-500" };
    if (score === 2) return { label: "中等强度", score: 50, color: "bg-amber-500" };
    if (score === 3) return { label: "高强度安全", score: 75, color: "bg-emerald-500" };
    return { label: "极度安全 (加固)", score: 100, color: "bg-teal-400" };
  };

  const strength = getPasswordStrength();

  // Execute encryption
  const handleEncrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    try {
      setIsEncrypting(true);
      setEncryptedResult(null);
      
      const result = await encryptAndEncodeToPNG(file, password, (msg, percent) => {
        setStepMessage(msg);
        setProgressPercent(percent);
      });
      
      setEncryptedResult(result);
    } catch (err) {
      alert("加密出现错误: " + (err as Error).message);
    } finally {
      setIsEncrypting(false);
    }
  };

  // Download trigger
  const handleDownload = () => {
    if (!encryptedResult || !file) return;
    const link = document.createElement("a");
    // Generate name suffix
    const originalNameWithoutExt = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    link.download = `${originalNameWithoutExt}_secure.png`;
    link.href = encryptedResult.dataUrl;
    link.click();
  };

  const resetAll = () => {
    setFile(null);
    setPassword("");
    setEncryptedResult(null);
    setProgressPercent(0);
    setStepMessage("");
  };

  return (
    <div className="w-full flex flex-col gap-6" id="encryptor-module">
      {/* Step Info */}
      <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
        <span className="relative flex h-3 w-3 sm:hidden">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
        </span>
        <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 hidden sm:block">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-950 font-display leading-tight">加密：将敏捷资产转化为高强度像素图</h2>
        </div>
      </div>

      {!encryptedResult ? (
        <form onSubmit={handleEncrypt} className="flex flex-col gap-6">
          {/* File Selector */}
          <div className="flex flex-col gap-2">
            <span className="text-xs sm:text-sm font-semibold text-slate-700">选择待加密媒体文件 (支持图片、音画、机密包)</span>
            {!file ? (
              <div className="flex flex-col gap-2 w-full">
                <div
                  id="dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border border-dashed rounded-2xl p-6 sm:p-12 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                    isDragOver
                      ? "border-indigo-500 bg-indigo-50/40 shadow-[0_0_20px_rgba(99,102,241,0.1)] scale-[0.99]"
                      : "border-slate-200 hover:border-indigo-400 hover:bg-slate-50/40"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/*,audio/*,video/*"
                  />
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl mb-3 transition-transform duration-300 hover:scale-105">
                    <Upload className="w-6 h-6 animate-pulse" />
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-slate-900 text-center">拖拽文件到这里，或点击浏览本地文件</p>
                  <p className="text-[10px] sm:text-xs text-slate-400 mt-2 text-center max-w-md leading-normal">
                    支持 JPG/PNG/GIF 画作、MP3/WAV 录音、MP4/MKV 视频（最大支持 ~100MB 极速吞吐）
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePasteFromClipboard();
                    }}
                    className="mt-4 px-4 py-2 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm border border-indigo-200/40"
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
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                <div className="flex items-center gap-3 pl-1 min-w-0 flex-1">
                  <div className="flex-shrink-0">
                    {getFileIcon(file.type)}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 truncate pr-4" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{formatSize(file.size)}</span>
                      <span>•</span>
                      <span className="truncate">{file.type || "二进制介质"}</span>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={isEncrypting}
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-rose-50 transition-colors mr-1 cursor-pointer disabled:opacity-40 flex-shrink-0"
                  id="cancel-file-btn"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Password Input & Strength */}
          {file && (
            <div className="flex flex-col gap-4 bg-slate-50/50 p-4 sm:p-5 rounded-2xl border border-slate-200/40">
              <div className="flex flex-col gap-2">
                <label className="text-xs sm:text-sm font-semibold text-slate-800 flex items-center justify-between">
                  <span>设定解密密码 (可选，不设密码则仅做本地混淆)</span>
                  <span className="text-[10px] sm:text-xs font-normal text-slate-400">解密时若不设密码也将不提示输入</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isEncrypting}
                    placeholder="[可选] 请输入安全/混淆密码。不设密码可直接开启混淆"
                    className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-base md:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 text-slate-900 font-mono transition-shadow duration-200"
                    id="encrypt-password-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
                    id="toggle-encrypt-pwd-btn"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password Strength Indicator */}
              {password && (
                <div className="flex flex-col gap-1.5 animate-fade-in">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-medium">密钥防暴力破解系数:</span>
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

          {/* Action Trigger / Progress */}
          {file && (
            <div className="flex flex-col gap-3">
              {isEncrypting && (
                <div className="flex flex-col gap-2.5 border border-indigo-100 bg-indigo-50/20 p-4 rounded-2xl animate-fade-in">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-indigo-600 font-semibold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                      {stepMessage}
                    </span>
                    <span className="text-indigo-600 font-mono font-bold">{progressPercent}%</span>
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
                  className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-lg shadow-indigo-100/60 cursor-pointer transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
                  id="start-encrypt-btn"
                >
                  本地像素混淆编码 (Encrypt)
                </button>
              )}
            </div>
          )}
        </form>
      ) : (
        /* SUCCESS RESULTS VIEW WITH TOP COMPACT ACTIONS BAR */
        <div className="flex flex-col gap-4 animate-fade-in" id="encrypt-result-node">
          {/* Top Actions Pill Bar */}
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap justify-start border-b border-dashed border-slate-100 pb-2.5" id="encrypt-top-actions">
            <button
              onClick={handleDownload}
              className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-100 flex items-center gap-1 cursor-pointer transition-colors"
              id="top-download-btn-enc"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载画纸</span>
            </button>
            <button
              onClick={handleCopyToClipboard}
              type="button"
              className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              {copyStatus === "success" ? (
                <>
                  <ClipboardCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>已复制</span>
                </>
              ) : copyStatus === "error" ? (
                <>
                  <Clipboard className="w-3.5 h-3.5 text-rose-500" />
                  <span>复制失败</span>
                </>
              ) : (
                <>
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>复制数据图</span>
                </>
              )}
            </button>
            <button
              onClick={resetAll}
              className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
              id="top-reset-btn-enc"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>继续加密</span>
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-6 items-stretch">
            {/* Visual Encrypted PNG Block Canvas Wrapper in Neo-Tech Frame */}
            <div className="flex-1 flex flex-col justify-center items-center p-5 bg-[#0d0f12] border border-slate-900/50 rounded-2xl relative overflow-hidden min-h-[280px]">
              {/* Retro Sci-fi Tech Bounds */}
              <div className="absolute top-3 left-3 text-[9px] text-slate-500 font-mono select-none flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
                <span>RENDER_ENGINE: PNG_CANVAS</span>
              </div>
              <div className="absolute bottom-3 right-3 text-[9px] text-indigo-400 font-mono bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-800 select-none">
                AES-255-GCM
              </div>
              
              {/* Visual Encrypted image pixel box */}
              <div className="relative group max-w-full my-4">
                <div className="absolute -inset-2 bg-indigo-500/10 rounded-xl blur-lg opacity-80 group-hover:opacity-100 transition duration-300"></div>
                <img
                  src={girlPearlEarringAssetUrl}
                  alt="加密生成图"
                  referrerPolicy="no-referrer"
                  className="relative rounded-lg shadow-2xl border border-slate-800 max-h-[220px] object-contain rendering-pixelated select-none"
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
              
              {/* Description */}
              <p className="text-slate-400 font-mono text-[10px] sm:text-xs mt-3 flex items-center gap-1 py-1 px-3 rounded-full bg-slate-900/60 border border-slate-800/80 select-none">
                画纸分辨率: <span className="text-white font-bold">{encryptedResult.width} × {encryptedResult.height}</span> 像素
              </p>
            </div>

            {/* Actions & Insights */}
            <div className="flex-1 flex flex-col justify-start gap-4 self-stretch">
              <div className="flex flex-col gap-3">
                {/* Simplified compact success banner to save space */}
                <div className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl flex items-center gap-2.5">
                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <div className="flex flex-row items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-950 font-display leading-none">本地像素加密顺利完成！</span>
                    <span className="text-[10px] text-slate-500 leading-none">密码经 PBKDF2 安全加固与像素打散。</span>
                  </div>
                </div>

                {/* Encrypted Details Cards */}
                <div className="grid grid-cols-2 gap-2.5 font-mono text-[11px] text-slate-600">
                  <div className="p-3 bg-slate-50/60 border border-slate-200/50 rounded-xl flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">原始文件</span>
                    <span className="font-bold text-slate-800 truncate" title={file?.name}>{file?.name}</span>
                  </div>
                  <div className="p-3 bg-slate-50/60 border border-slate-200/50 rounded-xl flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">输出类型</span>
                    <span className="font-bold text-indigo-600">Secure PNG</span>
                  </div>
                  <div className="p-3 bg-slate-50/60 border border-slate-200/50 rounded-xl flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">载荷长度</span>
                    <span className="font-bold text-slate-800">{formatSize(encryptedResult.payloadSize)}</span>
                  </div>
                  <div className="p-3 bg-slate-50/60 border border-slate-200/50 rounded-xl flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">加密像素数</span>
                    <span className="font-bold text-emerald-600">{(encryptedResult.width * encryptedResult.height).toLocaleString()} Px</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
