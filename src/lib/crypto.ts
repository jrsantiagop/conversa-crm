/**
 * Server-only credential encryption helpers.
 *
 * Uses AES-256-GCM with a key read from CREDENTIALS_ENCRYPTION_KEY (32-byte hex).
 * When the variable is missing, a stable development key is derived from a
 * constant and a single warning is printed. Encryption never throws because of
 * a missing key: development must keep working out of the box.
 *
 * IMPORTANT: import this module only from server code (route handlers, server
 * components, server-only libraries). It relies on node:crypto.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Inbox } from "./types";

const VERSION = "v1";
const DEV_KEY_SEED = "conversa-crm/development-only/credentials-encryption-key/v1";
const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

let warningIssued = false;

function warnOnce(message: string): void {
  if (warningIssued) return;
  warningIssued = true;
  console.warn(`[conversa-crm] ${message}`);
}

/** Resolves the AES-256 key. Invalid or missing env values fall back to a derived key. */
function resolveKey(): Buffer {
  const configured = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();

  if (configured && HEX_32_BYTES.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  if (configured) {
    warnOnce(
      "CREDENTIALS_ENCRYPTION_KEY is not 32 bytes of hex. Using a key derived from its value; set a proper hex key in production.",
    );
  } else {
    warnOnce(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Using a fixed development key; credentials are NOT secure until you configure it.",
    );
  }

  return createHash("sha256").update(configured || DEV_KEY_SEED).digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}

/** Encrypts a secret as: v1:<iv hex>:<authTag hex>:<ciphertext hex>. */
export function encryptSecret(value: string): string {
  if (!value || isEncryptedSecret(value)) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a secret produced by encryptSecret().
 * Plaintext values (legacy data or values coming from env vars) are returned
 * untouched. Corrupted ciphertext is replaced by an empty string and logged.
 */
export function decryptSecret(value: string): string {
  if (!value) return "";
  if (!isEncryptedSecret(value)) return value;

  const parts = value.split(":");
  if (parts.length !== 4) {
    warnOnce("A credential value has an invalid encrypted format and was ignored.");
    return "";
  }

  try {
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const payload = Buffer.from(parts[3], "hex");
    const decipher = createDecipheriv("aes-256-gcm", resolveKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    warnOnce("A credential value could not be decrypted (wrong key or corrupted data) and was ignored.");
    return "";
  }
}

/** Encrypts every non-empty credential value of an inbox. */
export function encryptCredentials(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    result[key] = typeof value === "string" && value ? encryptSecret(value) : "";
  }
  return result;
}

/** Decrypts every credential value of an inbox for server-side use. */
export function decryptCredentials(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    result[key] = typeof value === "string" ? decryptSecret(value) : "";
  }
  return result;
}

/** Convenience helpers that keep the Inbox type opaque to callers. */
export function encryptInboxCredentials(inbox: Inbox): Inbox {
  return { ...inbox, credentials: encryptCredentials(inbox.credentials) };
}

export function decryptInboxCredentials(inbox: Inbox): Inbox {
  return { ...inbox, credentials: decryptCredentials(inbox.credentials) };
}
