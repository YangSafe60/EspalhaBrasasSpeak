import { describe, expect, it } from "vitest";
import { encryptKeyBackup, isEncryptedKeyBackup, readKeyBackup } from "../keyBackup";

const keys = { publicKey: "pub-key-base64", privateKey: "priv-key-base64" };

describe("key backup", () => {
  it("round-trips with the right password", async () => {
    const text = await encryptKeyBackup(keys, "correct horse");
    expect(isEncryptedKeyBackup(text)).toBe(true);
    expect(text).not.toContain(keys.privateKey);
    await expect(readKeyBackup(text, "correct horse")).resolves.toEqual(keys);
  }, 30_000);

  it("rejects a wrong password, tampering and short passwords", async () => {
    const text = await encryptKeyBackup(keys, "correct horse");
    await expect(readKeyBackup(text, "wrong horse!")).rejects.toThrow();
    const data = JSON.parse(text);
    data.ct = data.ct.slice(0, -4) + (data.ct.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(readKeyBackup(JSON.stringify(data), "correct horse")).rejects.toThrow();
    await expect(encryptKeyBackup(keys, "short")).rejects.toThrow();
  }, 30_000);
});
