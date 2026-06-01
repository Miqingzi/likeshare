/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Canvas Safe Crypto Utility (Canvas 媒体文件加解密核心算法)
 * 这是一个完全运行在浏览器本地、无任何外部依赖的音视频及图片像素级 Canvas 加解密工具。
 * 
 * 编码协议 (Byte Level Protocol):
 * ----------------------------------------------------------------------------------------------------------------
 * |   前4字节: 载荷总长度 N (Big-Endian UInt32)                                                                     |
 * ----------------------------------------------------------------------------------------------------------------
 * |   数据载荷 (Payload, 长度为 N) :                                                                              |
 * |   - 0~7 字节  : 魔法字头 (Magic Header) -> "CSPNG100" (8字节)                                                    |
 * |   - 8~23 字节 : 密码盐值 (Salt) -> 16字节 (用于 PBKDF2 密匙派生)                                                |
 * |   - 24~35 字节: 初始向量 (IV) -> 12字节 (用于 AES-GCM 加密)                                                     |
 * |   - 36~39 字节: 元数据长度 M (Big-Endian UInt32)                                                               |
 * |   - 40 ~ 40+M-1 字节: 元数据 UTF-8 字符串 JSON (包含原始文件名、MIME类型、原文件大小)                            |
 * |   - 剩余字节  : AES-GCM 256 加密后的密文数据 (Ciphertext)                                                        |
 * ----------------------------------------------------------------------------------------------------------------
 * 
 * 之后，将整个 `4 + N` 长度的字节流，按每 3 字节作为一个像素的 R、G、B 值，A 通道固定设为 255（不透明），
 * 绘制于 Canvas 上，再导出为无损 PNG 图像。固定 A=255 可以完美规避浏览器在读取 Canvas 像素时对
 * Alpha 通道进行预乘（Premultiplication）进而损坏原始二进制数据的可能。
 */

import { EncryptedMetadata, DecryptedFile } from "../types";

// 将 Uint8Array 转换为 Big-endian 32位无符号整数
function writeUInt32BE(arr: Uint8Array, offset: number, value: number) {
  arr[offset] = (value >>> 24) & 0xff;
  arr[offset + 1] = (value >>> 16) & 0xff;
  arr[offset + 2] = (value >>> 8) & 0xff;
  arr[offset + 3] = value & 0xff;
}

// 从 Uint8Array 中读取 Big-endian 32位无符号整数
function readUInt32BE(arr: Uint8Array, offset: number): number {
  return (
    (arr[offset] << 24) |
    (arr[offset + 1] << 16) |
    (arr[offset + 2] << 8) |
    arr[offset + 3]
  ) >>> 0;
}

// 派生 AES-GCM 密钥
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  
  // 导入原始密码为 KeyMaterial
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  
  // 使用 PBKDF2 与 100,000 次 SHA-256 迭代派生 256 位 AES-GCM 密钥
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 加密一个 File，并将其转换为携带有加密信息的无损 PNG 图像的 DataURL
 * @param file 待加密的文件
 * @param password 用户设置的密码
 * @param onProgress 进度回调
 */
export async function encryptAndEncodeToPNG(
  file: File,
  password: string,
  onProgress?: (step: string, percent: number) => void,
  extraMeta?: Partial<EncryptedMetadata>
): Promise<{ dataUrl: string; width: number; height: number; payloadSize: number }> {
  onProgress?.("正在读取原始文件数据...", 10);
  const fileBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(fileBuffer);
  
  const hasPassword = !!password;
  let salt = new Uint8Array(16);
  let iv = new Uint8Array(12);
  let ciphertext: Uint8Array;

  if (hasPassword) {
    onProgress?.("生成加密安全随机盐值与向量...", 25);
    // 生成 16 字节 Salt
    salt = window.crypto.getRandomValues(new Uint8Array(16));
    // 生成 12 字节 IV
    iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    onProgress?.("正在导出密钥与执行高强度加密 (AES-GCM-256)...", 40);
    const key = await deriveKey(password, salt);
    
    // 加密文件字节
    const ciphertextBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      key,
      fileBytes
    );
    ciphertext = new Uint8Array(ciphertextBuffer);
  } else {
    onProgress?.("无需密码，进行像素级安全混淆...", 40);
    ciphertext = fileBytes;
  }
  
  onProgress?.("正在构建结构化头信息与元数据...", 65);
  // 构建元数据 JSON
  const metadata: EncryptedMetadata = {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    hasPassword: hasPassword,
    ...extraMeta
  };
  const encoder = new TextEncoder();
  const metadataBytes = encoder.encode(JSON.stringify(metadata));
  const metadataLength = metadataBytes.length;
  
  // 数据载荷长度 N = 8(Magic) + 16(Salt) + 12(IV) + 4(MetaLen) + M(MetaBytes) + Ciphertext
  const payloadSize = 8 + 16 + 12 + 4 + metadataLength + ciphertext.length;
  const payload = new Uint8Array(payloadSize);
  
  // 写入载荷各部分
  // 1. Magic
  const magic = encoder.encode("CSPNG100");
  payload.set(magic, 0);
  
  // 2. Salt
  payload.set(salt, 8);
  
  // 3. IV
  payload.set(iv, 24);
  
  // 4. Meta length
  writeUInt32BE(payload, 36, metadataLength);
  
  // 5. Meta JSON
  payload.set(metadataBytes, 40);
  
  // 6. Ciphertext
  payload.set(ciphertext, 40 + metadataLength);
  
  // 封装为 packed 字节流 = 4字节长度前缀 + 载荷数据
  const packed = new Uint8Array(4 + payloadSize);
  writeUInt32BE(packed, 0, payloadSize);
  packed.set(payload, 4);
  
  // Try to generate steganographed Girl with a Pearl Earring PNG format (Appended)
  try {
    onProgress?.("正在载入《戴珍珠耳环的少女》隐写封面...", 80);
    const girlPearlEarringAssetUrl = new URL("../assets/images/girl_pearl_earring_1780013307983.png", import.meta.url).href;
    const coverResponse = await fetch(girlPearlEarringAssetUrl);
    if (!coverResponse.ok) {
      throw new Error("无法读取封面图片资产");
    }
    const coverBlob = await coverResponse.blob();
    if (!coverBlob) {
      throw new Error("资产读取空内容");
    }
    
    const coverBuffer = await coverBlob.arrayBuffer();
    const coverBytes = new Uint8Array(coverBuffer);

    onProgress?.("组装隐写画纸与混合密文...", 90);
    // Combine: Cover PNG + packed + packed.length (4 bytes BE) + Magic "CSPFOOT1" (8 bytes)
    const combinedSize = coverBytes.length + packed.length + 4 + 8;
    const combinedBytes = new Uint8Array(combinedSize);
    
    combinedBytes.set(coverBytes, 0);
    combinedBytes.set(packed, coverBytes.length);
    
    const lenOffset = coverBytes.length + packed.length;
    writeUInt32BE(combinedBytes, lenOffset, packed.length);
    
    const markerOffset = lenOffset + 4;
    combinedBytes.set(encoder.encode("CSPFOOT1"), markerOffset);
    
    const combinedBlob = new Blob([combinedBytes], { type: "image/png" });
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(combinedBlob);
    });

    onProgress?.("加密绘制完成！", 100);
    return {
      dataUrl,
      width: 1024,
      height: 1024,
      payloadSize: packed.length
    };
  } catch (err) {
    console.warn("隐写封面图片读取失败，将降级为原版Canvas像素渲染模式:", err);
  }

  onProgress?.("正在将二进制流绘制为 Canvas 像素块 (降级模式)...", 80);
  // 计算像素
  const totalLength = packed.length;
  const pixelsCount = Math.ceil(totalLength / 3);
  
  // 设为正方形以完美展现其加密图像质感
  const width = Math.ceil(Math.sqrt(pixelsCount));
  const height = Math.ceil(pixelsCount / width);
  
  // 使用 OffscreenCanvas（如果支持）或创建动态 canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建 2D Canvas 绘图上下文");
  }
  
  const imgData = ctx.createImageData(width, height);
  const d = imgData.data;
  
  for (let i = 0; i < pixelsCount; i++) {
    const byteIdx = i * 3;
    const r = byteIdx < totalLength ? packed[byteIdx] : 0;
    const g = byteIdx + 1 < totalLength ? packed[byteIdx + 1] : 0;
    const b = byteIdx + 2 < totalLength ? packed[byteIdx + 2] : 0;
    
    const pixelIdx = i * 4;
    d[pixelIdx] = r;
    d[pixelIdx + 1] = g;
    d[pixelIdx + 2] = b;
    d[pixelIdx + 3] = 255; // 保持 Alpha 255，保障数据不失真
  }
  
  ctx.putImageData(imgData, 0, 0);
  
  onProgress?.("正在生成无损 PNG 编码镜像...", 95);
  // 转换为 PNG Base64 DataURL
  const dataUrl = canvas.toDataURL("image/png");
  onProgress?.("加密绘制完成！", 100);
  
  return {
    dataUrl,
    width,
    height,
    payloadSize: totalLength
  };
}

