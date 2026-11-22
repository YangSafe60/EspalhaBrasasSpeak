import { describe, expect, it } from "vitest";
import { decryptAttachment, encryptAttachment } from "../attachmentCrypto";

const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n)).buffer;

describe("attachment encryption", () => {
  it("round-trips and never stores the plain bytes", async () => {
    const plain = new TextEncoder().encode("PNG-ish content ".repeat(100)).buffer;
    const { data, key } = await encryptAttachment(plain);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new TextDecoder().decode(data)).not.toContain("PNG-ish content");
    const back = await decryptAttachment(data, key);
    expect(new Uint8Array(back)).toEqual(new Uint8Array(plain));
  });

  it("uses a new key and IV every time", async () => {
    const plain = bytes(64);
    const a = await encryptAttachment(plain);
    const b = await encryptAttachment(plain);
    expect(a.key).not.toBe(b.key);
    expect(new Uint8Array(a.data)).not.toEqual(new Uint8Array(b.data));
  });

  it("rejects a wrong key, tampering and plain files", async () => {
    const { data, key } = await encryptAttachment(bytes(256));
    const other = await encryptAttachment(bytes(8));
    await expect(decryptAttachment(data, other.key)).rejects.toThrow();
    const tampered = new Uint8Array(data.slice(0));
    tampered[tampered.length - 1] ^= 1;
    await expect(decryptAttachment(tampered.buffer, key)).rejects.toThrow();
    await expect(decryptAttachment(bytes(256), key)).rejects.toThrow(/not an encrypted/);
  });
});
