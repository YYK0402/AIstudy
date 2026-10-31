// API Key 本地加密（WebCrypto AES-GCM，浏览器与 Node 22 通用）
// 密文格式：enc1:<iv base64>.<ciphertext base64>；不以 enc1: 开头视为旧明文，原样使用并触发迁移
// 密钥材料（32 字节随机 hex）存于数据 cryptoKeyMaterial 字段
// WebCrypto 不可用时（极老内核）降级为明文存储，不阻断功能

const ENC_PREFIX = "enc1:";
const KEY_BYTES = 32;

export function isEncryptedApiKey(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}

function subtle(): SubtleCrypto | null {
  return typeof crypto !== "undefined" && crypto.subtle ? crypto.subtle : null;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToB64(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * 确保密钥材料可用；缺失时生成随机材料写回 data（就地修改）。
 * 材料存在但长度/格式异常视为损坏：旧材料已无法导入 AES，必然重新生成——
 * 但这会使全部既有密文永久不可解，调用方必须让用户知晓（返回 "corrupted" 供警示）。
 */
export async function ensureKeyMaterial(
  data: { cryptoKeyMaterial?: string },
): Promise<"ok" | "generated" | "corrupted"> {
  const material = data.cryptoKeyMaterial;
  if (material) {
    if (material.length === KEY_BYTES * 2 && /^[0-9a-fA-F]+$/.test(material)) {
      return "ok";
    }
    console.error(
      "[ai-study] 密钥材料异常（长度/格式不符），已重新生成；所有已加密 API Key 需到设置页重新填写",
    );
  }
  data.cryptoKeyMaterial = bytesToHex(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
  return material ? "corrupted" : "generated";
}

async function importKey(material: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", hexToBytes(material), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** 加密 API Key；WebCrypto 不可用时原样返回（降级明文） */
export async function encryptApiKey(data: { cryptoKeyMaterial?: string }, plaintext: string): Promise<string> {
  if (!plaintext || isEncryptedApiKey(plaintext)) {
    return plaintext;
  }
  const sub = subtle();
  if (!sub) {
    console.warn("[ai-study] WebCrypto 不可用，API Key 保持明文存储");
    return plaintext;
  }
  await ensureKeyMaterial(data);
  const key = await importKey(data.cryptoKeyMaterial!);
  const iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12));
  const ct = await sub.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${ENC_PREFIX}${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`;
}

/**
 * 解密 API Key；非密文（旧明文）原样返回。
 * 密文无法解密时抛出带指引的错误（而非把密文当 Key 发出去导致 401）：
 * 服务商配置页重新填写即可恢复。
 */
export async function decryptApiKey(data: { cryptoKeyMaterial?: string }, stored: string): Promise<string> {
  if (!stored || !isEncryptedApiKey(stored)) {
    return stored;
  }
  const sub = subtle();
  if (!sub) {
    throw new Error("无法解密 API Key：当前环境不支持 WebCrypto，请到设置页重新填写 API Key");
  }
  if (!data.cryptoKeyMaterial) {
    throw new Error("无法解密 API Key：密钥材料缺失，请到设置页重新填写 API Key");
  }
  try {
    const [ivB64, dataB64] = stored.slice(ENC_PREFIX.length).split(".");
    if (!ivB64 || !dataB64) {
      throw new Error("密文格式异常");
    }
    const key = await importKey(data.cryptoKeyMaterial);
    const pt = await sub.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(dataB64),
    );
    return new TextDecoder().decode(pt);
  } catch (error) {
    console.error("[ai-study] API Key 解密失败:", error);
    throw new Error("API Key 解密失败（密钥材料损坏或数据文件被改动），请到设置页重新填写 API Key");
  }
}

/** 遍历服务商，把仍为明文的 apiKey 加密回写（就地修改 data）；返回是否发生迁移 */
export async function migrateProviderKeys(data: {
  cryptoKeyMaterial?: string;
  providers: { apiKey: string }[];
}): Promise<boolean> {
  let migrated = false;
  for (const provider of data.providers) {
    if (provider.apiKey && !isEncryptedApiKey(provider.apiKey)) {
      provider.apiKey = await encryptApiKey(data, provider.apiKey);
      migrated = true;
    }
  }
  return migrated;
}