/**
 * 核心加密负载解密模块，支持从提取出的底层载荷直接还原原始文件
 */
export async function decryptPayload(
  payload: Uint8Array,
  password: string,
  onProgress?: (step: string, percent: number) => void
): Promise<DecryptedFile> {
  const payloadSize = payload.length;
  const decoder = new TextDecoder();
  
  if (payloadSize < 40) {
    throw new Error("载荷头部太短，这不是有效的 Like混肴 加密数据包。");
  }
  
  // 校验魔数 Magic Header "CSPNG100"
  const magic = decoder.decode(payload.subarray(0, 8));
  if (magic !== "CSPNG100") {
    throw new Error("解密校验失败：该图片不包含有效加密数据或并非由 Like混肴 支持的版本生成。");
  }
  
  // 解析各字段
  const salt = payload.subarray(8, 24);
  const iv = payload.subarray(24, 36);
  const metadataLength = readUInt32BE(payload, 36);
  
  if (36 + 4 + metadataLength > payloadSize) {
    throw new Error("元数据长度头部损坏，解密终止。");
  }
  
  onProgress?.("解析安全元数据...", 60);
  const metadataBytes = payload.subarray(40, 40 + metadataLength);
  const metadataText = decoder.decode(metadataBytes);
  let metadata: EncryptedMetadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch (err) {
    throw new Error("元数据 JSON 反序列化失败：" + (err as Error).message);
  }
  
  // 提取密文部分
  const ciphertext = payload.subarray(40 + metadataLength);
  
  if (metadata.hasPassword === false) {
    onProgress?.("无密码资产，正在本地进行像素重组并析出...", 90);
    const blob = new Blob([ciphertext], { type: metadata.type });
    onProgress?.("还原完成！", 100);
    
    return {
      blob,
      name: metadata.name,
      type: metadata.type,
      size: metadata.size,
      fps: metadata.fps,
      isImageSequenceToVideo: metadata.isImageSequenceToVideo,
      audioAttached: metadata.audioAttached,
      originalAudioName: metadata.originalAudioName,
      comfyNodeMode: metadata.comfyNodeMode
    };
  }
  
  onProgress?.("派生解密密钥中...", 75);
  const key = await deriveKey(password, salt);
  
  onProgress?.("执行高精度解密与数据校验 (AES-GCM-256)...", 90);
  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      key,
      ciphertext
    );
    
    onProgress?.("还原原始文件对象...", 98);
    const blob = new Blob([decryptedBuffer], { type: metadata.type });
    onProgress?.("解密完成！", 100);
    
    return {
      blob,
      name: metadata.name,
      type: metadata.type,
      size: metadata.size,
      fps: metadata.fps,
      isImageSequenceToVideo: metadata.isImageSequenceToVideo,
      audioAttached: metadata.audioAttached,
      originalAudioName: metadata.originalAudioName,
      comfyNodeMode: metadata.comfyNodeMode
    };
  } catch (err) {
    throw new Error("解密解密失败！密码可能输入错误，或图片像素已被宿主软件压缩/修改。");
  }
}

/**
 * 解密一个 PNG DataURL/Image，提取其中的数据包并由用户输入密码解密为原始文件对象
 * @param imageElement 已加载完的加密 PNG 图像元素
 * @param password 解密密码
 * @param onProgress 进度回调
 */
