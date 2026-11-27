/**
 * Verificación de firmas HMAC con `node:crypto` (built-in, sin SDKs).
 * Funciones puras y sin estado: seguras en funciones serverless de Vercel.
 * Devuelven `null` cuando no hay datos suficientes para validar, para que el
 * adaptador pueda degradar sin lanzar excepciones.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

type Digest = "sha256" | "sha1";

function digest(secret: string, data: string, algorithm: Digest): Buffer | null {
  if (!secret || typeof data !== "string") return null;
  try {
    return createHmac(algorithm, secret).update(data, "utf8").digest();
  } catch {
    return null;
  }
}

/** Comparación en tiempo constante (longitudes distintas => false). */
export function safeEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  try {
    const a = Buffer.from(left, "utf8");
    const b = Buffer.from(right, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function hmacHex(secret: string, data: string, algorithm: Digest = "sha256"): string | null {
  const result = digest(secret, data, algorithm);
  return result ? result.toString("hex") : null;
}

export function hmacBase64(secret: string, data: string, algorithm: Digest = "sha256"): string | null {
  const result = digest(secret, data, algorithm);
  return result ? result.toString("base64") : null;
}

/**
 * Meta: X-Hub-Signature-256: sha256=<hex>.
 * Devuelve null si falta secreto, cuerpo crudo o cabecera (no se puede validar).
 */
export function verifyHexSignature(
  secret: string,
  rawBody: string,
  signature: string,
  prefix = "sha256=",
): boolean | null {
  if (!secret || !rawBody || !signature) return null;
  const expected = hmacHex(secret, rawBody);
  if (!expected) return null;
  const provided = signature.startsWith(prefix) ? signature.slice(prefix.length) : signature;
  return safeEqual(expected, provided.trim());
}

/**
 * Twilio: X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + params ordenados)).
 * `url` debe ser la URL absoluta del webhook (incluida la query string).
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean | null {
  if (!authToken || !url || !signature) return null;
  const data = url + Object.keys(params)
    .sort()
    .map((key) => key + params[key])
    .join("");
  const expected = hmacBase64(authToken, data, "sha1");
  if (!expected) return null;
  return safeEqual(expected, signature.trim());
}

/** Resend/Svix: firma `v1,<base64>` sobre `${id}.${timestamp}.${rawBody}`. */
export function verifySvixSignature(
  secret: string,
  rawBody: string,
  headers: Record<string, string>,
): boolean | null {
  const id = headers["svix-id"] ?? "";
  const timestamp = headers["svix-timestamp"] ?? "";
  const signature = headers["svix-signature"] ?? "";
  if (!secret || !rawBody || !id || !timestamp || !signature) return null;
  const expected = hmacBase64(secret, `${id}.${timestamp}.${rawBody}`);
  if (!expected) return null;
  return signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .some((part) => safeEqual(expected, part.slice(3)));
}
