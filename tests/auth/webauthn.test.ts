import { describe, expect, it, beforeEach, vi } from "vitest";

const challengeMap = new Map<string, { challenge: string; expiresAt: Date }>();

vi.mock("../../src/db", () => ({
  db: {
    delete: vi.fn().mockImplementation((table) => ({
      where: vi.fn().mockImplementation((condition) => {
        return Promise.resolve([]);
      }),
      then: (resolve: any) => Promise.resolve([]).then(resolve),
      catch: (reject: any) => Promise.resolve([]).catch(reject),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((vals) => {
        challengeMap.set(vals.key, { challenge: vals.challenge, expiresAt: vals.expiresAt });
        return Promise.resolve([]);
      }),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation((condition) => ({
          limit: vi.fn().mockImplementation(() => {
            // Find in mock map
            const entry = Array.from(challengeMap.entries())[0];
            if (!entry) return Promise.resolve([]);
            const [key, val] = entry;
            challengeMap.delete(key);
            return Promise.resolve([{ key, challenge: val.challenge, expiresAt: val.expiresAt }]);
          }),
        })),
      })),
    })),
  },
}));

import {
  createWebAuthnChallenge,
  consumeWebAuthnChallenge,
  resetChallengesForTests,
  getExpectedRpConfig,
} from "../../src/lib/auth/webauthn";

describe("webauthn helpers", () => {
  beforeEach(async () => {
    await resetChallengesForTests();
  });

  it("creates and consumes a one-time challenge", async () => {
    const key = "test-key";
    const challenge = await createWebAuthnChallenge(key);
    expect(challenge).toBeTypeOf("string");
    expect(challenge.length).toBeGreaterThan(20);

    const consumed = await consumeWebAuthnChallenge(key);
    expect(consumed).toBe(challenge);

    // Second consume should fail (one-time use)
    const secondConsume = await consumeWebAuthnChallenge(key);
    expect(secondConsume).toBeNull();
  });

  it("extracts rpID and origin from request or APP_ORIGIN", () => {
    const req = new Request("https://runway.example.com/api/test");
    const { rpID, origin } = getExpectedRpConfig(req);
    expect(rpID).toBe("runway.example.com");
    expect(origin).toBe("https://runway.example.com");
  });

  it("handles forwarded proxy headers, multi-hop chains, and normalizes default ports", () => {
    const req = new Request("http://127.0.0.1:3000/api/test", {
      headers: {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "runway.custom.org:443, proxy2.internal",
      },
    });
    const { rpID, origin } = getExpectedRpConfig(req);
    expect(rpID).toBe("runway.custom.org");
    expect(origin).toBe("https://runway.custom.org");
  });
});