export async function decodeAndDecryptFromPNG(
  imageElement: HTMLImageElement,
  password: string,
  onProgress?: (step: string, percent: number) => void
): Promise<DecryptedFile> {
  onProgress?.("正在初始化 Canvas 像素读取...", 15);
  const width = imageElement.naturalWidth;
  const height = imageElement.naturalHeight;
  
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法初始化 Canvas 解密上下文");
  }
  
  ctx.drawImage(imageElement, 0, 0);
  const imgData = ctx.getImageData(0, 0, width, height).data;
  
  onProgress?.("正在还原二进制字节流...", 35);
  const totalPixels = width * height;
  // 每个像素提供3个有效数据字节
  const packed = new Uint8Array(totalPixels * 3);
  for (let i = 0; i < totalPixels; i++) {
    const pixelIdx = i * 4;
    const packedIdx = i * 3;
    packed[packedIdx] = imgData[pixelIdx];
    packed[packedIdx + 1] = imgData[pixelIdx + 1];
    packed[packedIdx + 2] = imgData[pixelIdx + 2];
  }
  
  // 1. 读取前 4 字节的荷载总长 N
  if (packed.length < 4) {
    throw new Error("图像长度异常，无法读取前导大小字节");
  }
  const payloadSize = readUInt32BE(packed, 0);
  if (payloadSize <= 0 || (payloadSize + 4) > packed.length) {
    throw new Error("图像像素损坏或并非由 Like混肴 加密生成的合法 PNG。");
  }
  
  // 2. 提取 Payload 并且解密
  const payload = packed.subarray(4, 4 + payloadSize);
  return decryptPayload(payload, password, onProgress);
}

/**
 * 这是一个完全无依赖的 Node.js/Browser 纯 JavaScript 加解密参考代码。
 * 供用户复制或在其 GitHub 库上展示。
 */
export const GITHUB_SOURCE_CODE = `/**
 * Like混肴 核心加解密库 (Pure JavaScript / Browser Implementation)
 * 完全运行在前端浏览器，支持对图片、音频、视频进行加解密并转为像素块无损 PNG。
 *
 * 协议：CSPNG100
 */

// 1. 辅组工具：写入 Big-endian UInt32
function writeUInt32BE(arr, offset, value) {
  arr[offset] = (value >>> 24) & 0xff;
  arr[offset + 1] = (value >>> 16) & 0xff;
  arr[offset + 2] = (value >>> 8) & 0xff;
  arr[offset + 3] = value & 0xff;
}

// 2. 辅助工具：读取 Big-endian UInt32
function readUInt32BE(arr, offset) {
  return (
    (arr[offset] << 24) |
    (arr[offset + 1] << 16) |
    (arr[offset + 2] << 8) |
    arr[offset + 3]
  ) >>> 0;
}

// 3. 基于 PBKDF2 与 AES-GCM 派生安全密钥
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 编码函数：将二进制 File 加密后画在 Canvas 并导出无损 PNG
 */
export async function encryptAndSave(file, password) {
  // 1. 读取原始字节
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  
  // 2. 随机盐与向量
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  // 3. AES-GCM 256 高强度加密
  const key = await deriveKey(password, salt);
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    fileBytes
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);
  
  // 4. 元数据拼装
  const metadata = {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size
  };
  const encoder = new TextEncoder();
  const metadataBytes = encoder.encode(JSON.stringify(metadata));
  const metadataLen = metadataBytes.length;
  
  // 5. 数据载荷打包
  const payloadSize = 8 + 16 + 12 + 4 + metadataLen + ciphertext.length;
  const payload = new Uint8Array(payloadSize);
  
  payload.set(encoder.encode("CSPNG100"), 0); // 8字节字头
  payload.set(salt, 8);                        // 16字节盐
  payload.set(iv, 24);                         // 12字节向量
  writeUInt32BE(payload, 36, metadataLen);     // 4字节元数据长
  payload.set(metadataBytes, 40);             // 元数据内容
  payload.set(ciphertext, 40 + metadataLen);   // 加密密文
  
  const packed = new Uint8Array(4 + payloadSize);
  writeUInt32BE(packed, 0, payloadSize);       // 最开头写入4字节总长度
  packed.set(payload, 4);
  
  // 6. 将一维字节流绘制到二维色彩空间
  const totalLength = packed.length;
  const pixelsCount = Math.ceil(totalLength / 3);
  const width = Math.ceil(Math.sqrt(pixelsCount));
  const height = Math.ceil(pixelsCount / width);
  
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(width, height);
  const d = imgData.data;
  
  for (let i = 0; i < pixelsCount; i++) {
    const byteIdx = i * 3;
    const r = byteIdx < totalLength ? packed[byteIdx] : 0;
    const g = byteIdx + 1 < totalLength ? packed[byteIdx + 1] : 0;
    const b = byteIdx + 2 < totalLength ? packed[byteIdx + 2] : 0;
    
    const pixelIdx = i * 4;
    d[pixelIdx] = r;
    d[pixelIdx + 1] = g;
    d[pixelIdx + 2] = b;
    d[pixelIdx + 3] = 255; // 锁定不透明，防止浏览器对 RGBA 进行插值/预乘破坏像素
  }
  ctx.putImageData(imgData, 0, 0);
  
  // 7. 返回无损 PNG 的 base64 代码
  return canvas.toDataURL("image/png");
}

/**
 * 解码函数：从图片恢复原始文件
 */
export async function decodeAndDecrypt(imageElement, password) {
  const width = imageElement.naturalWidth;
  const height = imageElement.naturalHeight;
  
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageElement, 0, 0);
  
  const imgData = ctx.getImageData(0, 0, width, height).data;
  const totalPixels = width * height;
  const packed = new Uint8Array(totalPixels * 3);
  
  for (let i = 0; i < totalPixels; i++) {
    const pIdx = i * 4;
    const kIdx = i * 3;
    packed[kIdx] = imgData[pIdx];
    packed[kIdx + 1] = imgData[pIdx + 1];
    packed[kIdx + 2] = imgData[pIdx + 2];
  }
  
  const payloadSize = readUInt32BE(packed, 0);
  const payload = packed.subarray(4, 4 + payloadSize);
  
  const decoder = new TextDecoder();
  const magic = decoder.decode(payload.subarray(0, 8));
  if (magic !== "CSPNG100") {
    throw new Error("识别失败：不支持的文件协议！");
  }
  
  const salt = payload.subarray(8, 24);
  const iv = payload.subarray(24, 36);
  const metadataLen = readUInt32BE(payload, 36);
  const metadataText = decoder.decode(payload.subarray(40, 40 + metadataLen));
  const metadata = JSON.parse(metadataText);
  
  const ciphertext = payload.subarray(40 + metadataLen);
  const key = await deriveKey(password, salt);
  
  // 执行 AES Decrypt
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );
  
  return {
    blob: new Blob([decrypted], { type: metadata.type }),
    name: metadata.name,
    type: metadata.type,
    size: metadata.size
  };
}
`;

