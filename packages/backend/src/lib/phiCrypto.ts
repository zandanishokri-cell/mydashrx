// P-SEC40: AES-256-GCM PHI encryption at rest — HIPAA 2025 NPRM ePHI encryption requirement
// PHI_ENCRYPTION_KEY env var: 32 random bytes as hex (openssl rand -hex 32)
// Format: "enc:v1:<base64(12-byte IV + ciphertext + 16-byte auth tag)>"
// Graceful pass-through: if input doesn't start with enc:v1: prefix, return as-is (legacy rows)

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;  // 96-bit IV — GCM standard
const TAG_LEN = 16; // 128-bit auth tag

function getKey(): Buffer {
  const hex = process.env.PHI_ENCRYPTION_KEY;
  if (!hex) throw new Error('PHI_ENCRYPTION_KEY env var not set — required for PHI encryption at rest');
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error('PHI_ENCRYPTION_KEY must be 32 bytes hex (64 hex chars). Generate: openssl rand -hex 32');
  return buf;
}

export function encryptPhi(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: IV(12) + ciphertext + tag(16) → base64
  return PREFIX + Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

export function decryptPhi(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return value; // legacy unencrypted row — pass-through
  const key = getKey();
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) return value; // malformed — pass-through
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/** Encrypt a JSON-serializable array to a single encrypted string */
export function encryptPhiArray(arr: unknown[]): string {
  return encryptPhi(JSON.stringify(arr));
}

/** Decrypt and parse an encrypted array. Pass-through for legacy plaintext JSON arrays */
export function decryptPhiArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  const raw = decryptPhi(value);
  try { return JSON.parse(raw) as unknown[]; } catch { return []; }
}
