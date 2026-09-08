import { jwtVerify } from "jose";

export type SessionTokenErrorCode =
  | "MISSING_TOKEN"
  | "INVALID_TOKEN"
  | "SHOP_NOT_ALLOWED";

export class SessionTokenError extends Error {
  constructor(
    readonly code: SessionTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionTokenError";
  }
}

export interface AdminSession {
  /** e.g. "wildandking-demo.myshopify.com" */
  shopDomain: string;
  /** Shopify staff user id, from the `sub` claim. Used for audit fields. */
  userId: string;
}

export interface VerifyOptions {
  apiKey: string;
  apiSecret: string;
  allowedShops: string[];
}

function hostOf(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Verify a Shopify App Bridge session token.
 *
 * Pure: every input arrives as an argument so this is testable without env
 * vars or a Next.js request. The wrapper in requireAdminSession.ts reads env.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  opts: VerifyOptions,
): Promise<AdminSession> {
  // Fail closed on a missing configuration. An empty secret is a valid
  // zero-length HMAC key, so `jose` would happily verify a token anyone can
  // mint; an empty apiKey makes `jose` skip the audience check entirely.
  // This must run before any parsing.
  if (!opts.apiSecret || !opts.apiKey) {
    throw new SessionTokenError(
      "INVALID_TOKEN",
      "Session token verification is not configured",
    );
  }

  if (!token) {
    throw new SessionTokenError("MISSING_TOKEN", "Missing session token");
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(
      token,
      new TextEncoder().encode(opts.apiSecret),
      {
        algorithms: ["HS256"],
        audience: opts.apiKey,
        clockTolerance: 5,
        // Without this a token that simply omits `exp` never expires.
        requiredClaims: ["exp", "nbf", "sub", "dest", "iss", "aud"],
      },
    );
    payload = verified.payload as Record<string, unknown>;
  } catch {
    throw new SessionTokenError(
      "INVALID_TOKEN",
      "Session token failed signature, audience or expiry verification",
    );
  }

  const destHost = hostOf(payload.dest);
  if (!destHost) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token has no valid dest claim");
  }

  const issHost = hostOf(payload.iss);
  if (!issHost) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token has no valid iss claim");
  }

  if (issHost !== destHost) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token iss does not match dest");
  }

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) {
    throw new SessionTokenError("INVALID_TOKEN", "Session token has no sub claim");
  }

  if (!opts.allowedShops.includes(destHost)) {
    throw new SessionTokenError("SHOP_NOT_ALLOWED", `Shop ${destHost} is not allowed`);
  }

  return { shopDomain: destHost, userId };
}