// ==========================================
// Duck Decoding (SS_tools Yaya Steganography)
// ==========================================

function bytesToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sha256Sync(data: Uint8Array): Uint8Array {
  const h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const len = data.length;
  const blocks: number[] = [];
  for (let i = 0; i < len; i++) {
    blocks[i >> 2] |= data[i] << (24 - (i & 3) * 8);
  }
  const bitLen = len * 8;
  blocks[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  
  const blockCount = ((len + 8) >> 6) + 1;
  const w = new Int32Array(blockCount * 16);
  for (let i = 0; i < blocks.length; i++) {
    w[i] = blocks[i];
  }
  w[w.length - 1] = bitLen;

  let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

  for (let i = 0; i < w.length; i += 16) {
    let subW = new Int32Array(64);
    for (let j = 0; j < 16; j++) {
      subW[j] = w[i + j];
    }
    for (let j = 16; j < 64; j++) {
      const s0 = (rightRotate(subW[j - 15], 7) ^ rightRotate(subW[j - 15], 18) ^ (subW[j - 15] >>> 3)) | 0;
      const s1 = (rightRotate(subW[j - 2], 17) ^ rightRotate(subW[j - 2], 19) ^ (subW[j - 2] >>> 10)) | 0;
      subW[j] = (subW[j - 16] + s0 + subW[j - 7] + s1) | 0;
    }

    let tA = a, tB = b, tC = c, tD = d, tE = e, tF = f, tG = g, tH = h;

    for (let j = 0; j < 64; j++) {
      const S1 = (rightRotate(tE, 6) ^ rightRotate(tE, 11) ^ rightRotate(tE, 25)) | 0;
      const ch = ((tE & tF) ^ (~tE & tG)) | 0;
      const temp1 = (tH + S1 + ch + k[j] + subW[j]) | 0;
      const S0 = (rightRotate(tA, 2) ^ rightRotate(tA, 13) ^ rightRotate(tA, 22)) | 0;
      const maj = ((tA & tB) ^ (tA & tC) ^ (tB & tC)) | 0;
      const temp2 = (S0 + maj) | 0;

      tH = tG;
      tG = tF;
      tF = tE;
      tE = (tD + temp1) | 0;
      tD = tC;
      tC = tB;
      tB = tA;
      tA = (temp1 + temp2) | 0;
    }

    a = (a + tA) | 0;
    b = (b + tB) | 0;
    c = (c + tC) | 0;
    d = (d + tD) | 0;
    e = (e + tE) | 0;
    f = (f + tF) | 0;
    g = (g + tG) | 0;
    h = (h + tH) | 0;
  }

  function rightRotate(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
  }

  const out = new Uint8Array(32);
  const hs = [a, b, c, d, e, f, g, h];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (hs[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (hs[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (hs[i] >>> 8) & 0xff;
    out[i * 4 + 3] = hs[i] & 0xff;
  }
  return out;
}

function generateKeyStream(password: string, salt: Uint8Array, length: number): Uint8Array {
  const encoder = new TextEncoder();
  const saltHex = bytesToHex(salt);
  const keyMaterialStr = password + saltHex;
  const keyMaterial = encoder.encode(keyMaterialStr);
  
  const out = new Uint8Array(length);
  let bytesWritten = 0;
  let counter = 0;
  
  while (bytesWritten < length) {
    const counterStr = counter.toString();
    const counterBytes = encoder.encode(counterStr);
    const combined = new Uint8Array(keyMaterial.length + counterBytes.length);
    combined.set(keyMaterial, 0);
    combined.set(counterBytes, keyMaterial.length);
    
    const hash = sha256Sync(combined);
    const chunkLen = Math.min(32, length - bytesWritten);
    out.set(hash.subarray(0, chunkLen), bytesWritten);
    
    bytesWritten += chunkLen;
    counter++;
  }
  
  return out;
}

function extractPayloadWithK(activeChannels: number[], k: number): Uint8Array {
  let bitIdx = 0;
  function getBit(index: number): number {
    const channelIdx = Math.floor(index / k);
    if (channelIdx >= activeChannels.length) return 0;
    const bitPosInChannel = k - 1 - (index % k);
    return (activeChannels[channelIdx] >> bitPosInChannel) & 1;
  }

  if (activeChannels.length * k < 32) {
    throw new Error("图像空间数据过少，无法解析前导头部");
  }

  let header_len = 0;
  for (let i = 0; i < 32; i++) {
    if (getBit(i)) {
      header_len |= (1 << (31 - i));
    }
  }
  header_len >>>= 0;

  const total_bits = 32 + header_len * 8;
  if (header_len <= 0 || total_bits > activeChannels.length * k) {
    throw new Error("鸭子载荷溢出或前导标识不符");
  }

  const payloadBytes = new Uint8Array(header_len);
  for (let i = 0; i < header_len; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      if (getBit(32 + i * 8 + j)) {
        byte |= (1 << (7 - j));
      }
    }
    payloadBytes[i] = byte;
  }

  return payloadBytes;
}

export interface DuckMetadata {
  hasPassword: boolean;
  ext: string;
  dataLen: number;
}

export function decodeDuckMetadata(
  imgData: Uint8ClampedArray,
  width: number,
  height: number
): DuckMetadata | null {
  const skip_w = Math.floor(width * 0.40);
  const skip_h = Math.floor(height * 0.08);

  const activeChannels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < skip_h && x < skip_w) {
        continue;
      }
      const idx = (y * width + x) * 4;
      activeChannels.push(imgData[idx]);     // R
      activeChannels.push(imgData[idx + 1]); // G
      activeChannels.push(imgData[idx + 2]); // B
    }
  }

  for (const k of [2, 6, 8]) {
    try {
      const headerBytes = extractPayloadWithK(activeChannels, k);
      if (headerBytes.length < 1) continue;
      
      const has_pwd = headerBytes[0] === 1;
      let idx = 1;
      if (has_pwd) {
        if (headerBytes.length < idx + 32 + 16) continue;
        idx += 32 + 16;
      }
      if (headerBytes.length < idx + 1) continue;
      const ext_len = headerBytes[idx];
      idx += 1;
      if (headerBytes.length < idx + ext_len + 4) continue;
      const decoder = new TextDecoder("utf-8");
      const ext = decoder.decode(headerBytes.subarray(idx, idx + ext_len));
      idx += ext_len;
      
      const data_len = (headerBytes[idx] << 24 | headerBytes[idx + 1] << 16 | headerBytes[idx + 2] << 8 | headerBytes[idx + 3]) >>> 0;
      
      if (ext_len > 0 && /^[a-zA-Z0-9.]+$/.test(ext) && data_len > 0) {
        return {
          hasPassword: has_pwd,
          ext,
          dataLen: data_len
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function parseDuckHeader(header: Uint8Array, password?: string): { data: Uint8Array; ext: string } {
  let idx = 0;
  if (header.length < 1) {
    throw new Error("文件头损坏");
  }
  const has_pwd = header[0] === 1;
  idx += 1;
  let pwd_hash = new Uint8Array(0);
  let salt = new Uint8Array(0);
  if (has_pwd) {
    if (header.length < idx + 32 + 16) {
      throw new Error("文件头损坏");
    }
    pwd_hash = header.subarray(idx, idx + 32);
    idx += 32;
    salt = header.subarray(idx, idx + 16);
    idx += 16;
  }
  if (header.length < idx + 1) {
    throw new Error("文件头损坏");
  }
  const ext_len = header[idx];
  idx += 1;
  if (header.length < idx + ext_len + 4) {
    throw new Error("文件头损坏");
  }
  const decoder = new TextDecoder("utf-8");
  const ext = decoder.decode(header.subarray(idx, idx + ext_len));
  idx += ext_len;
  
  const data_len = (header[idx] << 24 | header[idx + 1] << 16 | header[idx + 2] << 8 | header[idx + 3]) >>> 0;
  idx += 4;
  
  const data = header.subarray(idx);
  if (data.length !== data_len) {
    console.warn("数据载荷大小不协调，图像可能被降质压缩损坏");
  }
  
  if (!has_pwd) {
    return { data, ext };
  }
  
  if (!password) {
    throw new Error("需要密码：该解密图已被拥有密码的鸭鸭图安全锁闭");
  }
  
  // Validate Password Hash Check
  const encoder = new TextEncoder();
  const saltHex = bytesToHex(salt);
  const dataToHash = encoder.encode(password + saltHex);
  const checkHash = sha256Sync(dataToHash);
  
  let match = true;
  for (let i = 0; i < 32; i++) {
    if (checkHash[i] !== pwd_hash[i]) {
      match = false;
      break;
    }
  }
  if (!match) {
    throw new Error("密码错误：您输入的核验口令不符");
  }
  
  const ks = generateKeyStream(password, salt, data.length);
  const plain = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    plain[i] = data[i] ^ ks[i];
  }
  
  return { data: plain, ext };
}

export function getMimeFromExt(ext: string): string {
  const low = ext.toLowerCase();
  if (low.endsWith(".binpng") || low === "binpng") return "video/mp4";
  if (low === "png" || low === "jpg" || low === "jpeg" || low === "webp" || low === "gif") return `image/${low}`;
  if (low === "mp4" || low === "mkv" || low === "avi") return `video/${low}`;
  if (low === "wav" || low === "mp3" || low === "ogg") return `audio/${low}`;
  if (low === "txt" || low === "json") return "text/plain";
  return "application/octet-stream";
}

export function binpngBytesToRawBytes(binpngBytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([binpngBytes], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
      if (!ctx) {
        reject(new Error("无法初始化 Canvas 转换上下文"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, width, height).data;
      
      const totalPixels = width * height;
      const rawBytes = new Uint8Array(totalPixels * 3);
      let byteIdx = 0;
      for (let i = 0; i < totalPixels; i++) {
        const pixelIdx = i * 4;
        rawBytes[byteIdx++] = imgData[pixelIdx];     // R
        rawBytes[byteIdx++] = imgData[pixelIdx + 1]; // G
        rawBytes[byteIdx++] = imgData[pixelIdx + 2]; // B
      }
      
      // Right trim trailing zeroes (equivalent to Python .rstrip(b"\x00"))
      let endIdx = rawBytes.length;
      while (endIdx > 0 && rawBytes[endIdx - 1] === 0) {
        endIdx--;
      }
      
      resolve(rawBytes.subarray(0, endIdx));
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error("载荷图像加载失败"));
    };
    img.src = url;
  });
}

export async function decodeAndDecryptDuckPNG(
  imageElement: HTMLImageElement,
  password?: string
): Promise<DecryptedFile> {
  const width = imageElement.naturalWidth;
  const height = imageElement.naturalHeight;
  
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法初始化 Canvas 鸭鸭图解密上下文");
  }
  
  ctx.drawImage(imageElement, 0, 0);
  const imgData = ctx.getImageData(0, 0, width, height).data;
  
  const skip_w = Math.floor(width * 0.40);
  const skip_h = Math.floor(height * 0.08);

  const activeChannels: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < skip_h && x < skip_w) {
        continue;
      }
      const idx = (y * width + x) * 4;
      activeChannels.push(imgData[idx]);     // R
      activeChannels.push(imgData[idx + 1]); // G
      activeChannels.push(imgData[idx + 2]); // B
    }
  }

  let finalExt = "";
  let finalData: Uint8Array | null = null;
  let lastError: any = null;

  for (const k of [2, 6, 8]) {
    try {
      const headerBytes = extractPayloadWithK(activeChannels, k);
      const parsed = parseDuckHeader(headerBytes, password);
      finalExt = parsed.ext;
      finalData = parsed.data;
      break;
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  if (!finalData) {
    throw lastError || new Error("解析失败：不支持的加/解密配置或图片不含可读的鸭鸭层");
  }

  // Handle PNG-packed binary representation (.binpng) for videos
  let actualExt = finalExt;
  let outputData = finalData;

  if (finalExt.toLowerCase().endsWith(".binpng") || finalExt.toLowerCase() === "binpng") {
    try {
      outputData = await binpngBytesToRawBytes(finalData);
      if (finalExt.toLowerCase().endsWith(".binpng")) {
        actualExt = finalExt.slice(0, -7);
        if (!actualExt) {
          actualExt = "mp4";
        }
      } else {
        actualExt = "mp4";
      }
    } catch (err) {
      throw new Error("无法还原视频载荷层: " + (err as Error).message);
    }
  }

  const mime = getMimeFromExt(actualExt);
  return {
    blob: new Blob([outputData], { type: mime }),
    name: `duck_recovered_${Date.now()}.${actualExt}`,
    type: mime,
    size: outputData.length,
    comfyNodeMode: true
  };
}

export async function encryptAndEncodeToDuckPNG(
  file: File,
  password?: string,
  onProgress?: (step: string, percent: number) => void
): Promise<{ dataUrl: string; width: number; height: number; payloadSize: number }> {
  onProgress?.("正在读取原始文件数据...", 10);
  const hasPassword = !!password;
  const ext = file.name.split('.').pop() || '';
  const encoder = new TextEncoder();
  const extBytes = encoder.encode(ext);
  const extLen = extBytes.length;

  let headerSize = 1 + 1 + extLen + 4; // has_pwd + ext_len + ext + data_len
  if (hasPassword) {
    headerSize += 32 + 16; // pwd_hash + salt
  }

  const fileBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(fileBuffer);
  const dataLen = fileBytes.length;

  const payloadBytesSize = headerSize + dataLen;
  const payloadBytes = new Uint8Array(payloadBytesSize);

  let idx = 0;
  // 1. hasPassword
  payloadBytes[idx++] = hasPassword ? 1 : 0;

  let salt = new Uint8Array(16);
  if (hasPassword) {
    onProgress?.("正在生成安全随机盐并执行 SHA256 口令核验计算...", 30);
    salt = window.crypto.getRandomValues(new Uint8Array(16));
    const saltHex = bytesToHex(salt);
    const dataToHash = encoder.encode(password + saltHex);
    const pwd_hash = sha256Sync(dataToHash);
    payloadBytes.set(pwd_hash, idx);
    idx += 32;
    payloadBytes.set(salt, idx);
    idx += 16;
  }

  // 5. ext_len
  payloadBytes[idx++] = extLen;
  // 6. ext
  payloadBytes.set(extBytes, idx);
  idx += extLen;

  // 7. data_len
  payloadBytes[idx++] = (dataLen >>> 24) & 0xff;
  payloadBytes[idx++] = (dataLen >>> 16) & 0xff;
  payloadBytes[idx++] = (dataLen >>> 8) & 0xff;
  payloadBytes[idx++] = dataLen & 0xff;

  // 8. data
  if (hasPassword) {
    onProgress?.("正在派生密钥并执行 XOR 高频混淆加密...", 50);
    const ks = generateKeyStream(password!, salt, dataLen);
    const encryptedData = new Uint8Array(dataLen);
    for (let i = 0; i < dataLen; i++) {
      encryptedData[i] = fileBytes[i] ^ ks[i];
    }
    payloadBytes.set(encryptedData, idx);
  } else {
    payloadBytes.set(fileBytes, idx);
  }

  onProgress?.("正在载入《戴珍珠耳环的少女》隐写底图...", 70);
  const girlPearlEarringAssetUrl = new URL("../assets/images/girl_pearl_earring_1780013307983.png", import.meta.url).href;
  const coverResponse = await fetch(girlPearlEarringAssetUrl);
  if (!coverResponse.ok) {
    throw new Error("无法读取封面图片资产");
  }
  const coverBlob = await coverResponse.blob();
  const coverUrl = URL.createObjectURL(coverBlob);

  // Load cover into image, then canvas
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(coverUrl);
      const width = img.naturalWidth;
      const height = img.naturalHeight;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法初始化 Canvas 鸭鸭图解密上下文"));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imgDataObj = ctx.getImageData(0, 0, width, height);
      const imgData = imgDataObj.data;

      const skip_w = Math.floor(width * 0.40);
      const skip_h = Math.floor(height * 0.08);

      const activeChannels: number[] = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < skip_h && x < skip_w) {
            continue;
          }
          const idx = (y * width + x) * 4;
          activeChannels.push(imgData[idx]);     // R
          activeChannels.push(imgData[idx + 1]); // G
          activeChannels.push(imgData[idx + 2]); // B
        }
      }

      onProgress?.("正在组装隐写画纸与混合密文...", 85);

      const headerLen = payloadBytes.length;
      const totalBitStreamLength = 32 + headerLen * 8;

      // Determine k in [2, 6, 8]
      let k = 8;
      const targetRequiredBits = totalBitStreamLength;
      if (activeChannels.length * 2 >= targetRequiredBits) {
        k = 2;
      } else if (activeChannels.length * 6 >= targetRequiredBits) {
        k = 6;
      } else if (activeChannels.length * 8 >= targetRequiredBits) {
        k = 8;
      } else {
        reject(new Error("文件过大，当前鸭鸭图在无损像素层无足够空间容纳该大小的文件"));
        return;
      }

      // Embed bits into activeChannels on the fly
      let streamIdx = 0;
      for (let i = 0; i < activeChannels.length; i++) {
        if (streamIdx >= totalBitStreamLength) {
          break;
        }

        let newLowestBits = 0;
        for (let j = 0; j < k; j++) {
          let bitVal = 0;
          if (streamIdx < totalBitStreamLength) {
            if (streamIdx < 32) {
              bitVal = (headerLen >>> (31 - streamIdx)) & 1;
            } else {
              const byteIdx = (streamIdx - 32) >> 3;
              const bitOffset = 7 - ((streamIdx - 32) & 7);
              bitVal = (payloadBytes[byteIdx] >> bitOffset) & 1;
            }
            streamIdx++;
          }
          newLowestBits |= (bitVal << (k - 1 - j));
        }

        const originalValue = activeChannels[i];
        const mask = ~((1 << k) - 1);
        const newValue = (originalValue & mask) | newLowestBits;
        activeChannels[i] = newValue;
      }

      // Repopulate canvas imgData channels
      let activeIdx = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < skip_h && x < skip_w) {
            continue;
          }
          const idx = (y * width + x) * 4;
          imgData[idx]     = activeChannels[activeIdx++]; // R
          imgData[idx + 1] = activeChannels[activeIdx++]; // G
          imgData[idx + 2] = activeChannels[activeIdx++]; // B
        }
      }

      ctx.putImageData(imgDataObj, 0, 0);

      onProgress?.("正在生成无损 PNG 数据镜像...", 95);
      const dataUrl = canvas.toDataURL("image/png");

      onProgress?.("加密绘制完成！", 100);
      resolve({
        dataUrl,
        width,
        height,
        payloadSize: payloadBytes.length
      });
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(coverUrl);
      reject(new Error("隐写底图加载失败: " + String(err)));
    };

    img.src = coverUrl;
  });
}

