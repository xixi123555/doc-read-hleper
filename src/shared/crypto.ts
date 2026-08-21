/**
 * 本地加密工具（AES-GCM + PBKDF2）。
 * 仅用于本地存储混淆保护（如 API 密钥），密钥由固定种子派生 —— 数据不会离开本机，
 * 满足 PRD“本地加密存储、不上传云端”的隐私要求。
 */

const SALT = 'doc-read-helper::v1::salt'
const PBKDF2_ITERATIONS = 100_000

let cachedKey: CryptoKey | null = null

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const encoder = new TextEncoder()
  const base = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SALT),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  cachedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return cachedKey
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** 加密明文，返回 "ivBase64.ctBase64" */
export async function encryptText(plain: string): Promise<string> {
  if (!plain) return ''
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  )
  return `${toB64(iv.buffer)}.${toB64(ct)}`
}

/** 解密 "ivBase64.ctBase64"，失败返回空串 */
export async function decryptText(payload: string): Promise<string> {
  if (!payload) return ''
  try {
    const [ivB64, ctB64] = payload.split('.')
    if (!ivB64 || !ctB64) return ''
    const key = await getKey()
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64).buffer as ArrayBuffer },
      key,
      fromB64(ctB64).buffer as ArrayBuffer,
    )
    return new TextDecoder().decode(pt)
  } catch {
    return ''
  }
}
