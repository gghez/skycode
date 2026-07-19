import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "@/lib/crypto/token-cipher";

// 32 bytes hex = 64 chars
const KEY = "0".repeat(64);

describe("token-cipher", () => {
  beforeAll(() => {
    process.env.SKYCODE_ENCRYPTION_KEY = KEY;
  });

  it("round-trips a token", () => {
    const plain = "glpat-abc123";
    const encrypted = encryptToken(plain);
    expect(encrypted).not.toContain(plain);
    expect(decryptToken(encrypted)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  it("throws when the key is missing", () => {
    delete process.env.SKYCODE_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow();
    process.env.SKYCODE_ENCRYPTION_KEY = KEY;
  });

  it("throws a descriptive error when the key is the right length but not hex", () => {
    process.env.SKYCODE_ENCRYPTION_KEY = "z".repeat(64);
    expect(() => encryptToken("x")).toThrow(/64-character hex string/);
    process.env.SKYCODE_ENCRYPTION_KEY = KEY;
  });

  it("throws a descriptive error on a corrupt payload", () => {
    expect(() => decryptToken("")).toThrow(/corrupt token payload/i);
    expect(() => decryptToken("only-one-part")).toThrow(/corrupt token payload/i);
    expect(() => decryptToken("aa:bb")).toThrow(/corrupt token payload/i);
    expect(() => decryptToken("aa:bb:cc:dd")).toThrow(/corrupt token payload/i);
  });
});
