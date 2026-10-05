import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/auth/password";

describe("owner password helpers", () => {
  const password = "correct horse battery staple";

  it("verifies a password using its encoded scrypt hash", async () => {
    const encoded = await hashPassword(password);

    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword(password, encoded)).resolves.toBe(true);
    await expect(verifyPassword("another password", encoded)).resolves.toBe(false);
  });

  it("uses a fresh random salt for each hash", async () => {
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    expect(first.split("$")[4]).not.toBe(second.split("$")[4]);
  });

  it("rejects invalid password lengths and malformed hashes", async () => {
    await expect(hashPassword("short" )).rejects.toThrow("Password must be between");
    await expect(hashPassword("x".repeat(1_025))).rejects.toThrow("Password must be between");
    await expect(verifyPassword("short", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword(password, "scrypt$16384$8$1$bad$bad")).resolves.toBe(false);
  });
});
