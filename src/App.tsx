/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { 
  ShieldCheck, ShieldAlert, Lock, Unlock, FileCode, Github, HelpCircle, 
  Grid, Globe, Radio, Sparkles, Layers, Cpu, ArrowRightLeft, FileLock2, Info, Settings,
  ChevronDown, ChevronUp, BookOpen, Scale
} from "lucide-react";
import Encryptor from "./components/Encryptor";
import Decryptor from "./components/Decryptor";
import GithubCode from "./components/GithubCode";

export default function App() {
  const [activeTab, setActiveTab] = useState<"decrypt" | "encrypt">("decrypt");
  const [shouldBlur, setShouldBlur] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  const [openedMajors, setOpenedMajors] = useState<Record<string, boolean>>({
    protocols: false,
    safety: false,
    opensource: false,
    disclaimer: false
  });

  const [openedMinors, setOpenedMinors] = useState<Record<string, boolean>>({
    step1: false,
    step2: false,
    step3: false,
    step4: false,
    warning: false,
    githubCode: false,
    legalText: false
  });

  const toggleMajor = (key: string) => {
    setOpenedMajors((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const toggleMinor = (key: string) => {
    setOpenedMinors((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return (
    <div 
      className="min-h-screen text-slate-800 font-sans relative overflow-hidden flex flex-col justify-between selection:bg-indigo-500/15 selection:text-indigo-950 pb-8 bg-[#fbfcfd]"
    >
      {/* LobeHub style Ambient Glow Orbs */}
      <div className="absolute top-[10%] left-[-10%] w-[45vw] h-[45vw] bg-indigo-400/10 glow-orb"></div>
      <div className="absolute top-[60%] right-[-10%] w-[50vw] h-[50vw] bg-sky-400/10 glow-orb"></div>
      <div className="absolute top-[20%] right-[15%] w-[35vw] h-[35vw] bg-pink-400/5 glow-orb"></div>

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f080_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f080_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_70%)] pointer-events-none opacity-40 z-0"></div>

      {/* Main Container */}
      <div className={`w-full max-w-5xl mx-auto px-3.5 sm:px-6 relative z-10 flex-grow pt-2 sm:pt-8 animate-fade-in transition-all duration-350 ease-in-out ${
        isOverlayOpen ? "blur-md brightness-75 pointer-events-none scale-[0.985]" : ""
      }`}>
        


        {/* Hero Brand Section & Custom Settings Header Layout */}
        <div className="flex flex-row justify-between items-center sm:items-start gap-4 mb-4 sm:mb-8 mt-1 sm:mt-2 px-1 relative">
          {/* Brand Left */}
          <div className="flex flex-col gap-1 sm:gap-2 flex-grow min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold font-mono bg-indigo-50 text-indigo-600 border border-indigo-100/60 shadow-sm">
                <Sparkles className="w-2.5 h-2.5" />
                V1.0.0 Release
              </span>
              <span className="hidden sm:inline text-[10px] text-slate-400">• 纯本地沙盒模式</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-xl sm:text-3xl font-black tracking-tight text-slate-950 font-display flex items-center flex-wrap gap-x-2 gap-y-0.5">
                <span className="bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-700 bg-clip-text text-transparent">
                  Like混肴
                </span>
                <span className="text-[11px] sm:text-sm font-normal text-slate-400 tracking-normal">
                  / 纯本地运行，免云端。
                </span>
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-500 max-w-3xl leading-relaxed hidden xs:block">
                通过本地将图像、音频、视频等转换为PNG格式图像进行压缩。
              </p>
            </div>
          </div>

          {/* Settings Right (移植为整个网页的右上角) */}
          <div className="relative flex-shrink-0 self-center sm:self-start">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="py-1 px-2 sm:p-2 text-slate-600 hover:text-pink-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer flex items-center gap-1 text-[11px] sm:text-xs font-semibold border border-slate-200/80 shadow-sm bg-white"
              title="自定义设置"
              id="global-settings-trigger-btn"
            >
              <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-500 animate-[spin_5s_linear_infinite]" />
              <span>自定义设置</span>
            </button>

            {isSettingsOpen && (
              <div className="absolute right-0 top-10 sm:top-11 z-[30] min-w-[240px] bg-white border border-slate-200 rounded-2xl shadow-xl p-4 animate-fade-in flex flex-col gap-3">
                <span className="text-xs font-bold text-slate-800 tracking-wider uppercase flex items-center gap-1">
                  <Settings className="w-3.5 h-3.5 text-pink-500" />
                  解码偏好配置
                </span>
                <label className="flex items-center gap-2.5 p-2 bg-slate-50 hover:bg-slate-100/70 rounded-xl cursor-pointer transition-colors text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={shouldBlur}
                    onChange={(e) => setShouldBlur(e.target.checked)}
                    className="w-4 h-4 text-pink-600 focus:ring-pink-500 border-slate-300 rounded"
                    id="should-blur-global-input"
                  />
                  <span>将解密后的图片/视频进行模糊</span>
                </label>
                <div className="text-[10px] text-slate-400 leading-normal pl-1 border-t border-slate-100 pt-2">
                  提示：开启此项后，解密完成时文件预览及全屏状态将默认叠加高斯模糊滤镜。
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Primary Tab Navigation Controller (LobeHub Segmented Control Style) */}
        <div className="bg-slate-100/80 backdrop-blur-md p-1 rounded-2xl border border-slate-250/30 shadow-inner grid grid-cols-2 gap-1 mb-6 max-w-md">
          <button
            onClick={() => setActiveTab("decrypt")}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-1 sm:px-3 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
              activeTab === "decrypt"
                ? "bg-white text-pink-600 shadow-md border border-slate-200/30 scale-[1.01]"
                : "text-slate-500 hover:text-slate-900 hover:bg-white/40"
            }`}
            id="tab-btn-decrypt"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span className="truncate">本地解密</span>
          </button>

          <button
            onClick={() => setActiveTab("encrypt")}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-1 sm:px-3 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
              activeTab === "encrypt"
                ? "bg-white text-indigo-600 shadow-md border border-slate-200/30 scale-[1.01]"
                : "text-slate-500 hover:text-slate-900 hover:bg-white/40"
            }`}
            id="tab-btn-encrypt"
          >
            <Lock className="w-3.5 h-3.5" />
            <span className="truncate">本地加密</span>
          </button>
        </div>

        {/* Dynamic Inner Panel Card (Glassmorphism ultra effect) */}
        <div className="bg-white/70 text-slate-800 rounded-3xl p-4 sm:p-7 shadow-xl border border-white/90 flex flex-col gap-6 relative backdrop-blur-xl animate-fade-in" id="main-content-canvas">
          
          {/* Active component renderer */}
          {activeTab === "decrypt" && (
            <Decryptor 
              shouldBlur={shouldBlur} 
              onFullScreenToggle={(open) => setIsOverlayOpen(open)} 
            />
          )}
          {activeTab === "encrypt" && <Encryptor />}

        </div>

        {/* Collapsible Documentations and Tools Area (大分类/小分类全部折叠) */}
        <div className="mt-8 flex flex-col gap-4" id="bottom-collapsible-docs">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5 px-1">
            <Layers className="w-3.5 h-3.5" />
            <span>核心技术白皮书 & 协议指南</span>
          </div>

          {/* MAJOR CATEGORY 1: 操作原理与加密协议 */}
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-3xl overflow-hidden shadow-sm transition-all duration-200">
            <button
              onClick={() => toggleMajor("protocols")}
              className="w-full flex items-center justify-between p-5 text-left font-display hover:bg-slate-50/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-pink-50 text-pink-600">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">操作原理与加密协议</h3>
                  <p className="text-[10px] text-slate-400">了解像RGBA像素重组、AES-GCM 高强度封装步骤 (含4个子步骤)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-50 text-pink-600 font-mono font-medium">4项折叠</span>
                {openedMajors.protocols ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>
            </button>

            {openedMajors.protocols && (
              <div className="border-t border-slate-105 bg-slate-50/40 p-4 flex flex-col gap-3 animate-fade-in">
                {/* SUB CATEGORIES (MINOR COLLAPSIBLES) */}
                {/* Minor item 1 */}
                <div className="bg-white border border-slate-200/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleMinor("step1")}
                    className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 font-mono font-bold">STEP 01</span>
                      <span>无缝一键像素提取</span>
                    </div>
                    {openedMinors.step1 ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {openedMinors.step1 && (
                    <div className="p-3.5 pt-0 text-[11px] text-slate-500 leading-relaxed border-t border-slate-150/40 bg-slate-50/30">
                      将生成的标准无损 PNG 塞入解密窗并安全输入密码，核心解密模块会在物理层面毫秒级拼归原位。
                    </div>
                  )}
                </div>

                {/* Minor item 2 */}
                <div className="bg-white border border-slate-200/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleMinor("step2")}
                    className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 font-mono font-bold">STEP 02</span>
                      <span>渲染无损像素画布</span>
                    </div>
                    {openedMinors.step2 ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {openedMinors.step2 && (
                    <div className="p-3.5 pt-0 text-[11px] text-slate-500 leading-relaxed border-t border-slate-150/40 bg-slate-50/30">
                      像素点 RGBA 高速重组，采用无插值无失真渲染机制，锁死 Alpha 轴确保不牺牲任一通道，避免边缘溢出损坏字节。
                    </div>
                  )}
                </div>

                {/* Minor item 3 */}
                <div className="bg-white border border-slate-200/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleMinor("step3")}
                    className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-mono font-bold">STEP 03</span>
                      <span>选择任意机密文件</span>
                    </div>
                    {openedMinors.step3 ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {openedMinors.step3 && (
                    <div className="p-3.5 pt-0 text-[11px] text-slate-500 leading-relaxed border-t border-slate-150/40 bg-slate-50/30">
                      支持上传您的私人图片、音效录音或视频剪包（建议限制在 100MB 范围内，以获得极速极客处理体验）。
                    </div>
                  )}
                </div>

                {/* Minor item 4 */}
                <div className="bg-white border border-slate-200/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleMinor("step4")}
                    className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-mono font-bold">STEP 04</span>
                      <span>强保护派生密码</span>
                    </div>
                    {openedMinors.step4 ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {openedMinors.step4 && (
                    <div className="p-3.5 pt-0 text-[11px] text-slate-500 leading-relaxed border-t border-slate-150/40 bg-slate-50/30">
                      通过 PBKDF2 提取独创高频随机盐派生密文密钥（进行高频哈希迭代），并配合工业级别顶级 AES-GCM 安全算法锁死文件入口。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* MAJOR CATEGORY 2: 传输避坑与警告 */}
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-3xl overflow-hidden shadow-sm transition-all duration-200">
            <button
              onClick={() => toggleMajor("safety")}
              className="w-full flex items-center justify-between p-5 text-left font-display hover:bg-slate-50/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-amber-50 text-amber-600">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">传输避坑与安全规范</h3>
                  <p className="text-[10px] text-slate-400">了解跨社交平台、网盘传输的最佳无损原图姿势 (含1个子步骤)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-mono font-medium">1项折叠</span>
                {openedMajors.safety ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>
            </button>

            {openedMajors.safety && (
              <div className="border-t border-slate-100 bg-slate-50/40 p-4 flex flex-col gap-3 animate-fade-in">
                {/* Minor item 1 */}
                <div className="bg-white border border-slate-200/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleMinor("warning")}
                    className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-750 font-mono font-bold">IMPORTANT</span>
                      <span>社交软件无损/原图机制说明</span>
                    </div>
                    {openedMinors.warning ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {openedMinors.warning && (
                    <div className="p-3.5 pt-0 text-[11px] text-slate-500 leading-relaxed border-t border-slate-150/40 bg-slate-50/30">
                      <span className="text-slate-800 font-semibold block mb-1">跨平台传输安全细节:</span>
                      Like混肴 会在底层像素写入无插值二进制有效荷载。然而，如微信、QQ、网盘、微博、各种社交宿主软件在直接发送单张普通图片时，通常会有全画幅色深压缩、尺寸甚至还会强转 JPG，瞬间导致信息彻底丢失。请发送时务必：<b className="text-indigo-600">勾选「发送原图」</b> 或直接 <b className="text-slate-800">以 ZIP 压缩包的形式</b> 安全传输。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* MAJOR CATEGORY 3: 底层开发代码及跨宿实现 */}
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-3xl overflow-hidden shadow-sm transition-all duration-200">
            <button
              onClick={() => toggleMajor("opensource")}
              className="w-full flex items-center justify-between p-5 text-left font-display hover:bg-slate-50/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-zinc-900 text-zinc-50">
                  <FileCode className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">开源协议与自提代码</h3>
                  <p className="text-[10px] text-slate-400">获取原生 JS 库以及一键离线 Python 运行解密脚本 (含1个子步骤)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-900 text-zinc-50 font-mono font-medium">1项折叠</span>
                {openedMajors.opensource ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>
            </button>

            {openedMajors.opensource && (
              <div className="border-t border-slate-100 bg-slate-50/40 p-4 flex flex-col gap-3 animate-fade-in">
                {/* Minor item 1 */}
                <div className="bg-white border border-slate-200/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleMinor("githubCode")}
                    className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 font-mono font-bold font-sans">CODE</span>
                      <span>完整原生 JS / Python 语言离线解码脚本</span>
                    </div>
                    {openedMinors.githubCode ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {openedMinors.githubCode && (
                    <div className="p-4 border-t border-slate-150/40 bg-white">
                      <GithubCode />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* MAJOR CATEGORY 4: 法律声明 & 免责条款 (Legal & Liability Disclaimer) */}
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-3xl overflow-hidden shadow-sm transition-all duration-200">
            <button
              onClick={() => toggleMajor("disclaimer")}
              className="w-full flex items-center justify-between p-5 text-left font-display hover:bg-slate-50/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-slate-100 text-slate-700">
                  <Scale className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">开源公用法律声明</h3>
                  <p className="text-[10px] text-slate-400">查看关于本公开工具的软件开源公用属性、技术无害及免责条款 (含1个子步骤)</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono font-medium">1项折叠</span>
                {openedMajors.disclaimer ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </div>
            </button>

            {openedMajors.disclaimer && (
              <div className="border-t border-slate-100 bg-slate-50/40 p-4 flex flex-col gap-3 animate-fade-in">
                {/* Minor item 1 */}
                <div className="bg-white border border-slate-200/50 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => toggleMinor("legalText")}
                    className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-650 font-mono font-bold">DISCLAIMER</span>
                      <span>开源协议限制与无责声明书 (Agreement & Disclaimer)</span>
                    </div>
                    {openedMinors.legalText ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    )}
                  </button>
                  {openedMinors.legalText && (
                    <div className="p-4 border-t border-slate-150/40 bg-slate-50/30 text-[11px] text-slate-500 leading-relaxed flex flex-col gap-3 font-sans">
                      <div>
                        <span className="text-slate-800 font-bold block mb-1">一、 公共属性与开源学术宗旨</span>
                        本工具（「Like混肴」）完全基于标准 MIT / Apache-2.0 开源协议进行公开托管与公用技术分发。核心资产渲染、RGBA 像素重新排布、PBKDF2 基础密钥推导及 AES-GCM 工业级加解密体系均 100% 部署并运行于用户的本地客户端宿主，不涉及任何云端服务器交互、不存储亦不收集任何用户隐私数据。本项目旨在对无插值图像隐写（Steganography）、高复原度媒体转码、跨宿主数据无损容错性进行纯前端学术探讨。
                      </div>
                      <div className="border-t border-slate-200 pt-2.5">
                        <span className="text-slate-800 font-bold block mb-1">二、 行为约束与完全免责声明</span>
                        本站所提供的所有解密/加密等源代码与应用均为免费、开源、面向公众的工具性服务。由于混淆结果文件的传播渠道与使用场景由分发行为主体独立控制，开发者（或软件著作权利人）在此明确声明：
                        <ul className="list-disc pl-4 mt-1 flex flex-col gap-1">
                          <li><b>不对</b> 用户利用本工具对任何受知识产权、商业秘密或相关权益保护的文件进行加密、传输、破解或复原的行为承担任何形式的合规担保、连带赔偿或法律责任。</li>
                          <li><b>不对</b> 传输链路中由于第三方软件（如社交平台、网络云盘等）有损像素裁剪、色彩饱和压缩、拉伸破坏导致的密文无法解密或解密失真等技术障碍负责。</li>
                          <li>该软件是“按原样（As Is）”提供的，没有任何形式的保修。在任何情况下，对于因使用或无法使用本软件而产生的任何直接或间接的追偿诉讼或精神索赔，开发者一概免于追责。</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Humble Footer */}
      <footer className="w-full text-center py-6 text-slate-400 text-xs font-mono mt-12 z-10 border-t border-slate-200/45 px-4">
        <p>© 2026 Like混肴 Safe Studio. Highly Secure Front-End Application.</p>
        <p className="mt-1 text-[11px] text-slate-400/80">Refined LobeHub Visual System • No Server Overhead • 100% Secure.</p>
      </footer>
    </div>
  );
}
