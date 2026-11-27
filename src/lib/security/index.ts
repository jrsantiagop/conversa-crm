/**
 * Server-only security helpers for Conversa CRM.
 *
 * Import this module ONLY from server code (route handlers, server actions,
 * server-only libraries or scripts). It relies on `node:crypto` and must never
 * be bundled into a client component.
 *
 * Design rules:
 * - Pure functions: no state, no side effects at import time.
 * - Fail closed: invalid or missing input returns `false` / `null` / empty.
 * - Never throw for untrusted input (except `readRequiredEnv`, which is meant
 *   for trusted startup scripts and fails with a clear, secret-free message).
 * - Never log secret values, only their names or a masked preview.
 *
 * Provider-specific signature schemes (Twilio HMAC-SHA1, Svix, etc.) live in
 * `src/channels/crypto.ts`; this module holds the reusable primitives.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Compares two strings in constant time using `crypto.timingSafeEqual`.
 *
 * Empty or non-string inputs are rejected before comparison, and a length
 * mismatch returns `false` immediately (length is not a secret). Use this for
 * tokens, API keys, verify tokens and signature digests.
 *
 * @param a First value to compare.
 * @param b Second value to compare.
 * @returns `true` only when both values are non-empty and byte-for-byte equal.
 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;

  try {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/** Options for {@link verifyHmacSha256}. */
export interface VerifyHmacOptions {
  /**
   * Prefix expected before the digest in the header value.
   * Defaults to `"sha256="` (Meta `X-Hub-Signature-256`). Pass `""` to accept a
   * bare digest. The comparison is case-insensitive.
   */
  prefix?: string;
  /**
   * Encoding of the provided digest and of the computed HMAC.
   * Defaults to `"hex"`; use `"base64"` for providers such as Svix.
   */
  encoding?: "hex" | "base64";
}

/**
 * Verifies an HMAC-SHA256 signature over the **raw** request body.
 *
 * The signature may include the `sha256=` prefix (default) or be a bare
 * digest. Surrounding whitespace is ignored and hexadecimal digests are
 * normalized to lowercase before a constant-time comparison. This function
 * never throws: any missing/invalid input returns `false`.
 *
 * For schemes that sign a composite payload (for example
 * `${id}.${timestamp}.${rawBody}`), build that payload first and pass it as
 * `rawBody`. For HMAC-SHA1 or other algorithms use `src/channels/crypto.ts`.
 *
 * @param secret Shared secret used as the HMAC key.
 * @param rawBody Exact, unparsed request body as received over the wire.
 * @param signature Signature header value, with or without the prefix.
 * @param opts Optional prefix/encoding overrides.
 * @returns `true` only when the signature matches; `false` otherwise.
 */
export function verifyHmacSha256(
  secret: string,
  rawBody: string,
  signature: string,
  opts: VerifyHmacOptions = {},
): boolean {
  try {
    if (typeof secret !== "string" || !secret) return false;
    if (typeof rawBody !== "string" || !rawBody) return false;
    if (typeof signature !== "string" || !signature) return false;

    const prefix = opts.prefix ?? "sha256=";
    const encoding = opts.encoding ?? "hex";

    let provided = signature.trim();
    if (prefix && provided.toLowerCase().startsWith(prefix.toLowerCase())) {
      provided = provided.slice(prefix.length);
    }
    if (!provided) return false;
    if (encoding === "hex") provided = provided.toLowerCase();

    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest(encoding);
    return safeEqual(expected, provided);
  } catch {
    return false;
  }
}

/**
 * Extracts the token from an HTTP `Authorization: Bearer <token>` header.
 *
 * The scheme is matched case-insensitively. Returns `null` when the header is
 * absent, malformed, or contains extra whitespace-separated values. The token
 * itself is returned as-is; use {@link validateApiKey} to compare it safely.
 *
 * @param header Raw `Authorization` header value (or `null`/`undefined`).
 * @returns The bearer token, or `null` if there is no valid bearer header.
 */
export function extractBearer(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Validates a provided API key against the expected value in constant time.
 *
 * Empty or missing values are always rejected, so an unconfigured key never
 * turns into an open endpoint. Call this on the server only.
 *
 * @param provided Key supplied by the caller (never log it).
 * @param expected Key configured for the workspace/integration.
 * @returns `true` only when both keys are non-empty and equal.
 */
export function validateApiKey(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  return safeEqual(provided.trim(), expected.trim());
}

/**
 * Masks a secret for display in logs or UI (for example `••••••••1234`).
 *
 * Only the last four characters are shown. Values of four characters or fewer
 * are fully masked to avoid revealing a short secret. Prefer showing nothing
 * at all unless an operator really needs to identify a credential.
 *
 * @param value Secret to mask.
 * @returns A masked string; empty string when there is no value.
 */
export function maskSecret(value: string | null | undefined): string {
  if (typeof value !== "string" || !value) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  return `${"•".repeat(8)}${value.slice(-4)}`;
}

/**
 * Checks that a request body does not exceed a byte limit.
 *
 * Size is measured in UTF-8 **bytes**, not characters, so multi-byte text is
 * handled correctly. Strings and `Uint8Array` (including `Buffer`) are
 * supported; any other type fails closed.
 *
 * @param raw Raw request body as text or bytes.
 * @param maxBytes Maximum allowed size in bytes.
 * @returns `true` when the body is present and within the limit.
 */
export function assertBodySize(
  raw: string | Uint8Array | null | undefined,
  maxBytes: number,
): boolean {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return false;

  if (typeof raw === "string") return Buffer.byteLength(raw, "utf8") <= maxBytes;
  if (raw instanceof Uint8Array) return raw.byteLength <= maxBytes;
  return false;
}

/**
 * Reads a required environment variable, throwing a clear error if missing.
 *
 * Intended for trusted scripts and startup checks **only**, not for request
 * handlers (where a missing secret should produce a controlled 5xx instead).
 * The error mentions the variable name but never its value.
 *
 * @param name Name of the environment variable to read.
 * @returns The trimmed value of the variable.
 * @throws Error when the name is invalid or the variable is unset/empty.
 */
export function readRequiredEnv(name: string): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("[conversa-crm] readRequiredEnv: a variable name is required.");
  }

  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `[conversa-crm] Missing required environment variable "${name}". ` +
        "Set it in .env.local for local development or in the hosting provider settings for production.",
    );
  }
  return value;
}
