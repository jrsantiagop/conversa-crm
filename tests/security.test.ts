/**
 * Security helpers smoke tests.
 *
 * Run with: node --experimental-strip-types tests/security.test.ts
 * No external dependencies are required.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  assertBodySize,
  extractBearer,
  maskSecret,
  readRequiredEnv,
  safeEqual,
  validateApiKey,
  verifyHmacSha256,
} from "../src/lib/security/index.ts";

const SECRET = "fake-secret-for-tests";
const BODY = '{"event":"test","id":"evt_1"}';

type TestCase = [name: string, run: () => void];

const tests: TestCase[] = [
  ["safeEqual: equal strings", () => {
    assert.equal(safeEqual("abc123", "abc123"), true);
    assert.equal(safeEqual(SECRET, SECRET), true);
  }],

  ["safeEqual: different strings", () => {
    assert.equal(safeEqual("abc123", "abc124"), false);
    assert.equal(safeEqual("abc123", "ABC123"), false);
    assert.equal(safeEqual("abc123", "abc"), false);
  }],

  ["safeEqual: empty or non-string input", () => {
    assert.equal(safeEqual("", ""), false);
    assert.equal(safeEqual("", "x"), false);
    assert.equal(safeEqual(null as unknown as string, "x"), false);
  }],

  ["verifyHmacSha256: valid signature with prefix", () => {
    const digest = createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex");
    assert.equal(verifyHmacSha256(SECRET, BODY, `sha256=${digest}`), true);
  }],

  ["verifyHmacSha256: bare hexadecimal signature", () => {
    const digest = createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex");
    assert.equal(verifyHmacSha256(SECRET, BODY, digest), true);
    assert.equal(verifyHmacSha256(SECRET, BODY, digest.toUpperCase()), true);
  }],

  ["verifyHmacSha256: invalid signature and tampered body", () => {
    const digest = createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex");
    assert.equal(verifyHmacSha256(SECRET, BODY, `sha256=${"0".repeat(64)}`), false);
    assert.equal(verifyHmacSha256(SECRET, `${BODY} `, `sha256=${digest}`), false);
    assert.equal(verifyHmacSha256("another-fake-secret", BODY, `sha256=${digest}`), false);
  }],

  ["verifyHmacSha256: missing input never throws", () => {
    assert.equal(verifyHmacSha256("", BODY, "sha256=deadbeef"), false);
    assert.equal(verifyHmacSha256(SECRET, "", "sha256=deadbeef"), false);
    assert.equal(verifyHmacSha256(SECRET, BODY, ""), false);
    assert.equal(verifyHmacSha256(SECRET, BODY, null as unknown as string), false);
    assert.equal(verifyHmacSha256(SECRET, BODY, "sha256=zzzz"), false);
  }],

  ["verifyHmacSha256: base64 encoding override", () => {
    const digest = createHmac("sha256", SECRET).update(BODY, "utf8").digest("base64");
    assert.equal(
      verifyHmacSha256(SECRET, BODY, `sha256=${digest}`, { encoding: "base64" }),
      true,
    );
    assert.equal(
      verifyHmacSha256(SECRET, BODY, digest, { prefix: "", encoding: "base64" }),
      true,
    );
  }],

  ["extractBearer: valid and invalid headers", () => {
    assert.equal(extractBearer("Bearer token123"), "token123");
    assert.equal(extractBearer("bearer token123"), "token123");
    assert.equal(extractBearer("  Bearer   token123  "), "token123");
    assert.equal(extractBearer("Basic token123"), null);
    assert.equal(extractBearer("Bearer"), null);
    assert.equal(extractBearer(null), null);
  }],

  ["validateApiKey: accepted and rejected keys", () => {
    assert.equal(validateApiKey("key123", "key123"), true);
    assert.equal(validateApiKey(" key123 ", "key123"), true);
    assert.equal(validateApiKey("key123", "key124"), false);
    assert.equal(validateApiKey("", ""), false);
    assert.equal(validateApiKey("key123", ""), false);
    assert.equal(validateApiKey(null, "key123"), false);
  }],

  ["maskSecret: reveals only the last four characters", () => {
    assert.equal(maskSecret("abcdefgh1234"), "••••••••1234");
    assert.equal(maskSecret("abcd"), "••••");
    assert.equal(maskSecret("ab"), "••");
    assert.equal(maskSecret(""), "");
    assert.equal(maskSecret(null), "");
  }],

  ["assertBodySize: within and over the byte limit", () => {
    assert.equal(assertBodySize("abc", 3), true);
    assert.equal(assertBodySize("abcd", 3), false);
    assert.equal(assertBodySize("", 0), true);
    assert.equal(assertBodySize(new Uint8Array(10), 10), true);
    assert.equal(assertBodySize(new Uint8Array(11), 10), false);
  }],

  ["assertBodySize: counts UTF-8 bytes", () => {
    assert.equal(assertBodySize("á", 1), false);
    assert.equal(assertBodySize("á", 2), true);
    assert.equal(assertBodySize("á", -1), false);
    assert.equal(assertBodySize(null, 10), false);
  }],

  ["readRequiredEnv: clear error without leaking values", () => {
    const name = "CONVERSA_TEST_MISSING_ENV_VAR_XYZ";
    assert.throws(
      () => readRequiredEnv(name),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(name));
        assert.doesNotMatch(error.message, /fake-secret/);
        return true;
      },
    );
  }],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

console.log(`${tests.length - failed}/${tests.length} tests passed`);
if (failed > 0) process.exitCode = 1;
