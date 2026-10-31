import { describe, expect, it, beforeEach } from "vitest";
import {
  createWebAuthnChallenge,
  consumeWebAuthnChallenge,
  resetChallengesForTests,
  getExpectedRpConfig,
} from "../../src/lib/auth/webauthn";

describe("webauthn helpers", () => {
  beforeEach(() => {
    resetChallengesForTests();
  });

  it("creates and consumes a one-time challenge", () => {
    const key = "test-key";
    const challenge = createWebAuthnChallenge(key);
    expect(challenge).toBeTypeOf("string");
    expect(challenge.length).toBeGreaterThan(20);

    const consumed = consumeWebAuthnChallenge(key);
    expect(consumed).toBe(challenge);

    // Second consume should fail (one-time use)
    const secondConsume = consumeWebAuthnChallenge(key);
    expect(secondConsume).toBeNull();
  });

  it("extracts rpID and origin from request or APP_ORIGIN", () => {
    const req = new Request("https://runway.example.com/api/test");
    const { rpID, origin } = getExpectedRpConfig(req);
    expect(rpID).toBe("runway.example.com");
    expect(origin).toBe("https://runway.example.com");
  });
});
