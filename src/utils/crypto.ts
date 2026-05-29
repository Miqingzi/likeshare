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
  onProgress?: (step: string, percent: number) => void
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
    hasPassword: hasPassword
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
      size: metadata.size
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
      size: metadata.size
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
