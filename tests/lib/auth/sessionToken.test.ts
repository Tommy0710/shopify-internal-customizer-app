import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  SessionTokenError,
  verifySessionToken,
} from "@/lib/auth/sessionToken";

const API_KEY = "21102b2e2138173c5ab87e5ad38ef1e4";
const API_SECRET = "test_secret_that_is_long_enough_for_hs256";
const SHOP = "wildandking-demo.myshopify.com";

const secret = new TextEncoder().encode(API_SECRET);
const opts = { apiKey: API_KEY, apiSecret: API_SECRET, allowedShops: [SHOP] };

async function mintToken(
  overrides: Record<string, unknown> = {},
  signingKey: Uint8Array = secret,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: API_KEY,
    sub: "42",
    nbf: now - 10,
    iat: now - 10,
    ...overrides,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(typeof overrides.exp === "number" ? overrides.exp : now + 60)
    .sign(signingKey);
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SessionTokenError);
  await promise.catch((error) => {
    expect((error as SessionTokenError).code).toBe(code);
  });
}

describe("verifySessionToken", () => {
  it("accepts a well-formed token and returns shop and user", async () => {
    const session = await verifySessionToken(await mintToken(), opts);
    expect(session).toEqual({ shopDomain: SHOP, userId: "42" });
  });

  it("rejects a missing token", async () => {
    await expectCode(verifySessionToken(null, opts), "MISSING_TOKEN");
    await expectCode(verifySessionToken("", opts), "MISSING_TOKEN");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const wrongKey = new TextEncoder().encode("a_completely_different_secret_value");
    await expectCode(
      verifySessionToken(await mintToken({}, wrongKey), opts),
      "INVALID_TOKEN",
    );
  });

  it("rejects a token minted for another app", async () => {
    await expectCode(
      verifySessionToken(await mintToken({ aud: "some_other_app_key" }), opts),
      "INVALID_TOKEN",
    );
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expectCode(
      verifySessionToken(await mintToken({ exp: past }), opts),
      "INVALID_TOKEN",
    );
  });

  it("rejects a token whose iss host differs from dest", async () => {
    await expectCode(
      verifySessionToken(
        await mintToken({ iss: "https://attacker.myshopify.com/admin" }),
        opts,
      ),
      "INVALID_TOKEN",
    );
  });

  it("rejects a shop outside the allowlist", async () => {
    const other = "someone-else.myshopify.com";
    await expectCode(
      verifySessionToken(
        await mintToken({ iss: `https://${other}/admin`, dest: `https://${other}` }),
        opts,
      ),
      "SHOP_NOT_ALLOWED",
    );
  });

  it("rejects a token without a sub claim", async () => {
    await expectCode(
      verifySessionToken(await mintToken({ sub: undefined }), opts),
      "INVALID_TOKEN",
    );
  });
});