// Python-compatible MT19937 Mersenne Twister Random Number Generator
export class PythonRandom {
  private mt = new Uint32Array(624);
  private mti = 625;

  constructor(seed: number = 42) {
    this.seed(seed);
  }

  public seed(seed: number) {
    // python's random.Random(42) uses the absolute value split into 32-bit digits.
    // Since 42 fits within a single 32-bit integer, we pass [42] as a single key.
    const uintSeed = Math.abs(seed) >>> 0;
    this.init_by_array([uintSeed], 1);
  }

  private init_genrand(s: number) {
    this.mt[0] = s >>> 0;
    for (this.mti = 1; this.mti < 624; this.mti++) {
      const prev = this.mt[this.mti - 1];
      const term = (prev ^ (prev >>> 30)) >>> 0;
      const mult = Math.imul(term, 1812433253);
      this.mt[this.mti] = (mult + this.mti) >>> 0;
    }
  }

  private init_by_array(init_key: number[], key_length: number) {
    this.init_genrand(19650218);
    let i = 1;
    let j = 0;
    let k = 624 > key_length ? 624 : key_length;
    for (; k > 0; k--) {
      const prev = this.mt[i - 1];
      const term = (prev ^ (prev >>> 30)) >>> 0;
      const mult = Math.imul(term, 1664525);
      this.mt[i] = ((this.mt[i] ^ mult) + (init_key[j] >>> 0) + j) >>> 0;
      i++;
      j++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
      if (j >= key_length) {
        j = 0;
      }
    }
    for (let k2 = 623; k2 > 0; k2--) {
      const prev = this.mt[i - 1];
      const term = (prev ^ (prev >>> 30)) >>> 0;
      const mult = Math.imul(term, 1566083941);
      this.mt[i] = ((this.mt[i] ^ mult) - i) >>> 0;
      i++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000 >>> 0; /* MSB is 1; assuring non-zero initial array */
  }

  public genrand_int32(): number {
    let y = 0;
    const mag01 = [0x0, 0x9908b0df];

    if (this.mti >= 624) {
      if (this.mti === 625) {
        this.init_genrand(5489);
      }

      let kk = 0;
      for (; kk < 624 - 397; kk++) {
        y = (this.mt[kk] & 0x80000000) | (this.mt[kk + 1] & 0x7fffffff);
        this.mt[kk] = (this.mt[kk + 397] ^ (y >>> 1) ^ mag01[y & 0x1]) >>> 0;
      }
      for (; kk < 624 - 1; kk++) {
        y = (this.mt[kk] & 0x80000000) | (this.mt[kk + 1] & 0x7fffffff);
        this.mt[kk] = (this.mt[kk + (397 - 624)] ^ (y >>> 1) ^ mag01[y & 0x1]) >>> 0;
      }
      y = (this.mt[623] & 0x80000000) | (this.mt[0] & 0x7fffffff);
      this.mt[623] = (this.mt[396] ^ (y >>> 1) ^ mag01[y & 0x1]) >>> 0;

      this.mti = 0;
    }

    y = this.mt[this.mti++];

    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= (y >>> 18);

    return y >>> 0;
  }

  public getrandbits(k: number): number {
    if (k <= 0) return 0;
    const words = Math.floor((k - 1) / 32) + 1;
    let val = 0;
    let k_left = k;
    for (let i = 0; i < words; i++) {
      let r = this.genrand_int32();
      if (k_left < 32) {
        r = r >>> (32 - k_left); // Drop least significant bits matching Python's C implementation
      }
      val += r * Math.pow(2, 32 * i);
      k_left -= 32;
    }
    return val;
  }

  public randbelow(n: number): number {
    if (n <= 1) return 0;
    const k = n.toString(2).length; // Same as n.bit_length() in Python
    let r = this.getrandbits(k);
    while (r >= n) {
      r = this.getrandbits(k);
    }
    return r;
  }

  public shuffle<T>(x: T[]): void {
    const len = x.length;
    for (let i = len - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const temp = x[i];
      x[i] = x[j];
      x[j] = temp;
    }
  }
}

// Deterministic seed-based shuffle compatible with Python's random.Random(seed).shuffle
export function getSeededIndices(length: number, seed: number = 42): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  const rng = new PythonRandom(seed);
  rng.shuffle(indices);
  return indices;
}

