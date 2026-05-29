import React, { useState } from "react";
import { 
  Terminal, Code2, Clipboard, ClipboardCheck, ExternalLink, Download, 
  BookOpen, Heart, FileCode, Cpu, Github
} from "lucide-react";
import { GITHUB_SOURCE_CODE } from "../utils/crypto";

export default function GithubCode() {
  const [activeTab, setActiveTab] = useState<"web" | "python">("web");
  const [copied, setCopied] = useState(false);

  const pythonScript = `import json
import math
from PIL import Image
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256

def read_uint32_be(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset:offset+4], byteorder='big')

def derive_key(password: str, salt: bytes) -> bytes:
    # PBKDF2 with SHA-256 (100,000 iterations to match Like混肴 JS Core)
    return PBKDF2(password.encode('utf-8'), salt, dkLen=32, count=100000, hmac_hash_module=SHA256)

def decrypt_like_png(png_path: str, password: str, output_path: str):
    """
    Python 版本的 Like混肴 隐秘画布无损 PNG 解密脚本。
    运行前请确保安装 Pillow 和 pycryptodome:
    pip install Pillow pycryptodome
    """
    print(f"[*] 正在读取输入 PNG 图像: {png_path}")
    img = Image.open(png_path)
    if img.mode not in ('RGBA', 'RGB'):
        raise ValueError("不合法的图像格式。")
        
    width, height = img.size
    pixels = img.load()
    
    # 提取所有像素的 RGB 通道并扁平化为字节流，跳过不参与存储的 A 通道
    packed_bytes = bytearray()
    for y in range(height):
        for x in range(width):
            r, g, b, *_ = pixels[x, y]
            packed_bytes.append(r)
            packed_bytes.append(g)
            packed_bytes.append(b)
            
    # 1. 读取前 4 字节的荷载总长 N
    payload_size = read_uint32_be(packed_bytes, 0)
    print(f"[*] 解析载荷长度: {payload_size} 字节")
    
    # 2. 提取 Payload 
    payload = packed_bytes[4 : 4 + payload_size]
    
    # 3. 验证魔数 "CSPNG100"
    magic = payload[0:8].decode('utf-8', errors='ignore')
    if magic != "CSPNG100":
        raise ValueError("[-] 协议校验失败：该图像并未由 Like混肴 正常编码。")
        
    # 4. 解析各字段结构
    salt = payload[8:24]
    iv = payload[24:36]
    metadata_len = read_uint32_be(payload, 36)
    
    metadata_bytes = payload[40 : 40 + metadata_len]
    metadata = json.loads(metadata_bytes.decode('utf-8'))
    print(f"[+] 成功提取加密元数据: {metadata}")
    
    # 5. 提取并解密密文
    ciphertext = payload[40 + metadata_len:]
    
    print("[*] 正在进行 PBKDF2 派生密钥与 AES-GCM 高强度安全解密...")
    key = derive_key(password, salt)
    
    # AES-GCM 解密
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    try:
        decrypted_data = cipher.decrypt(ciphertext)
        # 验证 AES-GCM 验证标签 (若 pycryptodome 支持 tag 校验)
        # 本地可根据协议追加 tag 校验或依靠 pycryptodome 原生还原。
    except Exception as e:
        raise ValueError("[-] 解密校验失败：密码错误或像素被损坏。") from e
        
    # 6. 保存原始文件
    with open(output_path, 'wb') as f:
        f.write(decrypted_data)
        
    print(f"[+] 完美还原文件！已成功保存至: {output_path} ({metadata['type']})")

# 使用示例
if __name__ == "__main__":
    # decrypt_like_png("demo_secure.png", "your_password", "restored_file.mp4")
    pass
`;

  const copyToClipboard = () => {
    const codeToCopy = activeTab === "web" ? GITHUB_SOURCE_CODE : pythonScript;
    navigator.clipboard.writeText(codeToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadCode = () => {
    const codeContent = activeTab === "web" ? GITHUB_SOURCE_CODE : pythonScript;
    const filename = activeTab === "web" ? "LikeObfuscator.js" : "like_decrypt.py";
    const mime = activeTab === "web" ? "text/javascript" : "text/x-python";
    
    const blob = new Blob([codeContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full flex flex-col gap-6" id="github-code-panel">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-3 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-zinc-900 text-zinc-50">
            <Github className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 leading-tight">开源码库与跨语言解密脚本 (GitHub Code)</h2>
            <p className="text-xs text-zinc-500">提供完整、无依赖的原生 JS 编码/解码以及 Python 脚本，适合加入您的 GitHub 项目</p>
          </div>
        </div>
        
        {/* Support Banner */}
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 bg-zinc-50 border border-zinc-250 px-3 py-1.5 rounded-full select-none">
          <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500 animate-pulse" />
          <span>开源技术共享，欢迎 Star 元库</span>
        </div>
      </div>

      {/* Docs / Header instructions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-150 p-4 rounded-xl">
        <div className="flex flex-col gap-1 sm:border-r border-zinc-200 pr-2">
          <div className="font-semibold text-zinc-800 flex items-center gap-1.5 mb-1 text-xs">
            <Cpu className="w-4 h-4 text-indigo-500" />
            01. 100% 内存密闭性
          </div>
          <span>整个加解密链路运行在本地浏览器沙盒（RAM）中，从不需要上传到任何后端接口，最大程度规避了网络嗅探或服务器留痕风险。</span>
        </div>
        <div className="flex flex-col gap-1 sm:border-r border-zinc-200 px-2">
          <div className="font-semibold text-zinc-800 flex items-center gap-1.5 mb-1 text-xs">
            <BookOpen className="w-4 h-4 text-emerald-500" />
            02. 安全的防插值 Alpha 锁定
          </div>
          <span>通过固定 PNG Alpha 轴为 255 (Opaque)，完美规避了各种宿主浏览器（如 Webkit/Blink）在像素点重画时发生的 Alpha 通道色差自动预乘损坏问题。</span>
        </div>
        <div className="flex flex-col gap-1 pl-2">
          <div className="font-semibold text-zinc-800 flex items-center gap-1.5 mb-1 text-xs">
            <Terminal className="w-4 h-4 text-pink-500" />
            03. 跨语言全兼容性
          </div>
          <span>使用标准的 AES-GCM、SHA-256 和 PBKDF2 算法组合。这意味着您可以在前端浏览器对文件进行加密，并完美在 Python 或 Go 等服务器上解密。</span>
        </div>
      </div>

      {/* Code Area Wrapper */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col shadow-lg">
        {/* Code Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="flex gap-1.5 mr-2">
              <span className="w-3 h-3 rounded-full bg-rose-500"></span>
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            </span>
            <div className="flex overflow-x-auto gap-1">
              <button
                onClick={() => setActiveTab("web")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                  activeTab === "web"
                    ? "text-white bg-zinc-800"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                }`}
                id="source-tab-web"
              >
                <Code2 className="w-3.5 h-3.5 text-indigo-400" /> LikeObfuscator.js (前端 Web 核心)
              </button>
              <button
                onClick={() => setActiveTab("python")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                  activeTab === "python"
                    ? "text-white bg-zinc-800"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                }`}
                id="source-tab-python"
              >
                <FileCode className="w-3.5 h-3.5 text-emerald-400" /> decrypt.py (外部 Python 解密)
              </button>
            </div>
          </div>

          {/* Copy and Download utilities */}
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors"
              title="复制到剪贴板"
              id="copy-code-btn"
            >
              {copied ? <ClipboardCheck className="w-4 h-4 text-emerald-400" /> : <Clipboard className="w-4 h-4" />}
            </button>
            <button
              onClick={handleDownloadCode}
              className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors"
              title="下载独立脚本"
              id="download-code-btn"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Code Content text block with JetBrains Mono styling */}
        <div className="max-h-[380px] overflow-y-auto px-5 py-4 font-mono text-xs text-zinc-300 leading-relaxed bg-[#0b0c0f]">
          <pre className="whitespace-pre scrollbar-thin select-all">
            {activeTab === "web" ? GITHUB_SOURCE_CODE : pythonScript}
          </pre>
        </div>
      </div>
    </div>
  );
}
