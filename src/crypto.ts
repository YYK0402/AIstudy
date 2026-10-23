// API Key 本地加密（WebCrypto AES-GCM）
// 密文格式：enc1:<iv base64>.<ciphertext base64>；不以 enc1: 开头视为旧明文，原样使用并触发迁移
// 密钥材料（32 字节随机 hex）存于插件数据 cryptoKeyMaterial 字段
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

/** 确保密钥材料存在；缺失时生成随机材料写回 data（就地修改） */
export async function ensureKeyMaterial(data: { cryptoKeyMaterial?: string }): Promise<boolean> {
  if (data.cryptoKeyMaterial && data.cryptoKeyMaterial.length === KEY_BYTES * 2) {
    return true;
  }
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  data.cryptoKeyMaterial = bytesToHex(raw);
  return true;
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
    console.warn("[siyuan-ai-study] WebCrypto 不可用，API Key 保持明文存储");
    return plaintext;
  }
  await ensureKeyMaterial(data);
  const key = await importKey(data.cryptoKeyMaterial!);
  const iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12));
  const ct = await sub.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${ENC_PREFIX}${bytesToB64(iv)}.${bytesToB64(new Uint8Array(ct))}`;
}

/** 解密 API Key；非密文（旧明文）原样返回 */
export async function decryptApiKey(data: { cryptoKeyMaterial?: string }, stored: string): Promise<string> {
  if (!stored || !isEncryptedApiKey(stored)) {
    return stored;
  }
  const sub = subtle();
  if (!sub || !data.cryptoKeyMaterial) {
    console.warn("[siyuan-ai-study] 无法解密 API Key（WebCrypto 或密钥材料缺失）");
    return stored;
  }
  try {
    const [ivB64, dataB64] = stored.slice(ENC_PREFIX.length).split(".");
    const key = await importKey(data.cryptoKeyMaterial);
    const pt = await sub.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      key,
      b64ToBytes(dataB64),
    );
    return new TextDecoder().decode(pt);
  } catch (error) {
    console.error("[siyuan-ai-study] API Key 解密失败:", error);
    return stored;
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