function copyTile(
  srcData: Uint8ClampedArray,
  srcW: number,
  destData: Uint8ClampedArray,
  destW: number,
  srcTx: number,
  srcTy: number,
  destTx: number,
  destTy: number,
  tileSize: number
) {
  const srcStartX = srcTx * tileSize;
  const srcStartY = srcTy * tileSize;
  const destStartX = destTx * tileSize;
  const destStartY = destTy * tileSize;

  for (let dy = 0; dy < tileSize; dy++) {
    const srcY = srcStartY + dy;
    const destY = destStartY + dy;
    for (let dx = 0; dx < tileSize; dx++) {
      const srcX = srcStartX + dx;
      const destX = destStartX + dx;

      const srcIdx = (srcY * srcW + srcX) * 4;
      const destIdx = (destY * destW + destX) * 4;

      destData[destIdx] = srcData[srcIdx];         // R
      destData[destIdx + 1] = srcData[srcIdx + 1]; // G
      destData[destIdx + 2] = srcData[srcIdx + 2]; // B
      destData[destIdx + 3] = srcData[srcIdx + 3]; // A
    }
  }
}

function getHilbertPositions(width: number, height: number): Int32Array {
  const total = width * height;
  const positions = new Int32Array(total);
  let pos = 0;

  function generate2d(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
    const w = Math.abs(ax + ay);
    const h = Math.abs(bx + by);
    const dax = Math.sign(ax) | 0;
    const day = Math.sign(ay) | 0;
    const dbx = Math.sign(bx) | 0;
    const dby = Math.sign(by) | 0;

    if (h === 1) {
      for (let i = 0; i < w; i++) {
        positions[pos++] = x + y * width;
        x += dax;
        y += day;
      }
      return;
    }
    if (w === 1) {
      for (let i = 0; i < h; i++) {
        positions[pos++] = x + y * width;
        x += dbx;
        y += dby;
      }
      return;
    }

    let ax2 = Math.floor(ax / 2);
    let ay2 = Math.floor(ay / 2);
    let bx2 = Math.floor(bx / 2);
    let by2 = Math.floor(by / 2);
    const w2 = Math.abs(ax2 + ay2);
    const h2 = Math.abs(bx2 + by2);

    if (2 * w > 3 * h) {
      if ((w2 & 1) === 1 && w > 2) {
        ax2 += dax;
        ay2 += day;
      }
      generate2d(x, y, ax2, ay2, bx, by);
      generate2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by);
    } else {
      if ((h2 & 1) === 1 && h > 2) {
        bx2 += dbx;
        by2 += dby;
      }
      generate2d(x, y, bx2, by2, ax2, ay2);
      generate2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2);
      generate2d(
        x + (ax - dax) + (bx2 - dbx),
        y + (ay - day) + (by2 - dby),
        -bx2, -by2,
        -(ax - ax2), -(ay - ay2)
      );
    }
  }

  if (width >= height) {
    generate2d(0, 0, width, 0, 0, height);
  } else {
    generate2d(0, 0, 0, height, width, 0);
  }
  return positions;
}

/**
 * Like分享 - 图片大番茄像素洗牌加密 (TomatoScramble)
 */
export async function scrambleImage(
  file: File,
  onProgress?: (step: string, percent: number) => void
): Promise<{ dataUrl: string; width: number; height: number; payloadSize: number }> {
  onProgress?.("正在加载原始图像参数...", 20);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          reject(new Error("无法创建 2D Canvas 绘图上下文"));
          return;
        }

        ctx.drawImage(img, 0, 0);
        const srcImgDataObj = ctx.getImageData(0, 0, width, height);
        const srcData = srcImgDataObj.data;

        const destImgDataObj = ctx.createImageData(width, height);
        const destData = destImgDataObj.data;
        // set opacity for background incase
        for (let i = 0; i < destData.length; i += 4) destData[i + 3] = 255;

        const total = width * height;

        if (total < 1) {
          resolve({
            dataUrl: canvas.toDataURL("image/png"),
            width,
            height,
            payloadSize: 0
          });
          return;
        }

        onProgress?.("正在计算置乱空间重排序列 (2D Hilbert)...", 50);
        const positions = getHilbertPositions(width, height);
        
        onProgress?.("正在重构无损物理像素切片 (Golden Ratio)...", 75);
        const FIXED_KEY = 1.0;
        const GOLDEN_RATIO_CONJ = (Math.sqrt(5.0) - 1.0) / 2.0;
        const offset = Math.round(GOLDEN_RATIO_CONJ * total * FIXED_KEY);
        const loopPos = total - offset;

        for (let i = 0; i < loopPos; i++) {
          const srcIdx = positions[i] * 4;
          const destIdx = positions[i + offset] * 4;
          destData[destIdx] = srcData[srcIdx];
          destData[destIdx + 1] = srcData[srcIdx + 1];
          destData[destIdx + 2] = srcData[srcIdx + 2];
          destData[destIdx + 3] = srcData[srcIdx + 3];
        }
        for (let i = loopPos; i < total; i++) {
          const srcIdx = positions[i] * 4;
          const destIdx = positions[i - loopPos] * 4;
          destData[destIdx] = srcData[srcIdx];
          destData[destIdx + 1] = srcData[srcIdx + 1];
          destData[destIdx + 2] = srcData[srcIdx + 2];
          destData[destIdx + 3] = srcData[srcIdx + 3];
        }

        ctx.putImageData(destImgDataObj, 0, 0);
        onProgress?.("正在输出无损打乱图片...", 95);
        const dataUrl = canvas.toDataURL("image/png");

        resolve({
          dataUrl,
          width,
          height,
          payloadSize: total
        });
      };
      
      img.onerror = (err) => {
        reject(new Error("图片导入绘制失败: " + String(err)));
      };

      img.src = e.target?.result as string;
    };
    reader.onerror = (err) => {
      reject(new Error("文件转换基础阵列失败: " + String(err)));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Like分享 - 图片大番茄像素洗牌逆向解密 (TomatoScramble)
 */
export async function unscrambleImage(
  imageElement: HTMLImageElement,
  onProgress?: (step: string, percent: number) => void
): Promise<DecryptedFile> {
  onProgress?.("正在提取空间物理分辨率像素层...", 15);
  const width = imageElement.naturalWidth;
  const height = imageElement.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("无法初始化解密 Canvas 还原底图");
  }

  ctx.drawImage(imageElement, 0, 0);
  const srcImgDataObj = ctx.getImageData(0, 0, width, height);
  const srcData = srcImgDataObj.data;

  const destImgDataObj = ctx.createImageData(width, height);
  const destData = destImgDataObj.data;
  for (let i = 0; i < destData.length; i += 4) destData[i + 3] = 255;

  const total = width * height;

  if (total >= 1) {
    onProgress?.("逆向重排物理坐标重映射 (2D Hilbert)...", 50);
    const positions = getHilbertPositions(width, height);

    onProgress?.("正在重构无损物理像素切片 (Reverse Golden Ratio)...", 75);
    const FIXED_KEY = 1.0;
    const GOLDEN_RATIO_CONJ = (Math.sqrt(5.0) - 1.0) / 2.0;
    const offset = Math.round(GOLDEN_RATIO_CONJ * total * FIXED_KEY);
    const loopPos = total - offset;

    for (let i = 0; i < loopPos; i++) {
        const destIdx = positions[i] * 4;
        const srcIdx = positions[i + offset] * 4;
        destData[destIdx] = srcData[srcIdx];
        destData[destIdx + 1] = srcData[srcIdx + 1];
        destData[destIdx + 2] = srcData[srcIdx + 2];
        destData[destIdx + 3] = srcData[srcIdx + 3];
    }
    for (let i = loopPos; i < total; i++) {
        const destIdx = positions[i] * 4;
        const srcIdx = positions[i - loopPos] * 4;
        destData[destIdx] = srcData[srcIdx];
        destData[destIdx + 1] = srcData[srcIdx + 1];
        destData[destIdx + 2] = srcData[srcIdx + 2];
        destData[destIdx + 3] = srcData[srcIdx + 3];
    }
  }

  ctx.putImageData(destImgDataObj, 0, 0);
  onProgress?.("合成无损还原数据图...", 85);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("无法将坐标映射输出为还原的图像 Blob"));
        return;
      }
      resolve({
        blob,
        name: `unscrambled_${Date.now()}.png`,
        type: "image/png",
        size: blob.size
      });
    }, "image/png");
  });
}

